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
