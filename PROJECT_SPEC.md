# Guitar Sheet Watcher — Project Specification

## Status

Development steps 1–3 below (data model, paired-row parsing, deterministic diff) are implemented and tested offline. No live Google Sheets, LLM, or Telegram integration exists yet.

## Purpose

Monitor a live Google Sheets workbook used for JMM/JMC band signups and produce reliable, separate notifications for band-inventory changes and Player Finder changes.

## Functional requirements

### Worksheets

The system must monitor all three worksheets:

1. `Signup Sheet (one-song bands)` — one-song bands.
2. `Signup Sheet (two-song bands)` — two-song bands.
3. `Player Finder` — players looking for band opportunities.

The first two worksheets are one combined band inventory. `Player Finder` remains a separate inventory and must produce alerts separate from band changes.

### Canonical band records

Each band record in the combined inventory must retain:

- `bandType`: exactly `one-song` or `two-song`.
- Source sheet.
- Source rows.
- Songs.
- Members.
- Substitutions.
- Point of contact.
- Completion status.
- Other-instrument assignments.

The representation must retain enough source metadata to trace a canonical record back to its worksheet and source rows.

### Paired signup rows

The first two signup worksheets use paired rows:

- The first row contains primary/original-language fields and display names.
- The following row contains alternate-language fields and Telegram handles.

The two rows represent one logical band. They must be parsed and normalised as one band, never as two independent bands.

### Exact display information

Member display information must be preserved exactly as supplied by the sheet, especially names and `@Telegram` handles. The system must not invent, normalise away, or silently alter handles.

### Read-only Google Sheets access

The system is strictly read-only with respect to Google Sheets:

- Never write to the workbook.
- Never add formulas.
- Never add tabs.
- Never modify formatting.
- Never update cells.
- Use the Google Sheets API with read-only access.
- Use the `spreadsheets.readonly` OAuth scope where applicable.

Snapshots and runtime state must be stored outside the Google Sheet.

## Runtime architecture

The target pipeline is:

```text
scheduler
  -> read-only Google Sheets adapter
  -> worksheet/schema validation
  -> canonical normalisation
  -> deterministic diff engine
  -> structured change record
  -> NUS-provided LLM API for wording only
  -> output validation
  -> Telegram notification
```

### Responsibilities and boundaries

- **Scheduler:** invokes polling runs at a configured cadence and prevents overlapping runs.
- **Read-only Google Sheets adapter:** reads the three expected worksheets using read-only permissions and returns source values plus enough metadata for row tracing.
- **Worksheet/schema validation:** fails the run when an expected worksheet or required header is missing; validates paired-row assumptions before normalisation.
- **Canonical normalisation:** converts verified sheet values into stable band and Player Finder records while preserving exact source display strings and row references.
- **Deterministic diff engine:** compares the current canonical snapshot with the prior external snapshot and decides what was added, removed, or changed. The LLM is not involved in this decision.
- **Structured change record:** contains only verified changes, categorised so band alerts and Player Finder alerts remain separate.
- **NUS LLM API (SOC LaaS):** a standard OpenAI-compatible chat API. Used only for band messages containing an unclear cell; see Decisions.
- **Output validation:** rejects wording that reports a change not present in the diff, changes exact names or handles, or invents people, songs, bands, or changes.
- **Telegram notification:** sends validated wording, with deduplication preventing repeated delivery of the same change record.

## Reliability requirements

The implementation must provide:

- Retries with exponential backoff for transient external failures.
- Useful structured logging without secrets or sensitive credentials.
- Notification deduplication based on a stable change identity.
- Snapshot/state storage outside Google Sheets.
- Silent first-run baseline mode: establish the initial snapshot without sending change notifications.
- Hard failure when an expected worksheet or required header is missing.
- Deterministic fallback notification text when the NUS LLM fails, times out, or produces invalid output.

## LLM safety contract

