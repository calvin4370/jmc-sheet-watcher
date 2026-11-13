/*
 * Message for: a band disappears from a signup sheet (its row pair was cleared).
 * Shows the band as it was last seen.
 *
 * [Band Removed]
 * - One-song band #N · 夜の歌 / Night Song
 *
 * Song: …
 * POC: Name (@handle)
 * Complete: No
 *
 * Lead Guitar: Name (@handle)
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.band_removed = {
  render: function (change) {
    var band = change.band;
    return tplSections([
      '<b>[Band Removed]</b>\n' + tplBandLine(band),
      tplBandDetails(band),
      tplRoster(band)
    ]);
  }
};
