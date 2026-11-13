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
const players = (list) => list.map((p, i) => ({ sn: i + 1, ...p }));
const basePlayers = () => players([{ name: 'Oli', handle: '@Oli_X', instruments: 'Drums (3)' }, { name: 'Pat', handle: '@pat', instruments: 'Vox (5)' }]);

/** Owner + subscriber 7 approved; the sheet can be swapped between checks. */
function setup(initial = { oneSong: [band(1)], players: basePlayers() }) {
  const api = fakeApi();
  let current = workbook(initial);
  const ctx = fakeCtx({ api, sheets: () => current });
  [msg(OWNER, '/start'), msg(FAN, '/start'), tap(OWNER, 'approve:' + FAN)].forEach((u) => g.handleUpdate(u, ctx));
  g.runSheetCheck(ctx); // baseline
  api.calls.length = 0;
  return { ctx, api, setSheet: (wb) => { current = workbook(wb); } };
}
const say = (ctx, chat, text) => g.handleUpdate(msg(chat, text), ctx);
const texts = (api, chat) => api.sent(chat).map((c) => c.params.text);
const stars = (api, chat) => api.sent(chat).filter((c) => c.params.text.startsWith('⭐ One of your favourite'));

test('/favourite, /favourites and /unfavourite', () => {
  const { ctx, api } = setup();
  say(ctx, FAN, '/favourite Oli (@OLI_x)');
  assert.match(texts(api, FAN).at(-1), /^⭐ Added @OLI_x to your favourites/);
  say(ctx, FAN, '/favourite @oli_X');
  assert.equal(texts(api, FAN).at(-1), '@oli_X is already one of your favourites.');
  say(ctx, FAN, '/favourite Oli');
  assert.match(texts(api, FAN).at(-1), /Please include their Telegram handle/);
  assert.deepEqual(ctx.state.subscribers[FAN].favourites, ['@OLI_x']);

  say(ctx, FAN, '/favourite @pat');
  say(ctx, FAN, '/favourites');
  const list = api.sent(FAN).at(-1).params;
  assert.equal(list.text, '<b>[Your Favourites]</b>\n⭐ @OLI_x\n⭐ @pat\n\nTap a button to remove one.');
  const buttons = list.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(buttons.slice(0, 2), ['unfav:oli_x', 'unfav:pat']);
  assert.match(buttons[2], /^close:\d+$/);

  g.handleUpdate(tap(FAN, 'unfav:oli_x', '', list.reply_markup), ctx);
  assert.deepEqual(ctx.state.subscribers[FAN].favourites, ['@pat']);
  const edited = api.calls.filter((c) => c.method === 'editMessageText').at(-1).params;
  assert.match(edited.text, /⭐ @pat\n/);
  assert.deepEqual(edited.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['unfav:pat', buttons[2]],
    'Close still deletes the original /favourites message');

  say(ctx, FAN, '/unfavourite @PAT');
  assert.equal(texts(api, FAN).at(-1), 'Removed @PAT from your favourites.');
  assert.deepEqual(ctx.state.subscribers[FAN].favourites, []);
  say(ctx, FAN, '/unfavourite @nobody');
  assert.match(texts(api, FAN).at(-1), /isn't in your favourites/);

  // Not available before approval.
  say(ctx, '9', '/favourite @oli_x');
  assert.match(texts(api, '9').at(-1), /Send \/start/);
});

test('Close deletes the /favourites list and the /favourites command', () => {
  const { ctx, api } = setup();
  const command = msg(FAN, '/favourites');
  g.handleUpdate(command, ctx);
  const list = api.sent(FAN).at(-1).params;
  assert.match(list.text, /No favourites yet/);
  const close = list.reply_markup.inline_keyboard.flat().find((b) => b.text === '✖ Close');
  assert.equal(close.callback_data, 'close:' + command.message.message_id);

  api.calls.length = 0;
  g.handleUpdate(tap(FAN, close.callback_data, '', list.reply_markup), ctx);
  assert.deepEqual(api.calls.filter((c) => c.method === 'deleteMessage').map((c) => c.params),
    [{ chat_id: FAN, message_id: 55 }, { chat_id: FAN, message_id: command.message.message_id }]);
  assert.equal(api.calls.at(-1).params.text, '', 'no pop-up when it worked');
});

test('Close on a message older than 48 hours explains why nothing happened', () => {
  const { ctx, api } = setup();
  api.call = (method, params) => {
    api.calls.push({ method, params });
    if (method === 'deleteMessage') { const e = new Error('message can\'t be deleted'); e.status = 400; throw e; }
    return {};
  };
  g.handleUpdate(tap(FAN, 'close:1234'), ctx);
  assert.match(api.calls.at(-1).params.text, /48 hours/);
});

test('a favourite joining a band: the update, then a ⭐ reply to it', () => {
  const { ctx, api, setSheet } = setup();
  say(ctx, FAN, '/favourite Lee (@lee)');
  api.calls.length = 0;
  setSheet({ oneSong: [band(1, { 'Drum': ['Lee', '@LEE'] })], players: basePlayers() });
  g.runSheetCheck(ctx);

  const sent = api.sent(FAN);
  assert.equal(sent.length, 2);
  assert.match(sent[0].params.text, /^<b>\[Band Update\]<\/b>/);
  assert.equal(sent[1].params.text, '⭐ One of your favourite players has an update: Lee (@LEE)');
  const updateId = api.calls.indexOf(sent[0]) + 1; // the fake API numbers messages by call order
  assert.deepEqual(sent[1].params.reply_parameters, { message_id: updateId, allow_sending_without_reply: true });
  assert.equal(stars(api, OWNER).length, 0, 'the owner has no favourites');
});

test('swapped out, leaving, new band and removed band all count; an unchanged member does not', () => {
  const { ctx, api, setSheet } = setup({ oneSong: [band(1, { 'Drum': ['Lee', '@lee'] }), band(2), band(3, { 'Keyboard': ['Lee', '@lee'] })], players: basePlayers() });
  say(ctx, FAN, '/favourite @lee');
  say(ctx, FAN, '/favourite @kim');
  api.calls.length = 0;

  // Band 1: Kim (bass, POC) unchanged, Lee swapped out of drums. Band 2: someone else changes.
  // Band 3 removed (Lee was in it). Band 4 new, with Kim.
  setSheet({
    oneSong: [band(1, { 'Drum': ['Ray', '@ray'] }), band(2, { 'Complete?': ['Yes', ''] }), { number: 3 }, band(4)],
    players: basePlayers()
  });
  g.runSheetCheck(ctx);
  assert.deepEqual(stars(api, FAN).map((c) => c.params.text), [
    '⭐ One of your favourite players has an update: Lee (@lee)',  // band 1: Lee swapped out (Kim unchanged)
    '⭐ One of your favourite players has an update: Kim (@kim)',  // band 4: new band with Kim
    '⭐ One of your favourite players has an update: Kim (@kim), Lee (@lee)' // band 3 removed
  ]);
  // Band 2 has Kim in it, but Kim's own entry didn't change: no star.
  const band2 = api.sent(FAN).findIndex((c) => /One-song band #2/.test(c.params.text));
  assert.ok(band2 >= 0);
  assert.doesNotMatch(api.sent(FAN)[band2 + 1].params.text, /^⭐/);
});

test('Player Finder: a favourite\'s entry changing, appearing or leaving', () => {
  const { ctx, api, setSheet } = setup();
  say(ctx, FAN, '/favourite Oli (@oli_x)');
  api.calls.length = 0;
  setSheet({ oneSong: [band(1)], players: players([{ name: 'Oli', handle: '@Oli_X', instruments: 'Drums (4)' }, { name: 'Pat', handle: '@pat', instruments: 'Vox (6)' }]) });
  g.runSheetCheck(ctx);
  assert.deepEqual(texts(api, FAN).map((t) => t.split('\n')[0]), [
    '<b>[Player Finder: Update]</b>',
    '⭐ One of your favourite players has an update: Oli (@Oli_X)',
    '<b>[Player Finder: Update]</b>'
  ]);
});

test('favourites override switched-off alerts; other updates still follow the switches', () => {
  const { ctx, api, setSheet } = setup();
  say(ctx, FAN, '/favourite @oli_x');
  g.handleUpdate(tap(FAN, 'toggle:playerFinder'), ctx);
  api.calls.length = 0;
  setSheet({ oneSong: [band(1)], players: players([{ name: 'Oli', handle: '@Oli_X', instruments: 'Drums (4)' }, { name: 'Pat', handle: '@pat', instruments: 'Vox (6)' }]) });
  g.runSheetCheck(ctx);
  assert.deepEqual(texts(api, FAN).map((t) => t.split('\n')[0]), [
    '<b>[Player Finder: Update]</b>',
    '⭐ One of your favourite players has an update: Oli (@Oli_X)'
  ]);
  assert.match(texts(api, FAN)[0], /Oli/, 'only the favourite\'s update, not Pat\'s');
});

test('handles written without @ in the sheet still match', () => {
  const { ctx, api, setSheet } = setup();
  say(ctx, FAN, '/favourite @just_tin');
  api.calls.length = 0;
  setSheet({ oneSong: [band(1, { 'Drum': ['Justin', 'just_tin'] })], players: basePlayers() });
  g.runSheetCheck(ctx);
  assert.equal(stars(api, FAN).length, 1);
});

test('a re-run never sends the update or the ⭐ twice; a failed ⭐ is retried alone', () => {
  let failStar = true;
  const api = fakeApi({ failFor: { [FAN]: (p) => (failStar && p.text.startsWith('⭐ One') ? 500 : 0) } });
  let current = workbook({ oneSong: [band(1)], players: basePlayers() });
  const ctx = fakeCtx({ api, sheets: () => current });
  api.failuresOn = false;
  [msg(OWNER, '/start'), msg(FAN, '/start'), tap(OWNER, 'approve:' + FAN), msg(FAN, '/favourite @lee')].forEach((u) => g.handleUpdate(u, ctx));
  api.failuresOn = true;
  g.runSheetCheck(ctx);
  api.calls.length = 0;

  current = workbook({ oneSong: [band(1, { 'Drum': ['Lee', '@lee'] })], players: basePlayers() });
  assert.equal(g.runSheetCheck(ctx).ok, false); // the ⭐ failed: retry next time
  failStar = false;
  assert.equal(g.runSheetCheck(ctx).ok, true);
  const fanTexts = texts(api, FAN).map((t) => t.split('\n')[0]);
  assert.equal(fanTexts.filter((t) => t === '<b>[Band Update]</b>').length, 1);
  assert.equal(fanTexts.filter((t) => t.startsWith('⭐ One')).length, 2); // one failed attempt + one success
  g.runSheetCheck(ctx);
  assert.equal(texts(api, FAN).length, fanTexts.length, 'nothing more on a quiet check');
});

test('help lists the favourite commands', () => {
  const { ctx, api } = setup();
  say(ctx, FAN, '/help');
  assert.match(texts(api, FAN).at(-1), /\/favourite Name \(@handle\).*\n\/unfavourite @handle.*\n\/favourites/);
});
