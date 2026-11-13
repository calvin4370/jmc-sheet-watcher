/*
 * Telegram bot conversations: subscribing (with owner approval), /settings buttons,
 * and owner tools. Only private chats are handled; group chats are ignored.
 *
 * Commands:
 *   /start        ask to subscribe (the owner is approved automatically)
 *   /settings     tap-to-toggle alert buttons
 *   /stop         stop alerts (send /start to resume)
 *   /myid         show your chat ID (used once, to set TELEGRAM_OWNER_CHAT_ID)
 *   /subscribers  owner only: list subscribers with Approve / Reject / Remove buttons
 *   /status       owner only: is the bot working? (status.js)
 *   /favourite Name (@handle), /unfavourite @handle, /favourites   (see favourites.js)
 *   /aboutme [info]  owner only: the note about them SoC LaaS gets (see aboutMe.js)
 *   /watch one-song 3, /unwatch one-song 3, /watching   (see watch.js)
 *   /help
 * Plain messages from the owner and approved subscribers are answered by SoC LaaS
 * (assistant.js); subscribers have a daily limit.
 */

/** Button labels for each alert switch in /settings. */
var ALERT_LABELS = {
  bands: 'Band alerts',
  bandAdded: 'New bands',
  bandRemoved: 'Removed bands',
  members: 'Members',
  substitutions: 'Subs',
  otherInstruments: 'Other insts',
  songs: 'Songs',
  pointOfContact: 'POC',
  completion: 'Complete?',
  otherChanges: 'Other changes',
  playerFinder: 'Player Finder alerts',
  playerAdded: 'New players',
  playerRemoved: 'Removed players',
  playerEdited: 'Edited entries'
};

/** Button rows in /settings. */
var SETTINGS_LAYOUT = [
  ['bands'],
  ['bandAdded', 'bandRemoved'],
  ['members', 'substitutions'],
  ['otherInstruments', 'songs'],
  ['pointOfContact', 'completion'],
  ['otherChanges'],
  ['playerFinder'],
  ['playerAdded', 'playerRemoved', 'playerEdited']
];

var SETTINGS_TEXT = '<b>[Your Alerts]</b>\nTap a button to switch that alert on (✅) or off (❌).';

function botSend(ctx, chatId, html, replyMarkup) {
  return sendTelegram(ctx.api, chatId, html, { parseMode: 'HTML', replyMarkup: replyMarkup });
}

/** Sends without failing the caller (e.g. the person blocked the bot). */
function botTrySend(ctx, chatId, html, replyMarkup) {
  try { botSend(ctx, chatId, html, replyMarkup); } catch (e) { ctx.log('Could not message chat ' + chatId + ': ' + e.message); }
}

function isOwner(ctx, chatId) {
  return !!ctx.ownerChatId && String(chatId) === String(ctx.ownerChatId);
}

function telegramUserLabel(from) {
  from = from || {};
  var name = [from.first_name, from.last_name].filter(function (x) { return x; }).join(' ');
  if (from.username) name = (name ? name + ' ' : '') + '(@' + from.username + ')';
  return name || 'Unknown';
}

function settingsKeyboard(alerts) {
  return {
    inline_keyboard: SETTINGS_LAYOUT.map(function (row) {
      return row.map(function (key) {
        return { text: (alerts[key] ? '✅ ' : '❌ ') + ALERT_LABELS[key], callback_data: 'toggle:' + key };
      });
    })
  };
}

function helpText(ctx, chatId) {
  return '<b>[Help]</b>\n' +
    '/settings – choose which alerts you get\n' +
    '/stop – stop alerts (send /start to resume)\n' +
    '/favourite Name (@handle) – get a ⭐ when their entry changes\n' +
    '/unfavourite @handle – remove a favourite\n' +
    '/favourites – see your favourites\n' +
    '/watch one-song 3 – get every update for a band\n' +
    '/unwatch one-song 3 – stop watching a band\n' +
    '/watching – see the bands you watch\n' +
    '/myid – show your chat ID' +
    (isOwner(ctx, chatId)
      ? '\n/subscribers – see and manage subscribers' +
        '\n/status – check the bot is working' +
        '\n/aboutme – what SoC LaaS knows about you (add to it: /aboutme I play bass)'
      : '') +
    (ctx.assistantAvailable
      ? '\nAny other message is a question for SoC LaaS about the sheet' +
        (isOwner(ctx, chatId) ? '.' : ' (' + SETTINGS.llm.subscriberDailyQuestions + ' a day).')
      : '');
}

