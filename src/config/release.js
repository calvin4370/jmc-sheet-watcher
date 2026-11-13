/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-tidy-tool-messages',
  notes: [
    'Tidier SoC LaaS chats: the "Thinking…" and "Called tool: …" messages are now deleted once the answer ' +
      'is sent. [Confirm] messages stay until you tap Yes or Cancel.'
  ]
};