The LLM never decides what changed. As decided by the owner, it may read the raw cells of one band (header row and the band's two rows, plus the previous version) to rewrite a message containing an unclear cell.

Before notification, output validation must prove that:

- Every reported change exists in the structured diff.
- Exact member names and Telegram handles are preserved.
- No new people, songs, bands, or changes are introduced.
- Invalid or unavailable LLM output is replaced by the deterministic fallback message.

## Development workflow

The workflow is VS Code with a local Git repository. The initial production shape is a standalone Google Apps Script project, using `clasp` if appropriate.

### Development rules

- Never access, modify, or send requests to the live Google Sheet unless the owner explicitly authorises it.
- Do not add application logic until implementation is explicitly requested.
- The `fixtures/` directory is offline test data only. It is Git-ignored, along with all `*.env` files (e.g. `soclaas.env`); keep it that way.
- Prefer small, deterministic, testable units and fixture-driven tests.
- Before any external integration, document the required scopes, environment variables, state store, retry policy, and dry-run procedure.

Development should proceed in this order:

1. Define and test the canonical data model and schema rules against offline fixtures.
2. Implement paired-row parsing and exact display-value preservation.
3. Implement deterministic snapshot comparison and structured change records.
4. Add output validation and deterministic fallback wording.
5. Test retry, logging, deduplication, baseline, and schema-failure behavior locally.
6. Add the read-only Sheets adapter and verify the OAuth scope and no-write boundary.
7. Add NUS wording integration behind a safe test boundary.
8. Add Telegram delivery and end-to-end dry-run tests.
9. Deploy only after explicit review of scopes, secrets handling, state storage, and rollback procedure.

No live Google Sheet, NUS endpoint, Telegram bot, credential, or API key is required or permitted during the planning stage.

## Decisions

- **Tech stack (confirmed by owner):** JavaScript, running on Google Apps Script. Python is used only for local developer helpers (for example `tools/export_fixture.py`), never in production.
- **Configurable by the owner:** how the watcher behaves and which messages the bot sends.
- **Multiple subscribers:** the bot may serve several people. Only people the owner approves can subscribe (they press Start; the owner gets an Approve button).
- **Messages:** one Telegram message per change (never a summary of several changes). Each change type has its own template file in `src/messagetemplates/`. Band updates show the whole band, with changed values as ~~old~~ → **new**.
- **Player Finder messages:** list every field exactly as written. Never use the LLM.
- **LLM (SOC LaaS) use:** only for band messages where a new or changed person cell is unclear (several people or handles in one cell). The LLM gets the template message, the band's raw cell block and the unclear cells, and rewrites the whole message in the template's layout. Validation: every clear template line kept exactly and in order, new lines only use words/handles from the cells, every handle in the unclear cell still present, only <b>/<i>/<s> tags. On failure the template message is sent. LLM-written messages end with the line "(Written by SOC LaaS API)".
- **Deterministic cell checks:** open slots like "(trumpet)" are noted as "open slot, looking for trumpet"; missing/odd handles get a ⚠ note; handles are never corrected.
- **Message headers** such as [New Band] are always bold.
- **[Other Change]:** edits to band columns the watcher doesn't otherwise read (Description, YouTube Link, columns added later; never Points), and any change type without its own template, use `messagetemplates/otherChange.js`. The LLM writes the whole message starting with the bold [Other Change] header; it must keep the band line, use only words/handles from the cells, and quote each changed cell's new text exactly (unless over 200 characters). Otherwise a plain list of the changed cells is sent. Subscribers can switch these off ("Other changes").
- **Sheets access:** Google Sheets REST API, GET requests only, `spreadsheets.readonly` scope. No `SpreadsheetApp`. A test fails if write calls appear in the code.
- **Bot updates (owner decision):** Telegram webhook. The Apps Script project is deployed as a web app (execute as owner, access: anyone) so Telegram can deliver each message instantly; requests without the secret code in the URL are ignored. The secret is generated by `setup()` and kept in Script Properties. Messages arriving during a sheet check are queued and handled right after. Re-delivered updates are ignored.
- **Ask SoC LaaS (owner decisions):** plain (non-command) messages from the owner and approved subscribers are answered by SoC LaaS under a bold [SoC LaaS Response] header, as plain text. Subscribers get 20 questions a day (`SETTINGS.llm.subscriberDailyQuestions`, reset at midnight Singapore time, remaining count shown under each answer); the owner has no limit. Each person's own last 5 questions are remembered for follow-ups, but not SoC LaaS's answers (owner decision: given its old answers it repeated them instead of looking again, e.g. "You have no favourite players" after one was added), and their Telegram name and @handle are sent with their questions so "me" questions work. Owner-only extras: the last 5 alerts, the /aboutme note, and the `update_about_me` tool. The sheet is read live once per question (falling back to the last copy, with the reason, if the read fails). SoC LaaS does not get the whole sheet: it calls tools to fetch only what it needs (`list_bands`, `get_all_bands` (every band in full, in one call), `get_band`, `list_player_finder`, `get_player`, `find_person`), at most `SETTINGS.llm.maxToolRounds` rounds. Each tool call is shown to the owner as "Called tool: …" after "Thinking…"; "Thinking…" and the tool messages are deleted when the answer is sent (owner decision: keep the chat tidy). The prompt says to answer only from tool results, never to guess, and never to reply with just "I don't know": it says what it checked and what it needs.
- **/aboutme (owner decisions):** the owner's note, sent with each of their questions. `/aboutme <info>` has SoC LaaS rewrite the whole note to include it (newer info wins, so it can correct or remove things); SoC LaaS may also offer this itself with the `update_about_me` tool when the owner tells it something lasting; the confirmation shows the rewritten note. Size is counted in characters: limit 500, plus 100 overload (501–600 saved with a warning; over 600 not saved, old note kept). If SoC LaaS fails or adds an @handle not given, the info is appended as written. `/aboutme` alone shows the note with Clear and Close buttons.
- **SoC LaaS runs commands (owner decisions):** every command has a tool, offered only to people who can run that command (owner-only tools for the owner). Lookups (alert settings, favourites, watched bands, chat ID, /status, subscriber list) run straight away. Every change (set_alerts, stop_alerts, add/remove_favourite, watch/unwatch_band, manage_subscriber, update/clear_about_me) only sends a [Confirm] message with ✅ Yes / ❌ Cancel to the person asking; nothing changes until they tap ✅ Yes. Confirmations expire after 24 hours and work once. Tools use the same actions as the commands (`app/actions.js`). Structured outputs: tools are sent with strict JSON schemas (strict: true, all fields required, no extra fields, enums), and the arguments are checked against the schema in code before anything runs; bad arguments get a structured `{ok: false, error}` reply so SoC LaaS can fix them. The action is first tried on a copy of the state, so no confirmation is sent for something that would fail or change nothing; on ✅ Yes it runs on the current state.
- **Close and Dismiss buttons (owner decisions):** /favourites, /settings, /help, /myid, /subscribers, /aboutme, /watching and /status have ✖ Close, which deletes the reply and the command. [Bot Updated], [Watcher Problem] and [Watcher Recovered] have ✖ Dismiss, which deletes the notice. Telegram only allows deleting messages under 48 hours old.
- **/status (owner):** release ID, last sheet check (with a warning if late), current problem, subscriber counts, what the sheet copy holds, and SoC LaaS use today (API requests, counted in a Script Property, and subscriber questions).
- **Update notices (owner decision):** after every live update the bot sends the owner a [Bot Updated] message describing what changed (notes written by the developer in `src/config/release.js`), once, on its next run.
- **Player Finder names (owner decision):** every Player Finder message shows "Name: <name> (<handle>)" on one line, exactly as written; a change shows old → new on that line.
- **Long text in boxes (owner decision):** Instruments, Intro, Note to POC, band Description and [Other Change] values always go in a Telegram expandable quote (`<blockquote expandable>`). The band Description is shown in full. Edits inside a box show ~~old~~, →, **new** on separate lines.
- **New player in an empty slot (owner decision):** Band Update messages show "Label: 🆕 **Name (@handle)**" for roles, subs, Other instruments and a first POC; a swap shows "Label: 🔄 ~~Old~~ → **New**".
- **Changed-field markers (owner decision):** Telegram has no coloured boxes, so in Player Finder Update messages (and the Band Update Description) a changed field gets 🆕 (was empty) or 🔄 (edited or cleared) plus a bold field name; unchanged fields stay plain.
- **Favourite players (owner decisions):** every approved subscriber has their own list (/favourite Name (@handle), /unfavourite @handle, /favourites with remove buttons), matched by handle ignoring case and the @. A favourite is involved only when their own entry changes: joining, leaving or being swapped in a band (role, sub, other instrument, POC; a new or removed band counts for everyone in it) or their Player Finder entry changing. The subscriber then also gets "⭐ One of your favourite players has an update: Name (@handle)" as a reply to the update. Favourites override the subscriber's /settings switches.
- **My bands (owner decisions):** every band where a subscriber's own Telegram @handle appears (role, sub, other instrument or POC; before or after the change) is treated as watched: all its updates are sent even if that alert type is off, each followed by "🎸 You're in this band" / "🎸 You were in this band" as a reply (instead of 👀 if they also watch it). The "🎸 My bands" switch in /settings (on by default) turns it off. The handle comes from their Telegram account and is updated on every message. `/me` lists their bands, roles and Player Finder entry; SoC LaaS has `list_my_bands`.
- **/stats (owner decisions):** any approved subscriber: bands (one-song/two-song), complete vs not, most-needed roles (empty roles in bands not marked complete) and Player Finder count, worked out by the code. SoC LaaS has `get_stats`.
- **Daily report (owner decisions):** every day at 9am Singapore time (Google runs it between 9 and 10), the owner gets ✅/⚠ health checks (sheet timer, last sheet check, Telegram webhook, storage use of the 500 KB Script Properties limit with a warning at 80%, current problem) plus the stats, with a Dismiss button. No SoC LaaS calls. The 9am timer is created by setup() or, on the live bot, by the next sheet check.
- **Watched bands (owner decisions):** every approved subscriber can /watch one-song 3, /unwatch, and see /watching (remove and Close buttons). Only bands in the sheet now can be added (at most 30). Every update for a watched band is sent even if that alert type is off, followed by "👀 You're watching One-song band #3" as a reply.
- **Sheet timer (owner decision):** every 5 minutes (`SETTINGS.checkEveryMinutes`).
- **Wait for edits to settle (owner decisions):** when a check finds a change, nothing is sent yet and the timer switches to every 1 minute. Alerts go out once 3 checks in a row see the same sheet (everything the watcher reads: all band rows and columns, and Player Finder; the check that found the change counts as the first), or after 10 checks if it keeps changing. The alerts cover everything since the last alerts. Then the timer goes back to every 5 minutes. An edit undone before it settles sends nothing. (`SETTINGS.settle`; the timer is swapped with Apps Script triggers.)
- **Deploying (owner decision):** the developer deploys/redeploys from VS Code with clasp. Every push or redeploy to the live project needs the owner's explicit approval first. Updates: `clasp push` + `clasp redeploy <deploymentId>` (address unchanged).
- **State storage:** Apps Script Script Properties (chunked JSON): snapshot, subscribers, alert switches, sent-message IDs (deduplication), Telegram offset, last reported problem.
- **Delivery:** each subscriber gets each message at most once. If a send fails temporarily, the snapshot is not advanced and the next run retries (people who already got it are skipped). A subscriber who blocks the bot is marked stopped. Formatting errors are resent as plain text.
- **Owner notices:** sheet layout/read problems pause alerts and are reported to the owner once per distinct problem, with a recovery message afterwards.
- **Settings:** a settings file in the project holds owner-only settings and the default alerts for new subscribers. Each subscriber's own alert choices are stored per Telegram chat ID with the watcher's state (outside the sheet), editable through bot commands and tap-to-toggle buttons (`/settings`).
- **Band alerts trigger on:** band added or removed, song title/artist changes, members joining, leaving, or changing roles, substitutions, other-instrument assignments, point-of-contact changes, and `Complete?` changes.
- **Ignored for alerts:** the Points column (a formula that recalculates whenever any band changes). Description and YouTube link columns are not read.
- **Paired rows:** pairs start at the first numbered row after the "E.g." example rows and step by 2. A band number on a pair's second row means the layout shifted, and the run fails.
- **Band identity:** band type + the number in column A. A band with content but no number is tracked by its row, with a warning. Renumbering a band shows as removed + added.
- **Empty slots:** a numbered slot with no song, contact, or players is not a band. Filling it in counts as a new band.
- **Player identity:** the Telegram handle (case-insensitive), falling back to S/N.
- **Exact text:** names, handles, and titles are stored exactly as typed. Only leading/trailing whitespace is ignored when deciding whether something changed.
- **Delivery:** a Telegram bot sends direct messages to the owner only. Band changes and Player Finder changes arrive as separate messages in that one chat. The owner must message the bot once first, because bots cannot start conversations. The bot token and owner chat ID are secrets kept in the runtime's secret store, never in the repository.

## Unresolved design questions

These decisions must be made before implementation or external integration:

1. What exact header names and column layouts exist on each of the three worksheets?
2. How should a paired signup be identified and what should happen when the second row is missing, duplicated, or malformed?
3. What stable identity should represent a band across row movement, edits, and sheet changes?
4. What stable identity should represent a Player Finder entry?
5. Which fields are multi-valued, and what are the exact delimiters or encoding rules for songs, members, substitutions, and other instruments?
6. How should blank values, duplicate names, duplicate handles, and conflicting values across paired rows be represented?
7. What are the exact completion-status values and transition rules?
8. What source-row numbering convention should be exposed: one-based sheet rows, zero-based API indexes, or both?
9. Where should external snapshots and deduplication state live in the initial Apps Script deployment, and what retention/rollback policy is required?
10. What polling cadence, timeout limits, retry count, backoff parameters, and concurrency lock strategy are appropriate?
11. What Telegram message format, rate limits, and delivery/retry policy are required?
12. Which changes should be grouped into one notification?
13. What timezone and schedule should the watcher use for polling and notifications?
14. What logging destination, alerting path, and privacy/redaction policy are required?
15. What constitutes a safe first-run baseline and how should an operator force or recover a baseline?
16. What local test fixtures are authoritative, and may the supplied workbook fixture be committed or must it remain local-only?
17. What deployment, ownership, consent, and operational handoff process will govern the standalone Apps Script project?
