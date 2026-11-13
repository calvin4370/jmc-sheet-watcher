/*
 * Turns a signup worksheet (a 2D array of display strings) into band records.
 * One band = one pair of rows. Names, handles and titles are kept exactly as typed.
 */

/** Returns { name, handle } from a column of a row pair, or null if both are blank. */
function personAt(grid, primaryRow, col) {
  var name = cellText(grid, primaryRow, col);
  var handle = cellText(grid, primaryRow + 1, col);
  if (isBlank(name) && isBlank(handle)) return null;
  return { name: name, handle: handle };
}

function bilingualAt(grid, primaryRow, col) {
  return {
    primary: cellText(grid, primaryRow, col),
    alternate: cellText(grid, primaryRow + 1, col)
  };
}

/**
 * Parses one signup sheet.
 * Returns { bands: [...], warnings: [...] }. Throws a SchemaError if headers are missing
 * or the paired-row layout has shifted.
 */
function parseSignupSheet(grid, schema) {
  var sheet = schema.sheetName;
  var header = findHeaderRow(grid, sheet, signupRequiredHeaders(schema));
  var col = function (name) { return header.columns[normaliseHeader(name)]; };

  // "Other Insts" has one header but spills into the blank-headed columns to its right.
  var otherCols = [];
  var width = gridWidth(grid);
  for (var c = col(schema.otherInstruments); c < width; c++) {
    if (otherCols.length > 0 && !isBlank(cellText(grid, header.row, c))) break;
    otherCols.push(c);
  }

  var songCols = schema.songs.map(function (s) {
    return { title: col(s.title), artist: col(s.artist) };
  });
  var roleCols = schema.roles.map(function (r) { return { role: r, col: col(r) }; });
  var subCols = schema.substitutions.map(function (s) {
    return { slot: s.slot, direction: s.direction, col: col(s.header) };
  });

  // Columns that make a slot count as a real band. Number, Complete? and Points don't.
  var contentCols = [col(schema.pointOfContact)];
  songCols.forEach(function (s) { contentCols.push(s.title, s.artist); });
  roleCols.forEach(function (r) { contentCols.push(r.col); });
  subCols.forEach(function (s) { contentCols.push(s.col); });
  contentCols = contentCols.concat(otherCols);

  var warnings = [];
  var warn = function (row, message) {
    warnings.push({ sheet: sheet, row: row + 1, message: message });
  };

  // Find the first real pair: skip example pairs ("E.g." in column A) and blank rows.
  var anchor = -1;
  for (var r = header.row + 1; r < grid.length; r++) {
    var marker = cellText(grid, r, BAND_NUMBER_COLUMN);
    if (isExampleMarker(marker)) { r++; continue; }
    if (!isBlank(marker)) { anchor = r; break; }
    if (rowHasContent(grid, r, contentCols)) {
      warn(r, 'Row has content but comes before the first numbered band; ignored.');
    }
  }

  var bands = [];
  var seenIds = {};
  if (anchor < 0) return { bands: bands, warnings: warnings };

  for (var p = anchor; p < grid.length; p += 2) {
    var secondRowNumber = cellText(grid, p + 1, BAND_NUMBER_COLUMN);
    if (!isBlank(secondRowNumber)) {
      throw schemaError(
        'Sheet "' + sheet + '" row ' + (p + 2) + ': found band number "' + secondRowNumber.trim() +
          '" on the second row of a pair. The paired-row layout has shifted ' +
          '(was a single row inserted or deleted?).'
      );
    }
    if (!rowHasContent(grid, p, contentCols) && !rowHasContent(grid, p + 1, contentCols)) {
      continue; // empty reserved slot
    }

    var number = cellText(grid, p, BAND_NUMBER_COLUMN).trim();
    var id = number !== '' ? schema.bandType + '#' + number : schema.bandType + '@row' + (p + 1);
    if (number === '') warn(p, 'Band has no number in column A; tracked by its row instead.');
    if (seenIds[id]) {
      warn(p, 'Duplicate band number "' + number + '"; tracked by its row instead.');
      id = id + '@row' + (p + 1);
    }
    seenIds[id] = true;

    var members = [];
    roleCols.forEach(function (rc) {
      var person = personAt(grid, p, rc.col);
      if (person) members.push({ role: rc.role, name: person.name, handle: person.handle });
    });

    var substitutions = [];
    subCols.forEach(function (sc) {
      var person = personAt(grid, p, sc.col);
      if (person) {
        substitutions.push({
          slot: sc.slot, direction: sc.direction, name: person.name, handle: person.handle
        });
      }
    });

    var otherInstruments = [];
    otherCols.forEach(function (oc) {
      var person = personAt(grid, p, oc);
      if (person) {
        otherInstruments.push({ column: columnLetter(oc), name: person.name, handle: person.handle });
      }
    });

    // Raw cells for this band, header row through both rows, columns A to the last
    // used column. Given to the LLM when a message has an unclear cell.
    var lastCol = 0;
    [header.row, p, p + 1].forEach(function (row) {
      for (var cc = width - 1; cc > lastCol; cc--) {
        if (!isBlank(cellText(grid, row, cc))) { lastCol = cc; break; }
      }
    });
    var rowCells = function (row) {
      var cells = [];
      for (var cc = 0; cc <= lastCol; cc++) cells.push(cellText(grid, row, cc));
      return cells;
    };
    var block = {
      range: 'A' + (p + 1) + ':' + columnLetter(lastCol) + (p + 2),
      header: rowCells(header.row),
      rows: [rowCells(p), rowCells(p + 1)]
    };

    bands.push({
      id: id,
      bandType: schema.bandType,
      sourceSheet: sheet,
      sourceRows: [p + 1, p + 2],
      number: number,
      songs: songCols.map(function (s) {
        return { title: bilingualAt(grid, p, s.title), artist: bilingualAt(grid, p, s.artist) };
      }),
      completion: cellText(grid, p, col(schema.completion)),
      pointOfContact: personAt(grid, p, col(schema.pointOfContact)),
      members: members,
      substitutions: substitutions,
      otherInstruments: otherInstruments,
      block: block
    });
  }

  return { bands: bands, warnings: warnings };
}
