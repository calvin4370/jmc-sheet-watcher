// Sheets API adapter, Telegram client, and read-only safety checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const g = require('./helpers/load');

// ---- Google Sheets API (read-only) ----

function fakeSheetsHttp(titles, valuesByName) {
  const calls = [];
  const http = (url, options) => {
    calls.push({ url, options });
    if (url.includes('?fields=')) {
      return { status: 200, body: JSON.stringify({ sheets: titles.map((t) => ({ properties: { title: t } })) }) };
    }
    const names = [...url.matchAll(/ranges=([^&]+)/g)].map((m) => decodeURIComponent(m[1]).slice(1, -1).replace(/''/g, "'"));
    return { status: 200, body: JSON.stringify({ valueRanges: names.map((n) => ({ values: valuesByName[n] })) }) };
  };
  return { http, calls };
}

test('reads the three worksheets with GET requests only', () => {
  const titles = ['Info', 'Signup Sheet (one-song bands)', 'Signup Sheet (two-song bands)', 'Player Finder'];
  const f = fakeSheetsHttp(titles, {
    'Signup Sheet (one-song bands)': [['a', 1]],
    'Signup Sheet (two-song bands)': [['b']],
    'Player Finder': undefined
  });
  const sheets = g.readSheetsViaApi('SHEET_ID', f.http, 'oauth-token');
  assert.deepEqual(sheets, {
    'Signup Sheet (one-song bands)': [['a', '1']],
    'Signup Sheet (two-song bands)': [['b']],
    'Player Finder': []
  });
  for (const c of f.calls) {
    assert.equal(c.options.method, 'get');
    assert.equal(c.options.headers.Authorization, 'Bearer oauth-token');
    assert.equal(c.options.payload, undefined);
    assert.ok(c.url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/SHEET_ID'));
  }
  assert.match(f.calls[1].url, /valueRenderOption=FORMATTED_VALUE/);
  assert.doesNotMatch(f.calls[1].url, /Info/);
});

test('a missing worksheet is left out so the schema check fails loudly', () => {
  const f = fakeSheetsHttp(['Signup Sheet (one-song bands)', 'Player Finder'], {});
  const sheets = g.readSheetsViaApi('X', f.http, 't');
  assert.deepEqual(Object.keys(sheets).sort(), ['Player Finder', 'Signup Sheet (one-song bands)']);
  assert.throws(() => g.buildSnapshot(sheets), /Missing worksheet\(s\): "Signup Sheet \(two-song bands\)"/);
});

test('Sheets API errors are reported without the access token', () => {
  const http = () => ({ status: 403, body: JSON.stringify({ error: { message: 'The caller does not have permission' } }) });
  assert.throws(() => g.readSheetsViaApi('X', http, 'secret-oauth'), (e) =>
    /403: The caller does not have permission/.test(e.message) && !e.message.includes('secret-oauth'));
});

// ---- Telegram client ----

test('Telegram calls retry 429 using retry_after, and errors never include the token', () => {
  const sleeps = [];
  const responses = [
    { status: 429, body: JSON.stringify({ ok: false, parameters: { retry_after: 3 } }) },
    { status: 200, body: JSON.stringify({ ok: true, result: { message_id: 1 } }) }
  ];
  const urls = [];
  const api = g.createTelegramApi({
    token: '123:SECRET',
    http: (url) => { urls.push(url); return responses.shift(); },
    sleep: (ms) => sleeps.push(ms)
  });
  assert.deepEqual(api.call('sendMessage', { chat_id: 1, text: 'hi' }), { message_id: 1 });
  assert.deepEqual(sleeps, [3000]);
  assert.equal(urls[0], 'https://api.telegram.org/bot123:SECRET/sendMessage');

  const failing = g.createTelegramApi({
    token: '123:SECRET',
    http: (url) => { throw new Error('DNS error for ' + url); },
    sleep: () => {}
  });
  assert.throws(() => failing.call('getUpdates', {}), (e) => !e.message.includes('SECRET') && e.message.includes('<token>'));

  const forbidden = g.createTelegramApi({
    token: '123:SECRET',
    http: () => ({ status: 403, body: JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }) }),
    sleep: () => {}
  });
  assert.throws(() => forbidden.call('sendMessage', {}), (e) => e.status === 403 && /blocked/.test(e.message));
});

// ---- Read-only safety ----

const srcFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? srcFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);

test('no code can write to a spreadsheet', () => {
  const forbidden = /SpreadsheetApp|\.setValues?\(|\.setFormula|insertSheet|values:(update|append|batchUpdate|clear)|:batchUpdate|method:\s*'(put|patch|delete)'/i;
  for (const file of srcFiles(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, forbidden, path.basename(file));
  }
});

test('the Apps Script manifest only asks for read-only spreadsheet access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes.sort(), [
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ]);
  assert.equal(manifest.timeZone, 'Asia/Singapore');
  // Web app (Telegram webhook): runs as the owner; reachable by Telegram, guarded by the secret.
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
});

test('state survives a JSON round trip and old versions start fresh', () => {
  const s = g.emptyState();
  s.subscribers['7'] = g.newSubscriber('7', 'Amy', 'approved', 1);
  assert.deepEqual(g.normaliseState(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(g.normaliseState({ version: 0, subscribers: { x: 1 } }), g.emptyState());
});
