/*
 * SoC LaaS action tools: SoC LaaS can run the bot's commands for the person asking.
 *
 * Owner decisions:
 *  - Every command has a tool. Read-only ones (list favourites, /status…) run straight
 *    away. Anything that changes something only sends a confirmation message with
 *    ✅ Yes / ❌ Cancel buttons; nothing changes until the person taps ✅ Yes.
 *  - Tools use the same actions as the commands (app/actions.js), so they behave the same.
 *  - Owner-only commands (/subscribers, /status, /aboutme) have owner-only tools.
 *
 * Making sure it runs correctly ("structured outputs"):
 *  - Tools are sent with strict JSON schemas (strict: true, every field required, no
 *    extra fields, enums for fixed choices).
 *  - The arguments are checked against the schema in code too (shared/jsonSchema.js).
 *    If they don't match, nothing happens and SoC LaaS gets a structured error to fix.
 *  - Before asking for confirmation, the action is tried on a copy of the state; if it
 *    would fail or change nothing (e.g. already a favourite), SoC LaaS is told why and no
 *    confirmation is sent. When ✅ Yes is tapped, the action runs on the current state.
 *  - Every tool returns JSON: { ok, … } or { ok: false, error }.
 */

var ACTION_CONFIRM_HOURS = 24;     // a confirmation expires after this
var MAX_PENDING_ACTIONS = 20;      // oldest pending confirmations are dropped beyond this
var CONFIRM_HEADER = '<b>[Confirm]</b>';

function strictTool(name, description, properties) {
  return {
    type: 'function',
    function: {
      name: name,
      description: description,
      strict: true,
      parameters: { type: 'object', properties: properties, required: Object.keys(properties), additionalProperties: false }
    }
  };
}

function bandArgsSchema() {
  return {
    band_type: { type: 'string', 'enum': ['one-song', 'two-song'], description: 'Which signup sheet' },
    number: { type: 'integer', minimum: 1, description: 'The band number' }
  };
}

function handleArgSchema() {
  return { type: 'string', pattern: '^@?[A-Za-z0-9_]{3,32}$', description: 'Telegram handle, e.g. @oli' };
}

function toolHandle(text) {
  text = String(text || '').trim();
  return text.charAt(0) === '@' ? text : '@' + text;
}

function toolBandId(args) {
  return args.band_type + '#' + args.number;
}

/**
 * Every action tool. Built when needed (not at load time), since it uses things defined
 * in other files. Each: { owner, tool, read(env, args) | apply(env, args, payload),
 * describe(args, env, payload), prepare?(later, job, args, env) }.
 */
