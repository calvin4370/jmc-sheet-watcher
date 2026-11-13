/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-13-tools-and-new-player-emoji',
  notes: [
    'Questions to SoC LaaS no longer send it the whole sheet. It now looks up only what it needs ' +
      '(the band list, one band, Player Finder, one player, or where a person appears), using a ' +
      'fresh read of the sheet.',
    'While it works you will see "Called tool: …" messages after "Thinking…", one per lookup. ' +
      '"Thinking…" disappears when the answer arrives; the tool messages stay.',
    'Band Update messages mark someone filling a previously empty slot with 🆕, e.g. ' +
      '"Bass: 🆕 Name (@handle)" (roles, subs, Other instruments and a first POC).',
    'Swaps are marked with 🔄, e.g. "Drums: 🔄 Old (@old) → New (@new)" (old struck out, new in bold).'
  ]
};
