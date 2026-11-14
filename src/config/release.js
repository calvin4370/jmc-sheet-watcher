/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-song-lines',
  notes: [
    'Band cards in /me, /watching and SoC LaaS answers now show each song on its own 🎵 line, so you can ' +
      'tell a two-song band\'s songs apart.'
  ]
};
