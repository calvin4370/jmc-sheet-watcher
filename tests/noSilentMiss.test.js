// No sheet change is ever missed without the owner being told (owner decision).
// Each test simulates one way a change could slip through.
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
g.SETTINGS.settle.sameChecks = 1; // alerts go out on the first check that sees a change
const { workbook } = require('./helpers/grids');
const { fakeApi, fakeCtx, msg, tap } = require('./helpers/fakes');

const OWNER = '100';
const FAN = '7';
const band = (cells = {}) => ({
  number: 1,
  cells: { 'Song Title': ['A', ''], 'Complete?': ['No', ''], 'Point of Contact': ['Kim', '@kim'], 'Drum': ['Lee', '@lee'], ...cells }
});
const sheet = (cells) => workbook({ oneSong: [band(cells)], players: [] });

function setup(api = fakeApi()) {
  let current = sheet();
  const ctx = fakeCtx({ api, sheets: () => current });
  api.failuresOn = false;
  [msg(OWNER, '/start'), msg(FAN, '/start'), tap(OWNER, 'approve:' + FAN)].forEach((u) => g.handleUpdate(u, ctx));
  g.runSheetCheck(ctx); // baseline
  api.failuresOn = true;
  api.calls.length = 0;
  return { ctx, api, setSheet: (cells) => { current = sheet(cells); } };
}
const heads = (api, chat) => api.sent(chat).map((c) => c.params.text.split('\n')[0]);

test('an edit that is undone and then redone is alerted every time', () => {
  const { ctx, api, setSheet } = setup();
  for (const v of ['Yes', 'No', 'Yes', 'No', 'Yes']) {
    api.calls.length = 0;
    setSheet({ 'Complete?': [v, ''] });
    g.runSheetCheck(ctx);
    for (const chat of [OWNER, FAN]) {
      const texts = api.sent(chat).map((c) => c.params.text);
      assert.equal(texts.length, 1, 'Complete? -> ' + v + ' for ' + chat);
      assert.ok(texts[0].includes('<b>' + v + '</b>'), texts[0]);
    }
  }
});

test('the same edit after a failed send is retried with the same IDs (no duplicates)', () => {
  let failing = true;
  const api = fakeApi({ failFor: { [FAN]: () => (failing ? 500 : 0) } });
  const { ctx, setSheet } = setup(api);
  setSheet({ 'Complete?': ['Yes', ''] });
  g.runSheetCheck(ctx); // owner gets it, the fan's send fails (the fake records the failed try too)
  const updates = (chat) => api.sent(chat).filter((c) => /\[Band Update\]/.test(c.params.text)).length;
  assert.equal(updates(FAN), 1);
  failing = false;
  g.runSheetCheck(ctx);
  g.runSheetCheck(ctx);
  assert.equal(updates(OWNER), 1, 'owner not sent it again');
  assert.equal(updates(FAN), 2, 'the failed try + one successful retry, no more');
});

test('an alert Telegram refuses is replaced by a short notice, not dropped', () => {
  // Every alert to the fan is refused (with and without formatting); the plain notice goes through.
  const api = fakeApi({ failFor: { [FAN]: (p) => (p.text.startsWith('⚠') ? 0 : 400) } });
  const { ctx, setSheet } = setup(api);
  setSheet({ 'Complete?': ['Yes', ''] });
  const r = g.runSheetCheck(ctx);
  assert.equal(r.ok, true);
  const notice = api.sent(FAN).at(-1).params;
  assert.equal(notice.parse_mode, undefined);
  assert.equal(notice.text, '⚠ An alert couldn\'t be shown here (Telegram refused it: Telegram sendMessage failed (400)).\n' +
    '[Band Update]\n- One-song band #1 · A\nPlease check the sheet for this change.');
  assert.equal(heads(api, OWNER).filter((h) => /Problem/.test(h)).length, 0, 'the notice got through, so the owner isn\'t bothered');
});

