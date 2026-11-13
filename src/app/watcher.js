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
 * - Telegram rejects the formatting: the same text is resent without it.
 * - 403 (they blocked the bot): the subscriber is marked stopped.
 * - Other 400s: given up (retrying won't help). Anything else: retry on the next check.
 */
function deliverOnce(ctx, sub, id, text, parseMode, replyTo) {
  try {
    var result;
    try {
      result = sendTelegram(ctx.api, sub.chatId, text, { parseMode: parseMode, replyTo: replyTo });
    } catch (e) {
      if (e.status !== 400 || !parseMode) throw e;
      result = sendTelegram(ctx.api, sub.chatId, llmUnescape(text), { parseMode: null, replyTo: replyTo });
    }
    sub.sent.push(id);
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
      sub.sent.push(id);
      return { status: 'skip' };
    }
    ctx.log('Could not send to chat ' + sub.chatId + ': ' + e.message);
    return { status: 'retry' };
  }
}

/** Tells the owner about a problem, once per distinct problem. */
function reportProblem(ctx, message) {
  ctx.log(message);
  if (message === ctx.state.lastError) return;
  ctx.state.lastError = message;
  if (ctx.ownerChatId) botTrySend(ctx, ctx.ownerChatId, '<b>[Watcher Problem]</b>\n' + tplEscape(message), dismissButton());
}

/**
 * Checks the sheet and sends alerts. Returns { ok, baseline, sent }.
 * - First run: saves a baseline silently.
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
    return { ok: true, baseline: true, sent: 0 };
  }

  if (!result.bandChanges.length && !result.playerChanges.length) {
    state.snapshot = result.snapshot;
    return { ok: true, baseline: false, sent: 0 };
  }

  var notifications = buildNotifications(result.bandChanges, result.playerChanges, ctx.rewrite);
  var runKey = stableHash(JSON.stringify(state.snapshot));
  notifications.forEach(function (n) { n.id = stableHash(runKey + JSON.stringify(n.change)); });

  var sent = 0;
  var retryLater = false;
  approvedSubscribers(state).forEach(function (sub) {
    var alerts = resolveAlerts(sub.alerts);
    notifications.forEach(function (n) {
      if (sub.status !== 'approved') return;
      // Favourites and watched bands override the subscriber's switches
      // (see notify/favourites.js and notify/watch.js).
      var favourites = favouritesInChange(n.change, sub.favourites);
      var watched = changeIsWatched(n.change, sub.watching);
      if (!favourites.length && !watched && !wantsChange(n.change, alerts)) return;

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
      if (watched && sub.status === 'approved' && sub.sent.indexOf(n.id + ':watch') < 0) {
        var eyes = deliverOnce(ctx, sub, n.id + ':watch', watchNotice(n.change), 'HTML', updateMessageId);
        if (eyes.status === 'retry') retryLater = true;
      }
    });
    if (sub.sent.length > MAX_SENT_IDS) sub.sent = sub.sent.slice(-MAX_SENT_IDS);
  });

  if (retryLater) {
    reportProblem(ctx, 'Some alerts could not be sent. The watcher will try again on its next check.');
    return { ok: false, baseline: false, sent: sent };
  }
  state.snapshot = result.snapshot;
  return { ok: true, baseline: false, sent: sent };
}
