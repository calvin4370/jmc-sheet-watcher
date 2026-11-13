/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-14-aboutme',
  notes: [
    'SoC LaaS now knows your Telegram name and @handle, so questions like "am I in any band?" work.',
    'New: /aboutme. Send /aboutme followed by anything about you (e.g. /aboutme I play bass) and ' +
      'SoC LaaS rewrites your note to fit it in. Newer info wins, so you can also correct or remove ' +
      'things. The note is sent with every question you ask.',
    'Send /aboutme on its own to see your note, with Clear and Close buttons.',
    'The note is limited to 500 characters. Up to 600 is saved with a warning; a rewrite over 600 ' +
      'isn\'t saved and your old note is kept.'
  ]
};
