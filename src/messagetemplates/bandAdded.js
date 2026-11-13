/*
 * Message for: a new band appears on a signup sheet.
 *
 * [New Band]
 * - One-song band #N · 夜の歌 / Night Song
 *
 * Song: 夜バンド / Night Band — 夜の歌 / Night Song
 * POC: Name (@handle)
 * Description: (description text, cut to 100 chars then ...)
 * Complete: No
 *
 * Lead Guitar: Name (@handle)
 * Bass: Name (@handle)
 * Other: (trumpet) (open slot, looking for trumpet)
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.band_added = {
  render: function (change) {
    var band = change.band;
    return tplSections([
      '<b>[New Band]</b>\n' + tplBandLine(band),
      tplBandDetails(band),
      tplRoster(band)
    ]);
  }
};
