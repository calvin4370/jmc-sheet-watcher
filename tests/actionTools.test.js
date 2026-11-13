const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook } = require('./helpers/grids');
const { fakeCtx, msg, tap } = require('./helpers/fakes');

const OWNER = '100';
const FAN = '7';
const band = (n) => ({ number: n, cells: { 'Song Title': ['Song ' + n, ''], 'Complete?': ['No', ''], 'Point of Contact': ['Kim', '@kim'] } });

/** Owner + approved subscriber 7 + pending 8, a baseline sheet copy, and SoC LaaS tool plumbing. */
function setup() {
  const ctx = fakeCtx({ sheets: () => workbook({ oneSong: [band(1), band(3)], players: [] }) });
  ctx.readState = () => ctx.state;
  ctx.updateState = (fn) => fn(ctx.state);
  ctx.chat = () => 'Plays drums.';
  [msg(OWNER, '/start'), msg(FAN, '/start', { first_name: 'Amy' }), tap(OWNER, 'approve:' + FAN), msg('8', '/start', { first_name: 'Bo' })]
    .forEach((u) => g.handleUpdate(u, ctx));
  g.runSheetCheck(ctx);
  ctx.api.calls.length = 0;
  return ctx;
}
const run = (ctx, chatId, name, args) => g.runActionTool(ctx, { chatId, isOwner: chatId === OWNER }, name, args);
const lastConfirm = (ctx, chatId) => ctx.api.sent(chatId).filter((c) => c.params.text.startsWith('<b>[Confirm]</b>')).at(-1);
const buttons = (c) => c.params.reply_markup.inline_keyboard[0].map((b) => b.callback_data);
const yes = (ctx, chatId) => g.handleUpdate(tap(chatId, buttons(lastConfirm(ctx, chatId))[0]), ctx);
const no = (ctx, chatId) => g.handleUpdate(tap(chatId, buttons(lastConfirm(ctx, chatId))[1]), ctx);
const edits = (ctx) => ctx.api.calls.filter((c) => c.method === 'editMessageText').map((c) => c.params.text);
const stateOf = (ctx) => JSON.parse(JSON.stringify(ctx.state.subscribers));

test('the schema checker', () => {
  const schema = g.actionToolSpecs().watch_band.tool.function.parameters;
  assert.equal(g.jsonSchemaProblem(schema, { band_type: 'one-song', number: 3 }), '');
  assert.equal(g.jsonSchemaProblem(schema, { band_type: 'three-song', number: 3 }), 'arguments.band_type must be one of: one-song, two-song');
  assert.equal(g.jsonSchemaProblem(schema, { band_type: 'one-song', number: '3' }), 'arguments.number must be a whole number');
  assert.equal(g.jsonSchemaProblem(schema, { band_type: 'one-song', number: 0 }), 'arguments.number must be at least 1');
  assert.equal(g.jsonSchemaProblem(schema, { band_type: 'one-song' }), 'arguments.number is missing');
  assert.equal(g.jsonSchemaProblem(schema, { band_type: 'one-song', number: 3, note: 'x' }), 'arguments.note is not allowed');
  assert.equal(g.jsonSchemaProblem(schema, []), 'arguments must be an object');
  const alerts = g.actionToolSpecs().set_alerts.tool.function.parameters;
  assert.equal(g.jsonSchemaProblem(alerts, { alerts: [] }), 'arguments.alerts needs at least 1 item(s)');
  assert.equal(g.jsonSchemaProblem(alerts, { alerts: [{ alert: 'songs', on: 'yes' }] }), 'arguments.alerts[0].on must be a boolean');
  assert.equal(g.jsonSchemaProblem(alerts, { alerts: [{ alert: 'nope', on: true }] }), 'arguments.alerts[0].alert must be one of: ' +
    Object.keys(g.ALERT_LABELS).join(', '));
  const fav = g.actionToolSpecs().add_favourite.tool.function.parameters;
  assert.equal(g.jsonSchemaProblem(fav, { handle: 'not a handle!' }), 'arguments.handle is not in the right format');
});

test('every tool is strict: all fields required, no extra fields, at every level', () => {
  const checkObject = (schema, where) => {
    assert.equal(schema.additionalProperties, false, where);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), where);
    Object.entries(schema.properties).forEach(([k, v]) => {
      if (v.type === 'object') checkObject(v, where + '.' + k);
      if (v.type === 'array' && v.items.type === 'object') checkObject(v.items, where + '.' + k + '[]');
    });
  };
  for (const tool of g.actionToolDefinitions(true)) {
    assert.equal(tool.function.strict, true, tool.function.name);
    checkObject(tool.function.parameters, tool.function.name);
  }
});

