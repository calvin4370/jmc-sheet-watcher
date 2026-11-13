/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-13-player-finder-names',
  notes: [
    'Player Finder messages now show the name and Telegram handle together on one line, ' +
      'e.g. "Name: Oli (@oli)", in New Player, Update and Removed messages. Both are still shown ' +
      'exactly as written in the sheet.',
    'If someone changes their name or handle, that line shows the old version struck out and ' +
      'the new one in bold.',
    'New: whenever the bot is updated, it tells you here what changed.'
  ]
};
