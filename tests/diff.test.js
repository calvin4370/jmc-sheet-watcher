const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook, clone } = require('./helpers/grids');

const baseBand = () => ({
  number: 1,
  cells: {
    'Song Title': ['歌', 'Song'],
    'Original Artist': ['Artist', ''],
    'Complete?': ['No', ''],
    'Point of Contact': ['Kim', '@kim'],
    'Bass': ['Kim', '@kim'],
    'Drum': ['Lee', '@lee'],
    'Points\n(TLDR AT INFO SHEET)': ['1.5', '']
  },
  other: [['Max (Sax)', '@max'], ['Nia (Violin)', '@nia']]
});

const basePlayers = () => [
  { sn: 1, name: 'Oli', handle: '@oli', intro: 'hi', instruments: 'Drums (3)', note: '' },
  { sn: 2, name: 'Pat', handle: '@pat', intro: '', instruments: 'Vox (6)', note: '' }
];

/** Runs a baseline on `before`, then a second run on `after`; returns the second result. */
function run(before, after) {
  const first = g.detectChanges(null, workbook(before));
  return clone(g.detectChanges(clone(first.snapshot), workbook(after)));
}

function edit(mutator) {
  const band = baseBand();
  mutator(band);
  return { oneSong: [band], players: basePlayers() };
}

const base = () => ({ oneSong: [baseBand()], players: basePlayers() });

test('first run is a silent baseline', () => {
  const result = g.detectChanges(null, workbook(base()));
  assert.equal(result.baseline, true);
  assert.deepEqual([result.bandChanges, result.playerChanges], [[], []]);
  assert.equal(result.snapshot.bands.length, 1);
});

test('no edits means no changes', () => {
  const result = run(base(), base());
  assert.equal(result.baseline, false);
  assert.deepEqual([result.bandChanges, result.playerChanges], [[], []]);
});

test('Points, whitespace-only and Other Insts reordering are not changes', () => {
  const result = run(base(), edit((b) => {
    b.cells['Points\n(TLDR AT INFO SHEET)'] = ['9.9', ''];
    b.cells['Drum'] = ['Lee ', ' @lee'];
    b.other = [['Nia (Violin)', '@nia'], ['Max (Sax)', '@max']];
  }));
  assert.deepEqual(result.bandChanges, []);
});

test('filling an empty slot is a new band; clearing it is a removal', () => {
  const withSlot = { oneSong: [baseBand(), { number: 2 }], players: basePlayers() };
  const filled = { oneSong: [baseBand(), { number: 2, cells: { 'Song Title': ['New', ''] } }], players: basePlayers() };

  const added = run(withSlot, filled);
  assert.deepEqual(added.bandChanges.map((c) => [c.type, c.band.id]), [['band_added', 'one-song#2']]);

  const removed = run(filled, withSlot);
  assert.deepEqual(removed.bandChanges.map((c) => [c.type, c.band.id]), [['band_removed', 'one-song#2']]);
});

test('member joins, leaves and is replaced, reported per role', () => {
  const result = run(base(), edit((b) => {
    b.cells['Keyboard'] = ['Quinn', '@quinn'];     // joins
    delete b.cells['Bass'];                        // leaves
    b.cells['Drum'] = ['Ray', '@ray'];             // replaced
  }));
  assert.equal(result.bandChanges.length, 1);
  const change = result.bandChanges[0];
  assert.equal(change.type, 'band_changed');
  assert.equal(change.band.id, 'one-song#1');
  assert.deepEqual(change.band.sourceRows, [7, 8]);
  assert.deepEqual(change.changes, [
    { field: 'role', role: 'Bass', before: { name: 'Kim', handle: '@kim' }, after: null },
    { field: 'role', role: 'Drum', before: { name: 'Lee', handle: '@lee' }, after: { name: 'Ray', handle: '@ray' } },
    { field: 'role', role: 'Keyboard', before: null, after: { name: 'Quinn', handle: '@quinn' } }
  ]);
});

test('handle edits are changes, including case', () => {
  const result = run(base(), edit((b) => { b.cells['Drum'] = ['Lee', '@Lee']; }));
  assert.deepEqual(result.bandChanges[0].changes, [
    { field: 'role', role: 'Drum', before: { name: 'Lee', handle: '@lee' }, after: { name: 'Lee', handle: '@Lee' } }
  ]);
});

test('song, completion, point of contact and other instruments changes', () => {
  const result = run(base(), edit((b) => {
    b.cells['Song Title'] = ['歌', 'Song (Remix)'];
    b.cells['Complete?'] = ['Yes', ''];
    b.cells['Point of Contact'] = ['Lee', '@lee'];
    b.other = [['Max (Sax)', '@max'], ['Sol (Erhu)', '@sol']];
  }));
  assert.deepEqual(result.bandChanges[0].changes, [
    {
      field: 'song', song: 1, part: 'title',
      before: { primary: '歌', alternate: 'Song' },
      after: { primary: '歌', alternate: 'Song (Remix)' }
    },
    { field: 'completion', before: 'No', after: 'Yes' },
    { field: 'pointOfContact', before: { name: 'Kim', handle: '@kim' }, after: { name: 'Lee', handle: '@lee' } },
    { field: 'otherInstrument', change: 'removed', entry: { name: 'Nia (Violin)', handle: '@nia' } },
    { field: 'otherInstrument', change: 'added', entry: { name: 'Sol (Erhu)', handle: '@sol' } }
  ]);
});

test('substitution changes on two-song bands', () => {
  const band = (subIn) => ({
    number: 1,
    cells: { 'Song 1 Title': ['A', ''], ...(subIn ? { 'Player Subbing In 2': subIn } : {}) }
  });
  const result = run({ twoSong: [band(null)] }, { twoSong: [band(['Tia (keys)', '@tia'])] });
  assert.deepEqual(result.bandChanges[0].changes, [
    { field: 'substitution', slot: 2, direction: 'in', before: null, after: { name: 'Tia (keys)', handle: '@tia' } }
  ]);
});

test('Player Finder changes are reported separately from band changes', () => {
  const players = basePlayers();
  players[0].instruments = 'Drums (4)';             // changed
  players.splice(1, 1);                              // Pat removed
  players.push({ sn: 3, name: 'Uma', handle: '@uma', instruments: 'Keys (2)' }); // added

  const result = run(base(), { oneSong: [baseBand()], players });
  assert.deepEqual(result.bandChanges, []);
  assert.deepEqual(result.playerChanges.map((c) => [c.type, c.player.id]), [
    ['player_changed', 'handle:@oli'],
    ['player_added', 'handle:@uma'],
    ['player_removed', 'handle:@pat']
  ]);
  assert.deepEqual(result.playerChanges[0].changes, [
    { field: 'instruments', before: 'Drums (3)', after: 'Drums (4)' }
  ]);
});

test('a player moving rows is not a change', () => {
  const reordered = basePlayers().reverse();
  const result = run(base(), { oneSong: [baseBand()], players: reordered });
  assert.deepEqual(result.playerChanges, []);
});

test('rejects a stored snapshot from a different version', () => {
  const first = g.detectChanges(null, workbook(base()));
  const old = { ...clone(first.snapshot), version: 0 };
  assert.throws(() => g.detectChanges(old, workbook(base())), /Re-run as a baseline/);
});
