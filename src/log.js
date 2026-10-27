'use strict';
// Small diagnostic log in the app's data folder (never contains tokens or email bodies).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const file = () => path.join(app.getPath('userData'), 'gmail-desk.log');
function log(...parts) {
  try {
    const line = new Date().toISOString() + ' ' + parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') + '\n';
    const f = file();
    try { if (fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, f + '.old'); } catch (_) {}
    fs.appendFileSync(f, line);
  } catch (_) {}
}
module.exports = { log, file };
