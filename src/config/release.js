/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-band-cards',
  notes: [
    'Bands are no longer shown by number alone: /me, /watching and SoC LaaS answers show each band\'s ' +
      'songs (artist - title) and its members, one per line. /watching buttons show the first song too.',
    'SoC LaaS answers are tidier: no more working-out or repeated lists, and it doesn\'t fetch the same ' +
      'data twice for one question.'
  ]
};
