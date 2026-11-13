const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook, clone } = require('./helpers/grids');

const ONE = 'Signup Sheet (one-song bands)';
const TWO = 'Signup Sheet (two-song bands)';

test('a row pair becomes one band with exact names and handles', () => {
  const snap = clone(g.buildSnapshot(workbook({
    oneSong: [{
      number: 1,
      cells: {
        'Song Title': ['夜の歌', 'Night Song'],
        'Original Artist': ['夜バンド', 'Night Band'],
        'Complete?': ['No', ''],
        'Point of Contact': ['Alex Tan', '@alex_t '],
        'Bass': ['Alex Tan', '@alex_t '],
        'Drum': ['bo', 'bo_no_at'],
        'Points\n(TLDR AT INFO SHEET)': ['1.23', '']
      },
      other: [['Casey (Violin)', '@CaseyV']]
    }]
  })));

  assert.equal(snap.bands.length, 1);
  const { block, ...parsed } = snap.bands[0];
  assert.equal(block.range, 'A7:P8');
  assert.deepEqual(block.rows[1].slice(0, 5), ['', 'Night Song', 'Night Band', '', '@alex_t ']);
  assert.deepEqual(parsed, {
    id: 'one-song#1',
    bandType: 'one-song',
    sourceSheet: ONE,
    sourceRows: [7, 8],
    number: '1',
    songs: [{
      title: { primary: '夜の歌', alternate: 'Night Song' },
      artist: { primary: '夜バンド', alternate: 'Night Band' }
    }],
    completion: 'No',
    pointOfContact: { name: 'Alex Tan', handle: '@alex_t ' },
    members: [
      { role: 'Bass', name: 'Alex Tan', handle: '@alex_t ' },
      { role: 'Drum', name: 'bo', handle: 'bo_no_at' }
    ],
    substitutions: [],
    otherInstruments: [{ column: 'P', name: 'Casey (Violin)', handle: '@CaseyV' }]
  });
  assert.deepEqual(snap.warnings, []);
});

test('example rows and empty reserved slots are skipped', () => {
  const snap = g.buildSnapshot(workbook({
    oneSong: [
      { number: 1, cells: { 'Complete?': ['No', ''] } },           // empty slot
      { number: 2, cells: { 'Song Title': ['', 'Only Alt Title'] } },
      { number: 3 }                                                  // empty slot
    ]
  }));
  assert.deepEqual(snap.bands.map((b) => b.id), ['one-song#2']);
  assert.deepEqual(snap.bands[0].sourceRows, [9, 10]);
});

test('empty slots without a number keep the pairing aligned', () => {
  const snap = g.buildSnapshot(workbook({
    twoSong: [
      { number: 1, cells: { 'Song 1 Title': ['A', ''] } },
      { number: undefined },                                          // number deleted, empty
      { number: 3, cells: { 'Song 1 Title': ['C', ''] } }
    ]
  }));
  assert.deepEqual(snap.bands.map((b) => [b.id, b.sourceRows]), [
    ['two-song#1', [7, 8]],
    ['two-song#3', [11, 12]]
  ]);
});

test('a band with content but no number is tracked by row, with a warning', () => {
  const snap = g.buildSnapshot(workbook({
    oneSong: [
      { number: 1, cells: { 'Song Title': ['A', ''] } },
      { number: undefined, cells: { 'Song Title': ['B', ''] } }
    ]
  }));
  assert.deepEqual(snap.bands.map((b) => b.id), ['one-song#1', 'one-song@row9']);
  assert.equal(snap.warnings.length, 1);
  assert.match(snap.warnings[0].message, /no number/);
});

test('two-song bands keep both songs, substitutions and other instruments', () => {
  const band = clone(g.buildSnapshot(workbook({
    twoSong: [{
      number: 5,
      cells: {
        'Song 1 Title': ['Song One', ''],
        'Song 2 Title': ['', 'Song Two Alt'],
        'Point-of-Contact': ['Dee', '@dee'],
        'Keyboard': ['Dee', '@dee'],
        'Player Subbing In 1': ['Eli (bass)', '@eli'],
        'Player Subbing Out 1': ['Fay', '@fay']
      },
      other: [['Gus (Flute)', '@gus'], ['(trumpet)', ''], ['Hana (Cello)', '@hana']]
    }]
  })).bands[0]);

  assert.equal(band.bandType, 'two-song');
  assert.equal(band.sourceSheet, TWO);
  assert.equal(band.songs.length, 2);
  assert.deepEqual(band.songs[1].title, { primary: '', alternate: 'Song Two Alt' });
  assert.deepEqual(band.substitutions, [
    { slot: 1, direction: 'in', name: 'Eli (bass)', handle: '@eli' },
    { slot: 1, direction: 'out', name: 'Fay', handle: '@fay' }
  ]);
  assert.deepEqual(band.otherInstruments.map((o) => [o.column, o.name, o.handle]), [
    ['V', 'Gus (Flute)', '@gus'],
    ['W', '(trumpet)', ''],
    ['X', 'Hana (Cello)', '@hana']
  ]);
});

test('Player Finder rows become separate player records', () => {
  const snap = clone(g.buildSnapshot(workbook({
    players: [
      { sn: 1, name: 'Ivy', handle: '@IvyPlays ', intro: 'likes rock', instruments: 'Bass (5)' },
      { sn: 2 },                                    // numbered but empty
      { sn: 3, name: 'Jo', handle: '' }
    ]
  })));
  assert.deepEqual(snap.players, [
    {
      id: 'handle:@ivyplays', sourceSheet: 'Player Finder', sourceRow: 9, serial: '1',
      name: 'Ivy', handle: '@IvyPlays ', introduction: 'likes rock', instruments: 'Bass (5)',
      noteToPointOfContact: ''
    },
    {
      id: 'sn:3', sourceSheet: 'Player Finder', sourceRow: 11, serial: '3',
      name: 'Jo', handle: '', introduction: '', instruments: '', noteToPointOfContact: ''
    }
  ]);
  assert.equal(snap.bands.length, 0);
});

test('fails when a worksheet is missing', () => {
  const sheets = workbook();
  delete sheets['Player Finder'];
  assert.throws(() => g.buildSnapshot(sheets), /Missing worksheet\(s\): "Player Finder"/);
});

test('fails when a required header is missing, naming it', () => {
  const sheets = workbook();
  sheets[TWO][0] = sheets[TWO][0].map((h) => (h === 'Point-of-Contact' ? 'Contact' : h));
  assert.throws(() => g.buildSnapshot(sheets), (err) =>
    err.name === 'SchemaError' && /two-song.*"Point-of-Contact"/.test(err.message));
});

test('header matching tolerates whitespace and case only', () => {
  const sheets = workbook({ oneSong: [{ number: 1, cells: { 'Song Title': ['A', ''] } }] });
  sheets[ONE][0] = sheets[ONE][0].map((h) => (h === 'Complete?' ? '  complete? \n' : h));
  assert.equal(g.buildSnapshot(sheets).bands.length, 1);
});

test('fails when the paired-row layout shifts', () => {
  const sheets = workbook({
    oneSong: [
      { number: 1, cells: { 'Song Title': ['A', ''] } },
      { number: 2, cells: { 'Song Title': ['B', ''] } }
    ]
  });
  // Insert a single row after the first band: band 2's number lands on a second row.
  const grid = sheets[ONE];
  grid.splice(8, 0, new Array(30).fill(''));
  assert.throws(() => g.buildSnapshot(sheets), /row 10: found band number "2" on the second row/);
});
