# Guitar Sheet Watcher

Guitar Sheet Watcher monitors a live Google Sheets workbook used for JMM/JMC band signups and produces validated Telegram notifications. Change detection, message templates, the SOC LaaS (LLM) integration and the Telegram bot are implemented and tested offline. It has not been deployed: see "Deploying to Apps Script".

## Scope and safety

The two signup worksheets are normalised into one combined band inventory:

- `Signup Sheet (one-song bands)`
- `Signup Sheet (two-song bands)`

Each band retains its band type, source worksheet and rows, songs, members, substitutions, point of contact, completion status, and other-instrument assignments. Each signup is represented by its paired rows: the primary/original-language row and the following alternate-language/Telegram row are one logical band.

`Player Finder` is monitored as a separate inventory and produces separate alerts. Exact member display names and `@Telegram` handles are preserved from the sheet.

Google Sheets access is strictly read-only. The future adapter must use read-only API access and the `spreadsheets.readonly` scope where applicable; it must never write cells, formulas, tabs, or formatting. Snapshots and state live outside the workbook.

See [PROJECT_SPEC.md](PROJECT_SPEC.md) for the complete requirements, safety contract, development sequence, and unresolved design questions.
## Proposed architecture

```text
Scheduler
    -> read-only Google Sheets adapter
    -> worksheet/schema validation
    -> canonical normalisation
    -> deterministic diff engine
    -> structured change record
    -> NUS-provided LLM API for wording only
    -> output validation
    -> Telegram notification
```

The deterministic code decides what changed, and each change gets one message from its template. The LLM (SOC LaaS) is used only when a band message contains a cell the code can't read reliably (marked "⚠ unclear cell"): it rewrites that message from the template and the band's raw cells, and the result is checked. Clear template lines must be kept exactly, new lines may only use words and handles from the cells, and no one may be dropped. If the check fails or the LLM is unavailable, the template's message is sent. LLM-written messages end with "(Written by SOC LaaS API)". Player Finder never uses the LLM.

The runtime will also need retries with exponential backoff, logging, notification deduplication, external snapshot/state storage, a silent first-run baseline, and failure when expected worksheets or headers are missing.

## Development workflow

The environment is VS Code with local Git. The initial deployment target is a standalone Google Apps Script project, with `clasp` used if appropriate.

Development should stay offline and fixture-driven until the core behavior is tested:

1. Agree the worksheet headers and canonical data model.
2. Test schema validation and paired-row normalisation against local fixtures.
3. Test deterministic snapshots, diffs, change records, deduplication, and baseline behavior.
4. Test output validation and fallback messages without an LLM or Telegram connection.
5. Add the read-only Sheets adapter and verify its OAuth scope and no-write behavior.
6. Add NUS wording behind a test boundary.
7. Add Telegram delivery and dry-run coverage.
8. Review secrets handling, state storage, permissions, deployment, and rollback before any live connection.

No secrets, API keys, live workbook access, NUS credentials, or Telegram credentials are needed for this stage. The local `fixtures/` directory is offline test data only.

## Current repository state

- Implemented and tested offline: worksheet/header validation, paired-row parsing, Player Finder parsing, snapshots, the deterministic diff engine, the settings file, per-subscriber alert switches, one message template per change type, cell checks (open slots, missing @, unclear cells), and the SOC LaaS rewrite for unclear cells with output validation, retries and fallback.
- Implemented and tested offline: read-only Sheets API adapter, Telegram bot (owner-approved subscribers, `/settings` buttons, `/subscribers`), alert delivery with deduplication and retry, problem/recovery messages to the owner, state storage in Script Properties, the Telegram webhook (instant bot replies) and the 5-minute sheet timer.
- Not yet done: deployment to Apps Script (needs your Google account and bot token).
- Local fixture: `fixtures/JMM 27 signups.xlsx` (ignored by Git).

## Running the tests

Requires Node.js 22+. No packages to install.

```sh
npm test
```

To also test against the real workbook locally (the export stays in the Git-ignored `fixtures/` folder):

```sh
python tools/export_fixture.py "fixtures/JMM 27 signups.xlsx" fixtures/grids.json
npm test
```

## Previewing messages

`npm run preview` prints the messages you would receive, one per change. It uses the local workbook export plus a few pretend edits made in memory.

- `npm run preview -- --raw` shows the exact Telegram formatting codes.
- `npm run preview -- --llm` also calls SOC LaaS for messages with unclear cells. This sends those bands' cells (real names and handles) to SOC LaaS. It reads `soclaas.env` in the project folder (Git ignores all `*.env` files; never commit it):

  ```
  SOCLAAS_BASE_URL=https://.../v1
  SOCLAAS_API_KEY=...
  SOCLAAS_MODEL=...
  ```

## Deploying to Apps Script

Nothing here touches the sheet except reading it, with the `spreadsheets.readonly` scope.

