/*
 * Ask SoC LaaS: the owner's plain messages are answered by the LLM using the sheet.
 *
 * Owner decisions:
 *  - Only the owner can use it. Everyone else gets the help message.
 *  - The sheet is read live once per question. SoC LaaS does NOT get the whole sheet:
 *    it calls tools (below) to fetch only what it needs, e.g. one band or Player Finder.
 *    Only tool results are sent to it.
 *  - Each tool call is shown to the owner as "Called tool: …" after "Thinking…".
 *    "Thinking…" is deleted when the answer is sent; the tool-call messages stay.
 *  - The LLM must answer only from the sheet data, and say when it doesn't know.
 *  - It also gets the owner's last 5 messages with SoC LaaS's answers (the conversation
 *    so far), the last 5 alerts sent to the owner, the owner's Telegram name and @handle
 *    (so "me" questions work), and their /aboutme note (aboutMe.js).
 *  - Reply: plain text under a bold [SoC LaaS Response] header.
 *
 * The LLM calls run after the lock is released (ctx.defer), so they never hold up
 * sheet checks or other bot messages.
 */

var ASSISTANT_MEMORY_SIZE = 5;
var ASSISTANT_HEADER = '<b>[SoC LaaS Response]</b>';

/* ---------------- Tools SoC LaaS can call (OpenAI function format) ---------------- */

var ASSISTANT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_bands',
      description: 'Overview of every band on both signup sheets: band type, number, song titles, ' +
        'Complete?, point of contact, and which roles are still empty. Use get_band for full details.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_band',
      description: 'Full details of one band: songs and artists, point of contact, Complete?, every member ' +
        'by role with Telegram handle, substitutions, other instruments, and other columns such as ' +
        'Description and YouTube Link.',
      parameters: {
        type: 'object',
        properties: {
          band_type: { type: 'string', enum: ['one-song', 'two-song'], description: 'Which signup sheet' },
          number: { type: 'string', description: 'The band number, as shown in the sheet' }
        },
        required: ['band_type', 'number']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_player_finder',
      description: 'Everyone in Player Finder (people looking for a band): name, Telegram handle and instruments.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_player',
      description: 'One Player Finder entry in full: instruments, self-introduction and note to the point of ' +
        'contact. Matches the Telegram handle or name (partial, case-insensitive).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Telegram handle or name' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_person',
      description: 'Find everywhere a person appears (band roles, substitutions, other instruments, point ' +
        'of contact, Player Finder) by name or Telegram handle (partial, case-insensitive).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Name or Telegram handle' } },
        required: ['query']
      }
    }
  }
];

function trimmedPerson(p) {
  return p ? { name: String(p.name).trim(), handle: String(p.handle).trim() } : null;
}

function bandLabelText(b) {
  return b.bandType + ' band #' + (b.number || '?');
}

function songTitles(b) {
  return b.songs.map(function (s) {
    return [s.title.primary, s.title.alternate].filter(function (t) { return !isBlank(t); }).join(' / ');
  }).filter(function (t) { return t; });
}

/** Runs one tool against the sheet copy. Returns a JSON-serialisable result. */
function runAssistantTool(snapshot, name, args) {
  args = args || {};
  var query = String(args.query || '').trim().toLowerCase();
  var matches = function (p) {
    return !!query && !!p && (String(p.name).toLowerCase().indexOf(query) >= 0 ||
      String(p.handle).toLowerCase().indexOf(query) >= 0);
  };

  switch (name) {
    case 'list_bands':
      return snapshot.bands.map(function (b) {
        var filled = b.members.map(function (m) { return m.role; });
        return {
          bandType: b.bandType,
          number: b.number,
          songs: songTitles(b),
          complete: b.completion,
          pointOfContact: trimmedPerson(b.pointOfContact),
          emptyRoles: ROLE_HEADERS.filter(function (r) { return filled.indexOf(r) < 0; })
            .map(function (r) { return ROLE_LABELS[r] || r; })
        };
      });

    case 'get_band': {
      var number = String(args.number === undefined ? '' : args.number).replace(/^#/, '').trim();
      var band = null;
      snapshot.bands.forEach(function (b) {
        if (!band && b.bandType === args.band_type && b.number === number) band = b;
      });
      if (!band) return { error: 'No ' + args.band_type + ' band numbered ' + number + '.' };
      var out = {
        bandType: band.bandType,
        number: band.number,
        sheetRows: band.sourceRows,
        songs: band.songs,
        complete: band.completion,
        pointOfContact: trimmedPerson(band.pointOfContact),
        members: band.members.map(function (m) {
          return { role: ROLE_LABELS[m.role] || m.role, name: m.name.trim(), handle: m.handle.trim() };
        }),
        substitutions: band.substitutions.map(function (s) {
          return { slot: s.slot, direction: s.direction, name: s.name.trim(), handle: s.handle.trim() };
        }),
        otherInstruments: band.otherInstruments.map(trimmedPerson)
      };
      var extra = bandOtherColumns(band);
      if (Object.keys(extra).length) out.otherColumns = extra;
      return out;
    }

    case 'list_player_finder':
      return snapshot.players.map(function (p) {
        return { name: p.name.trim(), handle: p.handle.trim(), instruments: p.instruments };
      });

    case 'get_player': {
      var found = snapshot.players.filter(matches).map(function (p) {
        return {
          name: p.name.trim(), handle: p.handle.trim(), instruments: p.instruments,
          introduction: p.introduction, noteToPointOfContact: p.noteToPointOfContact
        };
      });
      return found.length ? found : { error: 'No Player Finder entry matches "' + args.query + '".' };
    }

    case 'find_person': {
      var hits = [];
      snapshot.bands.forEach(function (b) {
        var where = bandLabelText(b);
        if (matches(b.pointOfContact)) hits.push({ where: where, as: 'point of contact', person: trimmedPerson(b.pointOfContact) });
        b.members.forEach(function (m) {
          if (matches(m)) hits.push({ where: where, as: ROLE_LABELS[m.role] || m.role, person: trimmedPerson(m) });
        });
        b.substitutions.forEach(function (s) {
          if (matches(s)) hits.push({ where: where, as: 'sub ' + s.direction + ' ' + s.slot, person: trimmedPerson(s) });
        });
        b.otherInstruments.forEach(function (o) {
          if (matches(o)) hits.push({ where: where, as: 'other instrument', person: trimmedPerson(o) });
        });
      });
      snapshot.players.forEach(function (p) {
        if (matches(p)) hits.push({ where: 'Player Finder', as: 'player', person: trimmedPerson(p), instruments: p.instruments });
      });
      return hits.length ? hits : { error: 'Nobody matches "' + args.query + '".' };
    }

    default:
      return { error: 'Unknown tool "' + name + '".' };
  }
}

/** "get_band (band_type: two-song, number: 5)" for the "Called tool" message. */
function describeToolCall(name, args) {
  var parts = Object.keys(args || {}).map(function (k) { return k + ': ' + args[k]; });
  return name + (parts.length ? ' (' + parts.join(', ') + ')' : '');
}

/* ---------------- Asking and answering ---------------- */

/** Called by the bot (under the lock): remember the question, show "Thinking…", defer the work. */
function askAssistant(ctx, chatId, question, from) {
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
      owner: from ? telegramUserLabel(from) : '',
      aboutMe: memory.aboutMe || '',
      storedSnapshot: storedSnapshot,
      thinkingMessageId: thinking && thinking.message_id
    });
  });
}

