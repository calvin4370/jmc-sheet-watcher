const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook } = require('./helpers/grids');
const { fakeCtx, msg, tap } = require('./helpers/fakes');

const OWNER = '100';

/** Owner context with SoC LaaS; chat replies come from `reply(messages)`. */
function setup(reply = () => 'Plays bass.') {
  const ctx = fakeCtx({ sheets: () => workbook({ oneSong: [], players: [] }) });
  ctx.deferred = [];
  ctx.defer = (task) => ctx.deferred.push(task);
  ctx.assistantAvailable = true;
  ctx.prompts = [];
  ctx.chat = (messages, tools) => { ctx.prompts.push({ messages, tools }); return reply(messages, tools); };
  ctx.updateState = (fn) => fn(ctx.state);
  g.handleUpdate(msg(OWNER, '/start'), ctx);
  ctx.api.calls.length = 0;
  const run = () => ctx.deferred.splice(0).forEach((t) => t(ctx));
  return { ctx, run };
}
const lastText = (ctx) => ctx.api.sent(OWNER).at(-1).params.text;

test('/aboutme info: SoC LaaS rewrites the whole note; Updating… is deleted after', () => {
  const { ctx, run } = setup(() => 'Plays bass and keys.\nPOC for one-song band 3.');
  ctx.state.memory.aboutMe = 'Plays bass.';
  g.handleUpdate(msg(OWNER, '/aboutme I also play keys, and I\'m POC for band 3'), ctx);
  assert.equal(lastText(ctx), '<i>Updating your note…</i>');
  assert.equal(ctx.prompts.length, 0, 'the LLM call waits until the lock is released');
  run();

  const prompt = ctx.prompts[0].messages;
  assert.match(prompt[0].content, /Rewrite the whole note/);
  assert.match(prompt[0].content, /never more than 600/);
  assert.equal(prompt[1].content, 'Current note:\nPlays bass.\n\nNew information:\nI also play keys, and I\'m POC for band 3');
  assert.equal(ctx.prompts[0].tools, null);

  assert.equal(ctx.state.memory.aboutMe, 'Plays bass and keys.\nPOC for one-song band 3.');
  assert.equal(lastText(ctx), '<b>[About You]</b> Note updated\nPlays bass and keys.\nPOC for one-song band 3.\n\n' +
    '<i>45/500 characters</i>\n\n(Written by SOC LaaS API)');
  assert.equal(ctx.api.calls.at(-1).method, 'deleteMessage');
});

test('a note of 501–600 characters is saved with a warning; over 600 is not saved', () => {
  let size = 560;
  const { ctx, run } = setup(() => 'x'.repeat(size));
  ctx.state.memory.aboutMe = 'old note';
  g.handleUpdate(msg(OWNER, '/aboutme lots more'), ctx);
  run();
  assert.equal(ctx.state.memory.aboutMe.length, 560);
  assert.match(lastText(ctx), /560\/500 characters\n⚠ 60 over the limit\. Up to 600 is allowed/);

  size = 601;
  g.handleUpdate(msg(OWNER, '/aboutme even more'), ctx);
  run();
  assert.equal(ctx.state.memory.aboutMe.length, 560, 'unchanged');
  assert.match(lastText(ctx), /⚠ Not saved: the note would be 601\/500 characters, and the most allowed is 600\. Your note is unchanged \(560\/500\)/);
});

test('emoji count as one character', () => {
  assert.equal(g.aboutMeSize('🎸🥁 ok'), 5);
});

test('if SoC LaaS fails or makes up a handle, the info is added to the end as written', () => {
  let reply = () => { throw new Error('down'); };
  const { ctx, run } = setup((m) => reply(m));
  ctx.state.memory.aboutMe = 'Plays bass.';
  g.handleUpdate(msg(OWNER, '/aboutme My handle is @me_here'), ctx);
  run();
  assert.equal(ctx.state.memory.aboutMe, 'Plays bass.\nMy handle is @me_here');
  assert.doesNotMatch(lastText(ctx), /Written by SOC LaaS/);

  reply = () => 'Plays bass. Friend of @someone_else.';
  g.handleUpdate(msg(OWNER, '/aboutme likes jazz'), ctx);
  run();
  assert.equal(ctx.state.memory.aboutMe, 'Plays bass.\nMy handle is @me_here\nlikes jazz');
});

test('without SoC LaaS, /aboutme info is added straight away', () => {
  const { ctx } = setup();
  ctx.assistantAvailable = false;
  g.handleUpdate(msg(OWNER, '/aboutme I play drums'), ctx);
  assert.equal(ctx.state.memory.aboutMe, 'I play drums');
  assert.match(lastText(ctx), /Note updated\nI play drums/);
});

test('/aboutme alone shows the note with Clear and Close; Clear empties it', () => {
  const { ctx } = setup();
  ctx.state.memory.aboutMe = 'Plays <bass>';
  const command = msg(OWNER, '/aboutme');
  g.handleUpdate(command, ctx);
  const shown = ctx.api.sent(OWNER).at(-1).params;
  assert.equal(shown.text, '<b>[About You]</b>\nPlays &lt;bass&gt;\n\n<i>12/500 characters</i>\n' +
    'Add or change something with /aboutme followed by the new info.');
  assert.deepEqual(shown.reply_markup.inline_keyboard.flat().map((b) => b.callback_data),
    ['aboutme:clear', 'close:' + command.message.message_id]);

  g.handleUpdate(tap(OWNER, 'aboutme:clear', '', shown.reply_markup), ctx);
  assert.equal(ctx.state.memory.aboutMe, '');
  const edited = ctx.api.calls.filter((c) => c.method === 'editMessageText').at(-1).params;
  assert.match(edited.text, /No note yet/);
  assert.deepEqual(edited.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['close:' + command.message.message_id]);
});

test('/aboutme is owner only', () => {
  const { ctx } = setup();
  g.handleUpdate(msg('7', '/start'), ctx);
  g.handleUpdate(tap(OWNER, 'approve:7'), ctx);
  g.handleUpdate(msg('7', '/aboutme I am the owner'), ctx);
  assert.match(ctx.api.sent('7').at(-1).params.text, /^<b>\[Help\]<\/b>/);
  g.handleUpdate(tap('7', 'aboutme:clear'), ctx);
  assert.equal(ctx.api.calls.at(-1).params.text, 'Only the owner can do that.');
  assert.equal(ctx.state.memory.aboutMe || '', '');
});

test('SoC LaaS questions get the owner\'s Telegram name and @handle, and the note', () => {
  const { ctx, run } = setup(() => 'You are in no bands.');
  ctx.state.memory.aboutMe = 'Plays bass.';
  g.handleUpdate(msg(OWNER, 'am I in any band?', { first_name: 'Sam', username: 'sam_k' }), ctx);
  run();
  const system = ctx.prompts[0].messages[0].content;
  assert.match(system, /The owner is Sam \(@sam_k\) on Telegram\. "Me" or "I" means them/);
  assert.match(system, /their \/aboutme note\):\nPlays bass\./);
});
