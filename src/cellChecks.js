/*
 * Deterministic checks on a person cell (name row + handle row) in a signup sheet.
 * Decides whether a cell can be read reliably. Only cells marked `unclear` are ever
 * sent to the LLM for interpretation.
 */

/** A normal Telegram handle: @ followed only by letters, digits or underscores. */
var HANDLE_PATTERN = /^@[A-Za-z0-9_]+$/;

/** Signs that a name cell holds more than one person. */
var MULTI_PERSON_PATTERN = /\/|,|&|\+|\band\b/i;

/**
 * Returns {
 *   openSlot: 'trumpet' for a cell like "(trumpet)" with no handle, else '',
 *   unclear:  true if the cell seems to hold several people or handles,
 *   warnings: e.g. ['no handle'], ['handle has no @']
 * }
 */
function checkCell(person) {
  var result = { openSlot: '', unclear: false, warnings: [] };
  if (!person) return result;
  var name = String(person.name || '').trim();
  var handle = String(person.handle || '').trim();

  var open = name.match(/^\(([^()]+)\)$/);
  if (open && !handle) {
    result.openSlot = open[1].trim();
    return result;
  }

  var atCount = (handle.match(/@/g) || []).length;
  result.unclear = MULTI_PERSON_PATTERN.test(name) || atCount > 1;

  if (name && !handle) result.warnings.push('no handle');
  else if (!name && handle) result.warnings.push('no name');
  else if (handle && atCount === 0) result.warnings.push('handle has no @');
  else if (handle && atCount === 1 && !HANDLE_PATTERN.test(handle)) result.warnings.push('unusual handle');
  return result;
}

/** Stable key for a person slot within a band, used to attach LLM interpretations. */
function cellSlotKey(kind, entry) {
  if (kind === 'role') return 'role:' + entry.role;
  if (kind === 'sub') return 'sub:' + entry.direction + ':' + entry.slot;
  return 'other:' + personKey(entry);
}
