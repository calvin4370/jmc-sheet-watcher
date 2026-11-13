/*
 * Message for: someone adds themselves to Player Finder.
 * Lists every field exactly as written. No LLM.
 *
 * [Player Finder: New Player]
 *
 * Name: …
 * Telegram Handle: …
 * Instruments: …
 * Intro: …
 * Note to POC: …
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.player_added = {
  render: function (change) {
    return tplSections([
      '<b>[Player Finder: New Player]</b>',
      tplPlayerFields(null, change.player)
    ]);
  }
};
