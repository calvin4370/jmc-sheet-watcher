/*
 * Turns the Player Finder worksheet into player records (one row per person).
 * Kept completely separate from the band inventory.
 */

var PLAYER_FIELDS = ['name', 'handle', 'introduction', 'instruments', 'noteToPointOfContact'];

function parsePlayerFinder(grid) {
  var sheet = PLAYER_FINDER_SHEET;
  var headerNames = Object.keys(PLAYER_FINDER_COLUMNS).map(function (k) {
    return PLAYER_FINDER_COLUMNS[k];
  });
  var header = findHeaderRow(grid, sheet, headerNames);
  var cols = {};
  Object.keys(PLAYER_FINDER_COLUMNS).forEach(function (k) {
    cols[k] = header.columns[normaliseHeader(PLAYER_FINDER_COLUMNS[k])];
  });
  var fieldCols = PLAYER_FIELDS.map(function (f) { return cols[f]; });

  var players = [];
  var warnings = [];
  var seenIds = {};

  for (var r = header.row + 1; r < grid.length; r++) {
    var serial = cellText(grid, r, cols.serial);
    if (isExampleMarker(serial)) continue;
    if (!rowHasContent(grid, r, fieldCols)) continue; // empty or numbered-only slot

    var player = {
      id: '',
      sourceSheet: sheet,
      sourceRow: r + 1,
      serial: serial.trim()
    };
    PLAYER_FIELDS.forEach(function (f) { player[f] = cellText(grid, r, cols[f]); });

    // Identity is the handle (Telegram handles are case-insensitive); the displayed
    // handle is always the raw string. Fall back to S/N, then row.
    var id;
    if (!isBlank(player.handle)) id = 'handle:' + player.handle.trim().toLowerCase();
    else if (player.serial !== '') id = 'sn:' + player.serial;
    else id = 'row:' + (r + 1);
    if (seenIds[id]) {
      warnings.push({ sheet: sheet, row: r + 1, message: 'Duplicate entry for "' + id + '"; tracked by its row instead.' });
      id = id + '@row' + (r + 1);
    }
    seenIds[id] = true;
    player.id = id;
    players.push(player);
  }

  return { players: players, warnings: warnings };
}
