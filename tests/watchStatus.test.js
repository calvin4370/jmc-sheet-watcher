const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
// These tests are about what alerts say and who gets them, so alerts go out on the
// first check. Waiting for edits to settle is tested in settle.test.js.
g.SETTINGS.settle.sameChecks = 1;
const { workbook } = require('./helpers/grids');
const { fakeApi, fakeCtx, msg, tap } = require('./helpers/fakes');

const OWNER = '100';
const FAN = '7';
const band = (n, extra = {}) => ({
  number: n,
  cells: { 'Song Title': ['Song ' + n, ''], 'Complete?': ['No', ''], 'Point of Contact': ['Kim', '@kim'], 'Bass': ['Kim', '@kim'], ...extra }
});
const twoBand = (n, extra = {}) => ({
  number: n,
  cells: { 'Song 1 Title': ['Song ' + n, ''], 'Complete?': ['No', ''], 'Point-of-Contact': ['Kim', '@kim'], 'Bass': ['Kim', '@kim'], ...extra }
});
const players = [{ sn: 1, name: 'Oli', handle: '@oli', instruments: 'Drums (3)' }];

function setup() {
  const api = fakeApi();
  let current = workbook({ oneSong: [band(1), band(3)], twoSong: [twoBand(4)], players });
  const ctx = fakeCtx({ api, sheets: () => current });
  [msg(OWNER, '/start'), msg(FAN, '/start'), tap(OWNER, 'approve:' + FAN)].forEach((u) => g.handleUpdate(u, ctx));
  g.runSheetCheck(ctx); // baseline
  api.calls.length = 0;
  return { ctx, api, setSheet: (wb) => { current = workbook(wb); } };
}
const say = (ctx, chat, text) => g.handleUpdate(msg(chat, text), ctx);
const texts = (api, chat) => api.sent(chat).map((c) => c.params.text);

test('band IDs are read from what people type', () => {
  assert.equal(g.bandIdFromText(' one-song 3'), 'one-song#3');
  assert.equal(g.bandIdFromText('1-song #03'), 'one-song#3');
  assert.equal(g.bandIdFromText('Two song band 4'), 'two-song#4');
  assert.equal(g.bandIdFromText('3'), '');
});

