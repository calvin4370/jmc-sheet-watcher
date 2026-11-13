/*
 * ============================================================================
 *  WATCHER SETTINGS
 *  Edit this file to change how the watcher behaves, then push it to Apps Script.
 *  Message layouts live in src/messagetemplates/ (one file per kind of change).
 * ============================================================================
 */

var SETTINGS = {
  // ---------------------------------------------------------------------------
  // Owner-only settings. These apply to everyone.
  // ---------------------------------------------------------------------------

  // How often to check the sheet, in minutes: 1, 5, 10, 15 or 30 (Apps Script's
  // timer options). Bot messages don't wait for this: they're handled instantly.
  // After changing it, run setup() again.
  checkEveryMinutes: 5,

  // Telegram webhook: the deployed web app Telegram sends bot messages to.
  // deploymentId is filled in when the web app is first deployed; it stays the same
  // across updates.
  webhook: {
    deploymentId: 'AKfycbwwGeWl8f2hWxX-VqqwF3oNiN-OkavqRNyPrXedVQUwqzdZqtS2Icj5IEfjqQEew2cL'
  },

  // Who may subscribe. 'owner-approval': people press Start, you approve them.
  subscriptions: 'owner-approval',

  // ---------------------------------------------------------------------------
  // SOC LaaS (LLM). Used ONLY for band messages with a cell the code can't read
  // reliably (marked "⚠ unclear cell"). The LLM rewrites that whole message from
  // the template and the band's raw cells; its message is checked, and if it fails
  // the template's message is sent instead. Player Finder never uses the LLM.
  // The URL, API key and model are NOT kept here: they come from SOCLAAS_BASE_URL,
  // SOCLAAS_API_KEY and SOCLAAS_MODEL (soclaas.env locally, Script Properties in
  // Apps Script).
  // ---------------------------------------------------------------------------
  llm: {
    enabled: true,
    footer: '(Written by SOC LaaS API)', // last line of every LLM-written message
    maxCallsPerRun: 25,        // after this many calls in one run, use template messages
    maxToolRounds: 6,          // [SoC LaaS Response]: most tool-calling rounds per question
    subscriberDailyQuestions: 20, // SoC LaaS questions per subscriber per day (the owner has no limit)
    retries: 3,                // attempts per call, with exponential backoff
    retryBaseDelayMs: 1000     // 1s, 2s, 4s…
  },

  // ---------------------------------------------------------------------------
  // Default alerts for a new subscriber. true = send, false = don't send.
  // Each subscriber can change their own copy with /settings in the bot.
  // ---------------------------------------------------------------------------
  defaultAlerts: {
    // Band signups (both signup sheets)
    bands: true,               // master switch for all band alerts below
    bandAdded: true,           // a new band appears
    bandRemoved: true,         // a band is cleared/removed
    members: true,             // someone joins, leaves or swaps a role
    substitutions: true,       // subbing in/out changes (two-song bands)
    otherInstruments: true,    // "Other Insts" players added/removed
    songs: true,               // song title or artist edited
    pointOfContact: true,      // point of contact changed
    completion: true,          // "Complete?" changed
    otherChanges: true,        // [Other Change]: e.g. Description or YouTube link edited

    // Player Finder
    playerFinder: true,        // master switch for all Player Finder alerts below
    playerAdded: true,         // someone adds themselves
    playerRemoved: true,       // someone's entry disappears
    playerEdited: true         // someone edits their entry
  }
};
