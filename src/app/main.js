/*
 * Apps Script entry points.
 *
 * Run from the editor:
 *   setup()          start (or restart) everything: the sheet timer and the Telegram webhook
 *   webhookStatus()  show whether Telegram can deliver messages to the bot
 *   checkSheetNow()  check the sheet right away
 *   resetBaseline()  forget the last snapshot; the next check is a silent baseline
 *   stopWatcher()    stop everything: remove the timer and the webhook
 *
 * Called automatically:
 *   doPost(e)        Telegram delivers each bot message here, instantly (webhook)
 *   tick()           the timer: checks the sheet every SETTINGS.checkEveryMinutes
 *
 * Script Properties (Project Settings → Script Properties), never in code:
 *   TELEGRAM_BOT_TOKEN       from @BotFather
 *   TELEGRAM_OWNER_CHAT_ID   your chat ID (send /myid to the bot)
 *   WATCHED_SPREADSHEET_URL  the Google Sheet's link (https://docs.google.com/spreadsheets/d/…/edit)
 *   SOCLAAS_BASE_URL, SOCLAAS_API_KEY, SOCLAAS_MODEL   (optional: LLM)
 *   TELEGRAM_WEBHOOK_SECRET  created by setup(); never shown
 */

/** Timer frequencies Apps Script supports, in minutes. */
var ALLOWED_TIMER_MINUTES = [1, 5, 10, 15, 30];

/**
 * Run this from the editor (it's first, so the Run button picks it by default).
 * Prints which settings are filled in (never the values), starts the sheet timer,
 * and points Telegram at the web app.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  [
    ['TELEGRAM_BOT_TOKEN', true],
    ['WATCHED_SPREADSHEET_URL', true],
    ['TELEGRAM_OWNER_CHAT_ID', false],
    ['SOCLAAS_BASE_URL', false],
    ['SOCLAAS_API_KEY', false],
    ['SOCLAAS_MODEL', false]
  ].forEach(function (c) {
    var set = !!props.getProperty(c[0]);
    console.log((set ? '✓ ' : (c[1] ? '✗ MISSING ' : '– not set yet ')) + c[0]);
  });
  if (!props.getProperty('TELEGRAM_BOT_TOKEN') || !props.getProperty('WATCHED_SPREADSHEET_URL')) {
    console.log('Not started: add the MISSING Script Properties (Project Settings), then run setup again.');
    return;
  }
  try {
    spreadsheetIdFromUrl(props.getProperty('WATCHED_SPREADSHEET_URL'));
  } catch (e) {
    console.log('Not started: ' + e.message);
    return;
  }
  if (ALLOWED_TIMER_MINUTES.indexOf(SETTINGS.checkEveryMinutes) < 0) {
    console.log('Not started: SETTINGS.checkEveryMinutes must be one of ' + ALLOWED_TIMER_MINUTES.join(', ') + '.');
    return;
  }
  if (!props.getProperty('TELEGRAM_WEBHOOK_SECRET')) {
    props.setProperty('TELEGRAM_WEBHOOK_SECRET',
      Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
    console.log('✓ Created the webhook secret (stored in Script Properties).');
  }

  appsScriptSetTimerMinutes(SETTINGS.checkEveryMinutes, true);
  console.log('✓ Sheet timer: every ' + SETTINGS.checkEveryMinutes + ' minutes.');

  var ctx = appsScriptContext(appsScriptLoadState());
  if (!SETTINGS.webhook.deploymentId) {
    console.log('✗ Webhook not set: the web app has not been deployed yet, so the bot cannot receive messages.');
    return;
  }
  ctx.api.call('setWebhook', {
    url: webhookUrl(SETTINGS.webhook.deploymentId, props.getProperty('TELEGRAM_WEBHOOK_SECRET')),
    allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    max_connections: 1
  });
  console.log('✓ Webhook set: Telegram now delivers bot messages instantly.' +
    (props.getProperty('TELEGRAM_OWNER_CHAT_ID') ? '' : ' Next: send /myid to your bot and save the number as TELEGRAM_OWNER_CHAT_ID.'));
}

/** Telegram delivers every bot message here. Ignores calls without the secret. */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var given = e && e.parameter ? e.parameter.secret : '';
  if (!secretsMatch(given, props.getProperty('TELEGRAM_WEBHOOK_SECRET'))) {
    console.warn('Ignored a web request without the right secret.');
    return webhookReply();
  }
  var update;
  try {
    update = JSON.parse(e.postData.contents);
  } catch (err) {
    console.warn('Ignored a webhook request that was not valid JSON.');
    return webhookReply();
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    // A sheet check is running: queue this message; it's handled right after.
    props.setProperty(QUEUED_UPDATE_PREFIX + update.update_id, JSON.stringify(update));
    return webhookReply();
  }
  var deferred = [];
  try {
    deferred = withState(function (state, ctx) {
      announceRelease(ctx);
      drainQueuedUpdates(ctx, props);
      processTelegramUpdate(ctx, update);
    });
  } finally {
    lock.releaseLock();
  }
  runDeferred(deferred);
  return webhookReply();
}

function webhookReply() {
  return HtmlService.createHtmlOutput('ok');
}

/** The timer: handles any queued bot messages, then checks the sheet. */
function tick() {
  runLocked(function (state, ctx) {
    announceRelease(ctx);
    drainQueuedUpdates(ctx, PropertiesService.getScriptProperties());
    runSheetCheck(ctx);
  });
}

