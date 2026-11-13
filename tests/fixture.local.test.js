// Runs against the real workbook export if it exists locally (fixtures/ is Git-ignored).
// Create it with: python tools/export_fixture.py "fixtures/JMM 27 signups.xlsx" fixtures/grids.json
// No real names or handles are written in this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const g = require('./helpers/load');
const { clone } = require('./helpers/grids');

const file = path.join(__dirname, '..', 'fixtures', 'grids.json');
const skip = fs.existsSync(file) ? false : 'fixtures/grids.json not present';

test('real workbook parses and is stable against itself', { skip }, () => {
  const sheets = JSON.parse(fs.readFileSync(file, 'utf8'));
  const first = g.detectChanges(null, sheets);
  const snap = first.snapshot;

  const oneSong = snap.bands.filter((b) => b.bandType === 'one-song');
  const twoSong = snap.bands.filter((b) => b.bandType === 'two-song');
  assert.ok(oneSong.length > 0 && twoSong.length > 0 && snap.players.length > 0);

  // Every band is a pair of rows starting on the primary row.
  for (const b of snap.bands) assert.equal(b.sourceRows[1], b.sourceRows[0] + 1);

  // Exact handles: whatever is in the sheet cell comes through untouched.
  for (const b of snap.bands) {
    for (const m of b.members) {
      const grid = sheets[b.sourceSheet];
      const handleRow = grid[b.sourceRows[1] - 1];
      assert.ok(handleRow.includes(m.handle), `${b.id} ${m.role} handle not found verbatim`);
    }
  }

  const second = g.detectChanges(clone(snap), sheets);
  assert.deepEqual([second.bandChanges, second.playerChanges], [[], []]);

  console.log(
    `one-song bands: ${oneSong.length}, two-song bands: ${twoSong.length}, ` +
      `players: ${snap.players.length}, warnings: ${snap.warnings.length}`
  );
  for (const w of snap.warnings) console.log(`warning: ${w.sheet} row ${w.row}: ${w.message}`);
});