/**
 * Runs without the lock.
 * later: { api, readSheets(), chat(messages, tools, toolChoice) -> message, now(), log(), saveAnswer? }
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
      var answer = cleanAssistantAnswer(runAssistantConversation(later, job, snapshot));
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

/**
 * Lets SoC LaaS call tools until it answers (at most SETTINGS.llm.maxToolRounds rounds;
 * the last round must answer). Each tool call is shown to the owner. Returns the answer.
 */
function runAssistantConversation(later, job, snapshot) {
  var messages = assistantMessages(job, later.now());
  var rounds = SETTINGS.llm.maxToolRounds;
  for (var round = 1; ; round++) {
    var last = round >= rounds;
    var message = later.chat(messages, ASSISTANT_TOOLS, last ? 'none' : 'auto');
    if (typeof message === 'string') return message;
    var calls = message.tool_calls || [];
    if (!calls.length || last) return message.content || '';

    messages.push({ role: 'assistant', content: message.content || null, tool_calls: calls });
    calls.forEach(function (call) {
      var name = call['function'] && call['function'].name;
      var args = {};
      try { args = JSON.parse(call['function'].arguments || '{}'); } catch (e) { args = {}; }
      try {
        botSend(later, job.chatId, '<i>' + tplEscape('Called tool: ' + describeToolCall(name, args)) + '</i>');
      } catch (e) {
        later.log('Could not show a tool call: ' + e.message);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(runAssistantTool(snapshot, name, args)) });
    });
  }
}

/** Plain text only: drop Markdown emphasis the model may add anyway. */
function cleanAssistantAnswer(text) {
  return String(text || '').trim().replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '') || '(no answer)';
}

/** The opening chat messages sent to SoC LaaS (no sheet data: that comes from tools). */
function assistantMessages(job, now) {
  var system = [
    'You answer questions from the owner of a Telegram bot that watches the JMM band signup sheet',
    '(a university music club\'s concert signups). The time now is ' + new Date(now).toISOString() + '.',
    'Use the tools to look up what you need in the sheet. Answer ONLY from tool results and the',
    'conversation. Never guess or make anything up.',
    'Never reply with just "I don\'t know". If you can\'t answer, say briefly why: what you looked',
    'up and found, or what is missing. Then say what would let you answer, e.g. a name, @handle or',
    'band number.',
    'Be concise. Plain text only: no Markdown, no HTML.',
    'Copy names and @handles exactly as they appear in tool results.',
    '',
    'About the sheet: bands come from two signup sheets, one-song and two-song bands, each numbered.',
    'Each band has songs (first-row and second-row text, e.g. original language and English), a point of',
    'contact (POC), Complete? (Yes/No), members by role with Telegram handles, substitutions, other',
    'instruments, and other columns such as Description and YouTube Link. Player Finder lists people',
    'looking for a band.'
  ];
  if (job.owner) {
    system.push('', 'The owner is ' + job.owner + ' on Telegram. "Me" or "I" means them: look them up',
      'with find_person by @handle, then by name. Their sheet entries may use a different name.');
  } else {
    system.push('', 'You don\'t know who the owner is, so if they ask about "me" or "I", ask for their',
      'name or @handle.');
  }
  if (job.aboutMe) {
    system.push('', 'What the owner has told you about themselves (their /aboutme note):', job.aboutMe);
  }
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
