const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook, clone } = require('./helpers/grids');

const UNCLEAR = { 'Drum': ['Amy / Bo (drums song 1, cajon song 2)', '@amy_x @bo_y'] };
const band = (extra = {}) => ({
  number: 3,
  cells: {
    'Song 1 Title': ['夜の歌', 'Night Song'],
    'Song 2 Title': ['Day Song', ''],
    'Complete?': ['No', ''],
    'Point-of-Contact': ['Kim', '@kim'],
    'Bass': ['Kim', '@kim'],
    ...extra
  }
});

/** A band_added change with an unclear Drum cell, its template text and unclear cells. */
function setup() {
  const first = g.detectChanges(null, workbook({}));
  const result = clone(g.detectChanges(clone(first.snapshot), workbook({ twoSong: [band(UNCLEAR)] })));
  const change = result.bandChanges[0];
  return { change, text: g.MESSAGE_TEMPLATES[change.type].render(change), unclear: g.unclearCells(change) };
}

/** The template text with the unclear Drums line replaced by `lines`. */
function rewriteWith(text, lines) {
  return text.split('\n').flatMap((l) => (l.includes('⚠ unclear cell') ? lines : [l])).join('\n');
}

const GOOD = [
  'Drums: Amy (@amy_x) — drums (song 1)',
  'Drums: Bo (@bo_y) — cajon (song 2)'
];

test('the band keeps its raw cell block, header row through both rows', () => {
  const { change } = setup();
  assert.equal(change.band.block.range, 'A7:V8'); // out to the "Other Insts" header
  assert.equal(change.band.block.header[1], 'Song 1 Title');
  assert.equal(change.band.block.rows[0][16], 'Amy / Bo (drums song 1, cajon song 2)');
  assert.equal(change.band.block.rows[1][16], '@amy_x @bo_y');
});

test('the prompt contains the template message, the cells and the unclear cells', () => {
  const { change, text, unclear } = setup();
  const user = JSON.parse(g.llmRewritePrompt(change, text, unclear).user);
  assert.equal(user.templateMessage, text);
  assert.deepEqual(user.currentCells, change.band.block);
  assert.deepEqual(user.unclearCells, [{ column: 'Drum', firstRow: UNCLEAR.Drum[0], secondRow: UNCLEAR.Drum[1] }]);
});

test('a faithful rewrite is accepted', () => {
  const { change, text, unclear } = setup();
  const v = g.validateRewrite(rewriteWith(text, GOOD), text, change, unclear);
  assert.equal(v.ok, true, v.reason);
});

test('code fences and a model-added footer are tolerated', () => {
  const { change, text, unclear } = setup();
  const out = '```html\n' + rewriteWith(text, GOOD) + '\n(Written by SOC LaaS API)\n```';
  const v = g.validateRewrite(out, text, change, unclear);
  assert.equal(v.ok, true, v.reason);
  assert.doesNotMatch(v.html, /Written by/);
});

test('rewrites that alter, drop or invent things are rejected', () => {
  const { change, text, unclear } = setup();
  const bad = {
    'header not bold': rewriteWith(text, GOOD).replace('<b>[New Band]</b>', '[New Band]'),
    'changed a clear line': rewriteWith(text, GOOD).replace('Bass: Kim (@kim)', 'Bass: Kim (@Kim)'),
    'dropped a clear line': rewriteWith(text, GOOD).replace('Complete: No\n', ''),
    'unclear cell not explained': rewriteWith(text, []),
    'invented person': rewriteWith(text, [...GOOD, 'Guitar: Zoe (@zoe)']),
    'invented handle': rewriteWith(text, ['Drums: Amy (@amy_z)', 'Drums: Bo (@bo_y)']),
    'invented instrument': rewriteWith(text, ['Drums: Amy (@amy_x) — violin', 'Drums: Bo (@bo_y)']),
    'dropped a person': rewriteWith(text, ['Drums: Amy (@amy_x) — drums (song 1)']),
    'disallowed markup': rewriteWith(text, ['<u>Drums: Amy (@amy_x)</u>', 'Drums: Bo (@bo_y)']),
    'unclosed tag': rewriteWith(text, ['<b>Drums: Amy (@amy_x)', 'Drums: Bo (@bo_y)']),
    'too many new lines': rewriteWith(text, [...GOOD, ...GOOD, ...GOOD, ...GOOD])
  };
  for (const [label, out] of Object.entries(bad)) {
    assert.equal(g.validateRewrite(out, text, change, unclear).ok, false, label);
  }
});

