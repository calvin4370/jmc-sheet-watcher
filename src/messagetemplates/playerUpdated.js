/*
 * Message for: someone edits their Player Finder entry.
 * Lists every field exactly as written; changed fields are shown as ~~old~~ → **new**.
 * No LLM.
 *
 * [Player Finder: Update]
 *
 * Name: …
 * Telegram Handle: …
 * Instruments: ~~Guitar (3)~~ → **Guitar (4)**
 * Intro: …
 * Note to POC: …
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
