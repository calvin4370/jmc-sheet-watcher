const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook } = require('./helpers/grids');
const { fakeCtx, msg } = require('./helpers/fakes');

const OWNER = '100';
const sheet = () => workbook({
  oneSong: [{
    number: 1,
    cells: {
      'Song Title': ['夜の歌', 'Night Song'], 'Complete?': ['No', ''], 'Point of Contact': ['Kim', '@kim'],
      'Drum': ['Lee', '@lee '], 'Description / Points to Take Note': ['need keys', ''],
      'Points\n(TLDR AT INFO SHEET)': ['1.5', '']
    }
  }],
  twoSong: [{
    number: 4,
    cells: { 'Song 1 Title': ['Day Song', ''], 'Point-of-Contact': ['Amy', '@amy'], 'Keyboard': ['Amy', '@amy'], 'Player Subbing In 1': ['Lee', '@lee'] },
    other: [['Lee (Sax)', '@lee']]
  }],
  players: [{ sn: 1, name: 'Oli', handle: '@oli', instruments: 'Bass (3)', intro: 'likes jrock', note: 'pm me' }]
});
const snap = () => g.buildSnapshot(sheet());

const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

/**
 * Owner context with SoC LaaS available; deferred tasks are collected.
 * replies: list of chat replies (strings = final answers, objects = messages) or a function.
 */
function setup({ replies, readSheets } = {}) {
  const ctx = fakeCtx({ sheets: sheet });
  ctx.deferred = [];
  ctx.defer = (task) => ctx.deferred.push(task);
  ctx.assistantAvailable = true;
  const calls = [];
  const queue = Array.isArray(replies) ? replies.slice() : null;
  ctx.chat = (messages, tools, toolChoice) => {
    calls.push({ messages: JSON.parse(JSON.stringify(messages)), tools, toolChoice });
    if (typeof replies === 'function') return replies(messages, tools, toolChoice);
    return queue && queue.length ? queue.shift() : 'Kim is the POC.';
  };
  if (readSheets) ctx.readSheets = readSheets;
  ctx.saveAnswer = (at, answer) => g.rememberAssistantAnswer(ctx.state, at, answer);
  const runDeferred = () => { ctx.deferred.splice(0).forEach((t) => t(ctx)); };
  return { ctx, calls, runDeferred };
}
const ownerMessages = (ctx) => ctx.api.calls.filter((c) => c.method !== 'getUpdates');

test('SoC LaaS fetches only what it needs through tools; each call is shown; Thinking… is deleted last', () => {
  const { ctx, calls, runDeferred } = setup({
    replies: [
      { role: 'assistant', content: null, tool_calls: [toolCall('t1', 'get_band', { band_type: 'one-song', number: '1' })] },
      'Kim (@kim) is the POC of one-song band #1.'
    ]
  });
  g.handleUpdate(msg(OWNER, 'who is the POC of band 1?'), ctx);
  assert.equal(calls.length, 0, 'the LLM call waits until the lock is released');
  runDeferred();

  // No sheet data in the opening messages: only the question and instructions.
  const opening = calls[0].messages;
  assert.equal(opening.at(-1).content, 'who is the POC of band 1?');
  assert.doesNotMatch(JSON.stringify(opening), /@kim|@lee|@oli|need keys/);
  assert.match(opening[0].content, /Use the tools to look up what you need/);
  assert.match(opening[0].content, /Never reply with just "I don't know"/);
  assert.match(opening[0].content, /if they ask about "me" or "I", ask for their\nname or @handle/);
  assert.deepEqual(calls[0].tools.map((t) => t.function.name),
    ['list_bands', 'get_band', 'list_player_finder', 'get_player', 'find_person']);
  assert.equal(calls[0].toolChoice, 'auto');

  // The tool result went back to SoC LaaS.
  const toolMsg = calls[1].messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 't1');
  const band = JSON.parse(toolMsg.content);
  assert.deepEqual(band.pointOfContact, { name: 'Kim', handle: '@kim' });
  assert.deepEqual(band.members, [{ role: 'Drums', name: 'Lee', handle: '@lee' }]);
  assert.deepEqual(band.otherColumns, { 'Description / Points to Take Note': 'need keys' });

  // What the owner sees, in order.
  assert.deepEqual(ownerMessages(ctx).map((c) => [c.method, c.params.text || c.params.message_id]), [
    ['sendMessage', '<i>Thinking…</i>'],
    ['sendMessage', '<i>Called tool: get_band (band_type: one-song, number: 1)</i>'],
    ['sendMessage', '<b>[SoC LaaS Response]</b>\nKim (@kim) is the POC of one-song band #1.'],
    ['deleteMessage', 1]
  ]);
});

