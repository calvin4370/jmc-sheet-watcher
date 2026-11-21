/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-21-no-silent-misses',
  notes: [
    'Description and YouTube Link edits now come as a normal [Band Update] (whole band, 🔄 on the changed ' +
      'field), written by the bot itself instead of SoC LaaS.',
    'Fixed: an edit that was undone and then redone wasn\'t alerted the second time. Now it always is.',
    'No more silent misses: an alert Telegram refuses is replaced by a short notice (or you\'re told), long ' +
      'alerts are split instead of cut off, crashes are reported, and you\'re told if the bot ever has to ' +
      'start from a fresh copy of the sheet ([Watcher Started]).'
  ]
};
