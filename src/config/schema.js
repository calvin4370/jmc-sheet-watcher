/*
 * Expected worksheet names and headers. If the live sheet's layout changes, update this
 * file deliberately; the watcher fails loudly rather than guessing.
 */

var ONE_SONG_SHEET = 'Signup Sheet (one-song bands)';
var TWO_SONG_SHEET = 'Signup Sheet (two-song bands)';
var PLAYER_FINDER_SHEET = 'Player Finder';

var REQUIRED_SHEETS = [ONE_SONG_SHEET, TWO_SONG_SHEET, PLAYER_FINDER_SHEET];

/** The band number lives in column A, whose header cell is blank. */
var BAND_NUMBER_COLUMN = 0;

var ROLE_HEADERS = [
  'Vocal 1 (Melody)',
  'Vocal 2 (Harmony)',
  'Guitar 1 (Lead)',
  'Guitar 2 (Rhythm)',
  'Keyboard',
  'Bass',
  'Drum'
];

/*
 * Signup sheets use paired rows: the first row holds primary-language text and display
 * names, the second holds alternate-language text and Telegram handles.
 * Points is never read; Description and YouTube are read from the band's cells
 * (BAND_TEXT_FIELDS).
 */
var ONE_SONG_SCHEMA = {
  bandType: 'one-song',
  sheetName: ONE_SONG_SHEET,
  songs: [{ title: 'Song Title', artist: 'Original Artist' }],
  completion: 'Complete?',
  pointOfContact: 'Point of Contact',
  roles: ROLE_HEADERS,
  substitutions: [],
  otherInstruments: 'Other Insts'
};

var TWO_SONG_SCHEMA = {
  bandType: 'two-song',
  sheetName: TWO_SONG_SHEET,
  songs: [
    { title: 'Song 1 Title', artist: 'Original Artist 1' },
    { title: 'Song 2 Title', artist: 'Original Artist 2' }
  ],
  completion: 'Complete?',
  pointOfContact: 'Point-of-Contact',
  roles: ROLE_HEADERS,
  substitutions: [
    { slot: 1, direction: 'in', header: 'Player Subbing In 1' },
    { slot: 2, direction: 'in', header: 'Player Subbing In 2' },
    { slot: 1, direction: 'out', header: 'Player Subbing Out 1' },
    { slot: 2, direction: 'out', header: 'Player Subbing Out 2' }
  ],
  otherInstruments: 'Other Insts'
};

/**
 * Signup columns never alerted on, matched by the start of the header. Points is a
 * formula that recalculates whenever any band changes.
 */
var IGNORED_HEADER_PREFIXES = ['points'];

/**
 * Band columns treated as normal band fields (owner decision): edits show in [Band Update]
 * like any other field, from the code's own template (no LLM). Matched by the start of the
 * header; both rows are read. Alerts for them follow the "Other changes" switch.
 */
var BAND_TEXT_FIELDS = [
  { field: 'description', prefix: 'description', label: 'Description' },
  { field: 'youtube', prefix: 'youtube', label: 'YouTube Link' }
];

/** Player Finder: one row per person (not paired). */
var PLAYER_FINDER_COLUMNS = {
  serial: 'S/N',
  name: 'Name',
  handle: 'Telegram Handle',
  introduction: 'Self-introduction (Including Your Favorite Songs/Artists)',
  instruments: 'Instrument(s) (skill/confidence level)',
  noteToPointOfContact: 'I want to tell the Point of Contact that…'
};

function signupRequiredHeaders(schema) {
  var headers = [];
  schema.songs.forEach(function (s) { headers.push(s.title, s.artist); });
  headers.push(schema.completion, schema.pointOfContact);
  headers = headers.concat(schema.roles);
  schema.substitutions.forEach(function (s) { headers.push(s.header); });
  headers.push(schema.otherInstruments);
  return headers;
}
