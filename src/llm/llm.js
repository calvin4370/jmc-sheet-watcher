/*
 * LLM-written messages (SOC LaaS, an OpenAI-compatible chat API). Two cases:
 *
 * 1. Unclear cells: a band message where a person cell is new/changed and the code
 *    marks it "⚠ unclear cell" (see cellChecks.js). The LLM rewrites the template's
 *    message (validateRewrite, below).
 * 2. [Other Change]: changes no other template covers (see
 *    messagetemplates/otherChange.js). The LLM writes the whole message
 *    (validateOtherChange).
 *
 * All other messages are sent exactly as their template wrote them, with no LLM call.
 *
 * Case 1 in detail:
 *
 * What the LLM gets: the template's message, the band's raw cell block (header row +
 * the band's two rows; for updates also the previous version), and the unclear cells.
 *
 * What is checked (validateRewrite) before the LLM's message is used:
 *  - every template line that isn't marked unclear is still there, character for
 *    character, in the same order (header, songs, POC, Complete, clear members…);
 *  - new lines only use words and @handles that appear in the band's cells;
 *  - every @handle from the unclear cells is still mentioned;
 *  - only <b>, <i>, <s>, <blockquote expandable> tags, properly closed.
 * If anything fails, the template's message is sent instead (without the footer).
 */

/** Words the LLM may use in new lines even if they aren't in the cells. */
var LLM_FILLER_WORDS = [
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'on', 'in', 'to', 'by', 'from', 'with', 'as',
  'is', 'are', 'also', 'both', 'same', 'aka', 'alias', 'person', 'people', 'plays', 'playing',
  'play', 'song', 'songs', 'sub', 'other', 'open', 'slot', 'looking', 'note', 'handle', 'no',
  'not', 'given', 'role', 'roles', 'part', 'parts', 'who', 'only'
];

function llmRewritePrompt(change, templateText, unclear) {
  var system = [
    'You write Telegram notifications for a university music club\'s band signup sheet.',
    'You are given:',
    '- templateMessage: the message the code produced from its template (Telegram HTML).',
    '- currentCells: the band\'s raw spreadsheet cells, from the header row down to the band\'s two rows.',
    '  First row = display names and original-language text; second row = Telegram handles and',
    '  alternate-language text. previousCells is the earlier version, for updates.',
    '- unclearCells: cells the code could not read reliably. Their lines in templateMessage are',
    '  marked "' + UNCLEAR_MARKER + '".',
    '',
    'Write the complete message in the same layout as templateMessage.',
    'Rules:',
    '1. Copy every line that is NOT marked "' + UNCLEAR_MARKER + '" exactly, character for character,',
    '   in the same order, including the bold [header] line and the blank lines.',
    '2. Replace each marked line with one or more lines that make clear who is in that cell and',
    '   what they play, based on the cells. Example: "Lead Vocals: Name (@handle) — vox (song 2)".',
    '3. Copy names, @handles and instrument words exactly as they appear in the cells. Never invent',
    '   or change people, handles, songs, bands, numbers or changes.',
    '4. Use only these HTML tags: <b>, <i>, <s>, <blockquote expandable>. Write & < > in text as &amp; &lt; &gt;.',
    '5. Output only the message: no explanations, no code fences, no sign-off.'
  ].join('\n');

  var user = JSON.stringify({
    changeType: change.type,
    bandType: change.band.bandType,
    templateMessage: templateText,
    unclearCells: unclear.map(function (c) {
      return { column: c.column, firstRow: c.name, secondRow: c.handle };
    }),
    currentCells: change.band.block,
    previousCells: change.previous ? change.previous.block : undefined
  });
  return { system: system, user: user };
}

