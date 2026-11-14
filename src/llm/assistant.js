/*
 * Ask SoC LaaS: plain (non-command) messages are answered by the LLM using the sheet.
 *
 * Owner decisions:
 *  - The owner and approved subscribers can use it. Subscribers get
 *    SETTINGS.llm.subscriberDailyQuestions questions a day (reset at midnight Singapore
 *    time); the owner has no limit.
 *  - The sheet is read live once per question. SoC LaaS does NOT get the whole sheet:
 *    it calls tools (below) to fetch only what it needs, e.g. one band or Player Finder.
 *    Only tool results are sent to it.
 *  - Each tool call is shown to the owner as "Called tool: …" after "Thinking…".
 *    "Thinking…" and the tool-call messages are deleted when the answer is sent (owner
 *    decision, to keep the chat tidy). [Confirm] messages stay until tapped.
 *  - The LLM must answer only from the sheet data, and say when it doesn't know.
 *  - It also gets the person's last 5 questions (for follow-ups like "and band 4?") and
 *    their Telegram name and @handle (so "me" questions work). Owner decision: SoC LaaS's
 *    answers are NOT remembered: given its old answers, it repeated them instead of looking
 *    again (e.g. "You have no favourite players" after one was added).
 *  - The owner's questions also get the last 5 alerts sent to the owner and their
 *    /aboutme note.
 *  - SoC LaaS can also run the bot's commands for the person (llm/actionTools.js), e.g.
 *    add a favourite or update the owner's /aboutme note. Anything that changes something
 *    needs the person to tap ✅ Yes on a confirmation message first.
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
        'Complete?, point of contact, and which roles are still empty. Use get_band for full details of ' +
        'one band, or get_all_bands for full details of every band.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_all_bands',
      description: 'Full details of every band on both signup sheets in one call (the same as get_band for ' +
        'each band). Use this instead of calling get_band many times, e.g. to look through members, ' +
        'substitutions or descriptions across bands.',
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
      name: 'get_stats',
      description: 'Sheet numbers: how many bands (one-song, two-song), how many are complete, the most-needed ' +
        'roles (empty roles in bands not complete), and how many people are in Player Finder.',
      parameters: { type: 'object', properties: {} }
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

/** "One-song band #3 (🎵 夜バンド - 夜の歌)", for find_person results. */
function bandLabelText(b) {
  var songs = bandSongsText(b);
  return bandHeading(b) + (songs ? ' (🎵 ' + songs + ')' : '');
}

function songTitles(b) {
  return b.songs.map(function (s) {
    return [s.title.primary, s.title.alternate].filter(function (t) { return !isBlank(t); }).join(' / ');
  }).filter(function (t) { return t; });
}

/** Full details of one band, for get_band and get_all_bands. */
function bandDetails(band) {
  var out = {
    display: bandCardText(band),
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
          display: bandCardText(b),
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
      return bandDetails(band);
    }

    case 'get_all_bands':
      return snapshot.bands.map(bandDetails);

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

    case 'get_stats':
      return sheetStats(snapshot);

    default:
      return { error: 'Unknown tool "' + name + '".' };
  }
}

/** "get_band (band_type: two-song, number: 5)" for the "Called tool" message. */
function describeToolCall(name, args) {
  var parts = Object.keys(args || {}).map(function (k) {
    return k + ': ' + (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]);
  });
  return name + (parts.length ? ' (' + parts.join(', ') + ')' : '');
}

/* ---------------- Asking and answering ---------------- */

/**
 * A subscriber's daily SoC LaaS limit. Counts this question and returns how many are
 * left today, or -1 (and counts nothing) if they've used them all.
 */
function takeSubscriberQuestion(sub, now) {
  var today = singaporeDay(now);
  if (!sub.questionsToday || sub.questionsToday.day !== today) sub.questionsToday = { day: today, count: 0 };
  var limit = SETTINGS.llm.subscriberDailyQuestions;
  if (sub.questionsToday.count >= limit) return -1;
  sub.questionsToday.count++;
  return limit - sub.questionsToday.count;
}

/** The person's stored questions: the owner's in state.memory, a subscriber's on their record. */
function questionHistory(state, chatId, owner) {
  if (owner) return state.memory.ownerMessages;
  var sub = state.subscribers[String(chatId)];
  if (!sub) return [];
  if (!sub.questions) sub.questions = [];
  return sub.questions;
}

function setQuestionHistory(state, chatId, owner, list) {
  if (owner) state.memory.ownerMessages = list;
  else if (state.subscribers[String(chatId)]) state.subscribers[String(chatId)].questions = list;
}

