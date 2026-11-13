const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook } = require('./helpers/grids');
const { fakeApi, fakeCtx, msg } = require('./helpers/fakes');

const OWNER = '100';
const band = (n, complete = 'No', bass = ['Kim', '@kim']) => ({
  number: n, cells: { 'Song Title': ['Song ' + n, ''], 'Complete?': [complete, ''], 'Point of Contact': ['Kim', '@kim'], 'Bass': bass }
});

/** Owner subscribed, baseline saved. `timers` records each setTimerMinutes call. */
function setup(options = {}) {
  const api = fakeApi(options);
  let current = workbook({ oneSong: [band(1)], players: [] });
  const ctx = fakeCtx({ api, sheets: () => current });
  api.failuresOn = false;
  ctx.timers = [];
  ctx.setTimerMinutes = (m) => ctx.timers.push(m);
  g.handleUpdate(msg(OWNER, '/start'), ctx);
  g.runSheetCheck(ctx);
  api.failuresOn = true;
  api.calls.length = 0;
  ctx.timers.length = 0;
  return { ctx, api, setSheet: (bands) => { current = workbook({ oneSong: bands, players: [] }); } };
}
const alerts = (api) => api.sent(OWNER).map((c) => c.params.text).filter((t) => /^<b>\[(Band|New Band)/.test(t));

test('the settings: 3 same checks, at most 10, every minute meanwhile', () => {
  assert.deepEqual(g.SETTINGS.settle, { sameChecks: 3, maxChecks: 10, checkEveryMinutes: 1 });
});

test('a change is sent once 3 checks in a row see the same sheet; checks run every minute meanwhile', () => {
  const { ctx, api, setSheet } = setup();
  setSheet([band(1, 'Yes')]);

  assert.deepEqual(g.runSheetCheck(ctx), { ok: true, baseline: false, sent: 0, settling: true });
  assert.deepEqual(ctx.timers, [1], 'switched to every minute');
  assert.equal(g.runSheetCheck(ctx).settling, true);
  assert.deepEqual(alerts(api), []);

  const third = g.runSheetCheck(ctx);
  assert.equal(third.sent, 1);
  assert.equal(alerts(api).length, 1);
  assert.match(alerts(api)[0], /Complete: <s>No<\/s> → <b>Yes<\/b>/);
  assert.equal(ctx.state.settling, null);
  assert.equal(ctx.timers.at(-1), 5, 'back to every 5 minutes');

  g.runSheetCheck(ctx);
  assert.equal(alerts(api).length, 1, 'quiet afterwards');
});

test('another edit while settling restarts the count; the alert covers everything since the last alert', () => {
  const { ctx, api, setSheet } = setup();
  setSheet([band(1, 'Yes')]);
  g.runSheetCheck(ctx);                                  // 1: change seen
  setSheet([band(1, 'Yes', ['Lee', '@lee'])]);
  g.runSheetCheck(ctx);                                  // 2: changed again: count restarts
  g.runSheetCheck(ctx);                                  // 3: same (2 in a row)
  assert.deepEqual(alerts(api), []);
  assert.equal(ctx.state.settling.same, 2);
  g.runSheetCheck(ctx);                                  // 4: same (3 in a row): send
  assert.equal(alerts(api).length, 1);
  assert.match(alerts(api)[0], /Complete: <s>No<\/s> → <b>Yes<\/b>/);
  assert.match(alerts(api)[0], /Lee/);
});

test('an edit undone before it settles sends nothing', () => {
  const { ctx, api, setSheet } = setup();
  setSheet([band(1, 'Yes')]);
  g.runSheetCheck(ctx);
  setSheet([band(1)]);
  assert.deepEqual(g.runSheetCheck(ctx), { ok: true, baseline: false, sent: 0 });
  assert.equal(ctx.state.settling, null);
  assert.equal(ctx.timers.at(-1), 5);
  g.runSheetCheck(ctx);
  assert.deepEqual(alerts(api), []);
});

test('if the sheet keeps changing, alerts go out on the 10th check anyway', () => {
  const { ctx, api, setSheet } = setup();
  for (let i = 1; i <= 9; i++) {
    setSheet([band(1, 'No', ['Kim', '@kim']), band(2, 'No', ['P' + i, '@p' + i])]);
    assert.equal(g.runSheetCheck(ctx).settling, true, 'check ' + i);
  }
  setSheet([band(1), band(2, 'No', ['P10', '@p10'])]);
  assert.equal(g.runSheetCheck(ctx).sent, 1);
  assert.match(alerts(api)[0], /P10/);
  assert.equal(ctx.state.settling, null);

  setSheet([band(1), band(2, 'No', ['P11', '@p11'])]);
  assert.equal(g.runSheetCheck(ctx).settling, true, 'a new change waits again');
});

test('if sending fails after settling, the next check tries again', () => {
  const { ctx, api, setSheet } = setup({ failFor: { [OWNER]: 500 } });
  setSheet([band(1, 'Yes')]);
  g.runSheetCheck(ctx);
  g.runSheetCheck(ctx);
  assert.equal(g.runSheetCheck(ctx).ok, false);
  api.failuresOn = false;
  assert.equal(g.runSheetCheck(ctx).sent, 1);
  assert.equal(ctx.state.settling, null);
});

test('/status shows when it is waiting for edits to settle', () => {
  const { ctx, api, setSheet } = setup();
  setSheet([band(1, 'Yes')]);
  g.runSheetCheck(ctx);
  g.runSheetCheck(ctx);
  g.handleUpdate(msg(OWNER, '/status'), ctx);
  assert.match(api.sent(OWNER).at(-1).params.text,
    /<b>Waiting for edits to settle:<\/b> 2\/3 same checks \(check 2 of at most 10, every 1 min\)/);
});