function llmUnescape(text) {
  return text.replace(/<\/?(b|i|s|blockquote)( expandable)?>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function llmWords(text) {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).map(function (w) { return w.toLowerCase(); });
}

/** Trims the LLM's text and removes code fences and a footer it may have added. */
function llmCleanOutput(output) {
  var text = String(output).replace(/\r\n/g, '\n').trim();
  var fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();
  var footer = SETTINGS.llm.footer.trim();
  return text.split('\n').filter(function (line) { return line.trim() !== footer; }).join('\n').trim();
}

/** '' if the HTML only uses <b>, <i>, <s>, <blockquote [expandable]>, properly nested, & only as an entity. */
function llmMarkupProblem(text) {
  var stack = [];
  var tagRe = /<[^>]*>|<|&(?!amp;|lt;|gt;)/g;
  var m;
  while ((m = tagRe.exec(text)) !== null) {
    var tag = m[0].match(/^<(\/?)(b|i|s|blockquote)( expandable)?>$/);
    if (!tag || (tag[3] && (tag[1] || tag[2] !== 'blockquote'))) return 'disallowed markup or unescaped character';
    if (!tag[1]) stack.push(tag[2]);
    else if (stack.pop() !== tag[2]) return 'unbalanced tags';
  }
  return stack.length ? 'unclosed tag' : '';
}

/** Words and @handles the LLM may use: from the given source texts plus filler words. */
function llmAllowedVocabulary(sources, extraWords) {
  var sourceText = sources.join('\n');
  var words = {};
  llmWords(sourceText).concat(LLM_FILLER_WORDS, extraWords || []).forEach(function (w) { words[w] = true; });
  var handles = {};
  (sourceText.match(/@[A-Za-z0-9_]+/g) || []).forEach(function (h) { handles[h] = true; });
  return { words: words, handles: handles };
}

/** '' if every word and @handle in the lines is allowed, else the problem. */
function llmVocabularyProblem(lines, vocab) {
  for (var i = 0; i < lines.length; i++) {
    var plain = llmUnescape(lines[i]);
    var handles = plain.match(/@[A-Za-z0-9_]+/g) || [];
    for (var h = 0; h < handles.length; h++) {
      if (!vocab.handles[handles[h]]) return 'a handle is not in the cells';
    }
    var words = llmWords(plain.replace(/@[A-Za-z0-9_]+/g, ' '));
    for (var w = 0; w < words.length; w++) {
      if (!vocab.words[words[w]]) return 'a word is not in the cells: "' + words[w] + '"';
    }
  }
  return '';
}

/** All text in a band's raw cell block(s). */
function blockTexts(change) {
  var out = [];
  [change.band && change.band.block, change.previous && change.previous.block].forEach(function (block) {
    if (block) out = out.concat(block.header, block.rows[0], block.rows[1]);
  });
  return out;
}

/** Checks the LLM's message. Returns { ok: true, html } or { ok: false, reason }. */
function validateRewrite(output, templateText, change, unclear) {
  var fail = function (reason) { return { ok: false, reason: reason }; };
  if (typeof output !== 'string') return fail('no text');

  var text = llmCleanOutput(output);
  if (!text) return fail('empty');

  var markup = llmMarkupProblem(text);
  if (markup) return fail(markup);

  // Every clear template line must be kept, exactly and in order.
  var expected = templateText.split('\n').filter(function (l) {
    return l.trim() !== '' && l.indexOf(UNCLEAR_MARKER) < 0;
  });
  var extra = [];
  var next = 0;
  text.split('\n').forEach(function (line) {
    if (next < expected.length && line === expected[next]) next++;
    else if (line.trim() !== '') extra.push(line);
  });
  if (next < expected.length) return fail('template line ' + (next + 1) + ' was changed or dropped');
  if (extra.length === 0) return fail('unclear cells were not explained');
  if (extra.length > 4 * unclear.length + 2) return fail('too many new lines (' + extra.length + ')');

  // New lines may only use words and handles found in the band's cells.
  var sources = blockTexts(change);
  templateText.split('\n').forEach(function (l) { if (l.indexOf(UNCLEAR_MARKER) >= 0) sources.push(llmUnescape(l)); });
  var vocabProblem = llmVocabularyProblem(extra, llmAllowedVocabulary(sources));
  if (vocabProblem) return fail('new line: ' + vocabProblem);

  // Nobody from an unclear cell may be dropped.
  var outputPlain = llmUnescape(text);
  for (var u = 0; u < unclear.length; u++) {
    var cellHandles = String(unclear[u].handle).match(/@[A-Za-z0-9_]+/g) || [];
    for (var k = 0; k < cellHandles.length; k++) {
      if (outputPlain.indexOf(cellHandles[k]) < 0) return fail('a handle from an unclear cell is missing');
    }
  }

  return { ok: true, html: text };
}

/* ---------------- [Other Change]: the LLM writes the whole message ---------------- */

var OTHER_CHANGE_HEADER = '<b>[Other Change]</b>';

/** Extra words allowed in an [Other Change] message. */
var LLM_OTHER_CHANGE_WORDS = [
  'change', 'changed', 'changes', 'update', 'updated', 'edited', 'added', 'removed', 'cleared',
  'was', 'now', 'new', 'old', 'previous', 'previously', 'text', 'link', 'row', 'column', 'cell',
  'first', 'second', 'band', 'one', 'two'
];

function llmOtherChangePrompt(change, fallbackText, template) {
  var system = [
    'You write Telegram notifications for a university music club\'s band signup sheet.',
    'This change is not covered by the regular message templates. You are given:',
    '- fallbackMessage: a plain version of the message, made by the code (Telegram HTML).',
    '- changedCells: the cells that changed, with their column header and old and new text.',
    '- currentCells / previousCells: the band\'s raw cells (header row, then the band\'s two rows)',
    '  after and before the change.',
    '',
    'Write the complete message.',
    'Rules:',
    '1. The first line must be exactly: ' + OTHER_CHANGE_HEADER,
    '2. The second line identifies the band exactly as in fallbackMessage\'s second line.',
    '3. ' + template.llmTask,
    '4. Use only names, @handles and words that appear in the cells or fallbackMessage. Never',
    '   invent or change people, handles, songs, bands, numbers or changes.',
    '5. Use only these HTML tags: <b>, <i>, <s>, <blockquote expandable>. Write & < > in text as &amp; &lt; &gt;.',
    '6. Output only the message: no explanations, no code fences, no sign-off.'
  ].join('\n');
  var user = JSON.stringify(change.band ? {
    changeType: change.type,
    bandType: change.band.bandType,
    fallbackMessage: fallbackText,
    changedCells: change.cells,
    currentCells: change.band.block,
    previousCells: change.previous ? change.previous.block : undefined
  } : { changeType: change.type, fallbackMessage: fallbackText, change: change });
  return { system: system, user: user };
}

/**
 * Checks an LLM-written [Other Change] message: bold header first, band line kept,
 * only words/handles from the cells, and each changed cell's new text quoted exactly
 * (unless it is long or was cleared).
 */
function validateOtherChange(output, fallbackText, change) {
  var fail = function (reason) { return { ok: false, reason: reason }; };
  if (typeof output !== 'string') return fail('no text');
  var text = llmCleanOutput(output);
  if (!text) return fail('empty');
  if (text.length > 3500) return fail('too long');

  var markup = llmMarkupProblem(text);
  if (markup) return fail(markup);

  var lines = text.split('\n');
  var fallbackLines = fallbackText.split('\n');
  if (lines[0] !== OTHER_CHANGE_HEADER) return fail('missing the bold [Other Change] header');
  if (change.band && lines[1] !== fallbackLines[1]) return fail('band line was changed');

  var sources = blockTexts(change).concat(llmUnescape(fallbackText));
  if (!change.band) sources.push(JSON.stringify(change));
  (change.cells || []).forEach(function (c) { sources.push(c.header, c.before, c.after); });
  var problem = llmVocabularyProblem(lines.slice(1), llmAllowedVocabulary(sources, LLM_OTHER_CHANGE_WORDS));
  if (problem) return fail(problem);

  var plain = llmUnescape(text);
  var cells = change.cells || [];
  for (var i = 0; i < cells.length; i++) {
    var after = String(cells[i].after).trim();
    if (after && after.length <= 200 && plain.indexOf(after) < 0) return fail('a changed cell\'s new text is not quoted exactly');
  }
  return { ok: true, html: text };
}

/** Calls the OpenAI-compatible chat completions endpoint with retries. Returns the text. */
function llmComplete(config, systemPrompt, userContent, http, sleep) {
  return llmChat(config, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ], http, sleep);
}

