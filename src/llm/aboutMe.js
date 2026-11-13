/*
 * /aboutme: a short note about the owner that SoC LaaS gets with every question.
 *
 * Owner decisions:
 *  - Owner only (only the owner can ask SoC LaaS questions).
 *  - /aboutme <info>: SoC LaaS rewrites the whole note to fit the new info in (the info
 *    can also correct or remove things, e.g. "/aboutme I don't play bass any more").
 *  - /aboutme alone shows the note, with Clear and Close buttons.
 *  - Size is counted in characters (letters, spaces, emoji: each counts as 1).
 *    Limit 500, plus 100 of overload: a note of 501–600 is saved with a warning; a
 *    rewrite over 600 isn't saved and the old note is kept.
 *  - If SoC LaaS is unavailable, fails, or makes up an @handle, the info is added to the
 *    end of the note as written instead (same size rules).
 *  - SoC LaaS can also update the note with its update_about_me tool (llm/actionTools.js);
 *    like every action it does, the owner must confirm the new note first.
 */

var ABOUT_ME_LIMIT = 500;
var ABOUT_ME_OVERLOAD = 100;
var ABOUT_ME_HEADER = '<b>[About You]</b>';

/** The note's size: characters, counting each emoji as 1. */
function aboutMeSize(note) {
  return Array.from(String(note || '')).length;
}

function aboutMeMax() {
  return ABOUT_ME_LIMIT + ABOUT_ME_OVERLOAD;
}

/** "412/500 characters", plus a warning line when over the limit. */
function aboutMeSizeLine(note) {
  var size = aboutMeSize(note);
  var line = size + '/' + ABOUT_ME_LIMIT + ' characters';
  if (size > ABOUT_ME_LIMIT) {
    line += '\n⚠ ' + (size - ABOUT_ME_LIMIT) + ' over the limit. Up to ' + aboutMeMax() +
      ' is allowed, but bigger rewrites won\'t be saved. To trim it, send /aboutme with what to drop.';
  }
  return line;
}

/** The /aboutme message and its buttons. */
function aboutMeMessage(note, commandMessageId) {
  if (!note) {
    return {
      text: ABOUT_ME_HEADER + '\nNo note yet. SoC LaaS gets this note with every question.\n' +
        'Add to it with /aboutme followed by anything about you, e.g. /aboutme I play bass and keys.',
      replyMarkup: withCloseButton(null, commandMessageId)
    };
  }
  return {
    text: ABOUT_ME_HEADER + '\n' + tplEscape(note) + '\n\n<i>' + tplEscape(aboutMeSizeLine(note)) + '</i>\n' +
      'Add or change something with /aboutme followed by the new info.',
    replyMarkup: withCloseButton({ inline_keyboard: [[{ text: '🗑 Clear note', callback_data: 'aboutme:clear' }]] },
      commandMessageId)
  };
}

/** Handles /aboutme [info] from the owner. */
function aboutMeCommand(ctx, chatId, info, commandMessageId) {
  var note = ctx.state.memory.aboutMe || '';
  info = String(info || '').trim();
  if (!info) {
    var shown = aboutMeMessage(note, commandMessageId);
    botSend(ctx, chatId, shown.text, shown.replyMarkup);
    return;
  }
  if (!ctx.defer || !ctx.assistantAvailable || !ctx.chat) {
    var result = aboutMeAppend(note, info);
    if (result.saved) ctx.state.memory.aboutMe = result.note;
    botSend(ctx, chatId, aboutMeReply(result));
    return;
  }
  var working = null;
  try {
    working = botSend(ctx, chatId, '<i>Updating your note…</i>');
  } catch (e) {
    ctx.log('Could not show "Updating your note…": ' + e.message);
  }
  ctx.defer(function (later) {
    updateAboutMe(later, { chatId: chatId, note: note, info: info, workingMessageId: working && working.message_id });
  });
}

/**
 * Runs without the lock. later: { api, chat, log, updateState(fn) }
 * SoC LaaS rewrites the note; it's checked, saved, and the owner is told the result.
 */
function updateAboutMe(later, job) {
  var result = rewriteAndSaveAboutMe(later, job.note, job.info);
  try {
    botSend(later, job.chatId, aboutMeReply(result));
  } catch (e) {
    later.log('Could not send the note: ' + e.message);
  }
  if (job.workingMessageId) {
    try {
      later.api.call('deleteMessage', { chat_id: job.chatId, message_id: job.workingMessageId });
    } catch (e) {
      later.log('Could not delete "Updating your note…": ' + e.message);
    }
  }
}

/**
 * Rewrites the note to include `info` (SoC LaaS, or the fallback), without saving.
 * Returns { saved, note, previous, written: 'llm' | 'append' }; saved: false means the
 * new note is over the most allowed and must not be saved.
 */
