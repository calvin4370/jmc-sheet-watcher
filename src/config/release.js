/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-song-english-description-box',
  notes: [
    'Songs in /me, /watching and SoC LaaS answers now show the English row in brackets after the Japanese, ' +
      'e.g. 🎵 バックナンバー - ハッピーエンド (back number - Happy End).',
    'SoC LaaS answers show a band\'s Description in a full box, like the alerts (not collapsed).'
  ]
};
