/*
 * Read-only Google Sheets adapter.
 *
 * Uses the Google Sheets REST API with GET requests only, authorised by the
 * spreadsheets.readonly scope (see appsscript.json). There is no code path that
 * writes to the workbook, and the scope would refuse it anyway.
 */

var SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';

/** 'Name' -> "'Name'" for A1 ranges (single quotes doubled). */
function quoteSheetName(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

function sheetsApiGet(url, http, accessToken) {
  var res = http(url, { method: 'get', headers: { Authorization: 'Bearer ' + accessToken } });
  if (res.status !== 200) {
    var detail = '';
    try { detail = JSON.parse(res.body).error.message; } catch (e) { /* ignore */ }
    throw new Error('Google Sheets API returned ' + res.status + (detail ? ': ' + detail : ''));
  }
  return JSON.parse(res.body);
}

/**
 * Reads the watched worksheets as display strings.
 * Returns { sheetName: 2D array }. Worksheets that don't exist are left out, so the
 * schema check reports them as missing.
 */
function readSheetsViaApi(spreadsheetId, http, accessToken) {
  if (!spreadsheetId) throw new Error('WATCHED_SPREADSHEET_ID is not set.');
  var base = SHEETS_API_BASE + encodeURIComponent(spreadsheetId);

  var meta = sheetsApiGet(base + '?fields=' + encodeURIComponent('sheets.properties.title'), http, accessToken);
  var existing = (meta.sheets || []).map(function (s) { return s.properties.title; });
  var names = REQUIRED_SHEETS.filter(function (n) { return existing.indexOf(n) >= 0; });
  if (!names.length) return {};

  var query = names.map(function (n) { return 'ranges=' + encodeURIComponent(quoteSheetName(n)); }).join('&') +
    '&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
  var data = sheetsApiGet(base + '/values:batchGet?' + query, http, accessToken);

  var sheets = {};
  (data.valueRanges || []).forEach(function (vr, i) {
    sheets[names[i]] = (vr.values || []).map(function (row) {
      return row.map(function (v) { return v === null || v === undefined ? '' : String(v); });
    });
  });
  return sheets;
}
