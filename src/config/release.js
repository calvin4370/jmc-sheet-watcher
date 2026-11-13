/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-mybands-stats-daily',
  notes: [
    'New: My bands. Everyone gets every update for bands their own Telegram @handle is in (even with that ' +
      'alert type off), followed by a 🎸 reply. /me lists your bands and roles. Turn it off with the ' +
      '"🎸 My bands" switch in /settings.',
    'New: /stats shows how many bands there are, how many are complete, the most-needed roles and the ' +
      'Player Finder count. SoC LaaS can use it too.',
    'New: a daily report every morning between 9 and 10am: ✅/⚠ for the sheet timer, last check, Telegram ' +
      'connection, storage use and problems, plus the stats. The first one comes tomorrow.'
  ]
};
