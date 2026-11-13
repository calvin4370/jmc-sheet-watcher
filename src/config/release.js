/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-watch-status',
  notes: [
    'SoC LaaS can now update your /aboutme note itself when you tell it something about yourself or ask ' +
      'it to remember something. You\'ll see "Called tool: update_about_me (…)" when it does.',
    'New: /status shows the last sheet check, any problem, subscribers, the sheet size and SoC LaaS use today.',
    'Subscribers can now ask SoC LaaS questions too: 20 a day each (reset at midnight), with their own ' +
      'memory of their last 5 questions. Your note, alerts and the update_about_me tool stay yours only.',
    'New for everyone: /watch one-song 3 gets every update for that band, even if that alert type is off, ' +
      'each followed by a 👀 reply. /unwatch one-song 3 and /watching (with remove buttons) manage the list.'
  ]
};
