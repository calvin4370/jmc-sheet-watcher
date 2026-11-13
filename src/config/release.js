/*
 * Release notes. After the live bot is updated, it sends the owner a [Bot Updated]
 * message with these notes, once (on its next run: within 5 minutes, or straight
 * away if the owner messages the bot).
 *
 * For every deploy: give RELEASE a new id and describe what changed in plain words.
 */
var RELEASE = {
  id: '2026-11-15-llm-commands',
  notes: [
    'SoC LaaS can now run the bot\'s commands for you: e.g. "add @oli to my favourites", "watch one-song band 3", ' +
      '"turn off song alerts", "approve Bo", "what are my favourites?". Subscribers can use it for their own commands.',
    'Anything that changes something first sends a [Confirm] message with ✅ Yes / ❌ Cancel. Nothing changes ' +
      'until you tap ✅ Yes. Confirmations work once and expire after 24 hours. Lookups run straight away.',
    'This includes your /aboutme note: SoC LaaS now asks before saving, and the confirmation shows the new note.'
  ]
};
