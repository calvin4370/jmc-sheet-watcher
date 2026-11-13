const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook } = require('./helpers/grids');
const { fakeApi, fakeCtx, msg, tap } = require('./helpers/fakes');

const OWNER = '100';
const band = (extra = {}) => ({
  number: 1,
  cells: { 'Song Title': ['A', ''], 'Complete?': ['No', ''], 'Point of Contact': ['Kim', '@kim'], 'Drum': ['Lee', '@lee'], ...extra }
});
const players = (instruments) => [{ sn: 1, name: 'Oli', handle: '@oli', instruments }];

/** Context whose sheet can be swapped between runs; owner + chat 7 subscribed. */
function setup(api = fakeApi()) {
  let current = workbook({ oneSong: [band()], players: players('Drums (3)') });
  const ctx = fakeCtx({ api, sheets: () => current });
  api.failuresOn = false;
  [msg(OWNER, '/start'), msg(7, '/start'), tap(OWNER, 'approve:7')].forEach((u) => g.handleUpdate(u, ctx));
  api.failuresOn = true;
  api.calls.length = 0;
  return { ctx, api, setSheet: (wb) => { current = wb; } };
}
const edited = () => workbook({ oneSong: [band({ 'Complete?': ['Yes', ''] })], players: players('Drums (4)') });
const alertTexts = (api, chatId) => api.sent(chatId).map((c) => c.params.text.split('\n')[0]);

test('first check is a silent baseline', () => {
  const { ctx, api } = setup();
  const r = g.runSheetCheck(ctx);
  assert.deepEqual(r, { ok: true, baseline: true, sent: 0 });
  assert.equal(api.calls.length, 0);
  assert.ok(ctx.state.snapshot);
});

test('changes go to every approved subscriber, as separate messages', () => {
  const { ctx, api, setSheet } = setup();
  g.runSheetCheck(ctx);
  setSheet(edited());
  const r = g.runSheetCheck(ctx);
  assert.equal(r.sent, 4);
  for (const chat of [OWNER, '7']) {
    assert.deepEqual(alertTexts(api, chat), ['<b>[Band Update]</b>', '<b>[Player Finder: Update]</b>']);
    assert.equal(api.sent(chat)[0].params.parse_mode, 'HTML');
  }
});

test('each subscriber only gets what their switches allow', () => {
  const { ctx, api, setSheet } = setup();
  g.handleUpdate(tap(7, 'toggle:playerFinder'), ctx);
  api.calls.length = 0;
  g.runSheetCheck(ctx);
  setSheet(edited());
  g.runSheetCheck(ctx);
  assert.deepEqual(alertTexts(api, '7'), ['<b>[Band Update]</b>']);
  assert.equal(alertTexts(api, OWNER).length, 2);
});

test('pending, stopped and removed people get nothing', () => {
  const { ctx, api, setSheet } = setup();
  g.handleUpdate(msg(8, '/start'), ctx);
  g.handleUpdate(msg(7, '/stop'), ctx);
  api.calls.length = 0;
  g.runSheetCheck(ctx);
  setSheet(edited());
  g.runSheetCheck(ctx);
  assert.equal(api.sent('7').length, 0);
  assert.equal(api.sent('8').length, 0);
  assert.equal(api.sent(OWNER).length, 2);
});

test('a temporary send failure keeps the old snapshot; the retry skips people who already got it', () => {
  let failing = true;
  const api = fakeApi({ failFor: { 7: () => (failing ? 500 : 0) } });
  const { ctx, setSheet } = setup(api);
  g.runSheetCheck(ctx);
  const baseline = ctx.state.snapshot;
  setSheet(edited());

  const r1 = g.runSheetCheck(ctx);
  assert.equal(r1.ok, false);
  assert.equal(ctx.state.snapshot, baseline);
  assert.equal(api.sent(OWNER).filter((c) => /\[Band Update\]/.test(c.params.text)).length, 1);
  assert.match(api.sent(OWNER).at(-1).params.text, /\[Watcher Problem\]/);

  failing = false;
  const r2 = g.runSheetCheck(ctx);
  assert.equal(r2.ok, true);
  assert.equal(api.sent(OWNER).filter((c) => /\[Band Update\]/.test(c.params.text)).length, 1); // no duplicate
  assert.equal(api.sent('7').filter((c) => !c.params.text.includes('Watcher')).length, 4);       // 2 failed + 2 delivered
  assert.notEqual(ctx.state.snapshot, baseline);
});

