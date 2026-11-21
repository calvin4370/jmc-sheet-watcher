/*
 * Turns detected changes into messages: one message per change, using the template
 * for that change type. If a band message has a cell the code can't read reliably,
 * the LLM may rewrite the message (see llm.js); otherwise the template text is sent.
 */

var TELEGRAM_MAX_LENGTH = 4096;

/** The template for a change; changes with no template of their own use [Other Change]. */
function templateFor(change) {
  return MESSAGE_TEMPLATES[change.type] || MESSAGE_TEMPLATES.other_change;
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
 * rewrite (optional): function(change, templateText, unclear, template) -> HTML or ''.
 * It's called for band messages with unclear cells, and for every message whose
 * template has llmWritesWholeMessage (i.e. [Other Change]).
 * Returns [{ inventory: 'bands'|'playerFinder', change, text, parseMode, llmWritten }].
 */
function buildNotifications(bandChanges, playerChanges, rewrite) {
  return bandChanges.concat(playerChanges).map(function (change) {
    var template = templateFor(change);
    var templateText = template.render(change);
    var text = templateText;
    var llmWritten = false;

    var unclear = unclearCells(change);
    if (rewrite && (unclear.length || template.llmWritesWholeMessage)) {
      var rewritten = rewrite(change, templateText, unclear, template);
      var withFooter = rewritten ? rewritten + '\n' + SETTINGS.llm.footer : '';
      if (withFooter && withFooter.length <= TELEGRAM_MAX_LENGTH) {
        text = withFooter;
        llmWritten = true;
      }
    }

    // Too long for one Telegram message? It's split when sent (splitTelegramText), never cut.
    return {
      inventory: change.type.indexOf('band_') === 0 ? 'bands' : 'playerFinder',
      change: change,
      text: text,
      parseMode: 'HTML',
      llmWritten: llmWritten
    };
  });
}

/**
 * Splits a message that's too long for one Telegram message into parts, between lines.
 * With HTML, tags open at a split (e.g. a <blockquote>) are closed at the end of one part
 * and reopened at the start of the next. If a single line is too long, the message is
 * sent as plain text instead and split anywhere. Returns { parts, html }.
 */
function splitTelegramText(text, html) {
  var max = TELEGRAM_MAX_LENGTH;
  if (text.length <= max) return { parts: [text], html: html };
  var lines = text.split('\n');
  if (html && lines.some(function (l) { return l.length > max - 300; })) return splitTelegramText(llmUnescape(text), false);
  if (!html) {
    lines = [].concat.apply([], lines.map(function (l) {
      var pieces = [];
      for (var i = 0; i < l.length; i += max) pieces.push(l.slice(i, i + max));
      return pieces.length ? pieces : [''];
    }));
  }
  var closeAll = function (tags) {
    return tags.slice().reverse().map(function (t) { return '</' + t.name + '>'; }).join('');
  };
  var openAll = function (tags) { return tags.map(function (t) { return t.tag; }).join(''); };
  var tagsAfter = function (tags, line) {
    var out = tags.slice();
    var re = /<(\/?)([a-zA-Z]+)[^>]*>/g;
    var m;
    while ((m = re.exec(line))) {
      var name = m[2].toLowerCase();
      if (!m[1]) { out.push({ name: name, tag: m[0] }); continue; }
      for (var k = out.length - 1; k >= 0; k--) {
        if (out[k].name === name) { out.splice(k, 1); break; }
      }
    }
    return out;
  };

  var parts = [];
  var current = null;
  var open = [];
  lines.forEach(function (line) {
    var after = html ? tagsAfter(open, line) : open;
    var candidate = current === null ? line : current + '\n' + line;
    if ((candidate + closeAll(after)).length <= max) {
      current = candidate;
    } else {
      parts.push(current + closeAll(open));
      current = openAll(open) + line;
    }
    open = after;
  });
  if (current !== null) parts.push(current + closeAll(open));
  return { parts: parts, html: html };
}

/** The notifications a subscriber with these alert switches should receive. */
function notificationsFor(notifications, alerts) {
  return notifications.filter(function (n) { return wantsChange(n.change, alerts); });
}