test('several tool calls in one round are all run and shown', () => {
  const { ctx, calls, runDeferred } = setup({
    replies: [
      { tool_calls: [toolCall('a', 'list_bands', {}), toolCall('b', 'find_person', { query: 'lee' })] },
      'Lee plays drums and sax.'
    ]
  });
  g.handleUpdate(msg(OWNER, 'what does Lee do?'), ctx);
  runDeferred();
  const shown = ctx.api.sent(OWNER).map((c) => c.params.text).filter((t) => t.includes('Called tool'));
  assert.deepEqual(shown, ['<i>Called tool: list_bands</i>', '<i>Called tool: find_person (query: lee)</i>']);
  assert.deepEqual(calls[1].messages.slice(-2).map((m) => m.tool_call_id), ['a', 'b']);
});

test('the tools return the right parts of the sheet', () => {
  const s = snap();
  const bands = g.runAssistantTool(s, 'list_bands', {});
  assert.deepEqual(bands[0], {
    bandType: 'one-song', number: '1', songs: ['夜の歌 / Night Song'], complete: 'No',
    pointOfContact: { name: 'Kim', handle: '@kim' },
    emptyRoles: ['Lead Vocals', 'Harmony Vocals', 'Lead Guitar', 'Rhythm Guitar', 'Keyboard', 'Bass']
  });
  assert.equal(bands.length, 2);

  assert.deepEqual(g.runAssistantTool(s, 'get_band', { band_type: 'two-song', number: 4 }).substitutions,
    [{ slot: 1, direction: 'in', name: 'Lee', handle: '@lee' }]);
  assert.deepEqual(g.runAssistantTool(s, 'get_band', { band_type: 'two-song', number: '9' }),
    { error: 'No two-song band numbered 9.' });

  assert.deepEqual(g.runAssistantTool(s, 'list_player_finder', {}), [{ name: 'Oli', handle: '@oli', instruments: 'Bass (3)' }]);
  assert.deepEqual(g.runAssistantTool(s, 'get_player', { query: '@OLI' }), [{
    name: 'Oli', handle: '@oli', instruments: 'Bass (3)', introduction: 'likes jrock', noteToPointOfContact: 'pm me'
  }]);

  assert.deepEqual(g.runAssistantTool(s, 'find_person', { query: '@lee' }).map((h) => [h.where, h.as]), [
    ['one-song band #1', 'Drums'],
    ['two-song band #4', 'sub in 1'],
    ['two-song band #4', 'other instrument']
  ]);
  assert.deepEqual(g.runAssistantTool(s, 'find_person', { query: 'zed' }), { error: 'Nobody matches "zed".' });
  assert.deepEqual(g.runAssistantTool(s, 'nope', {}), { error: 'Unknown tool "nope".' });
});

test('after the most tool rounds allowed, SoC LaaS must answer', () => {
  const { ctx, calls, runDeferred } = setup({
    replies: (messages, tools, toolChoice) => (toolChoice === 'none'
      ? { content: 'Best I can tell: no.' }
      : { tool_calls: [toolCall('x' + messages.length, 'list_bands', {})] })
  });
  g.handleUpdate(msg(OWNER, 'loop forever'), ctx);
  runDeferred();
  assert.equal(calls.length, g.SETTINGS.llm.maxToolRounds);
  assert.equal(calls.at(-1).toolChoice, 'none');
  assert.equal(ctx.api.sent(OWNER).at(-1).params.text, '<b>[SoC LaaS Response]</b>\nBest I can tell: no.');
});

test('the answer is plain text: HTML is escaped and Markdown bold removed', () => {
  const { ctx, runDeferred } = setup({ replies: ['**Bands:** <none> & more'] });
  g.handleUpdate(msg(OWNER, 'list bands'), ctx);
  runDeferred();
  assert.equal(ctx.api.sent(OWNER).at(-1).params.text, '<b>[SoC LaaS Response]</b>\nBands: &lt;none&gt; &amp; more');
});

