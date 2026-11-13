/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-13-expandable-boxes',
  notes: [
    'Long text now sits in expandable boxes that show the first few lines with a "show more" toggle: ' +
      'Instruments, Intro and Note to POC in Player Finder messages, the band Description, and the ' +
      'changed values in [Other Change] messages.',
    'Band messages now show the full Description (no longer cut at 100 characters). It stays compact ' +
      'because the box is collapsed until you tap it.',
    'When boxed text changes, the box shows the old text struck out, an arrow, then the new text in bold.'
  ]
};
