const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
// These tests are about who gets which alert, so alerts go out on the first check.
// Waiting for edits to settle is tested in settle.test.js.
g.SETTINGS.settle.sameChecks = 1;
const { workbook } = require('./helpers/grids');
const { fakeCtx, msg, tap } = require('./helpers/fakes');

const OWNER = '100';
const FAN = '7';
const AMY = { first_name: 'Amy', username: 'Amy_X' };
const band = (n, extra = {}) => ({
  number: n,
  cells: { 'Song Title': ['Song ' + n, ''], 'Complete?': ['No', ''], 'Point of Contact': ['Kim', '@kim'], 'Bass': ['Kim', '@kim'], ...extra }
});
const twoBand = (n, extra = {}) => ({
  number: n,
  cells: { 'Song 1 Title': ['Song ' + n, ''], 'Complete?': ['No', ''], 'Point-of-Contact': ['Kim', '@kim'], ...extra }
});

/** Owner + Amy (@Amy_X) approved; Amy plays drums in one-song band 1. */
function setup(initial) {
  let current = workbook(initial || { oneSong: [band(1, { 'Drum': ['Amy', '@amy_x'] }), band(2)], players: [] });
  const ctx = fakeCtx({ sheets: () => current });
  [msg(OWNER, '/start'), msg(FAN, '/start', AMY), tap(OWNER, 'approve:' + FAN)].forEach((u) => g.handleUpdate(u, ctx));
  g.runSheetCheck(ctx);
  ctx.api.calls.length = 0;
  return { ctx, api: ctx.api, setSheet: (wb) => { current = workbook(wb); } };
}
const heads = (api, chat) => api.sent(chat).map((c) => c.params.text.split('\n')[0]);

test('the Telegram username is remembered, and kept up to date', () => {
  const { ctx } = setup();
  assert.equal(ctx.state.subscribers[FAN].username, '@Amy_X');
  g.handleUpdate(msg(FAN, '/help', { first_name: 'Amy', username: 'amy_new' }), ctx);
  assert.equal(ctx.state.subscribers[FAN].username, '@amy_new');
  g.handleUpdate(msg(FAN, '/help', { first_name: 'Amy' }), ctx);
  assert.equal(ctx.state.subscribers[FAN].username, '');
});

