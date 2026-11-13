/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-13-changed-field-markers',
  notes: [
    'Player Finder Update messages now mark only the fields that changed: 🆕 and a bold name for a ' +
      'field that was empty before, 🔄 and a bold name for one that was edited or cleared. Unchanged ' +
      'fields stay plain.',
    'Band Update messages mark the Description the same way when it changed, showing old → new inside the box.'
  ]
};
