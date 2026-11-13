/*
 * Message for: someone's Player Finder entry disappears.
 * Lists the entry as it was last seen, exactly as written. No LLM.
 *
 * [Player Finder: Removed]
 *
 * Name: …
 * Telegram Handle: …
 * …
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.player_removed = {
  render: function (change) {
    return tplSections([
      '<b>[Player Finder: Removed]</b>',
      tplPlayerFields(change.player, null)
    ]);
  }
};
