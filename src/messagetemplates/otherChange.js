/*
 * Message for: any change none of the other templates cover. That is:
 *  - edits to band columns the watcher doesn't read (Description, YouTube Link,
 *    columns added later; Points is always ignored), and
 *  - any future change type that has no template of its own.
 *
 * The LLM writes the whole message from the band's cells (before and after). It must
 * start with the bold [Other Change] header and may only use text from the cells.
 * If the LLM is unavailable or its message fails the checks, `render` below is sent:
 *
 * [Other Change]
 * - One-song band #N · 夜の歌 / Night Song
 *
 * Description / Points to Take Note:
 * ┃ ~~old text~~
 * ┃ →
 * ┃ **new text**
 * Youtube Link (2nd row):
 * ┃ **https://…** (new)
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.other_change = {
  // The LLM writes the whole message for this template.
  llmWritesWholeMessage: true,
  llmTask: 'Describe what changed in this band\'s cells in a short, readable message. ' +
    'Quote changed text exactly. Put each changed value in a <blockquote expandable> box, with old text ' +
    'as <s>old</s> and new text in <b>bold</b>.',

  render: function (change) {
    var heading = '<b>[Other Change]</b>' + (change.band ? '\n' + tplBandLine(change.band) : '');
    if (!change.cells) return tplSections([heading, tplEscape('Change type: ' + change.type)]);
    var lines = change.cells.map(function (c) {
      var label = (tplInline(c.header) || 'Column ' + c.column) + (c.row === 'second' ? ' (2nd row)' : '');
      return tplBoxField(label, tplBoxChange(
        isBlank(c.before) ? '' : tplExact(c.before),
        isBlank(c.after) ? '' : tplExact(c.after)
      ));
    });
    return tplSections([heading, lines.join('\n')]);
  }
};

MESSAGE_TEMPLATES.band_other_changed = MESSAGE_TEMPLATES.other_change;