// ---- rewriter: HTTP, retries and fallbacks ----

function fakeDeps(responses, overrides = {}) {
  const calls = [];
  const sleeps = [];
  const logs = [];
  return {
    calls, sleeps, logs,
    deps: {
      config: { baseUrl: 'https://llm.example/v1/', apiKey: 'test-key', model: 'test-model' },
      http: (url, options) => {
        calls.push({ url, options });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: (ms) => sleeps.push(ms),
      log: (m) => logs.push(m),
      ...overrides
    }
  };
}
const ok = (content) => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content } }] }) });

test('calls the OpenAI-compatible endpoint and returns the validated message', () => {
  const { change, text, unclear } = setup();
  const f = fakeDeps([ok(rewriteWith(text, GOOD))]);
  const html = g.createLlmRewriter(f.deps)(change, text, unclear);
  assert.equal(html, rewriteWith(text, GOOD));
  assert.equal(f.calls[0].url, 'https://llm.example/v1/chat/completions');
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(f.calls[0].options.payload).model, 'test-model');
});

test('retries server and network errors with exponential backoff', () => {
  const { change, text, unclear } = setup();
  const f = fakeDeps([{ status: 503, body: '' }, new Error('network down'), ok(rewriteWith(text, GOOD))]);
  assert.equal(g.createLlmRewriter(f.deps)(change, text, unclear), rewriteWith(text, GOOD));
  assert.deepEqual(f.sleeps, [1000, 2000]);
});

test('gives up after the retry limit and falls back', () => {
  const { change, text, unclear } = setup();
  const f = fakeDeps([{ status: 500, body: '' }, { status: 500, body: '' }, { status: 500, body: '' }]);
  assert.equal(g.createLlmRewriter(f.deps)(change, text, unclear), '');
  assert.equal(f.calls.length, 3);
  assert.match(f.logs[0], /LLM call failed/);
});

test('does not retry client errors such as a bad API key, and never logs the key', () => {
  const { change, text, unclear } = setup();
  const f = fakeDeps([{ status: 401, body: 'unauthorised' }]);
  assert.equal(g.createLlmRewriter(f.deps)(change, text, unclear), '');
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(f.logs.join('\n'), /test-key/);
});

test('a rejected rewrite falls back, and the log has no message content', () => {
  const { change, text, unclear } = setup();
  const f = fakeDeps([ok(rewriteWith(text, ['Drums: Zoe (@zoe)']))]);
  assert.equal(g.createLlmRewriter(f.deps)(change, text, unclear), '');
  assert.match(f.logs[0], /rejected/);
  assert.doesNotMatch(f.logs[0], /Kim|Amy|@/);
});

test('without SOC LaaS settings no calls are made', () => {
  const { change, text, unclear } = setup();
  const f = fakeDeps([], { config: { baseUrl: '', apiKey: '', model: '' } });
  assert.equal(g.createLlmRewriter(f.deps)(change, text, unclear), '');
  assert.equal(f.calls.length, 0);
  assert.match(f.logs[0], /not set/);
});

test('stops calling after maxCallsPerRun', () => {
  const { change, text, unclear } = setup();
  const saved = g.SETTINGS.llm.maxCallsPerRun;
  g.SETTINGS.llm.maxCallsPerRun = 1;
  try {
    const f = fakeDeps([ok(rewriteWith(text, GOOD)), ok(rewriteWith(text, GOOD))]);
    const rewrite = g.createLlmRewriter(f.deps);
    rewrite(change, text, unclear);
    assert.equal(rewrite(change, text, unclear), '');
    assert.equal(f.calls.length, 1);
  } finally {
    g.SETTINGS.llm.maxCallsPerRun = saved;
  }
});