function handleUpdate(update, ctx) {
  if (update.message) handleMessage(update.message, ctx);
  else if (update.callback_query) handleCallback(update.callback_query, ctx);
}

function handleMessage(message, ctx) {
  if (!message.chat || message.chat.type !== 'private') return;
  var chatId = String(message.chat.id);
  var match = String(message.text || '').trim().match(/^\/([a-z_]+)(@\w+)?/i);
  var command = match ? match[1].toLowerCase() : '';

  if (command === 'myid') {
    botSend(ctx, chatId, 'Your chat ID is <code>' + chatId + '</code>.', withCloseButton(null, message.message_id));
    return;
  }
  if (!ctx.ownerChatId) {
    botSend(ctx, chatId, 'This bot is not set up yet.');
    return;
  }
  if (command === 'start') {
    startCommand(message, chatId, ctx);
    return;
  }

  // The owner's plain (non-command) messages go to SoC LaaS (see assistant.js).
  var text = String(message.text || '').trim();
  if (!command && text && isOwner(ctx, chatId) && ctx.defer && ctx.assistantAvailable) {
    askAssistant(ctx, chatId, text, message.from);
    return;
  }

  var sub = ctx.state.subscribers[chatId];
  if (!sub || sub.status !== 'approved') {
    botSend(ctx, chatId, sub && sub.status === 'pending'
      ? 'Your request is waiting for the owner\'s approval.'
      : 'Send /start to ask for alerts.');
    return;
  }

  // Approved subscribers' plain messages go to SoC LaaS too, up to a daily limit.
  if (!command && text && ctx.defer && ctx.assistantAvailable) {
    var left = takeSubscriberQuestion(sub, ctx.now());
    if (left < 0) {
      botSend(ctx, chatId, 'You\'ve used your ' + SETTINGS.llm.subscriberDailyQuestions + ' SoC LaaS questions ' +
        'for today. They reset at midnight (Singapore time).');
      return;
    }
    askAssistant(ctx, chatId, text, message.from, left);
    return;
  }

  switch (command) {
    case 'settings':
      botSend(ctx, chatId, SETTINGS_TEXT, withCloseButton(settingsKeyboard(resolveAlerts(sub.alerts)), message.message_id));
      return;
    case 'stop':
      sub.status = 'stopped';
      botSend(ctx, chatId, 'Alerts stopped. Send /start to turn them back on.');
      return;
    case 'subscribers':
      if (isOwner(ctx, chatId)) { subscribersCommand(chatId, message.message_id, ctx); return; }
      break;
    case 'aboutme':
      if (isOwner(ctx, chatId)) { aboutMeCommand(ctx, chatId, text.slice(match[0].length), message.message_id); return; }
      break;
    case 'status':
      if (isOwner(ctx, chatId)) { botSend(ctx, chatId, statusMessage(ctx), withCloseButton(null, message.message_id)); return; }
      break;
    case 'watch':
      watchCommand(ctx, sub, chatId, text.slice(match[0].length));
      return;
    case 'unwatch':
      unwatchCommand(ctx, sub, chatId, text.slice(match[0].length));
      return;
    case 'watching': {
      var watched = watchingMessage(sub.watching);
      botSend(ctx, chatId, watched.text, withCloseButton(watched.replyMarkup, message.message_id));
      return;
    }
    case 'favourite':
    case 'favorite':
      favouriteCommand(sub, chatId, text.slice(match[0].length), ctx);
      return;
    case 'unfavourite':
    case 'unfavorite':
      unfavouriteCommand(sub, chatId, text.slice(match[0].length), ctx);
      return;
    case 'favourites':
    case 'favorites': {
      var list = favouritesMessage(sub.favourites);
      botSend(ctx, chatId, list.text, withCloseButton(list.replyMarkup, message.message_id));
      return;
    }
  }
  // /help gets a Close button; the help shown for an unknown command doesn't.
  botSend(ctx, chatId, helpText(ctx, chatId), command === 'help' ? withCloseButton(null, message.message_id) : null);
}

