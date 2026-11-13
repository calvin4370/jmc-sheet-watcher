/*
 * Turns detected changes into messages: one message per change, using the template
 * for that change type. If a band message has a cell the code can't read reliably,
 * the LLM may rewrite the message (see llm.js); otherwise the template text is sent.
 */

var TELEGRAM_MAX_LENGTH = 4096;

function templateFor(change) {
  var template = MESSAGE_TEMPLATES[change.type];
  if (!template) throw new Error('No message template for change type "' + change.type + '"');
  return template;
}

/**
 * Unclear person cells that are new or changed in this change (band_added /
 * band_changed only). Unchanged unclear cells keep their ⚠ marker without an LLM call.
 * Returns [{ column, name, handle }].
 */
function unclearCells(change) {
  if (change.type !== 'band_added' && change.type !== 'band_changed') return [];
  var band = change.band;
  var prev = change.type === 'band_changed' ? change.previous : null;
  var out = [];
  var consider = function (column, person, oldPerson) {
    if (prev && personKey(oldPerson) === personKey(person)) return;
    if (checkCell(person).unclear) out.push({ column: column, name: person.name, handle: person.handle });
  };
  var findIn = function (list, test) {
    for (var i = 0; list && i < list.length; i++) if (test(list[i])) return list[i];
    return null;
  };
  band.members.forEach(function (m) {
    consider(m.role, m, prev && findIn(prev.members, function (x) { return x.role === m.role; }));
  });
  band.substitutions.forEach(function (s) {
    consider('Sub ' + s.direction + ' ' + s.slot, s, prev && findIn(prev.substitutions, function (x) {
      return x.slot === s.slot && x.direction === s.direction;
    }));
  });
  band.otherInstruments.forEach(function (o) {
    consider('Other Insts', o, prev && findIn(prev.otherInstruments, function (x) { return personKey(x) === personKey(o); }));
  });
  return out;
}

/**
 * Builds one notification per change. Band changes come first, then Player Finder.
 * rewrite (optional): function(change, templateText, unclear) -> HTML or ''.
 * Returns [{ inventory: 'bands'|'playerFinder', change, text, parseMode, llmWritten }].
 */
function buildNotifications(bandChanges, playerChanges, rewrite) {
  return bandChanges.concat(playerChanges).map(function (change) {
    var templateText = templateFor(change).render(change);
    var text = templateText;
    var llmWritten = false;

    var unclear = unclearCells(change);
    if (rewrite && unclear.length) {
      var rewritten = rewrite(change, templateText, unclear);
      var withFooter = rewritten ? rewritten + '\n' + SETTINGS.llm.footer : '';
      if (withFooter && withFooter.length <= TELEGRAM_MAX_LENGTH) {
        text = withFooter;
        llmWritten = true;
      }
    }

    var parseMode = 'HTML';
    if (text.length > TELEGRAM_MAX_LENGTH) {
      // Too long for one Telegram message: send as plain text, cut short.
      text = text.replace(/<\/?[bis]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      text = text.slice(0, TELEGRAM_MAX_LENGTH - 1) + '…';
      parseMode = null;
    }
    return {
      inventory: change.type.indexOf('band_') === 0 ? 'bands' : 'playerFinder',
      change: change,
      text: text,
      parseMode: parseMode,
      llmWritten: llmWritten
    };
  });
}

/** The notifications a subscriber with these alert switches should receive. */
function notificationsFor(notifications, alerts) {
  return notifications.filter(function (n) { return wantsChange(n.change, alerts); });
}