test('updates for my band come even with band alerts off, with a 🎸 reply; other bands follow the switches', () => {
  const { ctx, api, setSheet } = setup();
  g.handleUpdate(tap(FAN, 'toggle:bands'), ctx);
  api.calls.length = 0;
  setSheet({ oneSong: [band(1, { 'Drum': ['Amy', '@amy_x'], 'Complete?': ['Yes', ''] }), band(2, { 'Complete?': ['Yes', ''] })], players: [] });
  g.runSheetCheck(ctx);
  assert.deepEqual(heads(api, FAN), ['<b>[Band Update]</b>', '🎸 You\'re in this band']);
  assert.match(api.sent(FAN)[0].params.text, /One-song band #1/);
  const sent = api.sent(FAN);
  assert.equal(sent[1].params.reply_parameters.message_id, api.calls.indexOf(sent[0]) + 1);
  assert.equal(api.sent(OWNER).filter((c) => c.params.text.startsWith('🎸')).length, 0, 'the owner isn\'t in band 1');
});

test('leaving a band, or the band being removed: "You were in this band"', () => {
  const { ctx, api, setSheet } = setup({ oneSong: [band(1, { 'Drum': ['Amy', '@amy_x'] }), band(2, { 'Keyboard': ['Amy', '@AMY_X'] })], players: [] });
  setSheet({ oneSong: [band(1, { 'Drum': ['Lee', '@lee'] }), { number: 2 }], players: [] });
  g.runSheetCheck(ctx);
  assert.deepEqual(api.sent(FAN).map((c) => c.params.text).filter((t) => t.startsWith('🎸')),
    ['🎸 You were in this band', '🎸 You were in this band']);
});

test('joining a band as a sub, other instrument or POC counts too', () => {
  const { ctx, api, setSheet } = setup({ oneSong: [band(1)], twoSong: [twoBand(4)], players: [] });
  setSheet({ oneSong: [band(1, { 'Point of Contact': ['Amy', '@amy_x'] })], twoSong: [twoBand(4, { 'Player Subbing In 1': ['Amy', '@amy_x'] })], players: [] });
  g.runSheetCheck(ctx);
  assert.equal(api.sent(FAN).filter((c) => c.params.text === '🎸 You\'re in this band').length, 2);
});

test('the My bands switch turns it off; with it on, 🎸 replaces 👀 for a watched band', () => {
  const { ctx, api, setSheet } = setup();
  g.handleUpdate(msg(FAN, '/watch one-song 1', AMY), ctx);
  api.calls.length = 0;
  setSheet({ oneSong: [band(1, { 'Drum': ['Amy', '@amy_x'], 'Complete?': ['Yes', ''] }), band(2)], players: [] });
  g.runSheetCheck(ctx);
  assert.deepEqual(heads(api, FAN), ['<b>[Band Update]</b>', '🎸 You\'re in this band']);

  g.handleUpdate(tap(FAN, 'toggle:myBands'), ctx);
  g.handleUpdate(tap(FAN, 'toggle:bands'), ctx);
  api.calls.length = 0;
  setSheet({ oneSong: [band(1, { 'Drum': ['Amy', '@amy_x'], 'Complete?': ['No', ''] }), band(2)], players: [] });
  g.runSheetCheck(ctx);
  assert.deepEqual(heads(api, FAN), ['<b>[Band Update]</b>', '👀 You\'re watching One-song band #1'], 'now only because it\'s watched');

  g.handleUpdate(msg(FAN, '/unwatch one-song 1', AMY), ctx);
  api.calls.length = 0;
  setSheet({ oneSong: [band(1, { 'Drum': ['Amy', '@amy_x'], 'Complete?': ['Yes', ''] }), band(2)], players: [] });
  g.runSheetCheck(ctx);
  assert.deepEqual(heads(api, FAN), [], 'band alerts and My bands both off');
});

test('/me lists my bands and roles, and my Player Finder entry', () => {
  const { ctx, api } = setup({
    oneSong: [band(1, { 'Drum': ['Amy', '@amy_x'], 'Point of Contact': ['Amy', '@amy_x'] }), band(2)],
    players: [{ sn: 1, name: 'Amy', handle: '@Amy_x', instruments: 'Drums (3)\nVox (2)' }]
  });
  const command = msg(FAN, '/me', AMY);
  g.handleUpdate(command, ctx);
  const me = api.sent(FAN).at(-1).params;
  assert.equal(me.text, '<b>[Your Bands]</b>\nMatched by your Telegram handle @Amy_X.\n\n' +
    '<b>One-song band #1</b>\n🎵 Song 1\nBass: Kim (@kim)\nDrums: Amy (@amy_x)\nPOC: Amy (@amy_x)\n<i>You: Drums, POC</i>\n\n' +
    'You\'re in Player Finder: Drums (3), Vox (2)\n\n' +
    '<i>You get every update for these bands, with a 🎸 reply.</i>');
  assert.deepEqual(me.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['close:' + command.message.message_id]);

  g.handleUpdate(msg(OWNER, '/me', { first_name: 'Sam' }), ctx);
  assert.match(api.sent(OWNER).at(-1).params.text, /You don't have a Telegram username/);
  g.handleUpdate(msg(OWNER, '/me', { first_name: 'Sam', username: 'sam' }), ctx);
  assert.match(api.sent(OWNER).at(-1).params.text, /You're not in any band in the sheet\.$/);
});

test('SoC LaaS: list_my_bands', () => {
  const { ctx } = setup();
  ctx.readState = () => ctx.state;
  ctx.updateState = (fn) => fn(ctx.state);
  assert.deepEqual(g.runActionTool(ctx, { chatId: FAN, isOwner: false }, 'list_my_bands', {}), {
    handle: '@Amy_X', bands: [{ band: 'One-song band #1', roles: ['Drums'] }], playerFinder: null, ok: true
  });
});

test('/stats and the get_stats tool', () => {
  const { ctx, api } = setup({
    oneSong: [
      band(1, { 'Drum': ['Amy', '@amy_x'], 'Keyboard': ['Cy', '@cy'] }),
      band(2, { 'Complete?': ['Yes', ''] }),
      band(3, { 'Keyboard': ['Di', '@di'] })
    ],
    twoSong: [twoBand(4, { 'Bass': ['Ed', '@ed'] })],
    players: [{ sn: 1, name: 'Oli', handle: '@oli', instruments: 'Keys' }]
  });
  const stats = g.sheetStats(ctx.state.snapshot);
  assert.deepEqual(stats.mostNeeded, [
    { role: 'Lead Vocals', bands: 3 }, { role: 'Harmony Vocals', bands: 3 }, { role: 'Lead Guitar', bands: 3 },
    { role: 'Rhythm Guitar', bands: 3 }, { role: 'Drums', bands: 2 }, { role: 'Keyboard', bands: 1 }
  ]);
  assert.deepEqual([stats.total, stats.oneSong, stats.twoSong, stats.complete, stats.notComplete, stats.playerFinder], [4, 3, 1, 1, 3, 1]);

  const command = msg(FAN, '/stats');
  g.handleUpdate(command, ctx);
  const sent = api.sent(FAN).at(-1).params;
  assert.equal(sent.text, '<b>[Sheet Stats]</b>\n<b>Bands:</b> 4 (3 one-song, 1 two-song)\n' +
    '<b>Complete:</b> 1 · <b>Not complete:</b> 3\n<b>Most needed</b> (empty roles in bands not complete):\n' +
    'Lead Vocals: 3 · Harmony Vocals: 3 · Lead Guitar: 3 · Rhythm Guitar: 3 · Drums: 2 · Keyboard: 1\n' +
    '<b>Player Finder:</b> 1 person');
  assert.deepEqual(sent.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['close:' + command.message.message_id]);
  assert.deepEqual(g.runAssistantTool(ctx.state.snapshot, 'get_stats', {}), stats);
});

test('the daily report: all good', () => {
  const { ctx } = setup();
  ctx.time = Date.UTC(2026, 10, 16, 1, 5); // 9:05 am in Singapore
  ctx.state.lastSheetCheck = ctx.time - 2 * 60000;
  const text = g.dailyReportMessage(ctx, {
    timerRunning: true, timerMinutes: 5, storageBytes: 61 * 1024,
    webhook: { url: true, pending: 0, lastErrorAt: 0, lastError: '' }
  });
  assert.equal(text, [
    '<b>[Daily Report]</b> 9:05 am, 16 Nov',
    '✅ Sheet timer: running (every 5 min)',
    '✅ Last sheet check: 2 min ago',
    '✅ Telegram: connected',
    '✅ Storage: 61 KB of 500 KB (12%)',
    '✅ Problems: none',
    '',
    '<b>Sheet stats</b>',
    '<b>Bands:</b> 2 (2 one-song, 0 two-song)',
    '<b>Complete:</b> 0 · <b>Not complete:</b> 2',
    '<b>Most needed</b> (empty roles in bands not complete):',
    'Lead Vocals: 2 · Harmony Vocals: 2 · Lead Guitar: 2 · Rhythm Guitar: 2 · Keyboard: 2 · Drums: 1',
    '<b>Player Finder:</b> 0 people'
  ].join('\n'));
});

test('the daily report: problems are flagged with ⚠', () => {
  const { ctx } = setup();
  ctx.time = Date.UTC(2026, 10, 16, 1, 5);
  ctx.state.lastSheetCheck = ctx.time - 3 * 3600000;
  ctx.state.lastError = 'Could not check the sheet: <boom>';
  const text = g.dailyReportMessage(ctx, {
    timerRunning: false, timerMinutes: 5, storageBytes: 420 * 1024,
    webhook: { url: true, pending: 3, lastErrorAt: ctx.time - 3600000, lastError: 'Wrong response' }
  });
  assert.match(text, /\n⚠ Sheet timer: missing\. Run setup in Apps Script to start it again\.\n/);
  assert.match(text, /\n⚠ Last sheet check: 3 h 0 min ago\n/);
  assert.match(text, /\n⚠ Telegram: delivery problem 1 h 0 min ago: Wrong response\n/);
  assert.match(text, /\n⚠ Storage: 420 KB of 500 KB \(84%\)\. Getting full/);
  assert.match(text, /\n⚠ Problems: Could not check the sheet: &lt;boom&gt;\n/);
  assert.match(g.dailyReportMessage(ctx, { timerRunning: true, timerMinutes: 1, storageBytes: 0, webhook: { checkError: 'timeout' } }),
    /⚠ Telegram: couldn't check \(timeout\)/);
});

test('UTF-8 size counting', () => {
  assert.equal(g.utf8Bytes('abc'), 3);
  assert.equal(g.utf8Bytes('é'), 2);
  assert.equal(g.utf8Bytes('夜'), 3);
  assert.equal(g.utf8Bytes('🎸'), 4);
});

test('help lists /me and /stats', () => {
  const { ctx, api } = setup();
  g.handleUpdate(msg(FAN, '/help'), ctx);
  assert.match(api.sent(FAN).at(-1).params.text, /\/me – your bands, found by your Telegram @handle\n\/stats – bands, completion and most-needed roles/);
});