/**
 * Called by the bot (under the lock): remember the question, show "Thinking…", defer the work.
 * questionsLeft: for subscribers, how many questions they have left today (shown with the answer).
 */
function askAssistant(ctx, chatId, question, from, questionsLeft) {
  var memory = ctx.state.memory;
  var owner = isOwner(ctx, chatId);
  var history = questionHistory(ctx.state, chatId, owner);
  var previousQuestions = history.slice();
  var recentAlerts = owner ? memory.alerts.slice() : [];
  var questionAt = ctx.now();
  // Only the questions are kept (answers stored by older versions are dropped).
  setQuestionHistory(ctx.state, chatId, owner, history
    .map(function (m) { return { text: m.text, at: m.at }; })
    .concat([{ text: question.slice(0, 1000), at: questionAt }])
    .slice(-ASSISTANT_MEMORY_SIZE));

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
      isOwner: owner,
      questionsLeft: owner ? null : questionsLeft,
      question: question,
      questionAt: questionAt,
      previousQuestions: previousQuestions,
      recentAlerts: recentAlerts,
      person: from ? telegramUserLabel(from) : '',
      commands: llmUnescape(helpText(ctx, chatId)).replace(/^\[Help\]\n/, ''),
      aboutMe: owner ? memory.aboutMe || '' : '',
      storedSnapshot: storedSnapshot,
      thinkingMessageId: thinking && thinking.message_id
    });
  });
}