test('if even the notice is refused, the owner is told', () => {
  const api = fakeApi({ failFor: { [FAN]: 400 } });
  const { ctx, setSheet } = setup(api);
  setSheet({ 'Complete?': ['Yes', ''] });
  g.runSheetCheck(ctx);
  const problem = api.sent(OWNER).find((c) => c.params.text.startsWith('<b>[Watcher Problem]</b>'));
  assert.ok(problem, 'owner told');
  assert.match(problem.params.text, /An alert for User7 could not be sent, not even as a short notice .*It was:\n\[Band Update\]\n- One-song band #1 · A$/s);
  // Not retried forever: the next check sends nothing new.
  api.calls.length = 0;
  g.runSheetCheck(ctx);
  assert.equal(api.sent(FAN).length + api.sent(OWNER).length, 0);
});

test('a lost saved copy is never a silent restart: the owner is told', () => {
  const { ctx, api } = setup();
  ctx.state.snapshot = null; // e.g. the stored state was lost
  api.calls.length = 0;
  const r = g.runSheetCheck(ctx);
  assert.equal(r.baseline, true);
  assert.deepEqual(heads(api, OWNER), ['<b>[Watcher Started]</b>']);
  assert.equal(api.sent(FAN).length, 0);
});

test('timer crashes are reported once per distinct error, then the recovery', () => {
  const api = fakeApi();
  const ctx = fakeCtx({ api });
  let stored = '';
  const store = { get: () => stored, set: (v) => { stored = v; } };
  g.noteTimerRun(ctx, store, '');                     // fine: nothing
  g.noteTimerRun(ctx, store, 'Unexpected token in JSON'); // crash: told
  g.noteTimerRun(ctx, store, 'Unexpected token in JSON'); // same crash: not again
  g.noteTimerRun(ctx, store, 'Cannot read x');            // a different crash: told
  g.noteTimerRun(ctx, store, '');                         // works again: told
  g.noteTimerRun(ctx, store, '');                         // still fine: nothing
  assert.deepEqual(api.sent(OWNER).map((c) => c.params.text.split('\n').slice(0, 2).join(' | ')), [
    '<b>[Watcher Problem]</b> | A sheet check crashed: Unexpected token in JSON',
    '<b>[Watcher Problem]</b> | A sheet check crashed: Cannot read x',
    '<b>[Watcher Recovered]</b> | Sheet checks are working again.'
  ]);
  assert.equal(stored, '');
});

test('an alert too long for one message is split, never cut, with boxes closed and reopened', () => {
  const long = Array.from({ length: 40 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(150)).join('\n');
  const { ctx, api, setSheet } = setup();
  setSheet({ 'Description / Points to Take Note': [long, ''] });
  g.runSheetCheck(ctx);
  const parts = api.sent(OWNER).map((c) => c.params);
  assert.ok(parts.length >= 2, 'split into ' + parts.length);
  for (const p of parts) {
    assert.ok(p.text.length <= 4096);
    assert.equal(p.parse_mode, 'HTML');
    assert.equal((p.text.match(/<blockquote/g) || []).length, (p.text.match(/<\/blockquote>/g) || []).length, 'boxes balanced');
    assert.equal((p.text.match(/<b>/g) || []).length, (p.text.match(/<\/b>/g) || []).length, 'bold balanced');
  }
  const all = parts.map((p) => p.text).join('\n');
  for (let i = 0; i < 40; i++) assert.ok(all.includes('line ' + i + ' '), 'line ' + i + ' kept');
  assert.ok(all.includes('Drums: Lee (@lee)'), 'the member list is still there');
});

test('a retry of a split alert only sends the parts still missing', () => {
  let failNext = 0;
  const delivered = [];
  const api = fakeApi({
    failFor: {
      [OWNER]: (p) => {
        if (failNext-- === 1) return 500;
        delivered.push(p.text);
        return 0;
      }
    }
  });
  const long = Array.from({ length: 40 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(150)).join('\n');
  const { ctx, setSheet } = setup(api);
  setSheet({ 'Description / Points to Take Note': [long, ''] });
  failNext = 2; // the first part goes through, the second fails
  g.runSheetCheck(ctx);
  const parts = delivered.filter((t) => !t.includes('[Watcher')).length;
  assert.equal(parts, 1, 'only the first part got through');
  g.runSheetCheck(ctx);
  const alertParts = delivered.filter((t) => !t.includes('[Watcher'));
  assert.equal(new Set(alertParts).size, alertParts.length, 'no part delivered twice');
  assert.ok(alertParts.length >= 2, 'the rest delivered on the retry');
  for (let i = 0; i < 40; i++) assert.ok(alertParts.join('\n').includes('line ' + i + ' '), 'line ' + i);
});

test('splitting: tags are reopened; one huge line falls back to plain text', () => {
  const lines = ['<b>[Band Update]</b>', '<blockquote expandable>'].concat(Array.from({ length: 60 }, () => 'y'.repeat(100)), ['end</blockquote>']);
  const split = g.splitTelegramText(lines.join('\n'), true);
  assert.equal(split.html, true);
  assert.ok(split.parts[1].startsWith('<blockquote expandable>'));
  assert.ok(split.parts[0].endsWith('</blockquote>'));

  const huge = g.splitTelegramText('<b>x</b>' + 'z'.repeat(9000), true);
  assert.equal(huge.html, false);
  assert.equal(huge.parts.join(''), 'x' + 'z'.repeat(9000));
  assert.ok(huge.parts.every((p) => p.length <= 4096));
});
