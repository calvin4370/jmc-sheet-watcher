// Builds synthetic worksheets with the same layout as the real workbook.
// All names and handles here are made up.

const ROLES = [
  'Vocal 1 (Melody)', 'Vocal 2 (Harmony)', 'Guitar 1 (Lead)', 'Guitar 2 (Rhythm)',
  'Keyboard', 'Bass', 'Drum'
];

const ONE_SONG_HEADER = [
  ' ', 'Song Title', 'Original Artist', 'Complete?', 'Point of Contact',
  'Points\n(TLDR AT INFO SHEET)', 'Description / Points to Take Note', 'Youtube Link',
  ...ROLES, 'Other Insts'
];

const TWO_SONG_HEADER = [
  ' ', 'Song 1 Title', 'Original Artist 1', 'Song 2 Title', 'Original Artist 2', 'Complete?',
  'Point-of-Contact', 'Points\n(TLDR AT INFO SHEET)', 'Description / Points to Take Note',
  'Youtube Link', ...ROLES, 'Player Subbing In 1', 'Player Subbing In 2',
  'Player Subbing Out 1', 'Player Subbing Out 2', 'Other Insts'
];

const PLAYER_HEADER = [
  'S/N', 'Name', 'Telegram Handle',
  'Self-introduction (Including Your Favorite Songs/Artists)',
  'Instrument(s) (skill/confidence level)',
  'I want to tell the Point of Contact that…', '', 'Tips:'
];

const WIDTH = 30;
const blankRow = () => new Array(WIDTH).fill('');

/**
 * bands: [{ number, cells: { header: [firstRow, secondRow] }, other: [[name, handle], ...] }]
 * A band with no cells/other is an empty reserved slot.
 */
function signupGrid(header, bands) {
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error('test helper: unknown header ' + name);
    return i;
  };
  const rows = [header.concat(new Array(WIDTH - header.length).fill(''))];

  // Two example pairs, then a blank row, like the real sheet.
  for (let e = 0; e < 2; e++) {
    const a = blankRow();
    const b = blankRow();
    a[0] = 'E.g.';
    a[col(header[1])] = 'Example Song';
    a[col('Drum')] = 'Example Person';
    b[col('Drum')] = '@example_person';
    rows.push(a, b);
  }
  rows.push(blankRow());

  for (const band of bands) {
    const a = blankRow();
    const b = blankRow();
    a[0] = band.number === undefined ? '' : String(band.number);
    for (const [name, [first, second]] of Object.entries(band.cells || {})) {
      a[col(name)] = first === undefined ? '' : first;
      b[col(name)] = second === undefined ? '' : second;
    }
    (band.other || []).forEach(([name, handle], i) => {
      a[col('Other Insts') + i] = name;
      b[col('Other Insts') + i] = handle;
    });
    rows.push(a, b);
  }
  return rows;
}

/** players: [{ sn, name, handle, intro, instruments, note }] */
function playerGrid(players) {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(blankRow());
  rows[0][3] = 'JMM Player Finder Sheet';
  rows.push(PLAYER_HEADER.concat(new Array(WIDTH - PLAYER_HEADER.length).fill('')));
  const example = blankRow();
  example[0] = 'E.g.';
  example[1] = 'Example Person';
  example[2] = '@example_person';
  rows.push(example, blankRow());
  for (const p of players) {
    const r = blankRow();
    r[0] = p.sn === undefined ? '' : String(p.sn);
    r[1] = p.name || '';
    r[2] = p.handle || '';
    r[3] = p.intro || '';
    r[4] = p.instruments || '';
    r[5] = p.note || '';
    rows.push(r);
  }
  return rows;
}

function workbook({ oneSong = [], twoSong = [], players = [] } = {}) {
  return {
    'Signup Sheet (one-song bands)': signupGrid(ONE_SONG_HEADER, oneSong),
    'Signup Sheet (two-song bands)': signupGrid(TWO_SONG_HEADER, twoSong),
    'Player Finder': playerGrid(players)
  };
}

// JSON round trip: snapshots are stored as JSON, so tests compare like the real thing.
const clone = (x) => JSON.parse(JSON.stringify(x));

module.exports = { workbook, signupGrid, playerGrid, ONE_SONG_HEADER, TWO_SONG_HEADER, clone };
