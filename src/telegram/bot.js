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
 *   /help
 * Plain messages from the owner are answered by SoC LaaS (assistant.js).
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
function botTrySend(ctx, chatId, html) {
  try { botSend(ctx, chatId, html); } catch (e) { ctx.log('Could not message chat ' + chatId + ': ' + e.message); }
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
    '/myid – show your chat ID' +
    (isOwner(ctx, chatId) ? '\n/subscribers – see and manage subscribers' : '');
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
    botSend(ctx, chatId, 'Your chat ID is <code>' + chatId + '</code>.');
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
    askAssistant(ctx, chatId, text);
    return;
  }

  var sub = ctx.state.subscribers[chatId];
  if (!sub || sub.status !== 'approved') {
    botSend(ctx, chatId, sub && sub.status === 'pending'
      ? 'Your request is waiting for the owner\'s approval.'
      : 'Send /start to ask for alerts.');
    return;
  }

  switch (command) {
    case 'settings':
      botSend(ctx, chatId, SETTINGS_TEXT, settingsKeyboard(resolveAlerts(sub.alerts)));
      return;
    case 'stop':
      sub.status = 'stopped';
      botSend(ctx, chatId, 'Alerts stopped. Send /start to turn them back on.');
      return;
    case 'subscribers':
      if (isOwner(ctx, chatId)) { subscribersCommand(chatId, ctx); return; }
      break;
  }
  botSend(ctx, chatId, helpText(ctx, chatId));
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

function botTrySendOwner(ctx, html, replyMarkup) {
  try { botSend(ctx, ctx.ownerChatId, html, replyMarkup); } catch (e) { ctx.log('Could not message the owner: ' + e.message); }
}

function subscribersCommand(chatId, ctx) {
  var subs = Object.keys(ctx.state.subscribers).sort().map(function (id) { return ctx.state.subscribers[id]; });
  if (!subs.length) {
    botSend(ctx, chatId, '<b>[Subscribers]</b>\nNo subscribers yet.');
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
  botSend(ctx, chatId, lines.join('\n'), buttons.length ? { inline_keyboard: buttons } : null);
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
          reply_markup: settingsKeyboard(resolveAlerts(sub.alerts))
        });
      }
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
          try {
            ctx.api.call('editMessageText', {
              chat_id: chatId,
              message_id: cq.message.message_id,
              text: tplEscape(cq.message.text || '') + '\n\n' + act.note + ': ' + tplEscape(target.name),
              parse_mode: 'HTML'
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