/**
 * Returns chat(messages) -> answer text for the owner's questions (assistant.js), or
 * null if SoC LaaS isn't configured. Throws on failure (after retries).
 */
function createLlmChat(deps) {
  var config = deps.config || {};
  if (!SETTINGS.llm.enabled || !config.baseUrl || !config.apiKey || !config.model) return null;
  return function (messages) { return llmChat(config, messages, deps.http, deps.sleep); };
}

/** One chat completion with retries. Returns the text. */
function llmChat(config, messages, http, sleep) {
  var url = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  var payload = JSON.stringify({
    model: config.model,
    messages: messages,
    temperature: 0.2,
    max_tokens: 1500
  });
  return withRetries(function () {
    var res = http(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + config.apiKey },
      payload: payload
    });
    if (res.status === 429 || res.status >= 500) throw retryableError('LLM HTTP ' + res.status);
    if (res.status >= 400) throw new Error('LLM HTTP ' + res.status);
    var body = JSON.parse(res.body);
    var content = body && body.choices && body.choices[0] && body.choices[0].message &&
      body.choices[0].message.content;
    if (typeof content !== 'string') throw new Error('LLM response has no message content');
    return content;
  }, SETTINGS.llm.retries, SETTINGS.llm.retryBaseDelayMs, sleep);
}

