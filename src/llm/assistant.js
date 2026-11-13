/*
 * Ask SoC LaaS: the owner's plain messages are answered by the LLM using the sheet.
 *
 * Owner decisions:
 *  - Only the owner can use it. Everyone else gets the help message.
 *  - The sheet is read live for each question, and the whole sheet copy (all bands,
 *    members, handles, descriptions, Player Finder) is sent to SoC LaaS.
 *  - The LLM must answer only from the sheet data, and say when it doesn't know.
 *  - It also gets the owner's last 5 messages with SoC LaaS's answers to them (as the
 *    conversation so far), and the last 5 alerts sent to the owner.
 *  - Reply: plain text under a bold [SoC LaaS Response] header. A "Thinking…" message
 *    is shown while waiting and deleted once the answer is sent.
 *
 * The LLM call runs after the lock is released (ctx.defer), so it never holds up
 * sheet checks or other bot messages.
 */

var ASSISTANT_MEMORY_SIZE = 5;
var ASSISTANT_HEADER = '<b>[SoC LaaS Response]</b>';

/** Called by the bot (under the lock): remember the question, show "Thinking…", defer the work. */
function askAssistant(ctx, chatId, question) {
  var memory = ctx.state.memory;
  var previousQuestions = memory.ownerMessages.slice();
  var recentAlerts = memory.alerts.slice();
  var questionAt = ctx.now();
  memory.ownerMessages = memory.ownerMessages
    .concat([{ text: question.slice(0, 1000), at: questionAt }])
    .slice(-ASSISTANT_MEMORY_SIZE);

  var thinking = null;
  try {
    thinking = botSend(ctx, chatId, '<i>Thinking…</i>');
  } catch (e) {
    ctx.log('Could not show "Thinking…": ' + e.message);
  }
  var storedSnapshot = ctx.state.snapshot;
  ctx.defer(function (later) {
    answerOwnerQuestion(later, {
      chatId: chatId,
      question: question,
      questionAt: questionAt,
      previousQuestions: previousQuestions,
      recentAlerts: recentAlerts,
      storedSnapshot: storedSnapshot,
      thinkingMessageId: thinking && thinking.message_id
    });
  });
}

/**
 * Runs without the lock. later: { api, readSheets(), chat(messages) -> text, now(), log() }
 */
function answerOwnerQuestion(later, job) {
  var reply;
  try {
    var snapshot;
    var note = '';
    var readError = '';
    try {
      snapshot = buildSnapshot(later.readSheets());
    } catch (e) {
      readError = e.message;
      later.log('Live sheet read failed for a question: ' + readError);
      snapshot = job.storedSnapshot;
      note = 'Note: the sheet could not be read just now (' + readError +
        '), so this uses the copy from the last sheet check.\n\n';
    }
    if (!snapshot) {
      reply = ASSISTANT_HEADER + '\n' + tplEscape('Sorry, I couldn\'t read the sheet: ' + readError);
    } else {
      var answer = cleanAssistantAnswer(later.chat(assistantMessages(snapshot, job, later.now())));
      reply = ASSISTANT_HEADER + '\n' + tplEscape(note + answer);
      if (later.saveAnswer) {
        try {
          later.saveAnswer(job.questionAt, answer);
        } catch (e) {
          later.log('Could not store the SoC LaaS answer: ' + e.message);
        }
      }
    }
  } catch (e) {
    later.log('SoC LaaS question failed: ' + e.message);
    reply = ASSISTANT_HEADER + '\nSorry, SoC LaaS couldn\'t answer right now. Please try again in a minute.';
  }

  if (reply.length > TELEGRAM_MAX_LENGTH) reply = reply.slice(0, TELEGRAM_MAX_LENGTH - 1) + '…';
  try {
    botSend(later, job.chatId, reply);
  } catch (e) {
    later.log('Could not send the SoC LaaS answer: ' + e.message);
  }
  if (job.thinkingMessageId) {
    try {
      later.api.call('deleteMessage', { chat_id: job.chatId, message_id: job.thinkingMessageId });
    } catch (e) {
      later.log('Could not delete "Thinking…": ' + e.message);
    }
  }
}

/** Plain text only: drop Markdown emphasis the model may add anyway. */
function cleanAssistantAnswer(text) {
  return String(text || '').trim().replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '') || '(no answer)';
}