function favouriteCommand(sub, chatId, args, ctx) {
  var handle = handleFromText(args);
  if (!handle) {
    botSend(ctx, chatId, 'Please include their Telegram handle, e.g. /favourite Oli (@oli).');
    return;
  }
  sub.favourites = sub.favourites || [];
  var key = handleKey(handle);
  if (sub.favourites.some(function (h) { return handleKey(h) === key; })) {
    botSend(ctx, chatId, tplEscape(handle) + ' is already one of your favourites.');
    return;
  }
  if (sub.favourites.length >= MAX_FAVOURITES) {
    botSend(ctx, chatId, 'You already have ' + MAX_FAVOURITES + ' favourites. Remove one with /favourites first.');
    return;
  }
  sub.favourites.push(handle);
  botSend(ctx, chatId, '⭐ Added ' + tplEscape(handle) + ' to your favourites. You\'ll get a ⭐ message whenever ' +
    'they join, leave or are swapped in a band, or their Player Finder entry changes.');
}

function unfavouriteCommand(sub, chatId, args, ctx) {
  var handle = handleFromText(args);
  var key = handleKey(handle);
  var before = (sub.favourites || []).length;
  sub.favourites = (sub.favourites || []).filter(function (h) { return handleKey(h) !== key; });
  botSend(ctx, chatId, handle && sub.favourites.length < before
    ? 'Removed ' + tplEscape(handle) + ' from your favourites.'
    : 'That handle isn\'t in your favourites. See them with /favourites.');
}

function startCommand(message, chatId, ctx) {
  var subs = ctx.state.subscribers;
  var sub = subs[chatId];
  var name = telegramUserLabel(message.from);

  if (isOwner(ctx, chatId)) {
    if (!sub) sub = subs[chatId] = newSubscriber(chatId, name, 'approved', ctx.now());
    sub.status = 'approved';
    botSend(ctx, chatId, 'You\'re the owner, and your alerts are on.\n' + helpText(ctx, chatId));
    return;
  }
  if (sub && sub.status === 'approved') {
    botSend(ctx, chatId, 'You\'re already subscribed. Use /settings to choose your alerts.');
    return;
  }
  if (sub && sub.status === 'pending') {
    botSend(ctx, chatId, 'Your request is waiting for the owner\'s approval.');
    return;
  }
  if (sub && sub.status === 'rejected') {
    botSend(ctx, chatId, 'Sorry, your request was declined.');
    return;
  }
  if (sub && sub.status === 'stopped') {
    sub.status = 'approved';
    botSend(ctx, chatId, 'Welcome back! Your alerts are on again. Use /settings to choose them.');
    return;
  }

  // New request (or someone the owner removed asking again).
  sub = subs[chatId] = newSubscriber(chatId, name, 'pending', ctx.now());
  botSend(ctx, chatId, 'Request sent! The owner needs to approve you before you get alerts.');
  botTrySendOwner(ctx, '<b>[Subscriber Request]</b>\n' + tplEscape(name) + '\nChat ID: <code>' + chatId + '</code>', {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: 'approve:' + chatId },
      { text: '❌ Reject', callback_data: 'reject:' + chatId }
    ]]
  });
}

/*
 * Close button: deletes the bot's message and the command that asked for it, to keep
 * the chat tidy. The command's message ID travels in the button ('close:<id>').
 * Used on /favourites, /settings, /help, /myid and /subscribers. Notices the bot sends
 * on its own ([Bot Updated], [Watcher Problem], [Watcher Recovered]) get a Dismiss
 * button instead ('close:' with no command), which deletes only the notice.
 */