test('subscribers are only offered their own commands; owner-only tools are refused anyway', () => {
  const names = g.actionToolDefinitions(false).map((t) => t.function.name);
  assert.deepEqual(names, ['get_alert_settings', 'set_alerts', 'stop_alerts', 'list_favourites', 'add_favourite',
    'remove_favourite', 'list_watched_bands', 'watch_band', 'unwatch_band', 'get_my_chat_id']);
  const ctx = setup();
  for (const [name, args] of [['get_status', {}], ['list_subscribers', {}], ['manage_subscriber', { chat_id: '8', action: 'approve' }],
    ['update_about_me', { info: 'x' }], ['clear_about_me', {}]]) {
    assert.deepEqual(run(ctx, FAN, name, args), { ok: false, error: 'Only the owner can do that.' }, name);
  }
  assert.equal(ctx.state.subscribers['8'].status, 'pending');
  assert.equal(ctx.api.calls.length, 0);
});

test('lookups run straight away, with no confirmation', () => {
  const ctx = setup();
  ctx.state.subscribers[FAN].favourites = ['@oli'];
  ctx.state.subscribers[FAN].watching = ['one-song#3'];
  ctx.state.subscribers[FAN].alerts = { songs: false };
  assert.deepEqual(run(ctx, FAN, 'list_favourites', {}), { favourites: ['@oli'], ok: true });
  assert.deepEqual(run(ctx, FAN, 'list_watched_bands', {}), { watching: ['One-song band #3'], ok: true });
  assert.deepEqual(run(ctx, FAN, 'get_my_chat_id', {}), { chat_id: FAN, ok: true });
  const settings = run(ctx, FAN, 'get_alert_settings', {});
  assert.deepEqual(settings.alerts.find((a) => a.alert === 'songs'), { alert: 'songs', label: 'Songs', on: false });
  assert.deepEqual(run(ctx, OWNER, 'list_subscribers', {}).subscribers.map((s) => [s.chat_id, s.name, s.status, s.is_owner]),
    [['100', 'User100', 'approved', true], ['7', 'Amy', 'approved', false], ['8', 'Bo', 'pending', false]]);
  assert.match(run(ctx, OWNER, 'get_status', {}).status, /^\[Status\]\nVersion: /);
  assert.equal(ctx.api.calls.length, 0, 'no messages, no confirmations');
});

test('each change asks first; ✅ Yes does exactly what the command does', () => {
  const cases = [
    [FAN, 'add_favourite', { handle: 'Oli_X' }, '/favourite Oli (@Oli_X)', 'Add @Oli_X to your favourites'],
    [FAN, 'watch_band', { band_type: 'one-song', number: 3 }, '/watch one-song 3', 'Watch One-song band #3'],
    [FAN, 'stop_alerts', {}, '/stop', 'Stop all your alerts (send /start to turn them back on)'],
    [FAN, 'set_alerts', { alerts: [{ alert: 'songs', on: false }, { alert: 'playerAdded', on: false }] }, null, 'Turn Songs off, New players off'],
    [OWNER, 'manage_subscriber', { chat_id: '8', action: 'approve' }, null, 'Approve Bo (they\'ll be told)']
  ];
  for (const [chat, name, args, command, summary] of cases) {
    const viaTool = setup();
    const before = stateOf(viaTool);
    const result = run(viaTool, chat, name, args);
    assert.equal(result.status, 'awaiting_confirmation', name);
    assert.deepEqual(stateOf(viaTool), before, name + ': nothing changes before ✅ Yes');
    const confirm = lastConfirm(viaTool, chat);
    assert.equal(confirm.params.text, '<b>[Confirm]</b>\nSoC LaaS wants to: ' + summary, name);
    yes(viaTool, chat);
    assert.match(edits(viaTool).at(-1), /^<b>\[Confirm\]<\/b>\n✅ Done\. /, name);

    if (command) {
      const viaCommand = setup();
      g.handleUpdate(msg(chat, command), viaCommand);
      assert.deepEqual(stateOf(viaTool), stateOf(viaCommand), name + ' matches ' + command);
      assert.equal(edits(viaTool).at(-1), '<b>[Confirm]</b>\n✅ Done. ' + viaCommand.api.sent(chat).at(-1).params.text, name);
    }
  }
});

