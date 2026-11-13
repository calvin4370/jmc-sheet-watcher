# Guitar Sheet Watcher

Guitar Sheet Watcher monitors a live Google Sheets workbook used for JMM/JMC band signups and produces validated Telegram notifications. Change detection, message templates and the SOC LaaS (LLM) integration are implemented and tested. Nothing connects to the live workbook or Telegram yet.

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
- Not yet implemented: the live Sheets adapter, state storage, Telegram bot (delivery, `/settings` buttons, subscriber approval), scheduling, deduplication.
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

## Code layout

`src/` files are plain global functions so the same code runs in Google Apps Script and in Node tests.

- `settings.js`: **the settings file you edit**: owner settings, LLM settings, default alerts.
- `messagetemplates/`: **one file per kind of message** (new band, band update, band removed, player added/updated/removed). Each has a `render` function for the layout. Headers are always bold. `_format.js` holds shared helpers such as role names ("Lead Guitar") and strike/bold formatting.
- `schema.js`: expected worksheet names and headers.
- `parseSignups.js` / `parsePlayerFinder.js`: turn sheet rows into band and player records.
- `diff.js`: decides what changed between two snapshots.
- `detectChanges.js`: entry point: validate, parse, then baseline or diff.
- `notifications.js`: one message per change, using its template.
- `cellChecks.js`: decides whether a person cell is clear, an open slot, or unclear.
- `llm.js`: SOC LaaS rewrite of messages with unclear cells: prompt, API call with retries, and validation.
- `alerts.js`: applies a subscriber's alert switches.