test('it remembers the last 5 questions with their answers, and the last 5 alerts', () => {
  const { ctx, calls, runDeferred } = setup({ replies: (messages) => 'answer to ' + messages.at(-1).content });
  for (let i = 1; i <= 7; i++) {
    ctx.time += 1000;
    g.handleUpdate(msg(OWNER, 'question ' + i), ctx);
    runDeferred();
  }
  assert.deepEqual(ctx.state.memory.ownerMessages.map((m) => [m.text, m.answer]),
    [3, 4, 5, 6, 7].map((i) => ['question ' + i, 'answer to question ' + i]));
  assert.deepEqual(calls.at(-1).messages.slice(1).map((m) => [m.role, m.content]), [
    ...[2, 3, 4, 5, 6].flatMap((i) => [['user', 'question ' + i], ['assistant', 'answer to question ' + i]]),
    ['user', 'question 7']
  ]);

  for (let i = 1; i <= 6; i++) g.rememberAlert(ctx.state, '<b>[Band Update]</b>\nalert ' + i, i);
  assert.deepEqual(ctx.state.memory.alerts.map((a) => a.text), [2, 3, 4, 5, 6].map((i) => '[Band Update]\nalert ' + i));
  g.handleUpdate(msg(OWNER, 'what changed?'), ctx);
  runDeferred();
  assert.match(calls.at(-1).messages[0].content, /The last alert messages the bot sent the owner \(oldest first\):\n1\. \[Band Update\]\nalert 2/);
});

test('alerts sent to the owner are remembered; alerts to others are not', () => {
  const ctx = fakeCtx({ sheets: sheet });
  [msg(OWNER, '/start'), msg(7, '/start')].forEach((u) => g.handleUpdate(u, ctx));
  ctx.state.subscribers['7'].status = 'approved';
  g.runSheetCheck(ctx);
  const edited = sheet();
  edited['Signup Sheet (one-song bands)'][6][3] = 'Yes';
  ctx.readSheets = () => edited;
  g.runSheetCheck(ctx);
  assert.equal(ctx.state.memory.alerts.length, 1);
  assert.match(ctx.state.memory.alerts[0].text, /^\[Band Update\]/);
});

test('if the live read fails, the last sheet copy is used and the answer says so', () => {
  const { ctx, runDeferred } = setup({ readSheets: () => { throw new Error('offline'); } });
  ctx.state.snapshot = snap();
  g.handleUpdate(msg(OWNER, 'anything'), ctx);
  runDeferred();
  assert.match(ctx.api.sent(OWNER).at(-1).params.text,
    /^<b>\[SoC LaaS Response\]<\/b>\nNote: the sheet could not be read just now \(offline\), so this uses the copy/);
});

test('with no saved copy either, the reply says why the sheet could not be read', () => {
  const reason = 'WATCHED_SPREADSHEET_URL must be a Google Sheets link, like https://docs.google.com/spreadsheets/d/…/edit';
  const { ctx, calls, runDeferred } = setup({ readSheets: () => { throw new Error(reason); } });
  g.handleUpdate(msg(OWNER, 'anything'), ctx);
  runDeferred();
  assert.equal(calls.length, 0);
  assert.equal(ctx.api.sent(OWNER).at(-1).params.text,
    '<b>[SoC LaaS Response]</b>\nSorry, I couldn\'t read the sheet: ' + reason);
});

test('if SoC LaaS fails, a short apology is sent and "Thinking…" is still deleted', () => {
  const { ctx, runDeferred } = setup({ replies: () => { throw new Error('LLM HTTP 500'); } });
  g.handleUpdate(msg(OWNER, 'anything'), ctx);
  runDeferred();
  assert.match(ctx.api.sent(OWNER).at(-1).params.text, /SoC LaaS couldn't answer right now/);
  assert.equal(ctx.api.calls.at(-1).method, 'deleteMessage');
});

test('only the owner can ask; others get the usual reply and nothing goes to SoC LaaS', () => {
  const { ctx, calls, runDeferred } = setup();
  g.handleUpdate(msg(7, '/start'), ctx);
  ctx.state.subscribers['7'].status = 'approved';
  g.handleUpdate(msg(7, 'who is in band 1?'), ctx);
  runDeferred();
  assert.equal(calls.length, 0);
  assert.match(ctx.api.sent(7).at(-1).params.text, /^<b>\[Help\]<\/b>/);
});

test('without SoC LaaS configured, the owner gets the normal reply', () => {
  const { ctx, calls, runDeferred } = setup();
  ctx.assistantAvailable = false;
  g.handleUpdate(msg(OWNER, '/start'), ctx);
  g.handleUpdate(msg(OWNER, 'hello'), ctx);
  runDeferred();
  assert.equal(calls.length, 0);
  assert.match(ctx.api.sent(OWNER).at(-1).params.text, /^<b>\[Help\]<\/b>/);
});
