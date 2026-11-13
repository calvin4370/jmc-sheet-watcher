/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-get-all-bands',
  notes: [
    'SoC LaaS can now read every band in full in one go (get_all_bands), instead of opening bands one ' +
      'at a time, so questions across many bands are faster.'
  ]
};