function actionToolSpecs() {
  var alertKeys = Object.keys(ALERT_LABELS);
  var CONFIRM = ' Changes are only made after the person taps ✅ Yes on a confirmation message.';
  return {
    get_alert_settings: {
      tool: strictTool('get_alert_settings', 'The person\'s alert switches (/settings): which alerts are on.', {}),
      read: function (env) {
        var on = resolveAlerts(env.sub.alerts);
        return { status: env.sub.status, alerts: alertKeys.map(function (k) { return { alert: k, label: ALERT_LABELS[k], on: !!on[k] }; }) };
      }
    },
    set_alerts: {
      tool: strictTool('set_alerts', 'Switch alerts on or off (/settings). "bands" and "playerFinder" switch whole ' +
        'groups; the others are single alert types.' + CONFIRM, {
        alerts: {
          type: 'array', minItems: 1, maxItems: alertKeys.length,
          items: {
            type: 'object',
            properties: { alert: { type: 'string', 'enum': alertKeys }, on: { type: 'boolean' } },
            required: ['alert', 'on'],
            additionalProperties: false
          }
        }
      }),
      describe: function (args) {
        return 'Turn ' + tplEscape(args.alerts.map(function (c) { return ALERT_LABELS[c.alert] + (c.on ? ' on' : ' off'); }).join(', '));
      },
      apply: function (env, args) { return actionSetAlerts(env.sub, args.alerts); }
    },
    stop_alerts: {
      tool: strictTool('stop_alerts', 'Stop all of the person\'s alerts (/stop). They can turn them back on with /start.' + CONFIRM, {}),
      describe: function () { return 'Stop all your alerts (send /start to turn them back on)'; },
      apply: function (env) { return actionStopAlerts(env.sub); }
    },
    list_favourites: {
      tool: strictTool('list_favourites', 'The person\'s favourite players (/favourites), by Telegram handle.', {}),
      read: function (env) { return { favourites: env.sub.favourites || [] }; }
    },
    add_favourite: {
      tool: strictTool('add_favourite', 'Add a favourite player by Telegram handle (/favourite).' + CONFIRM, { handle: handleArgSchema() }),
      describe: function (args) { return 'Add ' + tplEscape(toolHandle(args.handle)) + ' to your favourites'; },
      apply: function (env, args) { return actionAddFavourite(env.sub, toolHandle(args.handle)); }
    },
    remove_favourite: {
      tool: strictTool('remove_favourite', 'Remove a favourite player by Telegram handle (/unfavourite).' + CONFIRM, { handle: handleArgSchema() }),
      describe: function (args) { return 'Remove ' + tplEscape(toolHandle(args.handle)) + ' from your favourites'; },
      apply: function (env, args) { return actionRemoveFavourite(env.sub, toolHandle(args.handle)); }
    },
    list_watched_bands: {
      tool: strictTool('list_watched_bands', 'The bands the person watches (/watching).', {}),
      read: function (env) { return { watching: (env.sub.watching || []).map(watchedBandLabel) }; }
    },
    watch_band: {
      tool: strictTool('watch_band', 'Watch a band (/watch): the person gets every update for it.' + CONFIRM, bandArgsSchema()),
      describe: function (args) { return 'Watch ' + tplEscape(watchedBandLabel(toolBandId(args))); },
      apply: function (env, args) { return actionWatchBand(env.state, env.sub, toolBandId(args)); }
    },
    unwatch_band: {
      tool: strictTool('unwatch_band', 'Stop watching a band (/unwatch).' + CONFIRM, bandArgsSchema()),
      describe: function (args) { return 'Stop watching ' + tplEscape(watchedBandLabel(toolBandId(args))); },
      apply: function (env, args) { return actionUnwatchBand(env.sub, toolBandId(args)); }
    },
    get_my_chat_id: {
      tool: strictTool('get_my_chat_id', 'The person\'s Telegram chat ID (/myid).', {}),
      read: function (env) { return { chat_id: env.chatId }; }
    },
    get_status: {
      owner: true,
      tool: strictTool('get_status', 'Owner only: is the bot working (/status)? Last sheet check, problems, subscribers, SoC LaaS use.', {}),
      read: function (env) {
        return {
          status: llmUnescape(statusMessage({
            state: env.state, now: function () { return env.now; }, assistantAvailable: true, llmRequestsToday: env.llmRequestsToday
          }))
        };
      }
    },
    list_subscribers: {
      owner: true,
      tool: strictTool('list_subscribers', 'Owner only: everyone who has used the bot (/subscribers), with chat ID and status.', {}),
      read: function (env) {
        return {
          subscribers: Object.keys(env.state.subscribers).sort().map(function (id) {
            var s = env.state.subscribers[id];
            return { chat_id: s.chatId, name: s.name, status: s.status, is_owner: String(id) === String(env.ownerChatId) };
          })
        };
      }
    },
    manage_subscriber: {
      owner: true,
      tool: strictTool('manage_subscriber', 'Owner only: approve, reject or remove a subscriber (/subscribers). ' +
        'They are told the result. Get chat_id from list_subscribers.' + CONFIRM, {
        chat_id: { type: 'string', pattern: '^-?[0-9]+$', description: 'The subscriber\'s chat ID' },
        action: { type: 'string', 'enum': ['approve', 'reject', 'remove'] }
      }),
      describe: function (args, env) {
        var verb = { approve: 'Approve', reject: 'Reject', remove: 'Remove' }[args.action];
        return verb + ' ' + tplEscape(env.state.subscribers[args.chat_id].name) + ' (they\'ll be told)';
      },
      apply: function (env, args) { return actionManageSubscriber(env.state, env.ownerChatId, args.chat_id, args.action); }
    },
    update_about_me: {
      owner: true,
      tool: strictTool('update_about_me', 'Owner only: add something lasting the owner told you about themselves ' +
        '(e.g. instruments, bands, their name or @handle in the sheet, preferences) to their /aboutme note. The note is ' +
        'rewritten to fit it in; newer information wins, so this can also correct or remove things.' + CONFIRM, {
        info: { type: 'string', minLength: 1, maxLength: 500, description: 'The new information, in a short sentence' }
      }),
      prepare: function (later, job, args, env) {
        var rewrite = rewriteAboutMe(later, env.state.memory.aboutMe || '', args.info);
        if (!rewrite.saved) {
          return { error: 'The rewritten note would be ' + aboutMeSize(rewrite.note) + ' characters; the most allowed is ' +
            aboutMeMax() + '. Nothing was changed. Tell the owner.' };
        }
        return { note: rewrite.note };
      },
      describe: function (args, env, payload) {
        return 'Change your /aboutme note to:\n' + tplEscape(payload.note) + '\n<i>' + tplEscape(aboutMeSizeLine(payload.note)) + '</i>';
      },
      apply: function (env, args, payload) { return actionSaveAboutMe(env.state, payload.note); }
    },
    clear_about_me: {
      owner: true,
      tool: strictTool('clear_about_me', 'Owner only: clear the owner\'s /aboutme note.' + CONFIRM, {}),
      describe: function () { return 'Clear your /aboutme note'; },
      apply: function (env) { return actionClearAboutMe(env.state); }
    }
  };
}

