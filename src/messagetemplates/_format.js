/*
 * Shared building blocks for message templates.
 *
 * Messages use Telegram HTML: <b>bold</b>, <i>italic</i>, <s>strikethrough</s>.
 * Every helper here escapes sheet text, so templates can't break the formatting.
 * Names and handles are shown exactly as typed (only spaces at the very start/end
 * are dropped).
 *
 * Each template file registers itself in MESSAGE_TEMPLATES under the change type
 * it handles, with:
 *   render(change): returns the message.
 *
 * If a band message contains a cell the code can't read reliably (marked
 * "⚠ unclear cell"), the LLM is given the rendered message and asked to rewrite it
 * in the same layout. See src/llm/llm.js.
 */

var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

/** How each signup role column is named in messages. */
var ROLE_LABELS = {
  'Vocal 1 (Melody)': 'Lead Vocals',
  'Vocal 2 (Harmony)': 'Harmony Vocals',
  'Guitar 1 (Lead)': 'Lead Guitar',
  'Guitar 2 (Rhythm)': 'Rhythm Guitar',
  'Keyboard': 'Keyboard',
  'Bass': 'Bass',
  'Drum': 'Drums'
};

function tplEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tplClean(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

/** One-line text: line breaks inside a cell become " / ". */
function tplInline(value) {
  return tplEscape(tplClean(value).replace(/\s*\n\s*/g, ' / '));
}

function tplBold(html) { return html ? '<b>' + html + '</b>' : ''; }
function tplStrike(html) { return html ? '<s>' + html + '</s>' : ''; }

/** "Name (@handle)", or just whichever of the two is filled in. */
function tplPerson(person) {
  if (!person) return '';
  var name = tplInline(person.name);
  var handle = tplInline(person.handle);
  if (name && handle) return name + ' (' + handle + ')';
  return name || handle;
}

/** "first-row text / second-row text", or whichever is filled in. */
function tplBilingual(text) {
  if (!text) return '';
  var first = tplInline(text.primary);
  var second = tplInline(text.alternate);
  if (first && second && first !== second) return first + ' / ' + second;
  return first || second;
}

function tplRoleLabel(role) {
  return tplEscape(ROLE_LABELS[role] || role);
}

function tplSubLabel(slot, direction) {
  return 'Sub ' + (direction === 'in' ? 'In' : 'Out') + ' ' + slot;
}

/** "- One-song band #4 · 夜の歌 / Night Song" (title of the first named song). */
function tplBandLine(band) {
  var type = band.bandType === 'one-song' ? 'One-song band' : 'Two-song band';
  var number = band.number ? ' #' + tplEscape(band.number) : '';
  var title = '';
  for (var i = 0; i < band.songs.length && !title; i++) title = tplBilingual(band.songs[i].title);
  return '- ' + type + number + (title ? ' · ' + title : '');
}

/*
 * Band cards (owner decision): wherever a band is listed outside the sheet alerts
 * (/me, /watching, SoC LaaS answers), show which band it is, not just its number:
 *
 *   Two-song band #11
 *   🎵 夜バンド - 夜の歌 (Night Band - Night Song)   (one line per song: first sheet row as
 *   🎵 青バンド - 青い空                              artist - title, second row in brackets)
 *   Lead Vocals: Amy (@amy)
 *   Drums: Lee (@lee)
 *   POC: Amy (@amy)
 *
 * Built as plain text (SoC LaaS copies it), and HTML-escaped for Telegram by tplBandCard.
 */

/** "Name (@handle)" as plain text, exactly as written (trimmed, one line). */
function plainPerson(person) {
  if (!person) return '';
  var name = tplClean(person.name).replace(/\s*\n\s*/g, ' / ');
  var handle = tplClean(person.handle).replace(/\s*\n\s*/g, ' / ');
  if (name && handle) return name + ' (' + handle + ')';
  return name || handle;
}

/** "Two-song band #11" */
function bandHeading(band) {
  return (band.bandType === 'one-song' ? 'One-song band' : 'Two-song band') + (band.number ? ' #' + band.number : '');
}

/** "artist - title" from one sheet row ('' if both are blank). */
function plainSongRow(artist, title) {
  artist = tplClean(artist).replace(/\s*\n\s*/g, ' / ');
  title = tplClean(title).replace(/\s*\n\s*/g, ' / ');
  if (!title && !artist) return '';
  return (artist ? artist + ' - ' : '') + (title || '(untitled)');
}

/**
 * Each named song: "夜バンド - 夜の歌 (Night Band - Night Song)": first sheet row, then the
 * second row in brackets if it's filled in and different. firstRowOnly: no brackets.
 */
function bandSongList(band, firstRowOnly) {
  return band.songs.map(function (song) {
    var title = song.title || {};
    var artist = song.artist || {};
    var first = plainSongRow(artist.primary, title.primary);
    var second = plainSongRow(artist.alternate, title.alternate);
    if (!first) return second;
    return second && second !== first && !firstRowOnly ? first + ' (' + second + ')' : first;
  }).filter(function (s) { return s; });
}

/** "🎵 夜バンド - 夜の歌, 🎵 青バンド - 青い空" on one line ('' if there are no songs). */
function bandSongsText(band) {
  return bandSongList(band).map(function (s) { return '🎵 ' + s; }).join(', ');
}

/** The card as plain-text lines: one 🎵 line per song. compact: heading and songs only. */
function bandCardLines(band, compact) {
  var lines = [bandHeading(band)];
  bandSongList(band).forEach(function (s) { lines.push('🎵 ' + s); });
  if (compact) return lines;
  var people = [];
  band.members.forEach(function (m) { people.push((ROLE_LABELS[m.role] || m.role) + ': ' + plainPerson(m)); });
  band.substitutions.forEach(function (s) { people.push(tplSubLabel(s.slot, s.direction) + ': ' + plainPerson(s)); });
  band.otherInstruments.forEach(function (o) { people.push('Other: ' + plainPerson(o)); });
  if (!people.length) people.push('No members yet');
  if (band.pointOfContact) people.push('POC: ' + plainPerson(band.pointOfContact));
  return lines.concat(people);
}

function bandCardText(band, compact) {
  return bandCardLines(band, compact).join('\n');
}

/** The card for Telegram: bold heading, everything escaped. prefix goes before the heading (e.g. '👀 '). */
function tplBandCard(band, compact, prefix) {
  var lines = bandCardLines(band, compact);
  return (prefix || '') + '<b>' + tplEscape(lines[0]) + '</b>' +
    (lines.length > 1 ? '\n' + tplEscape(lines.slice(1).join('\n')) : '');
}

/** Short label for a button: "2-song #11 · 夜バンド - 夜の歌" (first song), at most 40 characters. */
function bandButtonLabel(band) {
  var first = bandSongList(band, true)[0] || '';
  var label = (band.bandType === 'one-song' ? '1-song' : '2-song') + ' #' + (band.number || '?') + (first ? ' · ' + first : '');
  var chars = Array.from(label);
  return chars.length > 40 ? chars.slice(0, 39).join('') + '…' : label;
}

/** "artist — title" for one song (just the title if there's no artist), or '' if both are blank. */
function tplSong(song) {
  if (!song) return '';
  var title = tplBilingual(song.title);
  var artist = tplBilingual(song.artist);
  if (!title && !artist) return '';
  return (artist ? artist + ' — ' : '') + (title || '(untitled)');
}

/**
 * The band's Description cell (first row), in full and exactly as written
 * (HTML-escaped). '' if there is none.
 */
function tplBandDescription(band) {
  var text = bandDescriptionText(band);
  return isBlank(text) ? '' : tplExact(text);
}

/** The band's Description (both rows) as raw text, '' if there is none. */
function bandDescriptionText(band) {
  return bandColumnText(band, 'description');
}

/**
 * The band's two cells in the first column whose header starts with `prefix`
 * ({ primary, alternate }), or null if there's no such column.
 */
function bandColumnCells(band, prefix) {
  var block = band && band.block;
  if (!block) return null;
  for (var c = 0; c < block.header.length; c++) {
    if (normaliseHeader(block.header[c]).indexOf(prefix) === 0) {
      return { primary: block.rows[0][c] || '', alternate: block.rows[1][c] || '' };
    }
  }
  return null;
}

/** Both rows of that column as one text (second row on its own line), exactly as written. */
function bandColumnText(band, prefix) {
  var cells = bandColumnCells(band, prefix);
  if (!cells) return '';
  return [cells.primary, cells.alternate].filter(function (v) { return !isBlank(v); }).join('\n');
}

/** True if a header belongs to one of BAND_TEXT_FIELDS (Description, YouTube Link). */
function isBandTextFieldHeader(header) {
  var key = normaliseHeader(header);
  return BAND_TEXT_FIELDS.some(function (f) { return key && key.indexOf(f.prefix) === 0; });
}

/**
 * Field name for something that changed: "🆕 <b>Label</b>" if it was empty before,
 * "🔄 <b>Label</b>" if it was edited or cleared. Unchanged fields keep a plain label.
 */
function tplChangedLabel(label, wasEmpty) {
  return (wasEmpty ? '🆕 ' : '🔄 ') + '<b>' + label + '</b>';
}

/**
 * A boxed field that may have changed between two raw values. Unchanged: plain label,
 * the text in a box. Changed: marked label (🆕 / 🔄); the box shows the new text in bold,
 * or ~~old~~ → **new**, or ~~old~~ (removed). Returns '' if both are blank.
 */
function tplBoxFieldChange(label, oldValue, newValue) {
  if (isBlank(oldValue) && isBlank(newValue)) return '';
  if (sameText(oldValue, newValue)) return tplBoxField(label, tplExact(newValue));
  if (isBlank(oldValue)) return tplBoxField(tplChangedLabel(label, true), tplBold(tplExact(newValue)));
  return tplBoxField(tplChangedLabel(label, false),
    tplBoxChange(tplExact(oldValue), isBlank(newValue) ? '' : tplExact(newValue)));
}

/*
 * Boxes: long free text (Instruments, Intro, Note to POC, Description, [Other Change]
 * values) goes in a Telegram expandable quote: it shows the first few lines with a
 * "show more" toggle.
 */
var BOX_OPEN = '<blockquote expandable>';
var BOX_CLOSE = '</blockquote>';

/** "Label:" then the text in an expandable box. */
function tplBoxField(label, html) {
  return label + ':\n' + BOX_OPEN + html + BOX_CLOSE;
}

/** A change inside a box: ~~old~~, →, **new** on separate lines (or (new) / (removed)). */
function tplBoxChange(beforeHtml, afterHtml) {
  if (beforeHtml && afterHtml) return tplStrike(beforeHtml) + '\n→\n' + tplBold(afterHtml);
  if (afterHtml) return tplBold(afterHtml) + ' (new)';
  if (beforeHtml) return tplStrike(beforeHtml) + ' (removed)';
  return '—';
}

/** "Song" for one-song bands, "Song 1"/"Song 2" for two-song bands. */
function tplSongLabel(band, index) {
  return band.songs.length > 1 ? 'Song ' + (index + 1) : 'Song';
}

/** Shows a change: ~~old~~ → **new**, **new** (new), or ~~old~~ (removed). */
function tplChange(beforeHtml, afterHtml) {
  if (beforeHtml && afterHtml) return tplStrike(beforeHtml) + ' → ' + tplBold(afterHtml);
  if (afterHtml) return tplBold(afterHtml) + ' (new)';
  if (beforeHtml) return tplStrike(beforeHtml) + ' (removed)';
  return '—';
}

/** Someone filling a previously empty slot: 🆕 **Name (@handle)**. */
function tplNewPerson(personHtml) {
  return '🆕 ' + tplBold(personHtml);
}

/** "Label: value", with multi-line values starting on the next line. */
function tplField(label, html) {
  return label + ':' + (html.indexOf('\n') >= 0 ? '\n' : ' ') + html;
}

/** Marker on lines the code can't read reliably; the LLM rewrite looks for it. */
var UNCLEAR_MARKER = '⚠ unclear cell';

/**
 * A person slot line: "Label: value", plus notes from the deterministic cell checks
 * (open slot, ⚠ warnings, unclear cell).
 */
function tplSlotLine(label, valueHtml, person) {
  var check = checkCell(person);
  var notes = [];
  if (check.openSlot) notes.push('open slot, looking for ' + tplEscape(check.openSlot));
  if (check.unclear) notes.push(UNCLEAR_MARKER);
  check.warnings.forEach(function (w) { notes.push('⚠ ' + w); });
  return label + ': ' + valueHtml + (notes.length ? ' <i>(' + notes.join('; ') + ')</i>' : '');
}

/** Joins non-empty sections with a blank line between them. */
function tplSections(sections) {
  return sections.filter(function (s) { return s; }).join('\n\n');
}

/** Text exactly as written in the cell (only HTML-escaped). */
function tplExact(value) {
  return tplEscape(value === null || value === undefined ? '' : String(value));
}

/** Player Finder fields, in message order. */
var PLAYER_FIELD_LABELS = [
  ['instruments', 'Instruments'],
  ['introduction', 'Intro'],
  ['noteToPointOfContact', 'Note to POC']
];

/** "<name> (<handle>)", both exactly as written; '' if both are blank. */
function tplPlayerNameAndHandle(p) {
  if (!p) return '';
  var name = isBlank(p.name) ? '' : tplExact(p.name);
  var handle = isBlank(p.handle) ? '' : tplExact(p.handle);
  if (name && handle) return name + ' (' + handle + ')';
  return name || handle;
}

/**
 * Every non-blank Player Finder field, exactly as written, starting with
 * "Name: <name> (<handle>)". When both versions are given (an update), changed fields
 * get 🆕 / 🔄 and a bold label, and show ~~old~~ → **new**.
 */
function tplPlayerFields(before, after) {
  var lines = [];
  var oldName = tplPlayerNameAndHandle(before);
  var newName = tplPlayerNameAndHandle(after);
  if (before && after && !(sameText(before.name, after.name) && sameText(before.handle, after.handle))) {
    lines.push(tplChangedLabel('Name', !oldName) + ': ' + (oldName ? tplChange(oldName, newName) : tplBold(newName)));
  } else if (newName || oldName) {
    lines.push('Name: ' + (after ? newName : oldName));
  }
  PLAYER_FIELD_LABELS.forEach(function (f) {
    var line;
    if (before && after) {
      // Update: changed fields get 🆕 / 🔄 and a bold label.
      line = tplBoxFieldChange(f[1], before[f[0]], after[f[0]]);
    } else {
      var value = after ? after[f[0]] : before[f[0]];
      line = isBlank(value) ? '' : tplBoxField(f[1], tplExact(value));
    }
    if (line) lines.push(line);
  });
  return lines.join('\n');
}

/** Lines for every role, sub and other instrument in a band (no highlighting). */
function tplRoster(band) {
  var lines = [];
  band.members.forEach(function (m) { lines.push(tplSlotLine(tplRoleLabel(m.role), tplPerson(m), m)); });
  band.substitutions.forEach(function (s) {
    lines.push(tplSlotLine(tplSubLabel(s.slot, s.direction), tplPerson(s), s));
  });
  band.otherInstruments.forEach(function (o) { lines.push(tplSlotLine('Other', tplPerson(o), o)); });
  return lines.join('\n');
}

/** Song, POC and Complete lines for a band (no highlighting). */
function tplBandDetails(band) {
  var lines = [];
  band.songs.forEach(function (song, i) {
    var text = tplSong(song);
    if (text) lines.push(tplSongLabel(band, i) + ': ' + text);
  });
  lines.push(band.pointOfContact ? tplSlotLine('POC', tplPerson(band.pointOfContact), band.pointOfContact) : 'POC: —');
  BAND_TEXT_FIELDS.forEach(function (f) {
    var text = bandColumnText(band, f.prefix);
    if (!isBlank(text)) lines.push(tplBoxField(f.label, tplExact(text)));
  });
  lines.push('Complete: ' + (tplInline(band.completion) || '—'));
  return lines.join('\n');
}