var CLOSE_ACTION = 'close';

/** Adds a Close row under a message's buttons (or as its only button). */
function withCloseButton(replyMarkup, commandMessageId) {
  var rows = replyMarkup && replyMarkup.inline_keyboard ? replyMarkup.inline_keyboard.slice() : [];
  rows.push([{ text: '✖ Close', callback_data: CLOSE_ACTION + ':' + (commandMessageId || '') }]);
  return { inline_keyboard: rows };
}

/** A single Dismiss button, for notices the bot sends on its own. */
function dismissButton() {
  return { inline_keyboard: [[{ text: '✖ Dismiss', callback_data: CLOSE_ACTION + ':' }]] };
}

/** The command message ID stored in a message's Close button: '' if empty, null if there's no button. */
function closeButtonTarget(message) {
  var rows = (message && message.reply_markup && message.reply_markup.inline_keyboard) || [];
  var data = null;
  rows.forEach(function (row) {
    row.forEach(function (b) { if (String(b.callback_data || '').indexOf(CLOSE_ACTION + ':') === 0) data = b.callback_data; });
  });
  return data === null ? null : data.slice(CLOSE_ACTION.length + 1);
}

/**
 * Deletes the bot's message and the command message. Telegram only lets bots delete
 * messages less than 48 hours old; returns the button-tap answer.
 */
function closeMessages(ctx, chatId, botMessageId, commandMessageId) {
  var ok = true;
  [botMessageId, Number(commandMessageId)].forEach(function (id) {
    if (!id) return;
    try {
      ctx.api.call('deleteMessage', { chat_id: chatId, message_id: id });
    } catch (e) {
      ok = false;
      ctx.log('Could not delete a message: ' + e.message);
    }
  });
  return ok ? '' : 'Telegram only lets bots delete messages from the last 48 hours.';
}

function botTrySendOwner(ctx, html, replyMarkup) {
  try { botSend(ctx, ctx.ownerChatId, html, replyMarkup); } catch (e) { ctx.log('Could not message the owner: ' + e.message); }
}

function subscribersCommand(chatId, commandMessageId, ctx) {
  var subs = Object.keys(ctx.state.subscribers).sort().map(function (id) { return ctx.state.subscribers[id]; });
  if (!subs.length) {
    botSend(ctx, chatId, '<b>[Subscribers]</b>\nNo subscribers yet.', withCloseButton(null, commandMessageId));
    return;
  }
  var lines = ['<b>[Subscribers]</b>'];
  var buttons = [];
  subs.forEach(function (s) {
    lines.push(tplEscape(s.name) + ' — ' + s.status + (isOwner(ctx, s.chatId) ? ' (you)' : ''));
    if (s.status === 'pending') {
      buttons.push([
        { text: '✅ Approve ' + s.name, callback_data: 'approve:' + s.chatId },
        { text: '❌ Reject', callback_data: 'reject:' + s.chatId }
      ]);
    } else if ((s.status === 'approved' || s.status === 'stopped') && !isOwner(ctx, s.chatId)) {
      buttons.push([{ text: '🗑 Remove ' + s.name, callback_data: 'remove:' + s.chatId }]);
    }
  });
  botSend(ctx, chatId, lines.join('\n'), withCloseButton({ inline_keyboard: buttons }, commandMessageId));
}

var OWNER_ACTIONS = {
  approve: { status: 'approved', note: '✅ Approved',
    tell: 'You\'re approved! You\'ll now get alerts. Use /settings to choose which ones.' },
  reject: { status: 'rejected', note: '❌ Rejected', tell: 'Sorry, your request was declined.' },
  remove: { status: 'removed', note: '🗑 Removed', tell: 'The owner has turned off your alerts.' }
};