function retryableError(message) {
  var error = new Error(message);
  error.retryable = true;
  return error;
}

/**
 * Runs fn, retrying retryable errors (and network exceptions) with exponential backoff:
 * baseDelayMs, 2x, 4x… Errors from a 4xx response or a bad response body fail at once.
 */
function withRetries(fn, attempts, baseDelayMs, sleep) {
  for (var i = 0; ; i++) {
    try {
      return fn();
    } catch (error) {
      var retryable = error.retryable === true || !/^LLM /.test(String(error.message));
      if (!retryable || i >= attempts - 1) throw error;
      sleep(baseDelayMs * Math.pow(2, i));
    }
  }
}

/**
 * Returns rewrite(change, templateText, unclear) -> validated HTML, or '' to use the
 * template's message. Never throws.
 * deps: { config: { baseUrl, apiKey, model }, http(url, options) -> { status, body },
 *         sleep(ms), log(message) }
 */
function createLlmRewriter(deps) {
  var calls = 0;
  var config = deps.config || {};
  var ready = SETTINGS.llm.enabled && config.baseUrl && config.apiKey && config.model;
  if (SETTINGS.llm.enabled && !ready) {
    deps.log('LLM is on but SOCLAAS_BASE_URL, SOCLAAS_API_KEY or SOCLAAS_MODEL is not set; using template messages.');
  }

  return function rewrite(change, templateText, unclear, template) {
    if (!ready || calls >= SETTINGS.llm.maxCallsPerRun) return '';
    calls++;
    var label = change.band ? change.band.id : change.type;
    var whole = template && template.llmWritesWholeMessage;
    try {
      var prompt = whole
        ? llmOtherChangePrompt(change, templateText, template)
        : llmRewritePrompt(change, templateText, unclear);
      var output = llmComplete(config, prompt.system, prompt.user, deps.http, deps.sleep);
      var result = whole
        ? validateOtherChange(output, templateText, change)
        : validateRewrite(output, templateText, change, unclear);
      if (!result.ok) {
        deps.log('LLM message rejected for ' + label + ': ' + result.reason);
        return '';
      }
      return result.html;
    } catch (error) {
      deps.log('LLM call failed for ' + label + ': ' + error.message);
      return '';
    }
  };
}

/* ---------------- Apps Script wiring (not used by the Node tests) ---------------- */

function appsScriptHttp(url, options) {
  var res = UrlFetchApp.fetch(url, {
    method: options.method,
    contentType: options.contentType,
    headers: options.headers,
    payload: options.payload,
    muteHttpExceptions: true
  });
  return { status: res.getResponseCode(), body: res.getContentText() };
}

/** Reads the SOC LaaS details from Apps Script's Script Properties (never from code). */
function appsScriptLlmConfig() {
  var props = PropertiesService.getScriptProperties();
  return {
    baseUrl: props.getProperty('SOCLAAS_BASE_URL'),
    apiKey: props.getProperty('SOCLAAS_API_KEY'),
    model: props.getProperty('SOCLAAS_MODEL')
  };
}
