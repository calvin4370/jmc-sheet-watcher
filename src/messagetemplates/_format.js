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
  var block = band.block;
  if (!block) return '';
  for (var c = 0; c < block.header.length; c++) {
    if (normaliseHeader(block.header[c]).indexOf('description') === 0) {
      return isBlank(block.rows[0][c]) ? '' : tplExact(block.rows[0][c]);
    }
  }
  return '';
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
 * "Name: <name> (<handle>)". When both versions are given, changed fields are shown
 * as ~~old~~ → **new**.
 */
function tplPlayerFields(before, after) {
  var lines = [];
  var oldName = tplPlayerNameAndHandle(before);
  var newName = tplPlayerNameAndHandle(after);
  if (before && after && !(sameText(before.name, after.name) && sameText(before.handle, after.handle))) {
    lines.push('Name: ' + tplChange(oldName, newName));
  } else if (newName || oldName) {
    lines.push('Name: ' + (after ? newName : oldName));
  }
  PLAYER_FIELD_LABELS.forEach(function (f) {
    var oldValue = before ? before[f[0]] : '';
    var newValue = after ? after[f[0]] : '';
    var shown;
    if (before && after && !sameText(oldValue, newValue)) {
      shown = tplBoxChange(isBlank(oldValue) ? '' : tplExact(oldValue), isBlank(newValue) ? '' : tplExact(newValue));
    } else {
      var value = after ? newValue : oldValue;
      if (isBlank(value)) return;
      shown = tplExact(value);
    }
    lines.push(tplBoxField(f[1], shown));
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
  var description = tplBandDescription(band);
  if (description) lines.push(tplBoxField('Description', description));
  lines.push('Complete: ' + (tplInline(band.completion) || '—'));
  return lines.join('\n');
}
