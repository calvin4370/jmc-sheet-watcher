const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook, clone } = require('./helpers/grids');

const band = (extra = {}) => ({
  number: 3,
  cells: {
    'Song Title': ['夜の歌', 'Night Song'],
    'Original Artist': ['夜バンド', 'Night Band'],
    'Complete?': ['No', ''],
    'Point of Contact': ['Kim', '@kim'],
    'Guitar 1 (Lead)': ['Kim', '@kim'],
    'Drum': ['Lee', '@lee '],
    ...extra
  }
});

function run(before, after) {
  const first = g.detectChanges(null, workbook(before));
  return clone(g.detectChanges(clone(first.snapshot), workbook(after)));
}
const messagesFor = (result, rewrite) =>
  g.buildNotifications(result.bandChanges, result.playerChanges, rewrite);

test('every change type has a template with render()', () => {
  for (const type of ['band_added', 'band_changed', 'band_removed', 'player_added', 'player_changed', 'player_removed']) {
    const t = g.MESSAGE_TEMPLATES[type];
    assert.ok(t, 'missing template for ' + type);
    assert.equal(typeof t.render, 'function');
  }
});

test('every message starts with a bold [Header]', () => {
  const p = { sn: 1, name: 'Oli', handle: '@oli', instruments: 'Drums (3)' };
  const ns = [
    ...messagesFor(run({}, { oneSong: [band()], players: [p] })),
    ...messagesFor(run({ oneSong: [band()], players: [p] }, { oneSong: [band({ 'Complete?': ['Yes', ''] })], players: [{ ...p, instruments: 'x' }] })),
    ...messagesFor(run({ oneSong: [band()], players: [p] }, {}))
  ];
  assert.deepEqual(ns.map((n) => n.change.type).sort(),
    ['band_added', 'band_changed', 'band_removed', 'player_added', 'player_changed', 'player_removed']);
  for (const n of ns) assert.match(n.text, /^<b>\[[^\]]+\]<\/b>(\n|$)/, n.change.type);
});

test('new band message', () => {
  const [n] = messagesFor(run({}, { oneSong: [band()] }));
  assert.equal(n.text, [
    '<b>[New Band]</b>',
    '- One-song band #3 · 夜の歌 / Night Song',
    '',
    'Song: 夜バンド / Night Band — 夜の歌 / Night Song',
    'POC: Kim (@kim)',
    'Complete: No',
    '',
    'Lead Guitar: Kim (@kim)',
    'Drums: Lee (@lee)'
  ].join('\n'));
  assert.equal(n.inventory, 'bands');
  assert.equal(n.parseMode, 'HTML');
});

test('band update shows the whole band with changes struck out and bolded', () => {
  const result = run(
    { twoSong: [{ number: 2, cells: { 'Song 1 Title': ['A', ''], 'Song 2 Title': ['B', ''], 'Complete?': ['No', ''], 'Point-of-Contact': ['Kim', '@kim'], 'Bass': ['Kim', '@kim'], 'Drum': ['Lee', '@lee'] }, other: [['Max (Sax)', '@max']] }] },
    { twoSong: [{ number: 2, cells: { 'Song 1 Title': ['A', ''], 'Song 2 Title': ['B2', ''], 'Complete?': ['Yes', ''], 'Point-of-Contact': ['Kim', '@kim'], 'Bass': ['Kim', '@kim'], 'Drum': ['Ray', '@ray'], 'Keyboard': ['Quinn', '@quinn'], 'Player Subbing In 1': ['Tia', '@tia'] }, other: [['Nia (Violin)', '@nia']] }] }
  );
  const [n] = messagesFor(result);
  assert.equal(n.text, [
    '<b>[Band Update]</b>',
    '- Two-song band #2 · A',
    '',
    'Song 1: A',
    'Song 2: <s>B</s> → <b>B2</b>',
    'POC: Kim (@kim)',
    'Complete: <s>No</s> → <b>Yes</b>',
    '',
    'Keyboard: <b>Quinn (@quinn)</b> (new)',
    'Bass: Kim (@kim)',
    'Drums: <s>Lee (@lee)</s> → <b>Ray (@ray)</b>',
    'Sub In 1: <b>Tia (@tia)</b> (new)',
    'Other: <b>Nia (Violin) (@nia)</b> (new)',
    'Other: <s>Max (Sax) (@max)</s> (removed)'
  ].join('\n'));
});

