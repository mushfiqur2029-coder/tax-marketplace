/**
 * Sterling Ledger contact form -> Google Sheet appender.
 *
 * Receives JSON POSTs from the static marketing site's /contact page,
 * validates minimally, appends a row to the sheet.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1g8RPppUXU5bnViufhxwCDR66Wux6ERiMs_xugNySOds/edit
 *
 * ----------------------------------------------------------------------
 * DEPLOY INSTRUCTIONS (do this once in your Google account)
 * ----------------------------------------------------------------------
 *
 * 1. Open the sheet above in a browser.
 * 2. Extensions -> Apps Script.
 * 3. Delete whatever starter code is in the editor (usually a stub
 *    `function myFunction() {}`).
 * 4. Paste this ENTIRE file into the editor.
 * 5. Save (Ctrl+S / Cmd+S). Name the project
 *    "Sterling Ledger contact form". Enter a project name if asked.
 * 6. (Optional but recommended) Change the SHARED_SECRET constant
 *    below to a long random string. Memo that string somewhere, the
 *    frontend will send it as a header, so this script can reject
 *    random POSTs from bots. Leave it empty to accept any POST (less
 *    safe; use rate-limiting at the frontend only).
 * 7. Click "Deploy" (top right) -> "New deployment".
 * 8. Click the gear icon next to "Select type" -> choose "Web app".
 * 9. Fill in:
 *       Description:  Sterling Ledger contact form (v1)
 *       Execute as:   Me (your-email@gmail.com)
 *       Who has access: Anyone
 * 10. Click Deploy.
 * 11. First deployment asks for authorization. Click "Authorize access"
 *     and go through the Google OAuth consent screen with the account
 *     that owns the sheet. Grant "See, edit, create and delete all your
 *     Google Sheets spreadsheets" scope.
 * 12. After deploy, copy the "Web app URL" shown. It looks like:
 *       https://script.google.com/macros/s/XXXXXXX..../exec
 * 13. Send that URL back to Claude. The contact page's form will POST
 *     JSON to it.
 *
 * To update the script later:
 *   Deploy -> Manage deployments -> edit the existing one. The URL
 *   stays the same across edits.
 *
 * To test from the terminal:
 *   curl -X POST \
 *     -H "Content-Type: application/json" \
 *     -H "X-Shared-Secret: <your-secret>" \
 *     -d '{"name":"Test User","phone":"07700900000","email":"test@example.com","message":"hello"}' \
 *     <your-web-app-url>
 *   Expect: {"ok":true}
 *
 * ----------------------------------------------------------------------
 */

// Fill this in. If left as empty string, the script accepts any POST.
// Must match the X-Shared-Secret header the frontend sends.
var SHARED_SECRET = "";

// Sheet ID from the sheet URL (the long part between /d/ and /edit).
var SHEET_ID = "1g8RPppUXU5bnViufhxwCDR66Wux6ERiMs_xugNySOds";

// Which tab to append rows to. If your sheet has only one tab, leave
// as empty string, the script uses the first/active sheet.
var TAB_NAME = "";

function doPost(e) {
  try {
    // Validate shared secret if configured.
    if (SHARED_SECRET) {
      var incoming =
        (e.parameter && e.parameter.secret) ||
        getHeader_(e, "x-shared-secret") ||
        getHeader_(e, "X-Shared-Secret");
      if (incoming !== SHARED_SECRET) {
        return jsonResponse_({ ok: false, error: "unauthorized" }, 401);
      }
    }

    // Parse body. Supports application/json and application/x-www-form-urlencoded.
    var body = {};
    if (e.postData && e.postData.type === "application/json") {
      body = JSON.parse(e.postData.contents || "{}");
    } else if (e.parameter) {
      body = e.parameter;
    }

    var name = String(body.name || "").trim();
    var phone = String(body.phone || "").trim();
    var email = String(body.email || "").trim();
    var message = String(body.message || "").trim();

    // Minimum validation: at least one of name/email/phone, plus a
    // non-empty message. Rejects obvious empty POSTs from scanners.
    if (!message) {
      return jsonResponse_({ ok: false, error: "message required" }, 400);
    }
    if (!name && !email && !phone) {
      return jsonResponse_({ ok: false, error: "name/email/phone required" }, 400);
    }
    if (message.length > 5000) {
      return jsonResponse_({ ok: false, error: "message too long" }, 400);
    }

    // Append to the sheet.
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = TAB_NAME ? ss.getSheetByName(TAB_NAME) : ss.getSheets()[0];
    if (!sheet) {
      return jsonResponse_({ ok: false, error: "sheet tab not found" }, 500);
    }

    // Ensure header row exists on first call.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Name", "Phone", "Email", "Message", "User-Agent", "IP"]);
    }

    var ua = getHeader_(e, "user-agent") || "";
    // IP is not forwarded reliably to Apps Script; leave blank unless
    // you've got a proxy that sets x-forwarded-for.
    var ip = getHeader_(e, "x-forwarded-for") || "";

    sheet.appendRow([
      new Date(),
      name,
      phone,
      email,
      message,
      ua,
      ip,
    ]);

    return jsonResponse_({ ok: true }, 200);
  } catch (err) {
    // Apps Script surfaces errors to the Cloud Logging dashboard; also
    // return a generic message so the frontend can show a friendly
    // "something went wrong, email us instead" fallback.
    return jsonResponse_({ ok: false, error: "server error" }, 500);
  }
}

// doGet lets you hit the Web App URL in a browser and see a tiny
// status page, useful for confirming the deploy worked. Does NOT
// accept form submissions via GET.
function doGet() {
  return ContentService
    .createTextOutput(
      "Sterling Ledger contact-form endpoint is live. POST JSON to this URL."
    )
    .setMimeType(ContentService.MimeType.TEXT);
}

// ---------- helpers ----------

function jsonResponse_(obj, status) {
  // Apps Script Web Apps don't let you set the HTTP status code
  // directly, any non-exception response is 200. We still return
  // the status in the body so the frontend can read it.
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getHeader_(e, name) {
  // Apps Script doesn't give direct header access on `e`, but some
  // headers come through on e.parameter when the frontend duplicates
  // them in the body. This helper is a stub, if you deploy behind
  // a reverse proxy that writes headers into the body, update here.
  if (e && e.parameter && e.parameter[name]) return e.parameter[name];
  return "";
}
