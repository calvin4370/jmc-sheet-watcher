/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-13-favourites',
  notes: [
    'New: favourite players. Send /favourite Name (@handle) to add someone, /favourites to see your ' +
      'list (with remove buttons), and /unfavourite @handle to remove one. Every approved subscriber ' +
      'has their own list. Handles are matched ignoring capital letters.',
    'When a favourite joins, leaves or is swapped in a band, or their Player Finder entry changes, ' +
      'you also get "⭐ One of your favourite players has an update: Name (@handle)" as a reply to that update.',
    'Favourites override your /settings: you get their updates even if that alert type is switched off.'
  ]
};