test('approving through SoC LaaS tells the subscriber, like the button', () => {
  const ctx = setup();
  run(ctx, OWNER, 'manage_subscriber', { chat_id: '8', action: 'approve' });
  yes(ctx, OWNER);
  assert.equal(ctx.state.subscribers['8'].status, 'approved');
  assert.match(ctx.api.sent('8').at(-1).params.text, /^You're approved!/);
});

test('❌ Cancel changes nothing; a second tap or someone else\'s tap does nothing', () => {
  const ctx = setup();
  run(ctx, FAN, 'add_favourite', { handle: '@lee' });
  const data = buttons(lastConfirm(ctx, FAN));
  g.handleUpdate(tap(OWNER, data[0]), ctx);
  assert.equal(ctx.api.calls.at(-1).params.text, 'This isn\'t your request.');
  assert.deepEqual(ctx.state.subscribers[FAN].favourites, []);
  no(ctx, FAN);
  assert.equal(edits(ctx).at(-1), '<b>[Confirm]</b>\n❌ Cancelled: Add @lee to your favourites');
  g.handleUpdate(tap(FAN, data[0]), ctx);
  assert.match(edits(ctx).at(-1), /expired or was already handled/);
  assert.deepEqual(ctx.state.subscribers[FAN].favourites, []);
});

test('confirmations expire after 24 hours', () => {
  const ctx = setup();
  run(ctx, FAN, 'watch_band', { band_type: 'one-song', number: 1 });
  ctx.time += 24 * 3600000 + 1;
  yes(ctx, FAN);
  assert.match(edits(ctx).at(-1), /expired/);
  assert.deepEqual(ctx.state.subscribers[FAN].watching, []);
  assert.deepEqual(ctx.state.pendingActions, {});
});

test('bad arguments, or something that would fail or change nothing: no confirmation', () => {
  const ctx = setup();
  ctx.state.subscribers[FAN].favourites = ['@oli'];
  assert.deepEqual(run(ctx, FAN, 'watch_band', { band_type: 'one-song', number: '3' }),
    { ok: false, error: 'Invalid arguments: arguments.number must be a whole number. Nothing was changed.' });
  assert.deepEqual(run(ctx, FAN, 'watch_band', undefined),
    { ok: false, error: 'The arguments were not valid JSON. Nothing was changed.' });
  assert.deepEqual(run(ctx, FAN, 'watch_band', { band_type: 'one-song', number: 9 }),
    { ok: false, error: 'There\'s no One-song band #9 in the sheet right now. Nothing was changed.' });
  assert.deepEqual(run(ctx, FAN, 'add_favourite', { handle: 'OLI' }),
    { ok: true, changed: false, result: '@OLI is already one of your favourites.' });
  assert.deepEqual(run(ctx, FAN, 'remove_favourite', { handle: '@nobody' }),
    { ok: false, error: 'That handle isn\'t in your favourites. See them with /favourites. Nothing was changed.' });
  assert.deepEqual(run(ctx, OWNER, 'manage_subscriber', { chat_id: OWNER, action: 'remove' }),
    { ok: false, error: 'You can\'t do that to yourself. Nothing was changed.' });
  assert.equal(ctx.api.calls.length, 0);
  assert.deepEqual(ctx.state.pendingActions, {});
});

test('the action runs on the state at the time of ✅ Yes', () => {
  const ctx = setup();
  run(ctx, FAN, 'add_favourite', { handle: '@lee' });
  g.handleUpdate(tap(OWNER, 'remove:' + FAN), ctx); // the owner removes them meanwhile
  yes(ctx, FAN);
  assert.match(edits(ctx).at(-1), /⚠ Not done: Only approved subscribers/);
  assert.deepEqual(ctx.state.subscribers[FAN].favourites, []);
});

test('update_about_me: the confirmation shows the rewritten note; too long is refused', () => {
  const ctx = setup();
  ctx.state.memory.aboutMe = 'Plays bass.';
  ctx.chat = () => 'Plays bass.\nPlays drums.';
  run(ctx, OWNER, 'update_about_me', { info: 'I play drums' });
  assert.equal(ctx.state.memory.aboutMe, 'Plays bass.');
  yes(ctx, OWNER);
  assert.equal(ctx.state.memory.aboutMe, 'Plays bass.\nPlays drums.');

  ctx.chat = () => 'x'.repeat(601);
  assert.deepEqual(run(ctx, OWNER, 'update_about_me', { info: 'lots' }), {
    ok: false, error: 'The rewritten note would be 601 characters; the most allowed is 600. Nothing was changed. Tell the owner.'
  });

  run(ctx, OWNER, 'clear_about_me', {});
  yes(ctx, OWNER);
  assert.equal(ctx.state.memory.aboutMe, '');
});

test('in a conversation: invalid JSON arguments get a structured error, then a fixed call goes through', () => {
  const ctx = setup();
  ctx.deferred = [];
  ctx.defer = (t) => ctx.deferred.push(t);
  ctx.assistantAvailable = true;
  const seen = [];
  const replies = [
    { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'watch_band', arguments: '{band: 3' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'b', type: 'function', function: { name: 'watch_band', arguments: '{"band_type":"one-song","number":3}' } }] },
    'Tap ✅ Yes to start watching One-song band #3.'
  ];
  ctx.chat = (messages) => { seen.push(JSON.parse(JSON.stringify(messages))); return replies.shift(); };
  g.handleUpdate(msg(FAN, 'watch band 3 on the one song sheet'), ctx);
  ctx.deferred.splice(0).forEach((t) => t(ctx));

  assert.deepEqual(JSON.parse(seen[1].at(-1).content), { ok: false, error: 'The arguments were not valid JSON. Nothing was changed.' });
  assert.equal(JSON.parse(seen[2].at(-1).content).status, 'awaiting_confirmation');
  assert.match(seen[0][0].content, /Never say a change is done, saved or noted/);
  assert.match(seen[0][0].content, /The bot's commands:\n\/settings/);
  const texts = ctx.api.sent(FAN).map((c) => c.params.text);
  assert.ok(texts.includes('<i>Called tool: watch_band (band_type: one-song, number: 3)</i>'));
  assert.ok(texts.includes('<b>[Confirm]</b>\nSoC LaaS wants to: Watch One-song band #3'));
  yes(ctx, FAN);
  assert.deepEqual(ctx.state.subscribers[FAN].watching, ['one-song#3']);
});