/** The chat messages sent to SoC LaaS. */
function assistantMessages(snapshot, job, now) {
  var system = [
    'You answer questions from the owner of a Telegram bot that watches the JMM band signup sheet',
    '(a university music club\'s concert signups).',
    'Answer ONLY from the sheet data below. If the answer is not in the data, say that you don\'t know.',
    'Be concise. Plain text only: no Markdown, no HTML.',
    'Copy names and @handles exactly as they appear in the data.',
    '',
    'About the data: bands come from two signup sheets, one-song and two-song bands. Each band has its',
    'songs (first-row and second-row text, e.g. original language and English), a point of contact (POC),',
    '"complete" (the Complete? column), members by role (name from the first row, Telegram handle from',
    'the second), substitutions, other instruments, and other columns such as Description and YouTube',
    'Link. Player Finder lists people looking for a band.',
    '',
    'Sheet data, read at ' + new Date(now).toISOString() + ':',
    JSON.stringify(assistantSheetContext(snapshot))
  ];
  if (job.recentAlerts.length) {
    system.push('', 'The last alert messages the bot sent the owner (oldest first):');
    job.recentAlerts.forEach(function (a, i) { system.push((i + 1) + '. ' + a.text); });
  }
  // The conversation so far: the owner's last messages and SoC LaaS's answers.
  var messages = [{ role: 'system', content: system.join('\n') }];
  job.previousQuestions.forEach(function (m) {
    messages.push({ role: 'user', content: m.text });
    if (m.answer) messages.push({ role: 'assistant', content: m.answer });
  });
  messages.push({ role: 'user', content: job.question });
  return messages;
}

/** Stores SoC LaaS's answer next to the question it answered (kept with the last 5). */
function rememberAssistantAnswer(state, questionAt, answer) {
  state.memory.ownerMessages.forEach(function (m) {
    if (m.at === questionAt) m.answer = String(answer).slice(0, 1500);
  });
}

/** A compact copy of the sheet for the LLM (no raw cell blocks or internal fields). */
function assistantSheetContext(snapshot) {
  var person = function (p) { return p ? { name: p.name.trim(), handle: p.handle.trim() } : null; };
  return {
    bands: snapshot.bands.map(function (b) {
      var band = {
        bandType: b.bandType,
        number: b.number,
        sheetRows: b.sourceRows,
        songs: b.songs,
        complete: b.completion,
        pointOfContact: person(b.pointOfContact),
        members: b.members.map(function (m) { return { role: m.role, name: m.name.trim(), handle: m.handle.trim() }; }),
        substitutions: b.substitutions.map(function (s) {
          return { slot: s.slot, direction: s.direction, name: s.name.trim(), handle: s.handle.trim() };
        }),
        otherInstruments: b.otherInstruments.map(person)
      };
      var extra = bandOtherColumns(b);
      if (Object.keys(extra).length) band.otherColumns = extra;
      return band;
    }),
    playerFinder: snapshot.players.map(function (p) {
      return {
        name: p.name.trim(), handle: p.handle.trim(), instruments: p.instruments,
        introduction: p.introduction, noteToPointOfContact: p.noteToPointOfContact
      };
    })
  };
}

/** Non-empty cells in the band's other columns (Description, YouTube Link…), by header. */
function bandOtherColumns(band) {
  var block = band.block;
  var out = {};
  if (!block) return out;
  var skip = {};
  block.readColumns.concat(block.ignoredColumns).forEach(function (c) { skip[c] = true; });
  for (var c = 0; c < block.header.length; c++) {
    var header = String(block.header[c] || '').replace(/\s+/g, ' ').trim();
    if (skip[c] || !header) continue;
    var values = [block.rows[0][c], block.rows[1][c]].filter(function (v) { return !isBlank(v); });
    if (values.length) out[header] = values.join(' / ');
  }
  return out;
}

/** Called after an alert is sent to the owner: keep the last few for context. */
function rememberAlert(state, html, now) {
  state.memory.alerts = state.memory.alerts
    .concat([{ text: llmUnescape(html).slice(0, 1500), at: now }])
    .slice(-ASSISTANT_MEMORY_SIZE);
}
