/**
 * Google Apps Script Web App endpoint for appending monthly benchmark rows.
 *
 * Expected POST JSON body:
 * {
 *   "secret": "...",
 *   "sheet_name": "Sheet1",
 *   "run_month": "2026-02",
 *   "run_id": "uuid",
 *   "headers": ["col1", "col2", ...],
 *   "rows": [["v1", "v2", ...], ...]
 * }
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({
        status: "error",
        rows_appended: 0,
        message: "Missing request body",
      });
    }

    var body = JSON.parse(e.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty("WEBAPP_SECRET");
    if (!expectedSecret) {
      return json_({
        status: "error",
        rows_appended: 0,
        message: "WEBAPP_SECRET not configured in Script Properties",
      });
    }
    if (String(body.secret || "") !== String(expectedSecret)) {
      return json_({
        status: "error",
        rows_appended: 0,
        message: "Invalid secret",
      });
    }

    var sheetName = String(body.sheet_name || "Sheet1");
    var runMonth = String(body.run_month || "").trim();
    var runId = String(body.run_id || "").trim();
    var headers = body.headers;
    var rows = body.rows;

    if (!runMonth || !runId) {
      return json_({
        status: "error",
        rows_appended: 0,
        message: "run_month and run_id are required",
      });
    }
    if (!Array.isArray(headers) || headers.length === 0) {
      return json_({
        status: "error",
        rows_appended: 0,
        message: "headers must be a non-empty array",
      });
    }
    if (!Array.isArray(rows)) {
      return json_({
        status: "error",
        rows_appended: 0,
        message: "rows must be an array",
      });
    }

    for (var i = 0; i < rows.length; i += 1) {
      if (!Array.isArray(rows[i]) || rows[i].length !== headers.length) {
        return json_({
          status: "error",
          rows_appended: 0,
          message: "Each row must be an array matching headers length",
        });
      }
    }

    var monthIndex = headers.indexOf("run_month");
    var runIdIndex = headers.indexOf("run_id");
    if (monthIndex === -1 || runIdIndex === -1) {
      return json_({
        status: "error",
        rows_appended: 0,
        message: "headers must include run_month and run_id",
      });
    }

    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    var lastRow = sheet.getLastRow();
    if (lastRow === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      lastRow = 1;
    } else {
      var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        .map(function (value) { return String(value); });

      if (!sameHeaders_(currentHeaders, headers)) {
        return json_({
          status: "error",
          rows_appended: 0,
          message: "Header mismatch between sheet and payload",
        });
      }
    }

    // Append-only behavior:
    // - Always allow new monthly runs (no run_month dedupe).
    // - Keep run_id dedupe to prevent accidental duplicate pushes
    //   of the exact same generated dataset.
    if (sheet.getLastRow() > 1) {
      var existingCount = sheet.getLastRow() - 1;
      var existingRunIds = sheet
        .getRange(2, runIdIndex + 1, existingCount, 1)
        .getValues()
        .map(function (row) { return String(row[0]); });
      if (existingRunIds.indexOf(runId) !== -1) {
        return json_({
          status: "skipped_duplicate",
          rows_appended: 0,
          message: "run_id already present: " + runId,
        });
      }
    }

    if (rows.length > 0) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
        .setValues(rows);
    }

    return json_({
      status: "appended",
      rows_appended: rows.length,
      message: "Rows appended to sheet " + sheetName,
    });
  } catch (err) {
    return json_({
      status: "error",
      rows_appended: 0,
      message: String(err),
    });
  }
}

function sameHeaders_(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (var i = 0; i < left.length; i += 1) {
    if (String(left[i]) !== String(right[i])) {
      return false;
    }
  }
  return true;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
