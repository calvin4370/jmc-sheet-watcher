/*
 * /stats: sheet numbers, worked out by the code (no SoC LaaS calls).
 * Owner decisions: any approved subscriber can use /stats; SoC LaaS has a get_stats tool;
 * the stats are also in the owner's 9am daily report (telegram/status.js).
 *
 * "Most needed" counts empty roles in bands not marked Complete? = Yes.
 */

function bandIsComplete(band) {
  return /^\s*yes\s*$/i.test(String(band.completion || ''));
}

/** { total, oneSong, twoSong, complete, notComplete, mostNeeded: [{ role, bands }], emptyRoles, playerFinder } */
function sheetStats(snapshot) {
  var stats = { total: 0, oneSong: 0, twoSong: 0, complete: 0, notComplete: 0, mostNeeded: [], emptyRoles: 0, playerFinder: 0 };
  if (!snapshot) return stats;
  var needed = {};
  ROLE_HEADERS.forEach(function (r) { needed[r] = 0; });
  snapshot.bands.forEach(function (b) {
    stats.total++;
    if (b.bandType === 'one-song') stats.oneSong++; else stats.twoSong++;
    if (bandIsComplete(b)) { stats.complete++; return; }
    stats.notComplete++;
    var filled = b.members.map(function (m) { return m.role; });
    ROLE_HEADERS.forEach(function (r) {
      if (filled.indexOf(r) < 0) { needed[r]++; stats.emptyRoles++; }
    });
  });
  stats.mostNeeded = ROLE_HEADERS
    .map(function (r, i) { return { role: ROLE_LABELS[r] || r, bands: needed[r], order: i }; })
    .filter(function (n) { return n.bands > 0; })
    .sort(function (a, b) { return b.bands - a.bands || a.order - b.order; })
    .map(function (n) { return { role: n.role, bands: n.bands }; });
  stats.playerFinder = snapshot.players.length;
  return stats;
}

/** The stats lines (Telegram HTML), without a header. */
function statsLines(stats) {
  return [
    '<b>Bands:</b> ' + stats.total + ' (' + stats.oneSong + ' one-song, ' + stats.twoSong + ' two-song)',
    '<b>Complete:</b> ' + stats.complete + ' · <b>Not complete:</b> ' + stats.notComplete,
    '<b>Most needed</b> (empty roles in bands not complete):',
    stats.mostNeeded.length
      ? stats.mostNeeded.map(function (n) { return tplEscape(n.role) + ': ' + n.bands; }).join(' · ')
      : 'none',
    '<b>Player Finder:</b> ' + stats.playerFinder + (stats.playerFinder === 1 ? ' person' : ' people')
  ];
}

function statsMessage(snapshot) {
  if (!snapshot) return '<b>[Sheet Stats]</b>\nThe sheet hasn\'t been checked yet. Try again in a few minutes.';
  return '<b>[Sheet Stats]</b>\n' + statsLines(sheetStats(snapshot)).join('\n');
}