test('/watch, /watching and /unwatch', () => {
  const { ctx, api } = setup();
  say(ctx, FAN, '/watch one-song 3');
  assert.equal(texts(api, FAN).at(-1), '👀 Now watching:\nOne-song band #3 · Song 3\n' +
    'You\'ll get every update for this band, even if that alert type is off in /settings.');
  say(ctx, FAN, '/watch 1-song 3');
  assert.equal(texts(api, FAN).at(-1), 'You\'re already watching One-song band #3.');
  say(ctx, FAN, '/watch one-song 9');
  assert.equal(texts(api, FAN).at(-1), 'There\'s no One-song band #9 in the sheet right now.');
  say(ctx, FAN, '/watch 3');
  assert.match(texts(api, FAN).at(-1), /^Say which band/);
  say(ctx, FAN, '/watch two-song 4');
  assert.deepEqual(ctx.state.subscribers[FAN].watching, ['one-song#3', 'two-song#4']);

  const command = msg(FAN, '/watching');
  g.handleUpdate(command, ctx);
  const list = api.sent(FAN).at(-1).params;
  assert.equal(list.text, '<b>[Watched Bands]</b>\n\n' +
    '👀 <b>One-song band #3</b>\n🎵 Song 3\nBass: Kim (@kim)\nPOC: Kim (@kim)\n\n' +
    '👀 <b>Two-song band #4</b>\n🎵 Song 4\nBass: Kim (@kim)\nPOC: Kim (@kim)\n\n' +
    'Tap a button to stop watching one.');
  assert.deepEqual(list.reply_markup.inline_keyboard.flat().map((b) => b.text).slice(0, 2),
    ['❌ 1-song #3 · Song 3', '❌ 2-song #4 · Song 4']);
  assert.deepEqual(list.reply_markup.inline_keyboard.flat().map((b) => b.callback_data),
    ['unwatch:one-song#3', 'unwatch:two-song#4', 'close:' + command.message.message_id]);

  g.handleUpdate(tap(FAN, 'unwatch:one-song#3', '', list.reply_markup), ctx);
  assert.deepEqual(ctx.state.subscribers[FAN].watching, ['two-song#4']);
  const edited = api.calls.filter((c) => c.method === 'editMessageText').at(-1).params;
  assert.deepEqual(edited.reply_markup.inline_keyboard.flat().map((b) => b.callback_data),
    ['unwatch:two-song#4', 'close:' + command.message.message_id]);

  say(ctx, FAN, '/unwatch two-song 4');
  assert.equal(texts(api, FAN).at(-1), 'Stopped watching Two-song band #4.');
  say(ctx, FAN, '/unwatch two-song 4');
  assert.match(texts(api, FAN).at(-1), /aren't watching that band/);
});

test('a watched band\'s updates come even with band alerts off, each with a 👀 reply', () => {
  const { ctx, api, setSheet } = setup();
  say(ctx, FAN, '/watch one-song 3');
  g.handleUpdate(tap(FAN, 'toggle:bands'), ctx);
  api.calls.length = 0;
  setSheet({ oneSong: [band(1, { 'Complete?': ['Yes', ''] }), band(3, { 'Complete?': ['Yes', ''] })], twoSong: [twoBand(4)], players });
  g.runSheetCheck(ctx);

  const sent = api.sent(FAN);
  assert.deepEqual(sent.map((c) => c.params.text.split('\n')[0]), ['<b>[Band Update]</b>', '👀 You\'re watching One-song band #3']);
  assert.match(sent[0].params.text, /One-song band #3/);
  assert.equal(sent[1].params.reply_parameters.message_id, api.calls.indexOf(sent[0]) + 1);

  // The owner (band alerts on, not watching) gets both updates and no 👀.
  assert.equal(texts(api, OWNER).filter((t) => t.startsWith('<b>[Band Update]')).length, 2);
  assert.equal(texts(api, OWNER).filter((t) => t.startsWith('👀')).length, 0);

  g.runSheetCheck(ctx);
  assert.equal(api.sent(FAN).length, 2, 'never sent twice');
});

test('with alerts on, a watched band\'s update still gets the 👀 reply', () => {
  const { ctx, api, setSheet } = setup();
  say(ctx, FAN, '/watch two-song 4');
  api.calls.length = 0;
  setSheet({ oneSong: [band(1), band(3)], twoSong: [twoBand(4, { 'Complete?': ['Yes', ''] })], players });
  g.runSheetCheck(ctx);
  assert.deepEqual(texts(api, FAN).map((t) => t.split('\n')[0]), ['<b>[Band Update]</b>', '👀 You\'re watching Two-song band #4']);
});

test('/status: owner only, with a Close button', () => {
  const { ctx, api } = setup();
  ctx.time = Date.UTC(2026, 10, 14, 16, 40); // 12:40 am, 15 Nov in Singapore
  ctx.state.lastSheetCheck = ctx.time - 3 * 60000;
  ctx.assistantAvailable = true;
  ctx.llmRequestsToday = () => 12;
  ctx.state.subscribers[FAN].questionsToday = { day: '2026-11-15', count: 4 };
  const command = msg(OWNER, '/status');
  g.handleUpdate(command, ctx);
  const status = api.sent(OWNER).at(-1).params;
  assert.equal(status.text, [
    '<b>[Status]</b>',
    '<b>Version:</b> ' + g.RELEASE.id,
    '<b>Last sheet check:</b> 12:37 am, 15 Nov (3 min ago)',
    '<b>Problem:</b> none',
    '<b>Subscribers:</b> 2 approved',
    '<b>Sheet:</b> 2 one-song bands, 1 two-song bands, 1 in Player Finder',
    '<b>SoC LaaS:</b> on, 12 API requests today, 4 subscriber questions today'
  ].join('\n'));
  assert.deepEqual(status.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['close:' + command.message.message_id]);

  say(ctx, FAN, '/status');
  assert.match(texts(api, FAN).at(-1), /^<b>\[Help\]<\/b>/);
});

test('/status warns when checks are late and shows the current problem', () => {
  const { ctx, api } = setup();
  ctx.state.lastSheetCheck = ctx.time - 2 * 3600000 - 5 * 60000;
  ctx.state.lastError = 'Could not check the sheet: <boom>';
  say(ctx, OWNER, '/status');
  const text = texts(api, OWNER).at(-1);
  assert.match(text, /\(2 h 5 min ago\)\n⚠ Late: checks should run every 5 minutes/);
  assert.match(text, /<b>Problem:<\/b> ⚠ Could not check the sheet: &lt;boom&gt;/);
  assert.match(text, /<b>SoC LaaS:<\/b> off$/);
});

test('SoC LaaS requests are counted per Singapore day', () => {
  assert.deepEqual(g.addLlmRequest(null, '2026-11-14'), { day: '2026-11-14', requests: 1 });
  assert.deepEqual(g.addLlmRequest({ day: '2026-11-14', requests: 5 }, '2026-11-14'), { day: '2026-11-14', requests: 6 });
  assert.deepEqual(g.addLlmRequest({ day: '2026-11-13', requests: 5 }, '2026-11-14'), { day: '2026-11-14', requests: 1 });
  assert.equal(g.singaporeDay(Date.UTC(2026, 10, 14, 15, 59)), '2026-11-14');
  assert.equal(g.singaporeDay(Date.UTC(2026, 10, 14, 16, 0)), '2026-11-15');
  assert.equal(g.singaporeTime(Date.UTC(2026, 10, 14, 4, 5)), '12:05 pm, 14 Nov');
});

test('help lists the new commands', () => {
  const { ctx, api } = setup();
  ctx.assistantAvailable = true;
  say(ctx, FAN, '/help');
  const help = texts(api, FAN).at(-1);
  assert.match(help, /\/watch one-song 3 – get every update for a band/);
  assert.match(help, /Any other message is a question for SoC LaaS about the sheet \(20 a day\)\.$/);
  assert.doesNotMatch(help, /\/status/);
  say(ctx, OWNER, '/help');
  assert.match(texts(api, OWNER).at(-1), /\/status – check the bot is working/);
});

test('band cards: songs (first row, artist - title), one member per line, short button labels', () => {
  const wb = workbook({
    oneSong: [band(1)],
    twoSong: [{
      number: 11,
      cells: {
        'Song 1 Title': ['夜の歌', 'Night Song'], 'Original Artist 1': ['夜バンド', 'Night Band'],
        'Song 2 Title': ['', 'Blue Sky'], 'Original Artist 2': ['', ''],
        'Point-of-Contact': ['Amy', '@amy'], 'Vocal 1 (Melody)': ['Amy', '@amy'], 'Drum': [' Lee ', '@lee'],
        'Player Subbing In 1': ['Bo', '@bo']
      },
      other: [['Cy (Sax)', '@cy']]
    }],
    players: []
  });
  const snapshot = g.buildSnapshot(wb);
  const b11 = snapshot.bands.find((b) => b.id === 'two-song#11');
  assert.equal(g.bandCardText(b11),
    'Two-song band #11\n🎵 夜バンド - 夜の歌, Blue Sky\nLead Vocals: Amy (@amy)\nDrums: Lee (@lee)\n' +
    'Sub In 1: Bo (@bo)\nOther: Cy (Sax) (@cy)\nPOC: Amy (@amy)');
  assert.equal(g.bandCardText(b11, true), 'Two-song band #11\n🎵 夜バンド - 夜の歌, Blue Sky');
  assert.equal(g.tplBandCard(b11, true, '👀 '), '👀 <b>Two-song band #11</b>\n🎵 夜バンド - 夜の歌, Blue Sky');
  assert.equal(g.bandButtonLabel(b11), '2-song #11 · 夜バンド - 夜の歌');
  const long = { ...b11, songs: [{ title: { primary: 'A'.repeat(50), alternate: '' }, artist: { primary: '', alternate: '' } }] };
  assert.equal(Array.from(g.bandButtonLabel(long)).length, 40);

  // A watched band no longer in the sheet; and a list too long for one message falls back to songs only.
  const gone = g.watchingMessage(['one-song#9'], snapshot);
  assert.match(gone.text, /👀 <b>One-song band #9<\/b>\n<i>Not in the sheet right now\.<\/i>/);
  assert.equal(gone.reply_markup, undefined);
  assert.equal(gone.replyMarkup.inline_keyboard[0][0].text, '❌ One-song band #9');
  const many = { bands: Array.from({ length: 30 }, (_, i) => ({ ...b11, id: 'two-song#' + i, number: String(i) })) };
  const big = g.watchingMessage(many.bands.map((b) => b.id), many);
  assert.ok(big.text.length <= 4096 && !big.text.includes('Lead Vocals'), 'compact when too long');
  assert.match(big.text, /👀 <b>Two-song band #0<\/b>\n🎵 夜バンド - 夜の歌, Blue Sky\n\n/);
});
