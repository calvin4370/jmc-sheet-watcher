// Prints sample Telegram messages, one per change, using the local workbook export
// plus a few pretend edits made in memory (the fixture file is never changed).
//
//   npm run preview              template messages only (no LLM)
//   npm run preview -- --llm     also call SOC LaaS for unclear cells (reads
//                                SOCLAAS_BASE_URL, _API_KEY and _MODEL from soclaas.env)
//   npm run preview -- --raw     show the Telegram HTML codes
//
// Needs fixtures/grids.json (see README: tools/export_fixture.py).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const g = require('../tests/helpers/load');

const file = path.join(__dirname, '..', 'fixtures', 'grids.json');
if (!fs.existsSync(file)) {
  console.error('fixtures/grids.json not found. Run tools/export_fixture.py first (see README).');
  process.exit(1);
}

const before = JSON.parse(fs.readFileSync(file, 'utf8'));
const after = JSON.parse(JSON.stringify(before));

const ONE = after['Signup Sheet (one-song bands)'];
const TWO = after['Signup Sheet (two-song bands)'];
const PF = after['Player Finder'];

const colOf = (grid, headerRow, name) => {
  const i = grid[headerRow].findIndex((h) => g.normaliseHeader(h) === g.normaliseHeader(name));
  if (i < 0) throw new Error('preview: header not found: ' + name);
  return i;
};
const rowOfBand = (grid, number) => grid.findIndex((r) => String(r[0]).trim() === String(number));
const setPair = (grid, row, name, first, second) => {
  const c = colOf(grid, 0, name);
  grid[row][c] = first;
  grid[row + 1][c] = second;
};

// --- Pretend edits (made-up people are named "Test ...") ---
let r = rowOfBand(ONE, 1);
setPair(ONE, r, 'Complete?', 'Yes', '');
setPair(ONE, r, 'Drum', 'Test Drummer', '@test_drummer');

r = rowOfBand(ONE, 12); // an empty slot gets filled in
setPair(ONE, r, 'Song Title', 'テストの歌', 'Test Song');
setPair(ONE, r, 'Original Artist', 'テストバンド', 'Test Band');
setPair(ONE, r, 'Point of Contact', 'Test Person', '@test_person');
setPair(ONE, r, 'Guitar 1 (Lead)', 'Test Person', '@test_person');
setPair(ONE, r, 'Bass', 'Test Bassist', '@test_bassist');

r = rowOfBand(ONE, 9); // a band is cleared
['Song Title', 'Original Artist', 'Point of Contact'].forEach((h) => setPair(ONE, r, h, '', ''));

r = rowOfBand(TWO, 3);
setPair(TWO, r, 'Guitar 1 (Lead)', 'Test Guitarist', '@test_guitarist');

const pfHeader = PF.findIndex((row) => g.normaliseHeader(row[0]) === 's/n');
const instruments = colOf(PF, pfHeader, 'Instrument(s) (skill/confidence level)');
PF[pfHeader + 5][instruments] = PF[pfHeader + 5][instruments] + '\nTriangle (2)';
const newRow = new Array(PF[pfHeader].length).fill('');
newRow[0] = 'Test';
newRow[1] = 'Test Player';
newRow[2] = '@test_player';
newRow[3] = 'likes testing things';
newRow[4] = 'Bass (3)\nVox (5)';
PF.push(newRow);

// An unclear cell (two people in one cell) to exercise the LLM path.
r = rowOfBand(TWO, 4);
setPair(TWO, r, 'Drum', 'Test Ana / Test Ben (drums song 1, cajon song 2)', '@test_ana @test_ben');

// --- LLM wiring for the preview ---
const useLlm = process.argv.includes('--llm');
let rewrite = null;
if (useLlm) {
  rewrite = g.createLlmRewriter({
    config: {
      baseUrl: process.env.SOCLAAS_BASE_URL,
      apiKey: process.env.SOCLAAS_API_KEY,
      model: process.env.SOCLAAS_MODEL
    },
    // Synchronous HTTP (like Apps Script's UrlFetchApp) via a child Node process.
    http: (url, options) => {
      const script = `
        let input = ''; process.stdin.on('data', (d) => (input += d)).on('end', async () => {
          const { url, options } = JSON.parse(input);
          const res = await fetch(url, { method: 'POST', headers: { ...options.headers, 'Content-Type': options.contentType }, body: options.payload });
          process.stdout.write(JSON.stringify({ status: res.status, body: await res.text() }));
        });`;
      return JSON.parse(execFileSync(process.execPath, ['-e', script], { input: JSON.stringify({ url, options }) }).toString());
    },
    sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    log: (m) => console.error('[llm] ' + m)
  });
}

// --- Run the watcher logic exactly as a real run would ---
const baseline = g.detectChanges(null, before);
const result = g.detectChanges(JSON.parse(JSON.stringify(baseline.snapshot)), after);
const all = g.buildNotifications(result.bandChanges, result.playerChanges, rewrite);
const mine = g.notificationsFor(all, g.resolveAlerts(null));

const raw = process.argv.includes('--raw');
const strikeThrough = (s) => [...s].map((ch) => ch + '̶').join('');
const show = (m) => (raw ? m : m
  .replace(/<blockquote( expandable)?>([\s\S]*?)<\/blockquote>/g, (_, x, t) => t.split('\n').map((l) => '┃ ' + l).join('\n'))
  .replace(/<s>([\s\S]*?)<\/s>/g, (_, t) => strikeThrough(t))
  .replace(/<\/?(b|i)>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

mine.forEach((n, i) => {
  console.log(`----- Message ${i + 1} (${n.change.type}${n.llmWritten ? ', written by LLM' : ''}) -----`);
  console.log(show(n.text));
  console.log();
});
