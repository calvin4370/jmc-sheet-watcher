/*
 * Shared helpers.
 *
 * Every file in src/ is written as plain global functions so it runs unchanged in
 * Google Apps Script (which shares one global scope across files) and in Node tests.
 * Do not use require/import/module here.
 */

/** Header rows are searched for within this many rows from the top of a sheet. */
var HEADER_SCAN_ROWS = 20;

/** Returns the cell at (row, col) of a grid as a string, exactly as stored ('' if empty). */
function cellText(grid, row, col) {
  var cells = grid[row];
  if (!cells || col >= cells.length) return '';
  var value = cells[col];
  return value === null || value === undefined ? '' : String(value);
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Comparison key used only to decide whether something changed.
 * Ignores leading/trailing whitespace; never changes case or any other character.
 * Display values are always the raw strings, never this key.
 */
function compareKey(value) {
  return isBlank(value) ? '' : String(value).trim();
}

function sameText(a, b) {
  return compareKey(a) === compareKey(b);
}

function gridWidth(grid) {
  var width = 0;
  for (var i = 0; i < grid.length; i++) {
    if (grid[i] && grid[i].length > width) width = grid[i].length;
  }
  return width;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
function columnLetter(index) {
  var letters = '';
  var n = index + 1;
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Header matching tolerates whitespace/newline differences, case, and "…" vs "...". */
function normaliseHeader(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isExampleMarker(value) {
  return normaliseHeader(value).indexOf('e.g.') === 0;
}

function schemaError(message) {
  var error = new Error(message);
  error.name = 'SchemaError';
  return error;
}

/**
 * Finds the header row containing every required header.
 * Returns { row, columns } where columns maps normaliseHeader(name) -> column index
 * (first occurrence). Throws a SchemaError naming the missing headers otherwise.
 */
function findHeaderRow(grid, sheetName, requiredHeaders) {
  var best = { row: -1, missing: requiredHeaders.slice() };
  var limit = Math.min(grid.length, HEADER_SCAN_ROWS);
  for (var r = 0; r < limit; r++) {
    var columns = {};
    var cells = grid[r] || [];
    for (var c = 0; c < cells.length; c++) {
      var key = normaliseHeader(cells[c]);
      if (key !== '' && !(key in columns)) columns[key] = c;
    }
    var missing = requiredHeaders.filter(function (h) {
      return !(normaliseHeader(h) in columns);
    });
    if (missing.length === 0) return { row: r, columns: columns };
    if (missing.length < best.missing.length) best = { row: r, missing: missing };
  }
  throw schemaError(
    'Sheet "' + sheetName + '": missing required header(s): ' +
      best.missing.map(function (h) { return '"' + h + '"'; }).join(', ') +
      (best.row >= 0 ? ' (closest header row is row ' + (best.row + 1) + ')' : '')
  );
}

/** Short stable hash of a string (cyrb53), used as an ID for sent notifications. */
/** Singapore has no daylight saving: always UTC+8. */
var SINGAPORE_OFFSET_MS = 8 * 3600 * 1000;

/** The Singapore date of a moment, as 'YYYY-MM-DD'. */
function singaporeDay(ms) {
  return new Date(ms + SINGAPORE_OFFSET_MS).toISOString().slice(0, 10);
}

/** A moment in Singapore time, e.g. '12:40 am, 14 Nov'. */
function singaporeTime(ms) {
  var d = new Date(ms + SINGAPORE_OFFSET_MS);
  var h = d.getUTCHours();
  var m = d.getUTCMinutes();
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' am' : ' pm') + ', ' +
    d.getUTCDate() + ' ' + months[d.getUTCMonth()];
}

function stableHash(text) {
  var h1 = 0xdeadbeef;
  var h2 = 0x41c6ce57;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** True if any of the given columns in the row is non-blank. */
function rowHasContent(grid, row, cols) {
  for (var i = 0; i < cols.length; i++) {
    if (!isBlank(cellText(grid, row, cols[i]))) return true;
  }
  return false;
}
