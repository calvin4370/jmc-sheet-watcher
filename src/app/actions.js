/*
 * Bot actions that change something, shared by the commands and buttons (bot.js) and by
 * SoC LaaS's action tools (llm/actionTools.js), so both always behave the same.
 *
 * Each action changes the state passed in and returns:
 *   { ok, changed, html, notify? }
 *   ok:      false if it couldn't be done (html says why)
 *   changed: false if nothing needed changing (e.g. already a favourite)
 *   html:    the reply for the person (Telegram HTML)
 *   notify:  [{ chatId, html }] messages for other people, sent by the caller
 * Actions never send messages themselves, so they can be tried on a copy of the state
 * first (SoC LaaS does this before asking for confirmation).
 */

function actionResult(ok, changed, html, notify) {
  return { ok: ok, changed: changed, html: html, notify: notify || [] };
}

/** Adds a favourite. `text` must contain an @handle, e.g. 'Name (@handle)'. */
function actionAddFavourite(sub, text) {
  var handle = handleFromText(text);
  if (!handle) return actionResult(false, false, 'Please include their Telegram handle, e.g. /favourite Oli (@oli).');
  sub.favourites = sub.favourites || [];
  var key = handleKey(handle);
  if (sub.favourites.some(function (h) { return handleKey(h) === key; })) {
    return actionResult(true, false, tplEscape(handle) + ' is already one of your favourites.');
  }
  if (sub.favourites.length >= MAX_FAVOURITES) {
    return actionResult(false, false, 'You already have ' + MAX_FAVOURITES + ' favourites. Remove one with /favourites first.');
  }
  sub.favourites.push(handle);
  return actionResult(true, true, '⭐ Added ' + tplEscape(handle) + ' to your favourites. You\'ll get a ⭐ message whenever ' +
    'they join, leave or are swapped in a band, or their Player Finder entry changes.');
}

function actionRemoveFavourite(sub, text) {
  var handle = handleFromText(text);
  var key = handleKey(handle);
  var before = (sub.favourites || []).length;
  sub.favourites = (sub.favourites || []).filter(function (h) { return handleKey(h) !== key; });
  return handle && sub.favourites.length < before
    ? actionResult(true, true, 'Removed ' + tplEscape(handle) + ' from your favourites.')
    : actionResult(false, false, 'That handle isn\'t in your favourites. See them with /favourites.');
}

/** id: 'one-song#3' (see watch.js). Only bands in the sheet copy now can be added. */
function actionWatchBand(state, sub, id) {
  if (!id) return actionResult(false, false, 'Say which band, e.g. /watch one-song 3 or /watch two-song 4.');
  sub.watching = sub.watching || [];
  if (sub.watching.indexOf(id) >= 0) {
    return actionResult(true, false, 'You\'re already watching ' + tplEscape(watchedBandLabel(id)) + '.');
  }
  var band = null;
  ((state.snapshot && state.snapshot.bands) || []).forEach(function (b) { if (b.id === id) band = b; });
  if (!band) return actionResult(false, false, 'There\'s no ' + tplEscape(watchedBandLabel(id)) + ' in the sheet right now.');
  if (sub.watching.length >= MAX_WATCHED_BANDS) {
    return actionResult(false, false, 'You\'re already watching ' + MAX_WATCHED_BANDS + ' bands. Remove one with /watching first.');
  }
  sub.watching.push(id);
  return actionResult(true, true, '👀 Now watching:\n' + tplBandLine(band).replace(/^- /, '') + '\n' +
    'You\'ll get every update for this band, even if that alert type is off in /settings.');
}

function actionUnwatchBand(sub, id) {
  var before = (sub.watching || []).length;
  sub.watching = (sub.watching || []).filter(function (w) { return w !== id; });
  return id && sub.watching.length < before
    ? actionResult(true, true, 'Stopped watching ' + tplEscape(watchedBandLabel(id)) + '.')
    : actionResult(false, false, 'You aren\'t watching that band. See your list with /watching.');
}

/** changes: [{ alert: key in ALERT_LABELS, on: true/false }] */
function actionSetAlerts(sub, changes) {
  var current = resolveAlerts(sub.alerts);
  var done = [];
  var changed = false;
  for (var i = 0; i < changes.length; i++) {
    var key = changes[i].alert;
    if (!ALERT_LABELS[key]) return actionResult(false, false, 'Unknown alert "' + tplEscape(key) + '".');
    if (current[key] !== changes[i].on) changed = true;
    sub.alerts[key] = changes[i].on;
    done.push(ALERT_LABELS[key] + ': ' + (changes[i].on ? 'on' : 'off'));
  }
  return actionResult(true, changed, (changed ? 'Alerts updated. ' : 'Already set. ') + tplEscape(done.join(', ')) + '.');
}

function actionStopAlerts(sub) {
  if (sub.status === 'stopped') return actionResult(true, false, 'Your alerts are already stopped. Send /start to turn them back on.');
  sub.status = 'stopped';
  return actionResult(true, true, 'Alerts stopped. Send /start to turn them back on.');
}

var OWNER_ACTIONS = {
  approve: { status: 'approved', note: '✅ Approved',
    tell: 'You\'re approved! You\'ll now get alerts. Use /settings to choose which ones.' },
  reject: { status: 'rejected', note: '❌ Rejected', tell: 'Sorry, your request was declined.' },
  remove: { status: 'removed', note: '🗑 Removed', tell: 'The owner has turned off your alerts.' }
};

/** Owner: approve / reject / remove a subscriber. The subscriber is told (notify). */
function actionManageSubscriber(state, ownerChatId, targetChatId, action) {
  var act = OWNER_ACTIONS[action];
  var target = state.subscribers[String(targetChatId)];
  if (!act) return actionResult(false, false, 'Unknown action.');
  if (!target) return actionResult(false, false, 'Unknown subscriber.');
  if (String(targetChatId) === String(ownerChatId)) return actionResult(false, false, 'You can\'t do that to yourself.');
  if (target.status === act.status) {
    return actionResult(true, false, tplEscape(target.name) + ' is already ' + act.status + '.');
  }
  target.status = act.status;
  return actionResult(true, true, act.note + ': ' + tplEscape(target.name), [{ chatId: target.chatId, html: act.tell }]);
}

function actionSaveAboutMe(state, note) {
  if (aboutMeSize(note) > aboutMeMax()) {
    return actionResult(false, false, 'That note is too long (' + aboutMeSize(note) + '/' + ABOUT_ME_LIMIT + ').');
  }
  var changed = (state.memory.aboutMe || '') !== note;
  state.memory.aboutMe = note;
  return actionResult(true, changed, 'Your /aboutme note is now:\n' + tplEscape(note) + '\n\n<i>' +
    tplEscape(aboutMeSizeLine(note)) + '</i>');
}

function actionClearAboutMe(state) {
  if (!state.memory.aboutMe) return actionResult(true, false, 'Your /aboutme note is already empty.');
  state.memory.aboutMe = '';
  return actionResult(true, true, 'Your /aboutme note is cleared.');
}