function handleCallback(cq, ctx) {
  var chatId = String(cq.message && cq.message.chat ? cq.message.chat.id : (cq.from || {}).id);
  var data = String(cq.data || '');
  var sep = data.indexOf(':');
  var action = sep >= 0 ? data.slice(0, sep) : data;
  var arg = sep >= 0 ? data.slice(sep + 1) : '';
  var answer = '';

  try {
    if (action === 'toggle') {
      var sub = ctx.state.subscribers[chatId];
      if (!sub || sub.status !== 'approved') answer = 'Send /start to ask for alerts.';
      else if (!ALERT_LABELS[arg]) answer = 'Unknown setting.';
      else {
        var current = resolveAlerts(sub.alerts);
        sub.alerts[arg] = !current[arg];
        answer = ALERT_LABELS[arg] + (sub.alerts[arg] ? ' on' : ' off');
        ctx.api.call('editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          reply_markup: withCloseButton(settingsKeyboard(resolveAlerts(sub.alerts)), closeButtonTarget(cq.message))
        });
      }
    } else if (action === 'unfav') {
      var fanSub = ctx.state.subscribers[chatId];
      if (!fanSub || fanSub.status !== 'approved') answer = 'Send /start to ask for alerts.';
      else {
        fanSub.favourites = (fanSub.favourites || []).filter(function (h) { return handleKey(h) !== arg; });
        answer = 'Removed';
        var updated = favouritesMessage(fanSub.favourites);
        ctx.api.call('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          text: updated.text,
          parse_mode: 'HTML',
          reply_markup: withCloseButton(updated.replyMarkup, closeButtonTarget(cq.message))
        });
      }
    } else if (action === 'unwatch') {
      var watcher = ctx.state.subscribers[chatId];
      if (!watcher || watcher.status !== 'approved') answer = 'Send /start to ask for alerts.';
      else {
        watcher.watching = (watcher.watching || []).filter(function (w) { return w !== arg; });
        answer = 'Removed';
        var list = watchingMessage(watcher.watching);
        ctx.api.call('editMessageText', {
          chat_id: chatId,
          message_id: cq.message.message_id,
          text: list.text,
          parse_mode: 'HTML',
          reply_markup: withCloseButton(list.replyMarkup, closeButtonTarget(cq.message))
        });
      }
    } else if (action === 'aboutme' && arg === 'clear') {
      answer = isOwner(ctx, chatId) ? clearAboutMe(ctx, chatId, cq) : 'Only the owner can do that.';
    } else if (action === CLOSE_ACTION) {
      answer = closeMessages(ctx, chatId, cq.message && cq.message.message_id, arg);
    } else if (OWNER_ACTIONS[action]) {
      var target = ctx.state.subscribers[arg];
      if (!isOwner(ctx, chatId)) answer = 'Only the owner can do that.';
      else if (!target) answer = 'Unknown subscriber.';
      else if (isOwner(ctx, arg)) answer = 'You can\'t do that to yourself.';
      else {
        var act = OWNER_ACTIONS[action];
        var changed = target.status !== act.status;
        target.status = act.status;
        answer = act.note;
        if (changed) botTrySend(ctx, target.chatId, act.tell);
        if (cq.message) {
          // A /subscribers list keeps its Close button; a [Subscriber Request] has none.
          var closeTarget = closeButtonTarget(cq.message);
          try {
            ctx.api.call('editMessageText', {
              chat_id: chatId,
              message_id: cq.message.message_id,
              text: tplEscape(cq.message.text || '') + '\n\n' + act.note + ': ' + tplEscape(target.name),
              parse_mode: 'HTML',
              reply_markup: closeTarget === null ? { inline_keyboard: [] } : withCloseButton(null, closeTarget)
            });
          } catch (e) { ctx.log('Could not update the owner\'s message: ' + e.message); }
        }
      }
    } else {
      answer = 'Unknown button.';
    }
  } finally {
    try {
      ctx.api.call('answerCallbackQuery', { callback_query_id: cq.id, text: answer });
    } catch (e) { ctx.log('Could not answer a button tap: ' + e.message); }
  }
}