function rewriteAboutMe(later, note, info) {
  try {
    var message = later.chat(aboutMePrompt(note, info), null, null);
    var text = String(typeof message === 'string' ? message : (message && message.content) || '').trim();
    var problem = aboutMeProblem(text, note, info);
    if (problem === 'too long') return { saved: false, note: text, previous: note, written: 'llm' };
    if (!problem) return { saved: true, note: text, previous: note, written: 'llm' };
    later.log('SoC LaaS note rewrite rejected (' + problem + '); adding the info as written.');
  } catch (e) {
    later.log('SoC LaaS note rewrite failed: ' + e.message);
  }
  return aboutMeAppend(note, info);
}

/** /aboutme <info>: rewrites the note and saves it. Returns rewriteAboutMe's result (+ error). */
function rewriteAndSaveAboutMe(later, note, info) {
  var result = rewriteAboutMe(later, note, info);
  if (result.saved) {
    try {
      later.updateState(function (state) { state.memory.aboutMe = result.note; });
    } catch (e) {
      later.log('Could not save the note: ' + e.message);
      result = { saved: false, error: true, note: note, previous: note };
    }
  }
  return result;
}

/** Fallback: the info added to the end of the note, as written. */
function aboutMeAppend(note, info) {
  var joined = note ? note + '\n' + info : info;
  return { saved: aboutMeSize(joined) <= aboutMeMax(), note: joined, previous: note, written: 'append' };
}

/** Why a rewrite can't be used ('' if it can). */
function aboutMeProblem(text, note, info) {
  if (!text) return 'empty';
  if (/<\/?[a-z][^>]*>/i.test(text)) return 'contains HTML';
  var source = (note + '\n' + info).toLowerCase();
  var handles = text.match(/@[A-Za-z0-9_]+/g) || [];
  for (var i = 0; i < handles.length; i++) {
    if (source.indexOf(handles[i].toLowerCase()) < 0) return 'made-up handle ' + handles[i];
  }
  if (aboutMeSize(text) > aboutMeMax()) return 'too long';
  return '';
}

/** The message telling the owner what happened. */
function aboutMeReply(result) {
  if (result.error) {
    return ABOUT_ME_HEADER + '\nSorry, your note couldn\'t be saved right now. Please try again in a minute.';
  }
  if (!result.saved) {
    return ABOUT_ME_HEADER + '\n⚠ Not saved: the note would be ' + aboutMeSize(result.note) + '/' + ABOUT_ME_LIMIT +
      ' characters, and the most allowed is ' + aboutMeMax() + '. Your note is unchanged (' +
      aboutMeSize(result.previous) + '/' + ABOUT_ME_LIMIT + ').\n' +
      'Send /aboutme with what to drop or shorten, or see and clear it with /aboutme.';
  }
  return ABOUT_ME_HEADER + ' Note updated\n' + tplEscape(result.note) + '\n\n<i>' +
    tplEscape(aboutMeSizeLine(result.note)) + '</i>' +
    (result.written === 'llm' ? '\n\n' + tplEscape(SETTINGS.llm.footer) : '');
}

/** The rewrite request sent to SoC LaaS. */
function aboutMePrompt(note, info) {
  return [
    {
      role: 'system',
      content: [
        'You keep a short note about the owner of a Telegram bot that watches a university music club\'s',
        'band signup sheet. The note is given to an assistant that answers the owner\'s questions.',
        'Rewrite the whole note so it includes the new information. The new information may add',
        'facts, correct old ones, or ask for something to be removed: newer information wins.',
        'Keep every fact from the current note unless the new information replaces or removes it.',
        'Use only facts from the current note and the new information. Never add anything else.',
        'Copy names and @handles exactly. Be brief: short phrases, one fact per line.',
        'Aim for ' + ABOUT_ME_LIMIT + ' characters or fewer; never more than ' + aboutMeMax() + '.',
        'Reply with only the new note: plain text, no Markdown, no HTML, no introduction.'
      ].join('\n')
    },
    {
      role: 'user',
      content: 'Current note:\n' + (note || '(empty)') + '\n\nNew information:\n' + info
    }
  ];
}

/** The Clear button on /aboutme. Returns the button-tap answer. */
function clearAboutMe(ctx, chatId, cq) {
  actionClearAboutMe(ctx.state);
  var shown = aboutMeMessage('', closeButtonTarget(cq.message));
  try {
    ctx.api.call('editMessageText', {
      chat_id: chatId,
      message_id: cq.message.message_id,
      text: shown.text,
      parse_mode: 'HTML',
      reply_markup: shown.replyMarkup
    });
  } catch (e) {
    ctx.log('Could not update the /aboutme message: ' + e.message);
  }
  return 'Note cleared';
}
