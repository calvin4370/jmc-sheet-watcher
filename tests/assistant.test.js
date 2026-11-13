const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook } = require('./helpers/grids');
const { fakeApi, fakeCtx, msg } = require('./helpers/fakes');

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
  players: [{ sn: 1, name: 'Oli', handle: '@oli', instruments: 'Bass (3)' }]
});

/** Owner context with SoC LaaS available; deferred tasks are collected. */
function setup({ chat, readSheets } = {}) {
  const ctx = fakeCtx({ sheets: sheet });
  ctx.deferred = [];
  ctx.defer = (task) => ctx.deferred.push(task);
  ctx.assistantAvailable = true;
  const calls = [];
  ctx.chat = (messages) => { calls.push(messages); return chat ? chat(messages) : 'Kim is the POC.'; };
  if (readSheets) ctx.readSheets = readSheets;
  ctx.saveAnswer = (at, answer) => g.rememberAssistantAnswer(ctx.state, at, answer);
  const runDeferred = () => { ctx.deferred.splice(0).forEach((t) => t(ctx)); };
  return { ctx, calls, runDeferred };
}

test('the owner\'s plain message is answered by SoC LaaS with the live sheet', () => {
  const { ctx, calls, runDeferred } = setup();
  g.handleUpdate(msg(OWNER, 'who is the POC of band 1?'), ctx);

  assert.equal(ctx.api.sent(OWNER)[0].params.text, '<i>Thinking…</i>');
  assert.equal(calls.length, 0, 'the LLM call waits until the lock is released');
  runDeferred();

  const [messages] = calls;
  assert.equal(messages.at(-1).role, 'user');
  assert.equal(messages.at(-1).content, 'who is the POC of band 1?');
  const system = messages[0].content;
  assert.match(system, /Answer ONLY from the sheet data below/);
  assert.match(system, /say that you don't know/);
  const data = JSON.parse(system.split('\n').find((l) => l.startsWith('{"bands"')));
  assert.deepEqual(data.bands[0].pointOfContact, { name: 'Kim', handle: '@kim' });
  assert.deepEqual(data.bands[0].members, [{ role: 'Drum', name: 'Lee', handle: '@lee' }]);
  assert.deepEqual(data.bands[0].otherColumns, { 'Description / Points to Take Note': 'need keys' });
  assert.equal(data.bands[0].block, undefined);
  assert.equal(data.playerFinder[0].handle, '@oli');

  const reply = ctx.api.sent(OWNER).at(-1).params;
  assert.equal(reply.text, '<b>[SoC LaaS Response]</b>\nKim is the POC.');
  assert.equal(reply.parse_mode, 'HTML');
  const del = ctx.api.calls.find((c) => c.method === 'deleteMessage');
  // The fake API numbers messages by call order: "Thinking…" was call 1.
  assert.deepEqual(del.params, { chat_id: OWNER, message_id: 1 });
});

test('the answer is plain text: HTML is escaped and Markdown bold removed', () => {
  const { ctx, runDeferred } = setup({ chat: () => '**Bands:** <none> & more' });
  g.handleUpdate(msg(OWNER, 'list bands'), ctx);
  runDeferred();
  assert.equal(ctx.api.sent(OWNER).at(-1).params.text, '<b>[SoC LaaS Response]</b>\nBands: &lt;none&gt; &amp; more');
});

test('it remembers the last 5 questions with their answers, and the last 5 alerts', () => {
  const { ctx, calls, runDeferred } = setup({ chat: (messages) => 'answer to ' + messages.at(-1).content });
  for (let i = 1; i <= 7; i++) {
    ctx.time += 1000;
    g.handleUpdate(msg(OWNER, 'question ' + i), ctx);
    runDeferred();
  }
  assert.deepEqual(ctx.state.memory.ownerMessages.map((m) => [m.text, m.answer]),
    [3, 4, 5, 6, 7].map((i) => ['question ' + i, 'answer to question ' + i]));
  // The 7th call saw the 5 earlier questions and answers as a conversation, then question 7.
  assert.deepEqual(calls.at(-1).slice(1).map((m) => [m.role, m.content]), [
    ...[2, 3, 4, 5, 6].flatMap((i) => [['user', 'question ' + i], ['assistant', 'answer to question ' + i]]),
    ['user', 'question 7']
  ]);

  for (let i = 1; i <= 6; i++) g.rememberAlert(ctx.state, '<b>[Band Update]</b>\nalert ' + i, i);
  assert.deepEqual(ctx.state.memory.alerts.map((a) => a.text), [2, 3, 4, 5, 6].map((i) => '[Band Update]\nalert ' + i));
  g.handleUpdate(msg(OWNER, 'what changed?'), ctx);
  runDeferred();
  assert.match(calls.at(-1)[0].content, /The last alert messages the bot sent the owner \(oldest first\):\n1\. \[Band Update\]\nalert 2/);
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
  ctx.state.snapshot = g.buildSnapshot(sheet());
  g.handleUpdate(msg(OWNER, 'anything'), ctx);
  runDeferred();
  assert.match(ctx.api.sent(OWNER).at(-1).params.text, /^<b>\[SoC LaaS Response\]<\/b>\nNote: the sheet could not be read just now/);
});

test('if SoC LaaS fails, a short apology is sent and "Thinking…" is still deleted', () => {
  const { ctx, runDeferred } = setup({ chat: () => { throw new Error('LLM HTTP 500'); } });
  g.handleUpdate(msg(OWNER, 'anything'), ctx);
  runDeferred();
  assert.match(ctx.api.sent(OWNER).at(-1).params.text, /SoC LaaS couldn't answer right now/);
  assert.ok(ctx.api.calls.some((c) => c.method === 'deleteMessage'));
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