/** Logs whether Telegram can reach the bot (the address itself is never shown). */
function webhookStatus() {
  var ctx = appsScriptContext(appsScriptLoadState());
  if (!ctx) return;
  var info = ctx.api.call('getWebhookInfo', {});
  console.log('Webhook set: ' + (info.url ? 'yes' : 'NO'));
  console.log('Messages waiting at Telegram: ' + (info.pending_update_count || 0));
  if (info.last_error_date) {
    console.log('Last delivery problem: ' + new Date(info.last_error_date * 1000).toString() +
      ' — ' + (info.last_error_message || ''));
  } else {
    console.log('No delivery problems reported.');
  }
}

function checkSheetNow() {
  runLocked(function (state, ctx) {
    console.log(JSON.stringify(runSheetCheck(ctx)));
  });
}

function resetBaseline() {
  runLocked(function (state) {
    state.snapshot = null;
    state.lastSheetCheck = 0;
    console.log('Snapshot cleared. The next check saves a new baseline without sending alerts.');
  });
}

/** Stops everything: no sheet checks, and Telegram stops delivering bot messages. */
function stopWatcher() {
  removeTimers();
  var ctx = appsScriptContext(appsScriptLoadState());
  if (ctx) ctx.api.call('deleteWebhook', {});
  console.log('Watcher stopped. Run setup to start it again.');
}

function removeTimers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty(TIMER_MINUTES_PROPERTY);
}

/** Script Property holding how often the sheet timer currently runs. */
var TIMER_MINUTES_PROPERTY = 'TIMER_MINUTES';

/**
 * Makes the sheet timer run every `minutes` (1 while edits settle, otherwise
 * SETTINGS.checkEveryMinutes). Does nothing if it already does, unless `force`.
 */
function appsScriptSetTimerMinutes(minutes, force) {
  var props = PropertiesService.getScriptProperties();
  if (!force && props.getProperty(TIMER_MINUTES_PROPERTY) === String(minutes)) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(minutes).create();
  props.setProperty(TIMER_MINUTES_PROPERTY, String(minutes));
  console.log('Sheet timer: every ' + minutes + ' minute(s).');
}

/** Runs fn(state, ctx) under the script lock (skips if another run holds it). */
function runLocked(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log('Another run is still going; skipping.');
    return;
  }
  var deferred = [];
  try {
    deferred = withState(fn);
  } finally {
    lock.releaseLock();
  }
  runDeferred(deferred);
}

/**
 * Loads state, runs fn(state, ctx), and saves state if it changed. Caller holds the lock.
 * Returns work deferred with ctx.defer (e.g. SoC LaaS answers), to run after unlocking.
 */
function withState(fn) {
  var state = appsScriptLoadState();
  var before = JSON.stringify(state);
  var ctx = appsScriptContext(state);
  if (!ctx) return [];
  var deferred = [];
  ctx.defer = function (task) { deferred.push(task); };
  try {
    fn(state, ctx);
  } finally {
    if (JSON.stringify(state) !== before) appsScriptSaveState(state);
  }
  return deferred;
}

/** Stores a SoC LaaS answer in the conversation memory (takes the lock briefly). */
function saveAssistantAnswer(questionAt, answer, chatId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    console.log('Could not store the SoC LaaS answer: the watcher was busy.');
    return;
  }
  try {
    var state = appsScriptLoadState();
    rememberAssistantAnswer(state, questionAt, answer, chatId);
    appsScriptSaveState(state);
  } finally {
    lock.releaseLock();
  }
}

/** For deferred work: loads the saved state under the lock, changes it, and saves it. */
function updateStoredState(change) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('the watcher was busy');
  try {
    var state = appsScriptLoadState();
    change(state);
    appsScriptSaveState(state);
  } finally {
    lock.releaseLock();
  }
}

/** Runs deferred work without the lock, so slow LLM calls don't block anything. */
function runDeferred(tasks) {
  if (!tasks || !tasks.length) return;
  var later = appsScriptContext(null);
  if (!later) return;
  tasks.forEach(function (task) {
    try {
      task(later);
    } catch (e) {
      console.error('Deferred task failed: ' + e.message);
    }
  });
}

function appsScriptContext(state) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set in Script Properties.');
    return null;
  }
  var sleep = function (ms) { Utilities.sleep(ms); };
  var log = function (message) { console.log(message); };
  var chat = createLlmChat({ config: appsScriptLlmConfig(), http: appsScriptCountedLlmHttp, sleep: sleep });
  return {
    state: state,
    api: createTelegramApi({ token: token, http: appsScriptHttp, sleep: sleep }),
    ownerChatId: props.getProperty('TELEGRAM_OWNER_CHAT_ID') || '',
    readSheets: function () {
      return readSheetsViaApi(spreadsheetIdFromUrl(props.getProperty('WATCHED_SPREADSHEET_URL')),
        appsScriptHttp, ScriptApp.getOAuthToken());
    },
    rewrite: createLlmRewriter({ config: appsScriptLlmConfig(), http: appsScriptCountedLlmHttp, sleep: sleep, log: log }),
    chat: chat,
    assistantAvailable: !!chat,
    saveAnswer: saveAssistantAnswer,
    updateState: updateStoredState,
    readState: appsScriptLoadState,
    setTimerMinutes: function (minutes) { appsScriptSetTimerMinutes(minutes, false); },
    llmRequestsToday: appsScriptLlmRequestsToday,
    now: function () { return Date.now(); },
    sleep: sleep,
    log: log
  };
}
