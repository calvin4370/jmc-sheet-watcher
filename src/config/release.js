/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-settle-and-memory-fix',
  notes: [
    'Alerts now wait for edits to settle. When a check finds a change, the sheet is checked every minute ' +
      'instead, and alerts go out once 3 checks in a row see the same sheet (about 2–3 minutes later). Then ' +
      'checks go back to every 5 minutes.',
    'If someone keeps editing, alerts go out after 10 checks anyway. An edit that\'s undone before it settles ' +
      'sends nothing. /status shows when it\'s waiting.',
    'Fixed: SoC LaaS could repeat an old answer (e.g. "You have no favourite players") instead of looking ' +
      'again. It now remembers only your last 5 questions, not its answers, and looks everything up each time.'
  ]
};
