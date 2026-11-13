/*
 * Message for: someone edits their Player Finder entry.
 * Lists every field exactly as written. Changed fields get 🆕 (was empty) or 🔄 (edited
 * or cleared) and a bold label; unchanged fields stay plain. No LLM.
 *
 * [Player Finder: Update]
 *
 * Name: … (@...)
 * 🔄 **Instruments:**
 * ┃ ~~Guitar (3)~~
 * ┃ →
 * ┃ **Guitar (4)**
 * Intro:
 * ┃ … (unchanged)
 * 🆕 **Note to POC:**
 * ┃ **…**
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.player_changed = {
  render: function (change) {
    return tplSections([
      '<b>[Player Finder: Update]</b>',
      tplPlayerFields(change.previous, change.player)
    ]);
  }
};