/** The action tool definitions sent to SoC LaaS (owner-only ones only for the owner). */
function actionToolDefinitions(isOwnerAsking) {
  var specs = actionToolSpecs();
  return Object.keys(specs)
    .filter(function (name) { return isOwnerAsking || !specs[name].owner; })
    .map(function (name) { return specs[name].tool; });
}

function isActionTool(name) {
  return Object.prototype.hasOwnProperty.call(actionToolSpecs(), name);
}

/** What an action runs with. `from` supplies ownerChatId, now() and llmRequestsToday. */
function actionEnv(state, chatId, from) {
  return {
    state: state,
    chatId: String(chatId),
    sub: state.subscribers[String(chatId)],
    ownerChatId: from.ownerChatId,
    isOwner: !!from.ownerChatId && String(chatId) === String(from.ownerChatId),
    now: from.now(),
    llmRequestsToday: from.llmRequestsToday
  };
}

/** Why this person can't use the tool ('' if they can). */
function actionAccessProblem(spec, env) {
  if (spec.owner) return env.isOwner ? '' : 'Only the owner can do that.';
  if (!env.sub || env.sub.status !== 'approved') return 'Only approved subscribers with alerts on can do that. Send /start first.';
  return '';
}

/**
 * Runs an action tool for SoC LaaS (without the lock).
 * later: { readState(), updateState(fn), chat, api, ownerChatId, now(), log() }
 * args: the parsed arguments, or undefined if they weren't valid JSON.
 */
