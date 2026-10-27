'use strict';
// Settings and per-account sign-in tokens. Tokens are encrypted with Windows DPAPI
// (Electron safeStorage) so they are readable only by this Windows user.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const COLORS = ['#2a5bd7', '#d9480f', '#2b8a3e', '#ae3ec9', '#c2255c', '#0b7285', '#e67700', '#5c7cfa'];

const file = () => path.join(app.getPath('userData'), 'settings.json');
const tokenFile = (id) => path.join(app.getPath('userData'), 'tokens', id + '.bin');

const defaults = () => ({
  accounts: [], // {id, email, name, color, needsAuth}
  active: null,
  theme: 'dark', // dark | light | system
  darkEmails: true,
  notify: true,
  primaryOnly: true,
  startup: true,
  undoSeconds: 5,
  importantAlerts: true, // only alert for emails For You would show
  calHidden: {}, // accountId -> [calendarIds you unticked]
  calView: 'week',
  alwaysImages: false,
  trustedSenders: [],
  bounds: null,
  trayHintShown: false,
  scheduled: [], // schedule send: {acct, draftId, sendAt, threadId, to, subject, tries, nextTry, error, failed}
  snoozed: [], // {acct, threadId, until}
  backFromSnooze: {}, // accountId -> {threadId: returnedAt}; pinned to the top of the Inbox until opened
  snoozeLabel: {}, // accountId -> Gmail label id of "Snoozed"
  lastVersion: null, // shows "Updated to …" once after an update
  clientOverride: null, // {client_id, client_secret} if the user loads a different key
});

let data = null;
let timer = null;

function load() {
  try { data = Object.assign(defaults(), JSON.parse(fs.readFileSync(file(), 'utf8'))); }
  catch (_) { data = defaults(); }
  if (!data.accounts.find((a) => a.id === data.active)) data.active = data.accounts[0] ? data.accounts[0].id : null;
  return data;
}
function get() { return data || load(); }
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(timer);
  try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(data, null, 2)); } catch (_) {}
}
function nextColor() {
  const used = new Set(get().accounts.map((a) => a.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[get().accounts.length % COLORS.length];
}

function writeToken(id, obj) {
  const json = JSON.stringify(obj);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from('PLAIN:' + json, 'utf8');
  fs.mkdirSync(path.dirname(tokenFile(id)), { recursive: true });
  fs.writeFileSync(tokenFile(id), buf);
}
function readToken(id) {
  try {
    const buf = fs.readFileSync(tokenFile(id));
    const head = buf.subarray(0, 6).toString('utf8');
    const json = head === 'PLAIN:' ? buf.subarray(6).toString('utf8') : safeStorage.decryptString(buf);
    return JSON.parse(json);
  } catch (_) { return null; }
}
function deleteToken(id) { try { fs.rmSync(tokenFile(id), { force: true }); } catch (_) {} }

module.exports = { load, get, save, flush, nextColor, writeToken, readToken, deleteToken };
