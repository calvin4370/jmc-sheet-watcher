/*
 * Entry points for one watcher run.
 *
 * Input `sheets` is an object mapping worksheet name -> 2D array of display strings
 * (what Apps Script's Range.getDisplayValues() returns).
 */

var SNAPSHOT_VERSION = 1;

/** Validates and parses all three worksheets. Throws SchemaError on missing sheets/headers. */
function buildSnapshot(sheets) {
  var missing = REQUIRED_SHEETS.filter(function (name) {
    return !Object.prototype.hasOwnProperty.call(sheets, name);
  });
  if (missing.length) {
    throw schemaError('Missing worksheet(s): ' + missing.map(function (n) { return '"' + n + '"'; }).join(', '));
  }

  var oneSong = parseSignupSheet(sheets[ONE_SONG_SHEET], ONE_SONG_SCHEMA);
  var twoSong = parseSignupSheet(sheets[TWO_SONG_SHEET], TWO_SONG_SCHEMA);
  var finder = parsePlayerFinder(sheets[PLAYER_FINDER_SHEET]);

  return {
    version: SNAPSHOT_VERSION,
    bands: oneSong.bands.concat(twoSong.bands),
    players: finder.players,
    warnings: oneSong.warnings.concat(twoSong.warnings, finder.warnings)
  };
}

/**
 * Builds the current snapshot and compares it with the previous one.
 * With no previous snapshot this is the silent first-run baseline: no changes reported.
 * Band changes and Player Finder changes are returned separately.
 */
function detectChanges(previousSnapshot, sheets) {
  var snapshot = buildSnapshot(sheets);
  if (!previousSnapshot) {
    return { baseline: true, snapshot: snapshot, bandChanges: [], playerChanges: [] };
  }
  if (previousSnapshot.version !== SNAPSHOT_VERSION) {
    throw new Error(
      'Stored snapshot is version ' + previousSnapshot.version + ' but this code expects version ' +
        SNAPSHOT_VERSION + '. Re-run as a baseline.'
    );
  }
  return {
    baseline: false,
    snapshot: snapshot,
    bandChanges: diffBands(previousSnapshot.bands, snapshot.bands),
    playerChanges: diffPlayers(previousSnapshot.players, snapshot.players)
  };
}