function runActionTool(later, job, name, args) {
  var spec = actionToolSpecs()[name];
  if (!spec) return { ok: false, error: 'Unknown tool "' + name + '".' };
  if (spec.owner && !job.isOwner) return { ok: false, error: 'Only the owner can do that.' };
  if (args === undefined) return { ok: false, error: 'The arguments were not valid JSON. Nothing was changed.' };
  var problem = jsonSchemaProblem(spec.tool['function'].parameters, args);
  if (problem) return { ok: false, error: 'Invalid arguments: ' + problem + '. Nothing was changed.' };
  if (!later.readState || !later.updateState) return { ok: false, error: 'This can\'t be done right now.' };

  try {
    if (spec.read) {
      var readEnv = actionEnv(later.readState(), job.chatId, later);
      var denied = actionAccessProblem(spec, readEnv);
      if (denied) return { ok: false, error: denied };
      var data = spec.read(readEnv, args);
      data.ok = true;
      return data;
    }

    var payload = null;
    if (spec.prepare) {
      payload = spec.prepare(later, job, args, actionEnv(later.readState(), job.chatId, later));
      if (payload.error) return { ok: false, error: payload.error };
    }

    var outcome = null;
    later.updateState(function (state) {
      var env = actionEnv(state, job.chatId, later);
      var access = actionAccessProblem(spec, env);
      if (access) { outcome = { ok: false, error: access }; return; }
      // Try it on a copy first: no confirmation for something that would fail or change nothing.
      var copy = JSON.parse(JSON.stringify(state));
      var trial = spec.apply(actionEnv(copy, job.chatId, later), args, payload);
      if (!trial.ok) { outcome = { ok: false, error: llmUnescape(trial.html) + ' Nothing was changed.' }; return; }
      if (!trial.changed) { outcome = { ok: true, changed: false, result: llmUnescape(trial.html) }; return; }

      var pending = state.pendingActions = state.pendingActions || {};
      prunePendingActions(state, env.now);
      var id = stableHash(job.chatId + ':' + name + ':' + env.now + ':' + Math.random()).slice(0, 12);
      var summary = spec.describe(args, env, payload);
      pending[id] = { chatId: String(job.chatId), tool: name, args: args, payload: payload, summary: summary, at: env.now };
      outcome = { id: id, summary: summary };
    });
    if (!outcome.id) return outcome;

    botSend(later, job.chatId, CONFIRM_HEADER + '\nSoC LaaS wants to: ' + outcome.summary, {
      inline_keyboard: [[
        { text: '✅ Yes', callback_data: 'act:' + outcome.id + ':yes' },
        { text: '❌ Cancel', callback_data: 'act:' + outcome.id + ':no' }
      ]]
    });
    return {
      ok: true,
      status: 'awaiting_confirmation',
      action: llmUnescape(outcome.summary),
      note: 'Nothing has changed yet. A confirmation message was sent; it only happens if the person taps ✅ Yes. ' +
        'Do not say it is done.'
    };
  } catch (e) {
    later.log('Action tool ' + name + ' failed: ' + e.message);
    return { ok: false, error: 'Something went wrong, so nothing was changed.' };
  }
}

/** Drops expired confirmations and keeps at most MAX_PENDING_ACTIONS. */
function prunePendingActions(state, now) {
  var pending = state.pendingActions || {};
  var ids = Object.keys(pending).filter(function (id) {
    if (now - pending[id].at > ACTION_CONFIRM_HOURS * 3600000) { delete pending[id]; return false; }
    return true;
  }).sort(function (a, b) { return pending[a].at - pending[b].at; });
  while (ids.length >= MAX_PENDING_ACTIONS) delete pending[ids.shift()];
}

/**
 * ✅ Yes / ❌ Cancel on a confirmation (under the lock; ctx has state). arg: '<id>:yes|no'.
 * Returns the button-tap answer.
 */
function confirmPendingAction(ctx, chatId, cq, arg) {
  var parts = String(arg).split(':');
  var id = parts[0];
  var yes = parts[1] === 'yes';
  var all = ctx.state.pendingActions || {};
  var pending = all[id];
  var finish = function (html) {
    try {
      ctx.api.call('editMessageText', {
        chat_id: chatId, message_id: cq.message.message_id, text: CONFIRM_HEADER + '\n' + html,
        parse_mode: 'HTML', reply_markup: { inline_keyboard: [] }
      });
    } catch (e) {
      ctx.log('Could not update a confirmation message: ' + e.message);
    }
  };

  if (!pending || ctx.now() - pending.at > ACTION_CONFIRM_HOURS * 3600000) {
    if (pending) delete all[id];
    finish('This request has expired or was already handled. Ask SoC LaaS again if you still want it.');
    return 'Expired';
  }
  if (String(pending.chatId) !== String(chatId)) return 'This isn\'t your request.';
  delete all[id];
  if (!yes) {
    finish('❌ Cancelled: ' + pending.summary);
    return 'Cancelled';
  }

  var spec = actionToolSpecs()[pending.tool];
  var env = actionEnv(ctx.state, chatId, ctx);
  var access = spec ? actionAccessProblem(spec, env) : 'Unknown action.';
  var result = access ? actionResult(false, false, tplEscape(access)) : spec.apply(env, pending.args, pending.payload);
  if (result.ok) sendActionNotices(ctx, result);
  finish((result.ok ? '✅ Done. ' : '⚠ Not done: ') + result.html);
  return result.ok ? 'Done' : 'Not done';
}
