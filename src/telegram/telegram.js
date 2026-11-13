/*
 * Minimal Telegram Bot API client.
 * The bot token is only ever used inside the request URL and is removed from any
 * error text, so it can't end up in logs or messages.
 */

/**
 * deps: { token, http(url, options) -> { status, body }, sleep(ms) }
 * Returns { call(method, params) -> result }. Retries network errors, 5xx and 429
 * (honouring Telegram's retry_after). Other errors throw with .status set.
 */
function createTelegramApi(deps) {
  var base = 'https://api.telegram.org/bot' + deps.token + '/';
  var redact = function (text) { return String(text).split(deps.token).join('<token>'); };

  function call(method, params) {
    for (var attempt = 0; ; attempt++) {
      var res;
      try {
        res = deps.http(base + method, {
          method: 'post',
          contentType: 'application/json',
          headers: {},
          payload: JSON.stringify(params || {})
        });
      } catch (error) {
        if (attempt < 2) { deps.sleep(1000 * Math.pow(2, attempt)); continue; }
        throw telegramError(method, 0, redact(error.message));
      }
      var body = null;
      try { body = JSON.parse(res.body); } catch (e) { /* not JSON */ }
      if (res.status === 200 && body && body.ok) return body.result;
      if (res.status === 429 && attempt < 3) {
        var wait = body && body.parameters && body.parameters.retry_after ? body.parameters.retry_after : 1;
        deps.sleep(wait * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < 2) { deps.sleep(1000 * Math.pow(2, attempt)); continue; }
      throw telegramError(method, res.status, body && body.description ? redact(body.description) : '');
    }
  }

  return { call: call };
}

function telegramError(method, status, description) {
  var error = new Error('Telegram ' + method + ' failed (' + status + ')' + (description ? ': ' + description : ''));
  error.status = status;
  return error;
}

/** Sends a message. options: { parseMode: 'HTML' | null, replyMarkup } */
function sendTelegram(api, chatId, text, options) {
  var params = { chat_id: chatId, text: text, link_preview_options: { is_disabled: true } };
  if (options && options.parseMode) params.parse_mode = options.parseMode;
  if (options && options.replyMarkup) params.reply_markup = options.replyMarkup;
  if (options && options.replyTo) {
    params.reply_parameters = { message_id: options.replyTo, allow_sending_without_reply: true };
  }
  return api.call('sendMessage', params);
}