test('a member leaving is struck out', () => {
  const [n] = messagesFor(run({ oneSong: [band()] }, { oneSong: [band({ 'Drum': ['', ''] })] }));
  assert.match(n.text, /\nDrums: <s>Lee \(@lee\)<\/s> \(removed\)$/);
});

test('one message per change, band messages before Player Finder', () => {
  const players = (instruments) => [{ sn: 1, name: 'Oli', handle: '@oli', instruments }];
  const result = run(
    { oneSong: [band(), { number: 4 }], players: players('Drums (3)') },
    { oneSong: [band({ 'Complete?': ['Yes', ''] }), { number: 4, cells: { 'Song Title': ['New', ''] } }], players: players('Drums (4)') }
  );
  const ns = messagesFor(result);
  assert.deepEqual(ns.map((n) => [n.inventory, n.change.type]), [
    ['bands', 'band_changed'], ['bands', 'band_added'], ['playerFinder', 'player_changed']
  ]);
  assert.equal(ns[2].text,
    '<b>[Player Finder: Update]</b>\n\nName: Oli (@oli)\nInstruments: <s>Drums (3)</s> → <b>Drums (4)</b>');
});

test('player messages list every field exactly as written, name and handle on one line, with no LLM', () => {
  const p = { sn: 1, name: 'Oli ', handle: ' @oli', instruments: 'Drums (3)\n  Bass (1)', intro: 'hi  there', note: '' };
  const body = '\n\nName: Oli  ( @oli)\nInstruments:\nDrums (3)\n  Bass (1)\nIntro: hi  there';

  const [added] = messagesFor(run({ players: [] }, { players: [p] }), () => 'should not be used');
  assert.equal(added.text, '<b>[Player Finder: New Player]</b>' + body);
  assert.equal(added.llmWritten, false);

  const [removed] = messagesFor(run({ players: [p] }, { players: [] }));
  assert.equal(removed.text, '<b>[Player Finder: Removed]</b>' + body);

  const [noHandle] = messagesFor(run({ players: [{ sn: 2, name: 'Pat' }] }, { players: [] }));
  assert.equal(noHandle.text, '<b>[Player Finder: Removed]</b>\n\nName: Pat');
  const [noName] = messagesFor(run({ players: [] }, { players: [{ sn: 3, handle: '@quinn' }] }));
  assert.equal(noName.text, '<b>[Player Finder: New Player]</b>\n\nName: @quinn');

  const long = 'x'.repeat(500);
  const [edited] = messagesFor(run({ players: [p] }, { players: [{ ...p, intro: long }] }));
  assert.ok(edited.text.includes('\nName: Oli  ( @oli)\n'));
  assert.ok(edited.text.endsWith('Intro: <s>hi  there</s> → <b>' + long + '</b>'));
});

test('a changed name is shown as old → new on the Name line', () => {
  const before = { sn: 1, name: 'Oli', handle: '@oli', instruments: 'Drums (3)' };
  const [n] = messagesFor(run({ players: [before] }, { players: [{ ...before, name: 'Oliver' }] }));
  assert.equal(n.text, '<b>[Player Finder: Update]</b>\n\nName: <s>Oli (@oli)</s> → <b>Oliver (@oli)</b>\nInstruments: Drums (3)');
});

test('cell checks: open slots, missing @, unclear cells', () => {
  const [n] = messagesFor(run({}, { oneSong: [{
    number: 3,
    cells: {
      'Song Title': ['A', ''],
      'Bass': ['Zed', 'zed_no_at'],
      'Drum': ['Amy / Bo (drums song 1)', '@amy_x @bo_y'],
      'Keyboard': ['Cy', '']
    },
    other: [['(trumpet)', '']]
  }] }));
  assert.match(n.text, /\nKeyboard: Cy <i>\(⚠ no handle\)<\/i>/);
  assert.match(n.text, /\nBass: Zed \(zed_no_at\) <i>\(⚠ handle has no @\)<\/i>/);
  assert.match(n.text, /\nDrums: Amy \/ Bo \(drums song 1\) \(@amy_x @bo_y\) <i>\(⚠ unclear cell\)<\/i>/);
  assert.match(n.text, /\nOther: \(trumpet\) <i>\(open slot, looking for trumpet\)<\/i>$/);
});

