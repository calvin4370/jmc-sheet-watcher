/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-14-close-buttons',
  notes: [
    'New: a ✖ Close button on /favourites, /settings, /help, /myid and /subscribers. It deletes ' +
      'the bot\'s reply and your command, to keep the chat tidy.',
    'Notices like this one ([Bot Updated], [Watcher Problem], [Watcher Recovered]) now have a ' +
      '✖ Dismiss button that deletes the notice.',
    'Telegram only lets bots delete messages from the last 48 hours, so Close and Dismiss ' +
      'don\'t work on older messages. Lists and menus sent before this update have no Close button.',
    'SoC LaaS no longer replies with just "I don\'t know". It says what it checked and what it ' +
      'needs, e.g. your name or @handle when you ask about "me".'
  ]
};
