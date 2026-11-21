/*
 * Deterministic diff engine. Decides exactly what changed between two snapshots.
 * Whitespace-only edits at the start/end of a value are not treated as changes.
 */

function personKey(person) {
  return person ? compareKey(person.name) + '\u0000' + compareKey(person.handle) : '';
}

function personOnly(entry) {
  return entry ? { name: entry.name, handle: entry.handle } : null;
}

function sameBilingual(a, b) {
  return sameText(a && a.primary, b && b.primary) && sameText(a && a.alternate, b && b.alternate);
}

function indexBy(list, keyFn) {
  var map = {};
  list.forEach(function (item) { map[keyFn(item)] = item; });
  return map;
}

/** Compares slot-based entries (roles, substitutions). Returns [{ key, before, after }]. */
function diffSlots(beforeList, afterList, keyFn) {
  var before = indexBy(beforeList, keyFn);
  var after = indexBy(afterList, keyFn);
  var keys = [];
  beforeList.concat(afterList).forEach(function (e) {
    var k = keyFn(e);
    if (keys.indexOf(k) < 0) keys.push(k);
  });
  var out = [];
  keys.forEach(function (k) {
    if (personKey(before[k]) !== personKey(after[k])) {
      out.push({ key: k, before: before[k] || null, after: after[k] || null });
    }
  });
  return out;
}

/** Field-level changes between two versions of the same band. */
function diffBand(before, after) {
  var changes = [];

  var songCount = Math.max(before.songs.length, after.songs.length);
  for (var i = 0; i < songCount; i++) {
    ['title', 'artist'].forEach(function (part) {
      var b = before.songs[i] ? before.songs[i][part] : null;
      var a = after.songs[i] ? after.songs[i][part] : null;
      if (!sameBilingual(b, a)) {
        changes.push({ field: 'song', song: i + 1, part: part, before: b, after: a });
      }
    });
  }

  if (!sameText(before.completion, after.completion)) {
    changes.push({ field: 'completion', before: before.completion, after: after.completion });
  }

  // Description and YouTube Link (both rows), read from the band's cells.
  BAND_TEXT_FIELDS.forEach(function (f) {
    var b = bandColumnCells(before, f.prefix) || {};
    var a = bandColumnCells(after, f.prefix) || {};
    if (!sameText(b.primary, a.primary) || !sameText(b.alternate, a.alternate)) {
      changes.push({ field: f.field, before: bandColumnText(before, f.prefix), after: bandColumnText(after, f.prefix) });
    }
  });

  if (personKey(before.pointOfContact) !== personKey(after.pointOfContact)) {
    changes.push({ field: 'pointOfContact', before: before.pointOfContact, after: after.pointOfContact });
  }

  diffSlots(before.members, after.members, function (m) { return m.role; }).forEach(function (d) {
    changes.push({ field: 'role', role: d.key, before: personOnly(d.before), after: personOnly(d.after) });
  });

  diffSlots(before.substitutions, after.substitutions, function (s) {
    return s.direction + ' ' + s.slot;
  }).forEach(function (d) {
    var ref = d.after || d.before;
    changes.push({
      field: 'substitution', slot: ref.slot, direction: ref.direction,
      before: personOnly(d.before), after: personOnly(d.after)
    });
  });

  // Other instruments: compared as a set of people, so reordering columns is not a change.
  var remaining = after.otherInstruments.slice();
  before.otherInstruments.forEach(function (e) {
    for (var j = 0; j < remaining.length; j++) {
      if (personKey(remaining[j]) === personKey(e)) { remaining.splice(j, 1); return; }
    }
    changes.push({ field: 'otherInstrument', change: 'removed', entry: personOnly(e) });
  });
  remaining.forEach(function (e) {
    changes.push({ field: 'otherInstrument', change: 'added', entry: personOnly(e) });
  });

  return changes;
}

/**
 * Cells that changed in a band's "other" columns (not read into the band record, not
 * ignored, and not Description / YouTube Link: e.g. columns added later).
 * Returns [{ column, header, row: 'first'|'second', before, after }].
 */
function diffOtherCells(before, after) {
  var b = before.block;
  var a = after.block;
  if (!b || !a) return [];
  var skip = {};
  a.readColumns.concat(a.ignoredColumns, b.readColumns, b.ignoredColumns).forEach(function (c) { skip[c] = true; });
  var width = Math.max(a.header.length, b.header.length);
  var cells = [];
  for (var c = 0; c < width; c++) {
    // Description and YouTube Link are band fields now (diffBand), not other columns.
    if (skip[c] || isBandTextFieldHeader(a.header[c]) || isBandTextFieldHeader(b.header[c])) continue;
    for (var r = 0; r < 2; r++) {
      var oldText = b.rows[r][c] === undefined ? '' : b.rows[r][c];
      var newText = a.rows[r][c] === undefined ? '' : a.rows[r][c];
      if (!sameText(oldText, newText)) {
        cells.push({
          column: columnLetter(c),
          header: a.header[c] !== undefined ? a.header[c] : (b.header[c] || ''),
          row: r === 0 ? 'first' : 'second',
          before: oldText,
          after: newText
        });
      }
    }
  }
  return cells;
}

function diffBands(previousBands, currentBands) {
  var previous = indexBy(previousBands, function (b) { return b.id; });
  var current = indexBy(currentBands, function (b) { return b.id; });
  var changes = [];
  currentBands.forEach(function (band) {
    var old = previous[band.id];
    if (!old) {
      changes.push({ type: 'band_added', band: band });
      return;
    }
    var fieldChanges = diffBand(old, band);
    if (fieldChanges.length) {
      changes.push({ type: 'band_changed', band: band, previous: old, changes: fieldChanges });
    }
    var otherCells = diffOtherCells(old, band);
    if (otherCells.length) {
      changes.push({ type: 'band_other_changed', band: band, previous: old, cells: otherCells });
    }
  });
  previousBands.forEach(function (band) {
    if (!current[band.id]) changes.push({ type: 'band_removed', band: band });
  });
  return changes;
}

function diffPlayers(previousPlayers, currentPlayers) {
  var previous = indexBy(previousPlayers, function (p) { return p.id; });
  var current = indexBy(currentPlayers, function (p) { return p.id; });
  var changes = [];
  currentPlayers.forEach(function (player) {
    var old = previous[player.id];
    if (!old) {
      changes.push({ type: 'player_added', player: player });
      return;
    }
    var fieldChanges = [];
    PLAYER_FIELDS.forEach(function (f) {
      if (!sameText(old[f], player[f])) {
        fieldChanges.push({ field: f, before: old[f], after: player[f] });
      }
    });
    if (fieldChanges.length) {
      changes.push({ type: 'player_changed', player: player, previous: old, changes: fieldChanges });
    }
  });
  previousPlayers.forEach(function (player) {
    if (!current[player.id]) changes.push({ type: 'player_removed', player: player });
  });
  return changes;
}