test('the LLM is only asked about messages with a new or changed unclear cell', () => {
  const unclear = { 'Drum': ['Amy / Bo', '@amy_x @bo_y'] };
  const calls = [];
  const rewrite = (change, text, cells) => { calls.push(cells); return ''; };

  messagesFor(run({}, { oneSong: [band()] }), rewrite);                         // clear new band
  assert.equal(calls.length, 0);
  messagesFor(run({}, { oneSong: [band(unclear)] }), rewrite);                  // unclear new band
  assert.deepEqual(calls.pop(), [{ column: 'Drum', name: 'Amy / Bo', handle: '@amy_x @bo_y' }]);
  messagesFor(run({ oneSong: [band(unclear)] }, { oneSong: [band({ ...unclear, 'Complete?': ['Yes', ''] })] }), rewrite);
  assert.equal(calls.length, 0);                                                // unclear cell unchanged
  messagesFor(run({ oneSong: [band(unclear)] }, {}), rewrite);                  // removed band
  assert.equal(calls.length, 0);
});

test('an LLM-written message gets the footer; a failed one falls back to the template', () => {
  const unclear = { 'Drum': ['Amy / Bo', '@amy_x @bo_y'] };
  const result = run({}, { oneSong: [band(unclear)] });
  const [template] = messagesFor(result);
  const [written] = messagesFor(result, () => 'LLM MESSAGE');
  assert.equal(written.text, 'LLM MESSAGE\n(Written by SOC LaaS API)');
  assert.equal(written.llmWritten, true);
  const [fallback] = messagesFor(result, () => '');
  assert.equal(fallback.text, template.text);
  assert.equal(fallback.llmWritten, false);
});

test('sheet text is HTML-escaped', () => {
  const [n] = messagesFor(run({}, { oneSong: [band({ 'Bass': ['<3 Ana & co', '@Ana_B4ss'] })] }));
  assert.match(n.text, /Bass: &lt;3 Ana &amp; co \(@Ana_B4ss\)/);
});

test('subscribers only get the messages their switches allow', () => {
  const result = run({ oneSong: [band()] }, { oneSong: [band({ 'Complete?': ['Yes', ''] })] });
  const ns = messagesFor(result);
  assert.equal(g.notificationsFor(ns, g.resolveAlerts(null)).length, 1);
  assert.equal(g.notificationsFor(ns, g.resolveAlerts({ completion: false })).length, 0);
  assert.equal(g.notificationsFor(ns, g.resolveAlerts({ bands: false })).length, 0);
});

test('saved switches missing a newer setting fall back to the default', () => {
  const alerts = g.resolveAlerts({ songs: false, notARealSwitch: false });
  assert.equal(alerts.songs, false);
  assert.equal(alerts.members, true);
  assert.equal('notARealSwitch' in alerts, false);
});

test('band messages show the description after POC, cut to 100 characters', () => {
  const long = 'x'.repeat(120);
  const withDesc = (d) => band({ 'Description / Points to Take Note': [d, ''] });
  const [added] = messagesFor(run({}, { oneSong: [withDesc('looking for\nkeys & vox')] }));
  assert.match(added.text, /\nPOC: Kim \(@kim\)\nDescription: looking for \/ keys &amp; vox\nComplete: No\n/);

  const result = run({ oneSong: [withDesc(long)] }, { oneSong: [{ ...withDesc(long), cells: { ...withDesc(long).cells, 'Complete?': ['Yes', ''] } }] });
  const [update] = messagesFor(result);
  assert.match(update.text, new RegExp('\nDescription: ' + 'x'.repeat(100) + '\.\.\.\nComplete: '));

  const [removed] = messagesFor(run({ oneSong: [withDesc('hi')] }, {}));
  assert.match(removed.text, /\nDescription: hi\nComplete: No/);

  const [none] = messagesFor(run({}, { oneSong: [band()] }));
  assert.doesNotMatch(none.text, /Description/);
});
