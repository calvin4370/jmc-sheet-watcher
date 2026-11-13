// Fake Telegram API and watcher context for bot/watcher tests.
const g = require('./load');

/** Records every call. failFor: { chatId: status } makes sendMessage to that chat fail. */
function fakeApi({ updates = [], failFor = {} } = {}) {
  const calls = [];
  const api = {
    calls,
    failuresOn: true, // tests switch this off while setting up subscribers
    call(method, params) {
      calls.push({ method, params });
      if (method === 'getUpdates') return updates.filter((u) => u.update_id >= (params.offset || 0));
      if (method === 'sendMessage' && api.failuresOn && failFor[params.chat_id]) {
        const status = typeof failFor[params.chat_id] === 'function'
          ? failFor[params.chat_id](params) : failFor[params.chat_id];
        if (status) {
          const e = new Error('Telegram sendMessage failed (' + status + ')');
          e.status = status;
          throw e;
        }
      }
      return { message_id: calls.length };
    },
    sent(chatId) {
      return calls.filter((c) => c.method === 'sendMessage' && (chatId === undefined || String(c.params.chat_id) === String(chatId)));
    }
  };
  return api;
}

function fakeCtx({ state = g.emptyState(), api = fakeApi(), owner = '100', sheets = null, rewrite = null, now = 1e12 } = {}) {
  const logs = [];
  const ctx = {
    state,
    api,
    ownerChatId: owner,
    readSheets: () => (typeof sheets === 'function' ? sheets() : sheets),
    rewrite,
    now: () => ctx.time,
    time: now,
    sleep: () => {},
    log: (m) => logs.push(m),
    logs
  };
  return ctx;
}

let nextUpdate = 1;
const msg = (chatId, text, from = {}) => ({
  update_id: nextUpdate++,
  message: { message_id: 1000 + nextUpdate, chat: { id: Number(chatId), type: 'private' }, from: { first_name: 'User' + chatId, ...from }, text }
});
const tap = (chatId, data, messageText = '', replyMarkup = undefined) => ({
  update_id: nextUpdate++,
  callback_query: { id: 'cq' + nextUpdate, data, from: { id: Number(chatId) }, message: { message_id: 55, chat: { id: Number(chatId) }, text: messageText, reply_markup: replyMarkup } }
});

module.exports = { fakeApi, fakeCtx, msg, tap };
