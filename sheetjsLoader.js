// ============================================================================
// SheetJS (Excel export) - loaded ONLY when the user asks for an Excel file.
// ----------------------------------------------------------------------------
// It used to be a <script> in index.html, which ran third-party code on every
// page for every user (including the login screen). Now nothing is requested
// until the export button is pressed.
//
// HARDENING (manual, see the Phase 7A report): SheetJS 0.20.x is not published
// on npm, so it cannot be self-hosted from a normal install. To remove the CDN
// completely, download the file below into the project (e.g. vendor/xlsx.full.min.js)
// and point SHEETJS_SRC at it. To keep the CDN, set SHEETJS_INTEGRITY to the
// file's SRI hash:
//   openssl dgst -sha384 -binary xlsx.full.min.js | openssl base64 -A
//   -> "sha384-<that value>"
// ============================================================================

export const SHEETJS_SRC =
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

export const SHEETJS_INTEGRITY = "";

let pending = null;

export function loadSheetJs({
  doc = globalThis.document,
  win = globalThis.window,
  src = SHEETJS_SRC,
  integrity = SHEETJS_INTEGRITY
} = {}) {
  if (win?.XLSX) {
    return Promise.resolve(win.XLSX);
  }

  // A second click while the first is loading shares the same request.
  if (pending) {
    return pending;
  }

  pending = new Promise((resolve, reject) => {
    const script = doc.createElement("script");

    script.src = src;
    script.async = true;

    if (integrity) {
      script.integrity = integrity;
      script.crossOrigin = "anonymous";
    }

    script.onload = () => {
      if (win?.XLSX) {
        resolve(win.XLSX);
      } else {
        pending = null;
        script.remove();
        reject(new Error("The Excel library loaded but is not usable."));
      }
    };

    script.onerror = () => {
      pending = null;
      script.remove();
      reject(new Error("Could not load the Excel library. Check your connection."));
    };

    doc.head.appendChild(script);
  });

  return pending;
}

// For tests only.
export function resetSheetJsLoader() {
  pending = null;
}
