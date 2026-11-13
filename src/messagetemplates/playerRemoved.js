/*
 * Message for: someone's Player Finder entry disappears.
 * Lists the entry as it was last seen, exactly as written. No LLM.
 *
 * [Player Finder: Removed]
 *
 * Name: … (@...)
 * …
 */
var MESSAGE_TEMPLATES = MESSAGE_TEMPLATES || {};

MESSAGE_TEMPLATES.player_removed = {
  render: function (change) {
    var p = change.player;
    // "Name: <name> (<handle>)", both exactly as written.
    var nameLine = 'Name: ' + tplExact(p.name) + (isBlank(p.handle) ? '' : ' (' + tplExact(p.handle) + ')');
    var rest = tplPlayerFields(p, null, ['name', 'handle']);
    return tplSections([
      '<b>[Player Finder: Removed]</b>',
      nameLine + (rest ? '\n' + rest : '')
    ]);
  }
};