1. **Create the bot**: in Telegram, message `@BotFather`, send `/newbot`, and keep the token private.
2. **Create the Apps Script project** (needs Node.js):
   ```sh
   npm install -g @google/clasp
   clasp login
   clasp create --type standalone --title "JMC Sheet Watcher" --rootDir src
   clasp push
   ```
   `.clasp.json` (your project link) is Git-ignored.
3. **Set Script Properties** in the Apps Script editor (Project Settings → Script Properties):
   - `TELEGRAM_BOT_TOKEN`: from BotFather
   - `WATCHED_SPREADSHEET_URL`: the sheet's link, e.g. `https://docs.google.com/spreadsheets/d/…/edit`
   - `SOCLAAS_BASE_URL`, `SOCLAAS_API_KEY`, `SOCLAAS_MODEL`: same values as `soclaas.env` (optional; without them, template messages are sent)
4. **Deploy the web app** (Telegram delivers bot messages to it instantly): `clasp create-deployment --description "Telegram webhook"`, then put the deployment ID in `SETTINGS.webhook.deploymentId` and `clasp push`.
5. **Start it**: in the editor, run `setup` and approve the permissions. It checks the sheet every 5 minutes and registers the webhook. `webhookStatus` shows whether Telegram can reach the bot.
6. **Make yourself the owner**: send `/myid` to your bot, put the number in a Script Property `TELEGRAM_OWNER_CHAT_ID`, then send `/start`.
7. The first sheet check saves a baseline silently. Alerts start with the next change.

Other people subscribe by sending `/start` to the bot; you get an Approve/Reject message. Useful editor functions: `webhookStatus`, `checkSheetNow`, `resetBaseline`, `stopWatcher` (stops the timer and the webhook).

**Updating the live watcher:** after an approved change, write the release notes in `src/config/release.js`, then `clasp push` and `clasp redeploy <deploymentId>`. The bot tells the owner what changed on its next run. The bot's address stays the same, and subscribers, settings and history are kept.

## Code layout

`src/` files are plain global functions so the same code runs in Google Apps Script and in Node tests. Every file is in a folder except `appsscript.json`, which Apps Script requires at the top.

- `config/settings.js`: **the settings file you edit**: sheet timer, webhook deployment, LLM settings, default alerts.
- `config/schema.js`: expected worksheet names and headers.
- `config/release.js`: release notes. After each update the bot sends the owner a [Bot Updated] message with them, once. Give it a new `id` and new notes for every deploy.
- `messagetemplates/`: **one file per kind of message** (new band, band update, band removed, other change, player added/updated/removed). Each has a `render` function for the layout. Headers are always bold. `_format.js` holds shared helpers such as role names ("Lead Guitar") and strike/bold formatting.
- `sheet/`: reading the sheet. `sheetsApi.js` (Google Sheets API, GET only, read-only scope), `parseSignups.js` / `parsePlayerFinder.js` (rows into band and player records), `cellChecks.js` (clear, open slot or unclear cell).
- `changes/`: `diff.js` decides what changed between two snapshots; `detectChanges.js` validates, parses, then baselines or diffs.
- `app/actions.js`: the actions that change something (favourites, watched bands, alert switches, subscribers, /aboutme), shared by the commands and SoC LaaS's tools. `shared/jsonSchema.js` checks tool arguments against their schemas.
- `notify/`: `notifications.js` makes one message per change from its template; `alerts.js` applies a subscriber's alert switches; `favourites.js` handles favourite players and the ⭐ messages; `watch.js` handles watched bands and the 👀 messages; `myBands.js` finds each subscriber's own bands by their Telegram @handle (🎸 messages, `/me`); `stats.js` works out `/stats`.
- `llm/`: `llm.js` (SoC LaaS calls with retries, rewrites of unclear-cell and [Other Change] messages, and their checks); `assistant.js` (plain messages from the owner and subscribers answered as [SoC LaaS Response]; SoC LaaS looks up only what it needs with tools; subscribers have a daily limit); `aboutMe.js` (the owner's /aboutme note); `actionTools.js` (SoC LaaS runs commands with strict-schema tools, each change confirmed with ✅ Yes first).
- `telegram/`: `telegram.js` (Bot API client; the token never appears in errors); `bot.js` (commands and buttons: `/start` with owner approval, `/settings`, `/stop`, `/myid`, `/subscribers`, favourites, watched bands, Close buttons); `status.js` (`/status`, the 9am daily report, and the SoC LaaS request count).
- `app/`: `main.js` (Apps Script entry points: `setup`, `doPost` webhook, `tick` sheet timer, `webhookStatus`, `checkSheetNow`, `resetBaseline`, `stopWatcher`); `watcher.js` (each bot message once, sheet checks, alerts once per subscriber); `state.js` (snapshot, subscribers, sent-message IDs and conversation memory in Script Properties).
- `shared/util.js`: small helpers used everywhere.
- `appsscript.json`: Apps Script manifest. Scopes: read-only spreadsheets, external requests, triggers. Web app for the Telegram webhook.