/**
 * Runs without the lock.
 * later: { api, readSheets(), chat(messages, tools, toolChoice) -> message, now(), log(), readState(), updateState(fn) }
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
      if (job.questionsLeft !== null && job.questionsLeft !== undefined) {
        reply += '\n\n<i>' + job.questionsLeft + ' of ' + SETTINGS.llm.subscriberDailyQuestions +
          ' questions left today.</i>';
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
  // Tidy up: "Thinking…" and the "Called tool: …" messages go once the answer is sent.
  deleteChatMessages(later, job.chatId, [job.thinkingMessageId].concat(job.toolMessageIds || []));
}

/** Deletes bot messages: one at a time, or up to 100 per call (falling back one by one). */
function deleteChatMessages(later, chatId, ids) {
  ids = ids.filter(function (id) { return id; });
  if (ids.length === 1) {
    try {
      later.api.call('deleteMessage', { chat_id: chatId, message_id: ids[0] });
    } catch (e) {
      later.log('Could not delete a message: ' + e.message);
    }
    return;
  }
  for (var i = 0; i < ids.length; i += 100) {
    var batch = ids.slice(i, i + 100);
    try {
      later.api.call('deleteMessages', { chat_id: chatId, message_ids: batch });
    } catch (e) {
      later.log('Could not delete messages together (' + e.message + '); deleting one by one.');
      batch.forEach(function (id) {
        try { later.api.call('deleteMessage', { chat_id: chatId, message_id: id }); } catch (err) { /* already gone */ }
      });
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
  var seen = {}; // sheet lookups already made for this question
  for (var round = 1; ; round++) {
    var last = round >= rounds;
    var message = later.chat(messages, ASSISTANT_TOOLS.concat(actionToolDefinitions(job.isOwner)), last ? 'none' : 'auto');
    if (typeof message === 'string') return message;
    var calls = message.tool_calls || [];
    if (!calls.length || last) return message.content || '';

    messages.push({ role: 'assistant', content: message.content || null, tool_calls: calls });
    calls.forEach(function (call) {
      var name = call['function'] && call['function'].name;
      var args;
      try { args = JSON.parse(call['function'].arguments || '{}'); } catch (e) { args = undefined; }
      try {
        var shown = botSend(later, job.chatId, '<i>' + tplEscape('Called tool: ' + describeToolCall(name, args || {})) + '</i>');
        if (shown && shown.message_id) (job.toolMessageIds = job.toolMessageIds || []).push(shown.message_id);
      } catch (e) {
        later.log('Could not show a tool call: ' + e.message);
      }
      var result = repeatedLookup(seen, name, args);
      if (!result) {
        result = isActionTool(name)
          ? runActionTool(later, job, name, args)
          : runAssistantTool(snapshot, name, args || {});
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    });
  }
}

/**
 * A sheet lookup already made with the same arguments in this question: returns a short
 * pointer to the earlier result instead of sending the data again. Otherwise remembers
 * the call and returns null. Commands (action tools) always run.
 */
function repeatedLookup(seen, name, args) {
  if (isActionTool(name)) return null;
  var key = name + ' ' + JSON.stringify(args || {});
  if (seen[key]) {
    return { note: 'You already called ' + name + ' with these arguments for this question. ' +
      'Its result is earlier in this conversation and has not changed. Use it to answer.' };
  }
  seen[key] = true;
  return null;
}

/** Plain text only: drop Markdown emphasis the model may add anyway. */
function cleanAssistantAnswer(text) {
  return String(text || '').trim().replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '') || '(no answer)';
}

/** The opening chat messages sent to SoC LaaS (no sheet data: that comes from tools). */
function assistantMessages(job, now) {
  var system = [
    'You answer questions from ' + (job.isOwner ? 'the owner' : 'a subscriber') +
      ' of a Telegram bot that watches the JMM band signup sheet',
    '(a university music club\'s concert signups). The time now is ' + new Date(now).toISOString() + '.',
    'Use the tools to look up what you need. Answer ONLY from tool results. Never guess or make anything up.',
    'The sheet and the person\'s settings, favourites and watched bands change all the time, so look them up',
    'with the tools for every question, never from memory.',
    'Never reply with just "I don\'t know". If you can\'t answer, say briefly why: what you looked',
    'up and found, or what is missing. Then say what would let you answer, e.g. a name, @handle or',
    'band number.',
    'Be concise. Plain text only: no Markdown, no HTML.',
    'Reply with only the final answer for the person: no working, no notes about what you looked up or',
    'will do next, and say each thing once. Tool results stay in this conversation, so never call the',
    'same tool with the same arguments twice.',
    'Copy names and @handles exactly as they appear in tool results.',
    'Never mention a band by its number alone. Bands in tool results have a "display" text: its heading',
    '(e.g. "Two-song band #11"), a 🎵 line with its songs (artist - title), then one member per line.',
    'When you mention a band, copy its display text as it is, with a blank line between bands. If you',
    'list more than 5 bands, copy just the first two lines (heading and 🎵 songs) of each.',
    '',
    'About the sheet: bands come from two signup sheets, one-song and two-song bands, each numbered.',
    'Each band has songs (first-row and second-row text, e.g. original language and English), a point of',
    'contact (POC), Complete? (Yes/No), members by role with Telegram handles, substitutions, other',
    'instruments, and other columns such as Description and YouTube Link. Player Finder lists people',
    'looking for a band.'
  ];
  var who = job.isOwner ? 'the owner' : 'the person asking';
  if (job.person) {
    system.push('', (job.isOwner ? 'The owner' : 'The person asking') + ' is ' + job.person +
      ' on Telegram. "Me" or "I" means them: look them up',
      'with find_person by @handle, then by name. Their sheet entries may use a different name.');
  } else {
    system.push('', 'You don\'t know who ' + who + ' is, so if they ask about "me" or "I", ask for their',
      'name or @handle.');
  }
  system.push('', 'You can also run the bot\'s commands for ' + who + ' with the other tools (alert settings,',
    'favourites, watched bands' + (job.isOwner ? ', subscribers, status, the /aboutme note' : '') + '). Use them when asked.',
    'Lookups run straight away. Anything that changes something only sends a confirmation message with',
    '✅ Yes / ❌ Cancel buttons to the person you\'re talking to (never anyone else) and returns status',
    '"awaiting_confirmation": then tell them that they need to tap ✅ Yes.',
    'Never say a change is done, saved or noted: it only happens when they tap ✅ Yes.',
    'If a tool returns ok: false, explain the error, fix the arguments if you can, and try again.');
  if (job.commands) system.push('', 'The bot\'s commands:', job.commands);
  if (job.isOwner) {
    system.push('', 'When the owner tells you something lasting about themselves (e.g. instruments they play,',
      'their bands, their name or @handle in the sheet, preferences), offer to save it with update_about_me.',
      'Don\'t save questions, guesses, or things about other people unless the owner asks you to.',
      'If the owner asks you to remember something, always call update_about_me.');
    system.push('', 'What the owner has told you about themselves (their /aboutme note):', job.aboutMe || '(empty)');
  }
  if (job.recentAlerts.length) {
    system.push('', 'The last alert messages the bot sent the owner (oldest first):');
    job.recentAlerts.forEach(function (a, i) { system.push((i + 1) + '. ' + a.text); });
  }
  // Their earlier questions (not SoC LaaS's answers: see the top of this file), as
  // background for follow-up questions.
  if (job.previousQuestions.length) {
    system.push('', 'Their earlier questions, oldest first. Use them only to understand a follow-up question',
      '(e.g. what "that band" means). Answer only their latest message, and look everything up again:');
    job.previousQuestions.forEach(function (m) { system.push('- ' + m.text); });
  }
  return [{ role: 'system', content: system.join('\n') }, { role: 'user', content: job.question }];
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