test('someone who blocked the bot is marked stopped', () => {
  const api = fakeApi({ failFor: { 7: 403 } });
  const { ctx, setSheet } = setup(api);
  g.runSheetCheck(ctx);
  setSheet(edited());
  const r = g.runSheetCheck(ctx);
  assert.equal(r.ok, true);
  assert.equal(ctx.state.subscribers['7'].status, 'stopped');
});

test('a message with bad formatting is resent as plain text', () => {
  const api = fakeApi({ failFor: { 7: (p) => (p.parse_mode ? 400 : 0) } });
  const { ctx, setSheet } = setup(api);
  g.runSheetCheck(ctx);
  setSheet(edited());
  g.runSheetCheck(ctx);
  const plain = api.sent('7').filter((c) => !c.params.parse_mode);
  assert.equal(plain.length, 2);
  assert.match(plain[0].params.text, /^\[Band Update\]/);
});

test('a missing header pauses alerts and tells the owner once; recovery is announced', () => {
  const { ctx, api, setSheet } = setup();
  g.runSheetCheck(ctx);
  const broken = edited();
  broken['Player Finder'][5][1] = 'Full Name';
  setSheet(broken);

  g.runSheetCheck(ctx);
  g.runSheetCheck(ctx);
  const problems = api.sent(OWNER).filter((c) => c.params.text.startsWith('<b>[Watcher Problem]</b>'));
  assert.equal(problems.length, 1);
  assert.match(problems[0].params.text, /layout has changed.*"Name"/);
  assert.equal(api.sent('7').length, 0);

  setSheet(edited());
  g.runSheetCheck(ctx);
  assert.equal(alertTexts(api, OWNER).filter((t) => t === '<b>[Watcher Recovered]</b>').length, 1);
  assert.deepEqual(alertTexts(api, '7'), ['<b>[Band Update]</b>', '<b>[Player Finder: Update]</b>']);
});

test('webhook updates are handled once; Telegram re-sending one is ignored', () => {
  const ctx = fakeCtx();
  const a = msg(OWNER, '/start');
  const b = msg(7, '/start');
  assert.equal(g.processTelegramUpdate(ctx, a), true);
  assert.equal(g.processTelegramUpdate(ctx, b), true);
  assert.equal(ctx.state.subscribers['7'].status, 'pending');
  const sends = ctx.api.sent().length;
  assert.equal(g.processTelegramUpdate(ctx, b), false); // re-delivered
  assert.equal(g.processTelegramUpdate(ctx, a), false); // older
  assert.equal(ctx.api.sent().length, sends);
  assert.equal(ctx.state.telegramOffset, b.update_id + 1);
  assert.equal(g.processTelegramUpdate(ctx, { nonsense: true }), false);
});

test('a broken update is skipped, not retried forever', () => {
  const bad = { update_id: 9000, message: { chat: { id: 7, type: 'private' }, text: '/start' } };
  const api = fakeApi({ failFor: { 7: 500 } });
  const ctx = fakeCtx({ api });
  g.processTelegramUpdate(ctx, bad);
  assert.equal(ctx.state.telegramOffset, 9001);
  assert.match(ctx.logs.join('\n'), /Could not handle a Telegram update/);
});

test('updates queued during a sheet check are handled in order, then removed', () => {
  const ctx = fakeCtx();
  const u1 = msg(OWNER, '/start');
  const u2 = msg(7, '/start');
  const store = {
    WATCHER_STATE_0: '{}',
    ['QUEUED_UPDATE_' + u2.update_id]: JSON.stringify(u2),
    ['QUEUED_UPDATE_' + u1.update_id]: JSON.stringify(u1),
    QUEUED_UPDATE_999999: 'not json'
  };
  const props = { getProperties: () => ({ ...store }), deleteProperty: (k) => { delete store[k]; } };
  g.drainQueuedUpdates(ctx, props);
  assert.equal(ctx.state.subscribers[OWNER].status, 'approved');
  assert.equal(ctx.state.subscribers['7'].status, 'pending');
  assert.deepEqual(Object.keys(store), ['WATCHER_STATE_0']);
  assert.match(ctx.logs.join('\n'), /unreadable queued update/);
});

test('the webhook secret check', () => {
  assert.equal(g.secretsMatch('abc123', 'abc123'), true);
  assert.equal(g.secretsMatch('abc124', 'abc123'), false);
  assert.equal(g.secretsMatch('', 'abc123'), false);
  assert.equal(g.secretsMatch(undefined, 'abc123'), false);
  assert.equal(g.secretsMatch('', ''), false); // no secret set: reject everything
  assert.equal(g.webhookUrl('DEP_ID', 's3cr3t'), 'https://script.google.com/macros/s/DEP_ID/exec?secret=s3cr3t');
});
