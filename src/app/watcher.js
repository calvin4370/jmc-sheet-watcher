/*
 * Watcher logic shared by the webhook (Telegram messages, handled instantly) and the
 * timer (sheet checks every SETTINGS.checkEveryMinutes).
 *
 * ctx: {
 *   state,                 // see state.js (modified in place; the caller saves it)
 *   api,                   // Telegram API (telegram.js)
 *   ownerChatId,           // owner's Telegram chat ID
 *   readSheets(),          // -> { sheetName: 2D display strings }
 *   rewrite,               // LLM rewriter for unclear cells, or null
 *   setTimerMinutes(m),    // optional: run the sheet timer every m minutes (main.js)
 *   now(), sleep(ms), log(message)
 * }
 */

/** Pause between Telegram messages, to stay well under Telegram's rate limits. */
var SEND_GAP_MS = 400;

/** Telegram update types the webhook receives. */
var TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query'];

/** Script Properties prefix for updates that arrived while another run held the lock. */
var QUEUED_UPDATE_PREFIX = 'QUEUED_UPDATE_';

/**
 * Handles one Telegram update, once. Telegram may deliver the same update again
 * (e.g. if it thinks delivery failed); updates already handled are ignored.
 * Returns true if the update was handled.
 */
function processTelegramUpdate(ctx, update) {
  if (!update || typeof update.update_id !== 'number') return false;
  if (update.update_id < (ctx.state.telegramOffset || 0)) return false;
  // Move past this update first, so a failing update is never handled twice.
  ctx.state.telegramOffset = update.update_id + 1;
  try {
    handleUpdate(update, ctx);
  } catch (e) {
    ctx.log('Could not handle a Telegram update: ' + e.message);
  }
  return true;
}

/**
 * Handles queued updates in order, removing them from the queue.
 * props: { getProperties(), deleteProperty(key) } (Apps Script Script Properties).
 */
function drainQueuedUpdates(ctx, props) {
  var all = props.getProperties();
  Object.keys(all)
    .filter(function (k) { return k.indexOf(QUEUED_UPDATE_PREFIX) === 0; })
    .sort(function (a, b) { return Number(a.slice(QUEUED_UPDATE_PREFIX.length)) - Number(b.slice(QUEUED_UPDATE_PREFIX.length)); })
    .forEach(function (key) {
      props.deleteProperty(key);
      var update = null;
      try { update = JSON.parse(all[key]); } catch (e) { ctx.log('Dropped an unreadable queued update.'); }
      processTelegramUpdate(ctx, update);
    });
}

