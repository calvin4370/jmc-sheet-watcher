/*
 * Watcher state: the last snapshot, subscribers and their alert choices, which
 * notifications each subscriber already got, and Telegram polling position.
 * Stored outside the Google Sheet (in Apps Script's Script Properties).
 */

var STATE_VERSION = 1;

/** Keep at most this many sent-notification IDs per subscriber (for deduplication). */
var MAX_SENT_IDS = 300;

function emptyState() {
  return {
    version: STATE_VERSION,
    snapshot: null,
    subscribers: {},     // chatId -> subscriber
    telegramOffset: 0,   // next Telegram update_id to fetch
    lastSheetCheck: 0,   // ms since epoch
    lastError: '',       // last problem reported to the owner (to avoid repeats)
    lastAnnouncedRelease: '', // RELEASE.id the owner was last told about (config/release.js)
    pendingActions: {},  // SoC LaaS actions waiting for ✅ Yes (llm/actionTools.js)
    settling: null,      // { since, checks, same, hash } while waiting for edits to settle (watcher.js)
    memory: {            // context for the owner's SoC LaaS questions (assistant.js)
      ownerMessages: [], // the owner's last 5 questions to SoC LaaS (not its answers)
      alerts: [],        // the last 5 alerts sent to the owner
      aboutMe: ''        // the owner's /aboutme note (aboutMe.js)
    }
  };
}

function normaliseState(state) {
  var base = emptyState();
  if (!state || state.version !== STATE_VERSION) return base;
  Object.keys(base).forEach(function (k) { if (!(k in state)) state[k] = base[k]; });
  return state;
}

/**
 * Subscriber: { chatId, name, status, alerts, favourites, watching, questions, questionsToday, sent, since }
 * favourites: @handles (favourites.js); watching: band IDs like 'one-song#3' (watch.js)
 * questions: their last 5 SoC LaaS questions, not the answers (assistant.js; the owner's are in memory)
 * questionsToday: { day: 'YYYY-MM-DD', count } for the daily SoC LaaS limit
 * status: 'pending' | 'approved' | 'rejected' | 'stopped' | 'removed'
 * alerts: the subscriber's own switches (missing ones use SETTINGS.defaultAlerts)
 */
function newSubscriber(chatId, name, status, now) {
  return {
    chatId: String(chatId), name: name, status: status, alerts: {}, favourites: [], watching: [],
    questions: [], questionsToday: { day: '', count: 0 }, sent: [], since: now
  };
}

function approvedSubscribers(state) {
  return Object.keys(state.subscribers).sort().map(function (id) { return state.subscribers[id]; })
    .filter(function (s) { return s.status === 'approved'; });
}

/* ---------------- Apps Script storage (not used by the Node tests) ----------------
 * Script Properties allow ~9 KB per value, so the JSON is split into chunks. 2,500
 * characters is at most 7.5 KB even if every character is 3-byte UTF-8 (e.g. Japanese).
 */
var STATE_PROPERTY_PREFIX = 'WATCHER_STATE_';
var STATE_CHUNK_CHARS = 2500;

function appsScriptLoadState() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var count = Number(props[STATE_PROPERTY_PREFIX + 'CHUNKS'] || 0);
  if (!count) return emptyState();
  var json = '';
  for (var i = 0; i < count; i++) json += props[STATE_PROPERTY_PREFIX + i] || '';
  return normaliseState(JSON.parse(json));
}

function appsScriptSaveState(state) {
  var json = JSON.stringify(state);
  var count = Math.max(1, Math.ceil(json.length / STATE_CHUNK_CHARS));
  var values = {};
  for (var i = 0; i < count; i++) {
    values[STATE_PROPERTY_PREFIX + i] = json.slice(i * STATE_CHUNK_CHARS, (i + 1) * STATE_CHUNK_CHARS);
  }
  values[STATE_PROPERTY_PREFIX + 'CHUNKS'] = String(count);
  var props = PropertiesService.getScriptProperties();
  var oldCount = Number(props.getProperty(STATE_PROPERTY_PREFIX + 'CHUNKS') || 0);
  props.setProperties(values);
  for (var j = count; j < oldCount; j++) props.deleteProperty(STATE_PROPERTY_PREFIX + j);
}
