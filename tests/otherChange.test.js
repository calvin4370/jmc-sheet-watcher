const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./helpers/load');
const { workbook, clone } = require('./helpers/grids');

const band = (extra = {}) => ({
  number: 2,
  cells: {
    'Song Title': ['夜の歌', 'Night Song'],
    'Complete?': ['No', ''],
    'Point of Contact': ['Kim', '@kim'],
    'Drum': ['Lee', '@lee'],
    'Description / Points to Take Note': ['looking for vox', ''],
    'Youtube Link': ['', ''],
    'Points\n(TLDR AT INFO SHEET)': ['1.5', ''],
    ...extra
  }
});
function changesFor(before, after) {
  const first = g.detectChanges(null, workbook({ oneSong: [band(before)] }));
  return clone(g.detectChanges(clone(first.snapshot), workbook({ oneSong: [band(after)] }))).bandChanges;
}
const descriptionEdit = () => changesFor({}, {
  'Description / Points to Take Note': ['found vox! still need keys & bass', ''],
  'Youtube Link': ['', 'https://youtu.be/abc']
});

test('edits to unread columns become an Other Change; Points stays ignored', () => {
  assert.deepEqual(changesFor({}, { 'Points\n(TLDR AT INFO SHEET)': ['9.9', ''] }), []);

  const [c] = descriptionEdit();
  assert.equal(c.type, 'band_other_changed');
  assert.deepEqual(c.cells, [
    { column: 'G', header: 'Description / Points to Take Note', row: 'first', before: 'looking for vox', after: 'found vox! still need keys & bass' },
    { column: 'H', header: 'Youtube Link', row: 'second', before: '', after: 'https://youtu.be/abc' }
  ]);
});

test('an edit to both a read field and an unread column gives a Band Update and an Other Change', () => {
  const changes = changesFor({}, { 'Complete?': ['Yes', ''], 'Youtube Link': ['https://x.y', ''] });
  assert.deepEqual(changes.map((c) => c.type), ['band_changed', 'band_other_changed']);
});

test('without the LLM, the plain Other Change message lists the cells exactly', () => {
  const [n] = g.buildNotifications(descriptionEdit(), []);
  assert.equal(n.text, [
    '<b>[Other Change]</b>',
    '- One-song band #2 · 夜の歌 / Night Song',
    '',
    'Description / Points to Take Note:',
    '<blockquote expandable><s>looking for vox</s>',
    '→',
    '<b>found vox! still need keys &amp; bass</b></blockquote>',
    'Youtube Link (2nd row):',
    '<blockquote expandable><b>https://youtu.be/abc</b> (new)</blockquote>'
  ].join('\n'));
  assert.equal(n.llmWritten, false);
});

test('the LLM writes the whole Other Change message, which gets the footer', () => {
  const changes = descriptionEdit();
  const good = [
    '<b>[Other Change]</b>',
    '- One-song band #2 · 夜の歌 / Night Song',
    '',
    'The description was updated: <b>found vox! still need keys &amp; bass</b>',
    'New link: https://youtu.be/abc'
  ].join('\n');
  let seen = null;
  const [n] = g.buildNotifications(changes, [], (change, text, unclear, template) => {
    seen = { change, template };
    return good;
  });
  assert.equal(seen.template, g.MESSAGE_TEMPLATES.other_change);
  assert.equal(n.text, good + '\n(Written by SOC LaaS API)');
  assert.equal(n.llmWritten, true);
});

test('Other Change checks: header, band line, invented words, exact new text', () => {
  const [change] = descriptionEdit();
  const fallback = g.MESSAGE_TEMPLATES.other_change.render(change);
  const head = '<b>[Other Change]</b>\n- One-song band #2 · 夜の歌 / Night Song\n\n';
  const body = 'Description updated: found vox! still need keys &amp; bass\nNew link: https://youtu.be/abc';
  assert.equal(g.validateOtherChange(head + body, fallback, change).ok, true);

  const bad = {
    'header not bold': head.replace('<b>[Other Change]</b>', '[Other Change]') + body,
    'band line changed': head.replace('#2', '#3') + body,
    'invented person': head + body + '\nZoe joined on drums',
    'invented handle': head + body + '\nContact @zoe_x',
    'new text not quoted exactly': head + 'Description updated: found vocals, still need keys and bass\nNew link: https://youtu.be/abc',
    'bad markup': head + '<u>' + body + '</u>'
  };
  for (const [label, out] of Object.entries(bad)) {
    assert.equal(g.validateOtherChange(out, fallback, change).ok, false, label);
  }
});

test('a change type with no template of its own uses Other Change', () => {
  const odd = { type: 'something_new', detail: 'x' };
  const [n] = g.buildNotifications([odd], []);
  assert.match(n.text, /^<b>\[Other Change\]<\/b>\n\nChange type: something_new$/);
  assert.equal(g.wantsChange(odd, g.resolveAlerts(null)), true);
  assert.equal(g.wantsChange(odd, g.resolveAlerts({ otherChanges: false })), false);
});

test('subscribers can switch Other Change messages off', () => {
  const [c] = descriptionEdit();
  assert.equal(g.wantsChange(c, g.resolveAlerts(null)), true);
  assert.equal(g.wantsChange(c, g.resolveAlerts({ otherChanges: false })), false);
});

test('LLM messages may use expandable boxes, but no other new markup', () => {
  assert.equal(g.llmMarkupProblem('<blockquote expandable><s>a</s>\n→\n<b>b</b></blockquote>'), '');
  assert.equal(g.llmMarkupProblem('<blockquote>a</blockquote>'), '');
  assert.notEqual(g.llmMarkupProblem('<blockquote expandable>a'), '');
  assert.notEqual(g.llmMarkupProblem('<b expandable>a</b>'), '');
  assert.notEqual(g.llmMarkupProblem('<blockquote>a</blockquote expandable>'), '');
  assert.notEqual(g.llmMarkupProblem('<pre>a</pre>'), '');

  const [change] = descriptionEdit();
  const fallback = g.MESSAGE_TEMPLATES.other_change.render(change);
  assert.equal(g.validateOtherChange(fallback, fallback, change).ok, true, 'the boxed plain message passes its own checks');
});