/** Compares two secrets without stopping at the first difference. */
function secretsMatch(given, expected) {
  given = String(given || '');
  expected = String(expected || '');
  if (!expected || given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** The address Telegram delivers updates to (contains the secret: never log it). */
function webhookUrl(deploymentId, secret) {
  return 'https://script.google.com/macros/s/' + encodeURIComponent(deploymentId) +
    '/exec?secret=' + encodeURIComponent(secret);
}

/**
 * After an update, tells the owner what changed (RELEASE in config/release.js), once.
 * If sending fails, it's tried again on the next run.
 */
function announceRelease(ctx) {
  if (!ctx.ownerChatId || typeof RELEASE === 'undefined') return false;
  if (ctx.state.lastAnnouncedRelease === RELEASE.id) return false;
  var text = '<b>[Bot Updated]</b>\nWhat\'s new:\n' +
    RELEASE.notes.map(function (n) { return '• ' + tplEscape(n); }).join('\n');
  try {
    botSend(ctx, ctx.ownerChatId, text, dismissButton());
  } catch (e) {
    ctx.log('Could not send the update notice: ' + e.message);
    return false;
  }
  ctx.state.lastAnnouncedRelease = RELEASE.id;
  return true;
}

/**
 * Sends one alert message to a subscriber and records `id` as sent, so it is never sent
 * twice. Returns { status: 'sent' | 'skip' | 'retry', messageId }.
 * - Too long for one Telegram message: split into several (never cut short). Each part
 *   is recorded, so a retry only sends the parts still missing.
 * - Telegram rejects the formatting: the same text is resent without it.
 * - Telegram refuses it even then (400): a short plain notice is sent instead, saying an
 *   alert couldn't be shown and which band or person it was about; if even that is
 *   refused, the owner is told. Never dropped silently.
 * - 403 (they blocked the bot): the subscriber is marked stopped.
 * - Anything else: retry on the next check (the saved copy of the sheet isn't moved on).
 */
function deliverOnce(ctx, sub, id, text, parseMode, replyTo) {
  var split = splitTelegramText(text, parseMode === 'HTML');
  var mode = split.html ? parseMode : null;
  var firstMessageId = null;
  for (var i = 0; i < split.parts.length; i++) {
    var partId = split.parts.length > 1 ? id + ':part' + i : id;
    if (split.parts.length > 1 && sub.sent.indexOf(partId) >= 0) continue;
    var r = deliverPart(ctx, sub, split.parts[i], mode, i === 0 ? replyTo : null);
    if (r.status === 'refused') r = deliverRefusedNotice(ctx, sub, text, r.error, replyTo);
    if (r.status !== 'sent') return r;
    if (i === 0) firstMessageId = r.messageId;
    if (r.wholeAlert) break; // the notice stands in for the whole alert
    if (split.parts.length > 1) sub.sent.push(partId);
  }
  sub.sent.push(id);
  return { status: 'sent', messageId: firstMessageId };
}

/** Sends one message. Returns { status: 'sent' | 'skip' | 'retry' | 'refused', messageId, error }. */
function deliverPart(ctx, sub, text, parseMode, replyTo) {
  try {
    var result;
    try {
      result = sendTelegram(ctx.api, sub.chatId, text, { parseMode: parseMode, replyTo: replyTo });
    } catch (e) {
      if (e.status !== 400 || !parseMode) throw e;
      result = sendTelegram(ctx.api, sub.chatId, llmUnescape(text), { parseMode: null, replyTo: replyTo });
    }
    ctx.sleep(SEND_GAP_MS);
    return { status: 'sent', messageId: result && result.message_id };
  } catch (e) {
    if (e.status === 403) {
      sub.status = 'stopped';
      ctx.log('Chat ' + sub.chatId + ' blocked the bot; marked as stopped.');
      return { status: 'skip' };
    }
    if (e.status === 400) {
      ctx.log('Telegram refused a message for chat ' + sub.chatId + ': ' + e.message);
      return { status: 'refused', error: e.message };
    }
    ctx.log('Could not send to chat ' + sub.chatId + ': ' + e.message);
    return { status: 'retry' };
  }
}

/**
 * Telegram refused an alert: send a short plain notice in its place (the alert's header
 * and band/person line). If that is refused too, tell the owner. Returns like deliverPart,
 * with wholeAlert: true when the notice (or the owner's message) stands in for the alert.
 */
function deliverRefusedNotice(ctx, sub, text, error, replyTo) {
  var summary = llmUnescape(text).split('\n').filter(function (l) { return l.trim(); }).slice(0, 2).join('\n');
  var notice = '⚠ An alert couldn\'t be shown here (Telegram refused it: ' + error + ').\n' + summary +
    '\nPlease check the sheet for this change.';
  var r = deliverPart(ctx, sub, notice.slice(0, TELEGRAM_MAX_LENGTH), null, replyTo);
  if (r.status === 'refused') {
    botTrySend(ctx, ctx.ownerChatId, '<b>[Watcher Problem]</b>\nAn alert for ' + tplEscape(sub.name || sub.chatId) +
      ' could not be sent, not even as a short notice (Telegram: ' + tplEscape(r.error) + '). It was:\n' +
      tplEscape(summary), dismissButton());
    return { status: 'sent', messageId: null, wholeAlert: true };
  }
  if (r.status === 'sent') r.wholeAlert = true;
  return r;
}

/**
 * After each timer run (main.js guardTimerRun): if the run crashed (an error the sheet
 * check didn't handle itself, or saved state that can't be read), tells the owner once per
 * distinct error; when runs work again, says so. store: { get(), set(text) } holding the
 * last crash ('' = none), kept outside the saved state so it works even if that is broken.
 */
function noteTimerRun(ctx, store, error) {
  var last = store.get() || '';
  if (error) {
    if (error === last) return;
    store.set(error);
    botTrySend(ctx, ctx.ownerChatId, '<b>[Watcher Problem]</b>\nA sheet check crashed: ' + tplEscape(error) +
      '\nNo alerts are lost: the saved copy of the sheet only moves on after alerts are sent, so the next ' +
      'working check catches up.', dismissButton());
  } else if (last) {
    store.set('');
    botTrySend(ctx, ctx.ownerChatId, '<b>[Watcher Recovered]</b>\nSheet checks are working again.', dismissButton());
  }
}

/** Tells the owner about a problem, once per distinct problem. */
function reportProblem(ctx, message) {
  ctx.log(message);
  if (message === ctx.state.lastError) return;
  ctx.state.lastError = message;
  if (ctx.ownerChatId) botTrySend(ctx, ctx.ownerChatId, '<b>[Watcher Problem]</b>\n' + tplEscape(message), dismissButton());
}

/** Sets how often the sheet timer runs (does nothing if it already runs that often). */
function setCheckTimer(ctx, minutes) {
  if (!ctx.setTimerMinutes) return;
  try {
    ctx.setTimerMinutes(minutes);
  } catch (e) {
    ctx.log('Could not change the sheet timer to every ' + minutes + ' min: ' + e.message);
  }
}

/**
 * Checks the sheet and sends alerts. Returns { ok, baseline, sent, settling? }.
 * - First run: saves a baseline silently.
 * - Waits for edits to settle (SETTINGS.settle): a change is only sent once several
 *   checks in a row see the same sheet; meanwhile the sheet is checked every minute.
 * - Missing worksheet/header or read failure: tells the owner, keeps the old snapshot.
 * - Each subscriber gets only the messages their switches allow, each at most once.
 * - If a message can't be sent for a temporary reason, the old snapshot is kept so the
 *   next run tries again; subscribers who already got it are skipped.
 */
function runSheetCheck(ctx) {
  var state = ctx.state;
  state.lastSheetCheck = ctx.now();

  var result;
  try {
    result = detectChanges(state.snapshot, ctx.readSheets());
  } catch (e) {
    reportProblem(ctx, e.name === 'SchemaError'
      ? 'The sheet layout has changed, so alerts are paused until the watcher is updated. ' + e.message
      : 'Could not check the sheet: ' + e.message);
    return { ok: false, baseline: false, sent: 0 };
  }

  if (state.lastError) {
    state.lastError = '';
    if (ctx.ownerChatId) botTrySend(ctx, ctx.ownerChatId, '<b>[Watcher Recovered]</b>\nThe watcher is working again.', dismissButton());
  }

  if (result.baseline) {
    state.snapshot = result.snapshot;
    ctx.log('First run: baseline saved, no alerts sent.');
    // Never start fresh silently: if the saved copy was lost, edits since the last check
    // can't be alerted, so the owner must know.
    if (ctx.ownerChatId) {
      botTrySend(ctx, ctx.ownerChatId, '<b>[Watcher Started]</b>\nSaved a fresh copy of the sheet to compare ' +
        'against, so alerts start from now.\nIf you didn\'t just set up or reset the watcher, its saved copy ' +
        'was lost: edits made since the last check weren\'t alerted, so please look over the sheet.', dismissButton());
    }
    return { ok: true, baseline: true, sent: 0 };
  }

  if (!result.bandChanges.length && !result.playerChanges.length) {
    state.snapshot = result.snapshot;
    state.settling = null; // e.g. an edit was undone before it settled
    setCheckTimer(ctx, SETTINGS.checkEveryMinutes);
    return { ok: true, baseline: false, sent: 0 };
  }

  // Wait for edits to settle: compare everything the watcher reads with the last check.
  var settle = SETTINGS.settle;
  var hash = stableHash(JSON.stringify(result.snapshot));
  var s = state.settling || (state.settling = { since: ctx.now(), checks: 0, same: 0, hash: '' });
  s.checks++;
  s.same = s.hash === hash ? s.same + 1 : 1;
  s.hash = hash;
  if (s.same < settle.sameChecks && s.checks < settle.maxChecks) {
    setCheckTimer(ctx, settle.checkEveryMinutes);
    return { ok: true, baseline: false, sent: 0, settling: true };
  }

  var notifications = buildNotifications(result.bandChanges, result.playerChanges, ctx.rewrite);
  // Alert IDs: the saved copy plus a round number that goes up each time the saved copy
  // moves on after alerts. Retries of the same alerts keep their IDs (no duplicates), but
  // an edit that is undone and then redone gets new IDs, so it is alerted again.
  var round = state.alertRound || 0;
  var runKey = stableHash(JSON.stringify(state.snapshot)) + (round ? ':' + round : '');
  notifications.forEach(function (n) { n.id = stableHash(runKey + JSON.stringify(n.change)); });

  var sent = 0;
  var retryLater = false;
  approvedSubscribers(state).forEach(function (sub) {
    var alerts = resolveAlerts(sub.alerts);
    notifications.forEach(function (n) {
      if (sub.status !== 'approved') return;
      // Favourites and watched bands override the subscriber's switches
      // (see notify/favourites.js and notify/watch.js).
      // Favourites, watched bands and the subscriber's own bands override their switches
      // (notify/favourites.js, notify/watch.js, notify/myBands.js).
      var favourites = favouritesInChange(n.change, sub.favourites);
      var mine = myBandInChange(n.change, sub, alerts);
      var watched = !mine && changeIsWatched(n.change, sub.watching); // 🎸 replaces 👀
      if (!favourites.length && !mine && !watched && !wantsChange(n.change, alerts)) return;

      var updateMessageId = null;
      if (sub.sent.indexOf(n.id) < 0) {
        var update = deliverOnce(ctx, sub, n.id, n.text, n.parseMode, null);
        if (update.status === 'retry') retryLater = true;
        if (update.status !== 'sent') return;
        updateMessageId = update.messageId;
        sent++;
        if (String(sub.chatId) === String(ctx.ownerChatId)) rememberAlert(state, n.text, ctx.now());
      }
      if (favourites.length && sub.sent.indexOf(n.id + ':star') < 0) {
        var star = deliverOnce(ctx, sub, n.id + ':star', favouriteNotice(favourites), 'HTML', updateMessageId);
        if (star.status === 'retry') retryLater = true;
      }
      if (mine && sub.status === 'approved' && sub.sent.indexOf(n.id + ':mine') < 0) {
        var guitar = deliverOnce(ctx, sub, n.id + ':mine', myBandNotice(mine), 'HTML', updateMessageId);
        if (guitar.status === 'retry') retryLater = true;
      }
      if (watched && sub.status === 'approved' && sub.sent.indexOf(n.id + ':watch') < 0) {
        var eyes = deliverOnce(ctx, sub, n.id + ':watch', watchNotice(n.change), 'HTML', updateMessageId);
        if (eyes.status === 'retry') retryLater = true;
      }
    });
    if (sub.sent.length > MAX_SENT_IDS) sub.sent = sub.sent.slice(-MAX_SENT_IDS);
  });

  if (retryLater) {
    // Keep the old snapshot (and the settling count), so the next check sends the rest.
    setCheckTimer(ctx, SETTINGS.checkEveryMinutes);
    reportProblem(ctx, 'Some alerts could not be sent. The watcher will try again on its next check.');
    return { ok: false, baseline: false, sent: sent };
  }
  state.snapshot = result.snapshot;
  state.alertRound = round + 1;
  state.settling = null;
  setCheckTimer(ctx, SETTINGS.checkEveryMinutes);
  return { ok: true, baseline: false, sent: sent };
}
