const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { fakeApi, fakeCtx, msg, tap } = require('./helpers/fakes');

const OWNER = '100';
const handle = (ctx, ...updates) => updates.forEach((u) => g.handleUpdate(u, ctx));
const lastText = (api, chatId) => api.sent(chatId).at(-1).params.text;

test('/myid works for anyone; nothing else works until the owner is configured', () => {
  const ctx = fakeCtx({ owner: '' });
  handle(ctx, msg(5, '/myid'), msg(5, '/start'));
  assert.equal(ctx.api.sent(5)[0].params.text, 'Your chat ID is <code>5</code>.');
  assert.equal(lastText(ctx.api, 5), 'This bot is not set up yet.');
  assert.deepEqual(ctx.state.subscribers, {});
});

test('the owner is approved automatically on /start', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(OWNER, '/start'));
  assert.equal(ctx.state.subscribers[OWNER].status, 'approved');
  assert.match(lastText(ctx.api, OWNER), /You're the owner/);
});

test('a new person asks, the owner approves, then they can use /settings', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(7, '/start', { first_name: 'Amy', username: 'amy_x' }));
  assert.equal(ctx.state.subscribers['7'].status, 'pending');
  assert.match(lastText(ctx.api, 7), /needs to approve you/);

  const request = ctx.api.sent(OWNER).at(-1).params;
  assert.equal(request.text, '<b>[Subscriber Request]</b>\nAmy (@amy_x)\nChat ID: <code>7</code>');
  assert.deepEqual(request.reply_markup.inline_keyboard[0].map((b) => b.callback_data), ['approve:7', 'reject:7']);

  handle(ctx, msg(7, '/settings'));
  assert.match(lastText(ctx.api, 7), /waiting for the owner's approval/);

  handle(ctx, tap(OWNER, 'approve:7', 'Subscriber Request'));
  assert.equal(ctx.state.subscribers['7'].status, 'approved');
  assert.match(lastText(ctx.api, 7), /You're approved/);
  const edit = ctx.api.calls.find((c) => c.method === 'editMessageText');
  assert.match(edit.params.text, /✅ Approved: Amy \(@amy_x\)/);

  handle(ctx, msg(7, '/settings'));
  const settings = ctx.api.sent(7).at(-1).params;
  assert.equal(settings.text, g.SETTINGS_TEXT);
  assert.equal(settings.reply_markup.inline_keyboard[0][0].text, '✅ Band alerts');
});

test('only the owner can approve, reject or remove', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(7, '/start'), msg(8, '/start'));
  handle(ctx, tap(8, 'approve:7'));
  assert.equal(ctx.state.subscribers['7'].status, 'pending');
  const answer = ctx.api.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1);
  assert.equal(answer.params.text, 'Only the owner can do that.');
});

test('a rejected person is told, and asking again does not bother the owner', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(7, '/start'), tap(OWNER, 'reject:7'));
  assert.equal(ctx.state.subscribers['7'].status, 'rejected');
  const ownerMessages = ctx.api.sent(OWNER).length;
  handle(ctx, msg(7, '/start'));
  assert.match(lastText(ctx.api, 7), /declined/);
  assert.equal(ctx.api.sent(OWNER).length, ownerMessages);
});

test('settings buttons toggle that subscriber\'s switches only', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(7, '/start'), tap(OWNER, 'approve:7'), msg(9, '/start'), tap(OWNER, 'approve:9'));
  handle(ctx, tap(7, 'toggle:playerFinder'));
  assert.equal(ctx.state.subscribers['7'].alerts.playerFinder, false);
  assert.equal(g.resolveAlerts(ctx.state.subscribers['9'].alerts).playerFinder, true);
  const edit = ctx.api.calls.filter((c) => c.method === 'editMessageReplyMarkup').at(-1);
  const flat = edit.params.reply_markup.inline_keyboard.flat();
  assert.equal(flat.find((b) => b.callback_data === 'toggle:playerFinder').text, '❌ Player Finder alerts');

  handle(ctx, tap(7, 'toggle:playerFinder'));
  assert.equal(ctx.state.subscribers['7'].alerts.playerFinder, true);

  handle(ctx, tap(7, 'toggle:notASwitch'), tap(12, 'toggle:bands'));
  assert.equal(ctx.state.subscribers['12'], undefined);
});

test('/stop and /start again', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(7, '/start'), tap(OWNER, 'approve:7'), msg(7, '/stop'));
  assert.equal(ctx.state.subscribers['7'].status, 'stopped');
  handle(ctx, msg(7, '/start'));
  assert.equal(ctx.state.subscribers['7'].status, 'approved');
  assert.match(lastText(ctx.api, 7), /Welcome back/);
});

test('/subscribers lists people with manage buttons, for the owner only', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(OWNER, '/start'), msg(7, '/start', { first_name: 'Amy' }), msg(8, '/start', { first_name: 'Bo' }), tap(OWNER, 'approve:8'));
  handle(ctx, msg(OWNER, '/subscribers'));
  const list = ctx.api.sent(OWNER).at(-1).params;
  assert.equal(list.text, '<b>[Subscribers]</b>\nUser100 — approved (you)\nAmy — pending\nBo — approved');
  assert.deepEqual(list.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['approve:7', 'reject:7', 'remove:8']);

  handle(ctx, msg(8, '/subscribers'));
  assert.match(lastText(ctx.api, 8), /^<b>\[Help\]<\/b>/);
  assert.doesNotMatch(lastText(ctx.api, 8), /subscribers/);

  handle(ctx, tap(OWNER, 'remove:8'));
  assert.equal(ctx.state.subscribers['8'].status, 'removed');
  assert.match(lastText(ctx.api, 8), /turned off your alerts/);
});

test('group chats are ignored', () => {
  const ctx = fakeCtx();
  g.handleUpdate({ update_id: 1, message: { chat: { id: -5, type: 'group' }, text: '/start' } }, ctx);
  assert.equal(ctx.api.calls.length, 0);
});

test('names from Telegram are HTML-escaped', () => {
  const ctx = fakeCtx();
  handle(ctx, msg(7, '/start', { first_name: '<b>x</b> & co' }));
  assert.match(ctx.api.sent(OWNER).at(-1).params.text, /&lt;b&gt;x&lt;\/b&gt; &amp; co/);
});

test('every alert switch has a /settings button', () => {
  const buttons = g.SETTINGS_LAYOUT.flat().sort();
  assert.deepEqual(buttons, Object.keys(g.SETTINGS.defaultAlerts).sort());
  for (const key of buttons) assert.ok(g.ALERT_LABELS[key], key);
});
