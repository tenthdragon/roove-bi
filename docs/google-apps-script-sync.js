/**
 * Google Apps Script — Auto-sync Ads tab to Roove BI
 *
 * Setup:
 * 1. Buka Google Sheet → Extensions → Apps Script
 * 2. Paste seluruh kode ini
 * 3. Klik Save
 * 4. Jalankan setupTrigger() sekali (Run → setupTrigger) untuk memasang trigger otomatis
 * 5. Approve permissions saat diminta
 *
 * Cara kerja:
 * - Setiap kali ada edit di tab "Ads", script menunggu 30 detik (debounce)
 *   lalu memanggil /api/sync di Roove BI
 * - Jika edit di tab lain, tidak terjadi apa-apa
 */

// ── Configuration ──
var CONFIG = {
  SYNC_URL: "https://roove-bi.vercel.app/api/sync",
  CRON_SECRET: "roove-sync-2026-xyz",
  ADS_TAB_NAME: "Ads",
  DEBOUNCE_SECONDS: 30,
};

/**
 * Trigger: dipanggil setiap kali ada edit di spreadsheet.
 */
function onEdit(e) {
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.ADS_TAB_NAME) return;

  // Debounce: hapus trigger pending sebelumnya, buat yang baru
  clearPendingTriggers_();
  ScriptApp.newTrigger("doSync")
    .timeBased()
    .after(CONFIG.DEBOUNCE_SECONDS * 1000)
    .create();
}

/**
 * Menjalankan sync ke Roove BI.
 */
function doSync() {
  clearPendingTriggers_();

  try {
    var options = {
      method: "post",
      headers: {
        Authorization: "Bearer " + CONFIG.CRON_SECRET,
        "Content-Type": "application/json",
      },
      muteHttpExceptions: true,
    };

    var response = UrlFetchApp.fetch(CONFIG.SYNC_URL, options);
    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code === 200) {
      Logger.log("Sync OK: " + body);
    } else {
      Logger.log("Sync failed (" + code + "): " + body);
    }
  } catch (err) {
    Logger.log("Sync error: " + err.message);
  }
}

/**
 * Hapus semua trigger "doSync" yang pending (untuk debounce).
 */
function clearPendingTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "doSync") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Jalankan sekali untuk memasang onEdit trigger.
 * (Karena simple onEdit tidak bisa melakukan UrlFetch,
 *  kita perlu installable trigger.)
 */
function setupTrigger() {
  // Hapus trigger lama
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "onEdit") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Pasang installable onEdit trigger
  ScriptApp.newTrigger("onEdit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  Logger.log("Trigger installed! Edit di tab Ads akan otomatis sync ke Roove BI.");
}

/**
 * Test manual — jalankan dari Apps Script editor untuk test koneksi.
 */
function testSync() {
  doSync();
  Logger.log("Check Logs (View → Logs) untuk hasilnya.");
}
