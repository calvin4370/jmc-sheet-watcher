/*
 * /status (owner only): is the bot working? Shows the release, the last sheet check,
 * any current problem, subscribers, what the sheet copy holds, and SoC LaaS use today.
 */

/** "just now", "4 min ago", "2 h 5 min ago", "3 days ago" */
function timeAgo(ms, now) {
  var minutes = Math.floor(Math.max(0, now - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' h ' + (minutes % 60) + ' min ago';
  var days = Math.floor(hours / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

function statusMessage(ctx) {
  var state = ctx.state;
  var now = ctx.now();
  var today = singaporeDay(now);
  var lines = ['<b>[Status]</b>'];

  lines.push('<b>Version:</b> ' + tplEscape(typeof RELEASE === 'undefined' ? '?' : RELEASE.id));

  var check = 'never';
  if (state.lastSheetCheck) {
    check = singaporeTime(state.lastSheetCheck) + ' (' + timeAgo(state.lastSheetCheck, now) + ')';
    var lateAfter = (2 * SETTINGS.checkEveryMinutes + 1) * 60000;
    if (now - state.lastSheetCheck > lateAfter) {
      check += '\n⚠ Late: checks should run every ' + SETTINGS.checkEveryMinutes + ' minutes. Is the timer still set?';
    }
  }
  lines.push('<b>Last sheet check:</b> ' + check);
  if (state.settling) {
    lines.push('<b>Waiting for edits to settle:</b> ' + state.settling.same + '/' + SETTINGS.settle.sameChecks +
      ' same checks (check ' + state.settling.checks + ' of at most ' + SETTINGS.settle.maxChecks + ', every ' +
      SETTINGS.settle.checkEveryMinutes + ' min)');
  }
  lines.push('<b>Problem:</b> ' + (state.lastError ? '⚠ ' + tplEscape(state.lastError) : 'none'));

  var counts = {};
  var questions = 0;
  Object.keys(state.subscribers).forEach(function (id) {
    var s = state.subscribers[id];
    counts[s.status] = (counts[s.status] || 0) + 1;
    if (s.questionsToday && s.questionsToday.day === today) questions += s.questionsToday.count;
  });
  var order = ['approved', 'pending', 'stopped', 'removed', 'rejected'];
  var parts = order.filter(function (k) { return counts[k]; }).map(function (k) { return counts[k] + ' ' + k; });
  lines.push('<b>Subscribers:</b> ' + (parts.length ? parts.join(', ') : 'none'));

  var snap = state.snapshot;
  if (snap) {
    var one = snap.bands.filter(function (b) { return b.bandType === 'one-song'; }).length;
    lines.push('<b>Sheet:</b> ' + one + ' one-song bands, ' + (snap.bands.length - one) + ' two-song bands, ' +
      snap.players.length + ' in Player Finder');
  } else {
    lines.push('<b>Sheet:</b> no copy yet (the first check saves one)');
  }

  var llm = ctx.assistantAvailable ? 'on' : 'off';
  if (ctx.assistantAvailable) {
    var requests = ctx.llmRequestsToday ? ctx.llmRequestsToday() : null;
    if (requests !== null) llm += ', ' + requests + ' API requests today';
    llm += ', ' + questions + ' subscriber questions today';
  }
  lines.push('<b>SoC LaaS:</b> ' + llm);
  return lines.join('\n');
}

/* ---------------- SoC LaaS request count (Apps Script) ----------------
 * Every request to SoC LaaS (including retries) is counted per Singapore day in a Script
 * Property. Approximate: two runs at the same moment can miss a count.
 */
var LLM_USAGE_PROPERTY = 'LLM_USAGE';

/** The usage record after one more request: { day, requests } */
function addLlmRequest(usage, day) {
  return { day: day, requests: (usage && usage.day === day ? usage.requests : 0) + 1 };
}

function appsScriptLlmUsage(props) {
  try { return JSON.parse(props.getProperty(LLM_USAGE_PROPERTY) || 'null'); } catch (e) { return null; }
}

/** appsScriptHttp, counting each request. */
function appsScriptCountedLlmHttp(url, options) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty(LLM_USAGE_PROPERTY,
      JSON.stringify(addLlmRequest(appsScriptLlmUsage(props), singaporeDay(Date.now()))));
  } catch (e) {
    console.log('Could not count a SoC LaaS request: ' + e.message);
  }
  return appsScriptHttp(url, options);
}

function appsScriptLlmRequestsToday() {
  var usage = appsScriptLlmUsage(PropertiesService.getScriptProperties());
  return usage && usage.day === singaporeDay(Date.now()) ? usage.requests : 0;
}

/* ---------------- Daily report ----------------
 * Owner decision: every day at 9am Singapore time (Google runs daily timers some time
 * between 9 and 10), the owner gets health checks plus the sheet stats, with a Dismiss
 * button. Nothing here calls SoC LaaS.
 *
 * health (gathered in main.js): {
 *   timerRunning, timerMinutes,
 *   webhook: { url: true/false, pending, lastErrorAt (ms), lastError } or { checkError },
 *   storageBytes
 * }
 */
var STORAGE_LIMIT_BYTES = 500 * 1024; // Apps Script's limit for Script Properties
var STORAGE_WARN_SHARE = 0.8;

/** Bytes a string takes as UTF-8. */
function utf8Bytes(text) {
  var bytes = 0;
  text = String(text);
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { bytes += 4; i++; } // a surrogate pair (e.g. emoji)
    else bytes += 3;
  }
  return bytes;
}

function dailyReportMessage(ctx, health) {
  var state = ctx.state;
  var now = ctx.now();
  var mark = function (good, text) { return (good ? '✅ ' : '⚠ ') + text; };
  var lines = ['<b>[Daily Report]</b> ' + singaporeTime(now)];

  lines.push(mark(health.timerRunning, health.timerRunning
    ? 'Sheet timer: running (every ' + health.timerMinutes + ' min)'
    : 'Sheet timer: missing. Run setup in Apps Script to start it again.'));

  var fresh = !!state.lastSheetCheck && now - state.lastSheetCheck <= (2 * SETTINGS.checkEveryMinutes + 1) * 60000;
  lines.push(mark(fresh, 'Last sheet check: ' + (state.lastSheetCheck ? timeAgo(state.lastSheetCheck, now) : 'never')));

  var w = health.webhook || {};
  if (w.checkError) {
    lines.push(mark(false, 'Telegram: couldn\'t check (' + tplEscape(w.checkError) + ')'));
  } else {
    var recentError = !!w.lastErrorAt && now - w.lastErrorAt < 24 * 3600000;
    var text = !w.url ? 'Telegram: not connected (no webhook). Run setup in Apps Script.'
      : recentError ? 'Telegram: delivery problem ' + timeAgo(w.lastErrorAt, now) + ': ' + tplEscape(w.lastError || 'unknown')
        : 'Telegram: connected' + (w.pending ? ', ' + w.pending + ' messages waiting' : '');
    lines.push(mark(w.url && !recentError && (w.pending || 0) < 20, text));
  }

  var share = health.storageBytes / STORAGE_LIMIT_BYTES;
  lines.push(mark(share < STORAGE_WARN_SHARE, 'Storage: ' + Math.ceil(health.storageBytes / 1024) + ' KB of ' +
    (STORAGE_LIMIT_BYTES / 1024) + ' KB (' + Math.round(share * 100) + '%)' +
    (share < STORAGE_WARN_SHARE ? '' : '. Getting full: subscribers\' saved questions may need trimming.')));

  lines.push(mark(!state.lastError, 'Problems: ' + (state.lastError ? tplEscape(state.lastError) : 'none')));

  lines.push('', '<b>Sheet stats</b>');
  if (state.snapshot) lines.push.apply(lines, statsLines(sheetStats(state.snapshot)));
  else lines.push('The sheet hasn\'t been checked yet.');
  return lines.join('\n');
}
