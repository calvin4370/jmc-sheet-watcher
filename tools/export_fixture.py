"""Converts a local .xlsx export of the workbook into fixtures/grids.json.

The output mimics Apps Script's Range.getDisplayValues(): every cell is a string,
merged cells hold their value only in the top-left cell, and formulas show their
cached result. Output stays in fixtures/, which Git ignores.

Usage: python tools/export_fixture.py "fixtures/JMM 27 signups.xlsx" fixtures/grids.json
Requires: openpyxl
"""

import json
import sys

import openpyxl


def display(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def main(src, dest):
    wb = openpyxl.load_workbook(src, data_only=True)
    sheets = {}
    for ws in wb.worksheets:
        sheets[ws.title] = [[display(c.value) for c in row] for row in ws.iter_rows()]
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(sheets, f, ensure_ascii=False)
    print(f"Wrote {len(sheets)} sheets to {dest}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
