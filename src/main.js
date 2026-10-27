'use strict';
// Gmail Desk 2: a Windows mail app for Gmail built on the Gmail API.

const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, shell, ipcMain, dialog, nativeTheme, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const store = require('./store');
const oauth = require('./oauth');
const mime = require('./mime');
const win32 = require('./winint');
const { Account, AuthError, displayName } = require('./gmail');
const { log, file: logFile } = require('./log');
const contacts = require('./contacts');
const cleanup = require('./cleanup');
const updater = require('./updater');
const later = require('./later');
const calendar = require('./calendar');
const priority = require('./priority');

const APP_NAME = win32.APP_NAME; // internal (keeps the saved-data folder)
const DISPLAY_NAME = win32.DISPLAY_NAME;
const IS_WIN = win32.IS_WIN;
const MOCK = !!process.env.GMAIL_DESK_MOCK;
const ASSETS = path.join(__dirname, 'assets');
const ICON_ICO = path.join(ASSETS, 'icon.ico');
const ICON_PNG = path.join(ASSETS, 'icon.png');
const POLL_MS = 60 * 1000;

app.setName(APP_NAME);
if (IS_WIN) app.setAppUserModelId(win32.AUMID);
if (MOCK) app.setPath('userData', path.join(os.tmpdir(), 'gmail-desk-mock'));
// Update testing: a throwaway profile, so the test copy never touches real sign-ins or the running app.
if (process.env.GMAIL_DESK_TEST_INSTALL_DIR) app.setPath('userData', path.join(os.tmpdir(), 'gmail-desk-update-test'));
if (process.env.GMAIL_DESK_TEST_INSTALL_DIR && process.env.GMAIL_DESK_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.GMAIL_DESK_DEBUG_PORT);

const argv = process.argv.slice(1);
const startHidden = argv.includes('--hidden');

// ---------------------------------------------------------------- single instance
if (!app.requestSingleInstanceLock()) {
  // An older copy may still be running in the tray. When this copy was opened by hand
  // (not from the installed location), end the other one and start again.
  if (IS_WIN && !win32.isInstalled() && !argv.includes('--after-kill')) {
    win32.killOthers();
    app.relaunch({ args: process.argv.slice(1).concat(['--after-kill']) });
  }
  app.exit(0);
} else {
  app.on('second-instance', (_e, args) => {
    if (args.includes('--uninstall')) { win32.uninstall(win); return; }
    showWindow();
    const mailto = args.find((a) => /^mailto:/i.test(a));
    if (mailto) send('compose-mailto', parseMailto(mailto));
  });
  app.whenReady().then(boot);
}

// ---------------------------------------------------------------- state
let win = null;
let tray = null;
let quitting = false;
const accounts = new Map(); // id -> Account
const counts = {}; // id -> unread number
const lastHistory = {}; // id -> historyId
const pending = new Map(); // undo-send id -> {timer, resolve}

function projectId() {
  const o = store.get().clientOverride;
  if (o && o.client_id) return o.project_id || '';
  try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'client.json'), 'utf8')); return (j.installed || j.web || j).project_id || ''; } catch (_) { return ''; }
}
function client() {
  const s = store.get();
  if (s.clientOverride && s.clientOverride.client_id) return s.clientOverride;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'client.json'), 'utf8'));
    const c = j.installed || j.web || j;
    return { client_id: c.client_id, client_secret: c.client_secret };
  } catch (_) { return null; }
}

function accountObj(id) {
  if (accounts.has(id)) return accounts.get(id);
  const meta = store.get().accounts.find((a) => a.id === id);
  if (!meta) throw new Error('That account is no longer in Beacon.');
  let a;
  if (MOCK) { const { MockAccount } = require('./mock'); a = new MockAccount(meta); }
  else a = new Account(meta, client);
  accounts.set(id, a);
  return a;
}

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

// ---------------------------------------------------------------- boot
async function boot() {
  store.load();
  log('start', app.getVersion(), process.platform, 'accounts=' + store.get().accounts.length);
  if (argv.includes('--uninstall')) { if (!(await win32.uninstall(null))) app.exit(0); return; }

  // Started by the updater from an unpacked new version: install it without asking.
  if (IS_WIN && app.isPackaged && !win32.isInstalled() && argv.includes('--update')) { win32.install({ args: startHidden ? ['--hidden'] : [] }); return; }
  if (IS_WIN && app.isPackaged && !win32.isInstalled() && !MOCK) {
    const choice = dialog.showMessageBoxSync({
      type: 'question', title: DISPLAY_NAME, icon: nativeImage.createFromPath(ICON_PNG),
      buttons: ['Install', 'Just run it', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
      message: 'Install Beacon ' + app.getVersion() + ' on this computer?',
      detail: 'This replaces any older Beacon (or Gmail Desk), adds it to your Start menu and desktop, lets it start with Windows, and adds it to Apps in Windows Settings so you can uninstall it later.',
    });
    if (choice === 2) { app.quit(); return; }
    if (choice === 0) { win32.install(); return; }
  }

  if (MOCK && !store.get().accounts.length) {
    store.get().accounts.push({ id: 'mock1', email: 'you@example.com', name: 'Lawrence Rank', color: '#2a5bd7' }, { id: 'mock2', email: 'second.account@gmail.com', name: 'Second', color: '#d9480f' });
    store.get().active = 'mock1';
  }
  if (win32.isInstalled()) win32.applyStartup(store.get().startup);
  applyTheme();
  createWindow();
  createTray();
  const s0 = store.get();
  if (s0.lastVersion && s0.lastVersion !== app.getVersion()) {
    const from = s0.lastVersion;
    win.webContents.once('did-finish-load', () => setTimeout(() => send('updated', { from, to: app.getVersion() }), 1500));
  }
  if (s0.lastVersion !== app.getVersion()) { s0.lastVersion = app.getVersion(); store.save(); }
  later.start({ accountObj, send, sendState, notify: (t, b) => notify(t, b, showWindow), accountIds: () => store.get().accounts.map((m) => m.id) });
  updater.start((st) => {
    send('update', fullUpdateStatus());
    refreshTray();
    if (!win || !win.isVisible()) notify('Beacon ' + st.ready.version + ' is ready', 'Click to open Beacon and restart it to update.', showWindow);
  });
  setTimeout(pollAll, 3000);
  setInterval(pollAll, POLL_MS);
  powerMonitor.on('resume', () => setTimeout(pollAll, 5000));
  const mailto = argv.find((a) => /^mailto:/i.test(a));
  if (mailto) win.webContents.once('did-finish-load', () => setTimeout(() => send('compose-mailto', parseMailto(mailto)), 800));
}

function applyTheme() {
  const t = store.get().theme;
  nativeTheme.themeSource = t === 'system' ? 'system' : t;
}

// ---------------------------------------------------------------- window
function createWindow() {
  const b = store.get().bounds || {};
  win = new BrowserWindow({
    width: b.width || 1320, height: b.height || 880, x: b.x, y: b.y, minWidth: 820, minHeight: 520,
    title: DISPLAY_NAME, icon: IS_WIN ? ICON_ICO : ICON_PNG, show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12161d' : '#f4f6f9',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true, webviewTag: false },
  });
  if (b.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  const remember = () => {
    if (!win || win.isMinimized()) return;
    const s = store.get();
    s.bounds = Object.assign({}, win.isMaximized() ? (s.bounds || {}) : win.getBounds(), { maximized: win.isMaximized() });
    store.save();
  };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((ev) => win.on(ev, remember));
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    const s = store.get();
    if (!s.trayHintShown) { s.trayHintShown = true; store.save(); notify('Beacon is still running', 'It keeps checking your mail from the tray. Right click the tray icon and choose Quit to close it fully.'); }
  });
  // Nothing inside the app window may navigate away or open windows: links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openExternal(url); } });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.on('context-menu', (_e, p) => contextMenu(p));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' }] },
  ]));
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openExternal(u) {
  try { const p = new URL(u).protocol; if (['https:', 'http:', 'mailto:', 'tel:'].includes(p)) shell.openExternal(u); } catch (_) {}
}

function contextMenu(p) {
  const wc = win.webContents;
  const items = [];
  if (p.misspelledWord) {
    p.dictionarySuggestions.slice(0, 5).forEach((s) => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
    items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
  }
  if (p.linkURL && !p.linkURL.startsWith('file:')) items.push({ label: 'Open link in browser', click: () => openExternal(p.linkURL) }, { label: 'Copy link address', click: () => require('electron').clipboard.writeText(p.linkURL) }, { type: 'separator' });
  if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'pasteAndMatchStyle', label: 'Paste as plain text' }, { role: 'selectAll' });
  else if (p.selectionText) items.push({ role: 'copy' });
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------------------------------------------------------------- tray, badges, alerts
function trayImage(total) {
  const name = total <= 0 ? 'tray-0.png' : total > 9 ? 'tray-9plus.png' : 'tray-' + total + '.png';
  return nativeImage.createFromPath(path.join(ASSETS, 'tray', name));
}
function overlayImage(total) {
  if (total <= 0) return null;
  return nativeImage.createFromPath(path.join(ASSETS, 'tray', total > 9 ? 'overlay-9plus.png' : 'overlay-' + total + '.png'));
}
function createTray() {
  tray = new Tray(trayImage(0));
  tray.setToolTip(DISPLAY_NAME);
  tray.on('click', () => { if (win.isVisible() && win.isFocused()) win.hide(); else showWindow(); });
  refreshTray();
}
function refreshTray() {
  const s = store.get();
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  if (tray) {
    tray.setImage(trayImage(total));
    tray.setToolTip(total ? DISPLAY_NAME + ': ' + total + ' unread' : DISPLAY_NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Beacon', click: showWindow },
      { label: 'New email', click: () => { showWindow(); send('compose-new'); } },
      { type: 'separator' },
      ...s.accounts.map((a) => ({ label: (a.email || 'Account') + (counts[a.id] ? '  (' + counts[a.id] + ')' : '') + (a.needsAuth ? '  (sign in again)' : ''), click: () => { showWindow(); send('switch-account', a.id); } })),
      { type: 'separator' },
      { label: 'Check mail now', click: pollAll },
      { label: 'New mail alerts', type: 'checkbox', checked: s.notify, click: (i) => setSettings({ notify: i.checked }) },
      { label: 'Start with Windows', type: 'checkbox', checked: s.startup && win32.isInstalled(), enabled: win32.isInstalled(), click: (i) => setSettings({ startup: i.checked }) },
      { type: 'separator' },
      ...(updater.status().ready ? [{ label: 'Restart to update to ' + updater.status().ready.version, click: requestUpdate }, { type: 'separator' }] : []),
      { label: 'Quit Beacon', click: quit },
    ]));
  }
  if (win && !win.isDestroyed()) {
    if (IS_WIN) win.setOverlayIcon(overlayImage(total), total ? total + ' unread' : '');
    win.setTitle(total ? DISPLAY_NAME + ' (' + total + ')' : DISPLAY_NAME);
  }
  send('counts', Object.assign({}, counts));
}

const liveNotes = new Set();
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON_PNG });
  liveNotes.add(n);
  n.on('click', () => { liveNotes.delete(n); showWindow(); if (onClick) onClick(); });
  n.on('close', () => liveNotes.delete(n));
  n.show();
  setTimeout(() => liveNotes.delete(n), 15 * 60 * 1000);
}

// ---------------------------------------------------------------- polling for new mail
let polling = false;
async function pollAll() {
  if (polling) return;
  polling = true;
  try { for (const meta of store.get().accounts) await pollOne(meta); }
  finally { polling = false; refreshTray(); }
}

async function pollOne(meta) {
  if (meta.needsAuth) return;
  const s = store.get();
  let acct;
  try { acct = accountObj(meta.id); } catch (_) { return; }
  try {
    // Unread count
    if (s.primaryOnly) {
      const r = acct.api ? await acct.api('GET', 'threads', { query: { labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], maxResults: 100 } }) : null;
      if (r) counts[meta.id] = (r.threads || []).length;
      else counts[meta.id] = (await acct.label('CATEGORY_PERSONAL')).threadsUnread || 0;
    } else {
      counts[meta.id] = (await acct.label('INBOX')).threadsUnread || 0;
    }
    contacts.build(meta.id, acct, meta.email); // no-op unless the address book is a few days old
    // New messages since last check
    if (!lastHistory[meta.id]) { lastHistory[meta.id] = (await acct.profile()).historyId; return; }
    let h;
    try { h = await acct.history(lastHistory[meta.id]); }
    catch (e) { if (e.status === 404) { lastHistory[meta.id] = (await acct.profile()).historyId; return; } throw e; }
    lastHistory[meta.id] = h.historyId || lastHistory[meta.id];
    const added = [];
    for (const rec of h.history || []) for (const ma of rec.messagesAdded || []) {
      const m = ma.message || {};
      const l = m.labelIds || [];
      if (l.includes('INBOX') && l.includes('UNREAD') && !l.includes('SENT') && !l.includes('DRAFT') && (s.importantAlerts || !s.primaryOnly || l.includes('CATEGORY_PERSONAL') || !l.some((x) => x.startsWith('CATEGORY_')))) added.push(m);
    }
    if (added.length) send('mail-changed', meta.id);
    if (!added.length || !s.notify) return;
    const alerts = [];
    for (const m of added.slice(0, 12)) {
      try {
        const full = await acct.messageMeta(m.id);
        const hd = full.payload ? full.payload.headers : [];
        const from = mime.header(hd, 'From'); const subject = mime.header(hd, 'Subject');
        const snippet = (full.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        // Only the emails For You would show, unless that setting is off.
        if (s.importantAlerts && !priority.score(meta.id, { id: m.threadId, from, subject, snippet, labelIds: full.labelIds || m.labelIds, participants: '', count: 1 }, meta.email).important) continue;
        alerts.push({ m, from, subject, snippet });
      } catch (_) {}
    }
    if (alerts.length > 3) {
      notify(alerts.length + (s.importantAlerts ? ' new important emails' : ' new emails'), meta.email, () => send('switch-account', meta.id));
      return;
    }
    for (const x of alerts) {
      notify(displayName(x.from) || 'New email', (x.subject || '(no subject)') + '\n' + x.snippet.slice(0, 120) + (store.get().accounts.length > 1 ? '\n' + meta.email : ''),
        () => send('open-thread', { accountId: meta.id, threadId: x.m.threadId }));
    }
  } catch (e) {
    if (e instanceof AuthError || e.code === 'needs_auth') { meta.needsAuth = true; store.save(); sendState(); }
  }
}

// ---------------------------------------------------------------- settings / state for the window
function publicState() {
  const s = store.get();
  return {
    accounts: s.accounts.map((a) => ({ id: a.id, email: a.email, name: a.name, color: a.color, needsAuth: !!a.needsAuth, calendar: calendarConnected(a.id) })),
    active: s.active, counts: Object.assign({}, counts),
    settings: { theme: s.theme, darkEmails: s.darkEmails, notify: s.notify, primaryOnly: s.primaryOnly, startup: s.startup && win32.isInstalled(), undoSeconds: s.undoSeconds, importantAlerts: !!s.importantAlerts, alwaysImages: s.alwaysImages, trustedSenders: s.trustedSenders, calHidden: s.calHidden || {}, calView: s.calView || 'week' },
    later: later.publicInfo(),
    installed: win32.isInstalled(), version: app.getVersion(), hasClient: !!client(), mock: MOCK, platform: process.platform, projectId: projectId(),
  };
}
function calendarConnected(id) {
  try { const a = accountObj(id); return a.hasCalendar ? a.hasCalendar() : false; } catch (_) { return false; }
}
function sendState() { send('state', publicState()); refreshTray(); }

function setSettings(patch) {
  const s = store.get();
  const allowed = ['theme', 'darkEmails', 'notify', 'importantAlerts', 'primaryOnly', 'startup', 'undoSeconds', 'alwaysImages', 'trustedSenders', 'calHidden', 'calView'];
  for (const k of allowed) if (k in patch) s[k] = patch[k];
  if ('theme' in patch) applyTheme();
  if ('startup' in patch) win32.applyStartup(s.startup);
  if ('primaryOnly' in patch) setTimeout(pollAll, 200);
  store.save();
  sendState();
}

function parseMailto(u) {
  try {
    const url = new URL(u);
    const p = url.searchParams;
    return { to: decodeURIComponent(url.pathname || ''), cc: p.get('cc') || '', bcc: p.get('bcc') || '', subject: p.get('subject') || '', body: p.get('body') || '' };
  } catch (_) { return { to: '' }; }
}

// ---------------------------------------------------------------- IPC
const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...args) => {
  if (!win || e.sender !== win.webContents) throw new Error('Not allowed');
  try { return { ok: true, value: await fn(...args) }; }
  catch (err) {
    log('ipc error', ch, String(err && err.message).slice(0, 300));
    if (err instanceof AuthError || err.code === 'needs_auth') {
      const id = args[0];
      const meta = store.get().accounts.find((a) => a.id === id);
      if (meta && !meta.needsAuth) { meta.needsAuth = true; store.save(); sendState(); }
    }
    return { ok: false, error: err.message || String(err), code: err.code || null };
  }
});

handle('state', () => publicState());
// Your own Google key (the public download ships without one).
handle('client-load', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your Google key file', properties: ['openFile'], filters: [{ name: 'Google key (JSON)', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths.length) return false;
  let j;
  try { j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (_) { throw new Error('That file could not be read as a Google key.'); }
  const c = j.installed;
  if (!c || !c.client_id || !c.client_secret) throw new Error(j.web ? 'That key is for a website. In Google Cloud, create a client with the type Desktop app and download that one.' : 'That is not a Google key file. In Google Cloud open Clients, pick your Desktop app client and click Download JSON.');
  store.get().clientOverride = { client_id: c.client_id, client_secret: c.client_secret, project_id: c.project_id || '' };
  store.save(); sendState();
  return true;
});
handle('settings', (patch) => { setSettings(patch || {}); return publicState(); });
handle('external', (url) => openExternal(url));
handle('quit', () => quit());
handle('uninstall', () => win32.uninstall(win));

// ---------------------------------------------------------------- updates
let updateFallback = null;
// Asks the window to save any open reply as a draft first; installs anyway if it does not answer.
function requestUpdate() {
  if (!win || win.isDestroyed()) { applyUpdate(); return; }
  send('update-install-request');
  clearTimeout(updateFallback);
  updateFallback = setTimeout(applyUpdate, 8000);
}
async function applyUpdate() {
  clearTimeout(updateFallback);
  updater.apply({ hidden: !win || win.isDestroyed() || !win.isVisible() });
  await quit();
}
// Newer versions posted on GitHub. Only tells you and opens the download page; it never installs on its own.
const RELEASES_API = 'https://api.github.com/repos/BeaconMailApp/beacon/releases/latest';
let online = null; // {version, url}
let onlineChecked = 0;
async function checkOnline() {
  onlineChecked = Date.now();
  try {
    const r = await fetch(RELEASES_API, { headers: { 'User-Agent': 'Beacon/' + app.getVersion(), Accept: 'application/vnd.github+json' } });
    if (!r.ok) return online;
    const j = await r.json();
    const v = String(j.tag_name || '').replace(/^v/i, '');
    online = /^\d+\.\d+\.\d+$/.test(v) && updater.newer(v, app.getVersion()) ? { version: v, url: String(j.html_url || 'https://github.com/BeaconMailApp/beacon/releases/latest') } : null;
    if (online && !/^https:\/\/github\.com\//.test(online.url)) online.url = 'https://github.com/BeaconMailApp/beacon/releases/latest';
    if (online) { log('online update available', online.version); send('update', fullUpdateStatus()); }
  } catch (e) { log('online update check failed', String(e && e.message)); }
  return online;
}
function fullUpdateStatus() {
  const st = updater.status();
  // A build already waiting on this computer wins over a download link.
  st.online = online && !(st.ready && !updater.newer(online.version, st.ready.version)) ? online : null;
  return st;
}
setTimeout(() => { checkOnline(); setInterval(checkOnline, 6 * 3600 * 1000); }, 60 * 1000);
handle('update-state', () => fullUpdateStatus());
handle('update-check', async () => { await Promise.all([updater.check(), checkOnline()]); return fullUpdateStatus(); });
handle('signin-cancel', () => { oauth.cancel(); return true; });
handle('update-install', () => applyUpdate());
handle('open-log', () => shell.showItemInFolder(logFile()));
handle('make-default', () => { win32.registerMailto(); shell.openExternal('ms-settings:defaultapps'); });

handle('account-add', async (hint) => {
  const c = client();
  if (!c && !MOCK) throw new Error('No Google login key is set up.');
  showWindow();
  let tok;
  if (MOCK) tok = { access_token: 'x', refresh_token: 'y', expires_at: Date.now() + 3e6 };
  else tok = await oauth.signIn(c, { loginHint: hint || undefined });
  const id = 'acct_' + crypto.randomBytes(5).toString('hex');
  store.writeToken(id, tok);
  const meta = { id, email: '', name: '', color: store.nextColor() };
  const s = store.get();
  s.accounts.push(meta);
  let profile;
  try { profile = await accountObj(id).profile(); }
  catch (e) { s.accounts = s.accounts.filter((a) => a.id !== id); accounts.delete(id); store.deleteToken(id); store.save(); throw e; }
  const email = profile.emailAddress || (MOCK ? 'new.account@gmail.com' : '');
  const dup = s.accounts.find((a) => a.id !== id && a.email.toLowerCase() === email.toLowerCase());
  if (dup) {
    // Same Google account signed in again: keep the old entry, give it the fresh token.
    store.writeToken(dup.id, tok);
    s.accounts = s.accounts.filter((a) => a.id !== id);
    store.deleteToken(id);
    accounts.delete(id); accounts.delete(dup.id);
    dup.needsAuth = false;
    s.active = dup.id;
  } else {
    meta.email = email;
    s.active = id;
  }
  lastHistory[s.active] = profile.historyId;
  store.save();
  sendState();
  setTimeout(pollAll, 500);
  return s.active;
});

handle('account-reauth', (id) => reauth(id));
async function reauth(id) {
  const meta = store.get().accounts.find((a) => a.id === id);
  if (!meta) throw new Error('Account not found.');
  const tok = MOCK ? { access_token: 'x', refresh_token: 'y', expires_at: Date.now() + 3e6 } : await oauth.signIn(client(), { loginHint: meta.email });
  store.writeToken(id, tok);
  accounts.delete(id);
  const profile = await accountObj(id).profile();
  if (meta.email && profile.emailAddress && profile.emailAddress.toLowerCase() !== meta.email.toLowerCase()) {
    store.writeToken(id, {}); accounts.delete(id);
    throw new Error('You signed in as ' + profile.emailAddress + ', but this account is ' + meta.email + '. Try again and pick ' + meta.email + '.');
  }
  meta.needsAuth = false;
  store.save(); sendState(); setTimeout(pollAll, 500);
  return true;
}

handle('account-remove', async (id) => {
  const s = store.get();
  const meta = s.accounts.find((a) => a.id === id);
  if (!meta) return true;
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, title: DISPLAY_NAME, message: 'Remove ' + (meta.email || 'this account') + ' from Beacon?', detail: 'Beacon signs out of it and forgets it. Your email stays in Gmail.' });
  if (r.response !== 0) return false;
  const tok = store.readToken(id);
  if (tok && tok.refresh_token && !MOCK) oauth.revoke(tok.refresh_token);
  store.deleteToken(id);
  accounts.delete(id); delete counts[id]; delete lastHistory[id];
  contacts.forget(id); priority.forget(id); delete calCache[id];
  s.accounts = s.accounts.filter((a) => a.id !== id);
  if (s.active === id) s.active = s.accounts[0] ? s.accounts[0].id : null;
  store.save(); sendState();
  return true;
});
handle('account-switch', (id) => { store.get().active = id; store.save(); refreshTray(); return true; });
handle('account-move', (id, dir) => {
  const list = store.get().accounts;
  const i = list.findIndex((a) => a.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return false;
  const [a] = list.splice(i, 1); list.splice(j, 0, a); store.save(); sendState(); return true;
});

handle('labels', (id) => accountObj(id).labels());
handle('label-create', (id, name) => accountObj(id).createLabel(name));
handle('threads', async (id, opts) => {
  opts = opts || {};
  if (opts.scheduled) return { threads: later.scheduledRows(id), nextPageToken: null };
  if (opts.snoozed) return later.snoozedRows(id, accountObj(id));
  if (opts.drafts) {
    const r = await accountObj(id).listDrafts(opts);
    for (const t of r.threads) { const x = later.scheduleFor(id, t.draftId); if (x) t.scheduledAt = x.sendAt; }
    return r;
  }
  const meta = store.get().accounts.find((a) => a.id === id) || {};
  // Conversations back from snooze go on top of the first page of the Inbox (and the tab they belong to).
  const pin = (r) => {
    if (opts.pageToken || opts.q || !(opts.labelIds || []).includes('INBOX')) return r;
    const need = (opts.labelIds || []).filter((l) => l !== 'INBOX');
    return later.pinReturned(id, accountObj(id), r).then((x) => { x.threads = x.threads.filter((t) => !t.backFromSnooze || need.every((l) => (t.labelIds || []).includes(l))); return x; });
  };
  if (opts.forYou) return pin(await listForYou(id, meta, opts));
  const r = await accountObj(id).listThreads(opts);
  try { contacts.learnFromRows(id, r.threads, meta.email); } catch (_) {}
  priority.scoreRows(id, r.threads, meta.email);
  return pin(r);
});
// For You / Everything else: reads the inbox a page at a time and keeps the side you asked for.
async function listForYou(id, meta, opts) {
  const a = accountObj(id);
  const wantImportant = opts.forYou === 'imp';
  const out = []; let token = opts.pageToken || undefined; let next = null; let pages = 0;
  do {
    const r = await a.listThreads({ labelIds: ['INBOX'], pageToken: token, max: 50 });
    try { contacts.learnFromRows(id, r.threads, meta.email); } catch (_) {}
    priority.scoreRows(id, r.threads, meta.email);
    out.push(...r.threads.filter((t) => t.priority && t.priority.important === wantImportant));
    next = r.nextPageToken || null; token = next; pages++;
  } while (next && out.length < 20 && pages < 3);
  return { threads: out, nextPageToken: next };
}
handle('priority-teach', (id, rows, important) => { priority.teach(id, Array.isArray(rows) ? rows.slice(0, 500) : [], !!important); return true; });
handle('priority-learn', (id, kind, rows) => { priority.learn(id, String(kind), Array.isArray(rows) ? rows.slice(0, 500) : []); return true; });
handle('priority-reset', (id) => { priority.reset(id); return true; });
// Google Calendar
const calCache = {}; // accountId -> calendars list
async function calList(id, fresh) {
  if (!calCache[id] || fresh) calCache[id] = await calendar.calendars(accountObj(id));
  return calCache[id];
}
handle('cal-connect', async (id) => { showWindow(); await reauth(id); delete calCache[id]; if (MOCK) accountObj(id).calConnected = true; sendState(); return calendarConnected(id); });
handle('cal-calendars', (id, fresh) => calList(id, !!fresh));
handle('cal-events', async (id, timeMin, timeMax, calIds) => {
  const all = await calList(id);
  const want = new Set(Array.isArray(calIds) ? calIds : all.map((c) => c.id));
  return calendar.events(accountObj(id), all.filter((c) => want.has(c.id)), String(timeMin), String(timeMax));
});
handle('cal-save', async (id, d) => {
  const cals = await calList(id);
  const cal = cals.find((c) => c.id === d.calendarId);
  if (!cal || !cal.writable) throw new Error('You can\'t add or change events in that calendar.');
  if (d.moveTo && !(cals.find((c) => c.id === d.moveTo) || {}).writable) throw new Error('You can\'t move events into that calendar.');
  return calendar.save(accountObj(id), d);
});
handle('cal-delete', (id, calId, eventId, opts) => calendar.remove(accountObj(id), calId, eventId, opts || {}));
handle('cal-rsvp', (id, calId, eventId, status) => calendar.respond(accountObj(id), calId, eventId, status));
handle('contacts-search', (id, q) => contacts.search(id, q));

// Inbox cleanup. Scan results stay here so the window only ever passes a sender's address.
const lastScan = {}; // accountId -> Map(email -> sender group)
const cleanupUndo = new Map();
handle('cleanup-scan', async (id, scope) => {
  const r = await cleanup.scan(accountObj(id), scope, (done, total) => send('cleanup-progress', { accountId: id, scope, done, total }));
  lastScan[id] = new Map(r.senders.map((g) => [g.email, g]));
  const done = new Set(((store.get().unsubscribed || {})[id]) || []);
  return Object.assign({}, r, { senders: r.senders.map(({ ids, ...g }) => Object.assign(g, { unsubbed: done.has(g.email) })) });
});
handle('cleanup-act', async (id, scope, email, action) => {
  const r = await cleanup.act(accountObj(id), scope, String(email), action);
  setTimeout(pollAll, 300);
  let token = null;
  if (r.undo) { token = crypto.randomBytes(6).toString('hex'); cleanupUndo.set(token, Object.assign({ id }, r.undo)); setTimeout(() => cleanupUndo.delete(token), 120000); }
  return { count: r.count, undo: token };
});
handle('cleanup-undo', async (token) => {
  const u = cleanupUndo.get(token);
  if (!u) throw new Error('Too late to undo.');
  cleanupUndo.delete(token);
  await accountObj(u.id).batchModify(u.ids, u.add, u.remove);
  setTimeout(pollAll, 300);
  return u.ids.length;
});
handle('cleanup-unsub', async (id, senderEmail) => {
  const g = lastScan[id] && lastScan[id].get(String(senderEmail));
  if (!g || !g.unsub) throw new Error('This sender does not offer an unsubscribe link.');
  const a = accountObj(id);
  const meta = store.get().accounts.find((m) => m.id === id) || {};
  const r = await cleanup.unsubscribe(a, g.unsub, meta.email, (o) => a.sendRaw(mime.buildRaw({ from: meta.email, to: o.to, subject: o.subject, html: mime.textToHtml(o.text) })));
  if (r.method === 'browser') openExternal(r.url);
  log('unsubscribe', senderEmail || '', r.method);
  // Remember it so the button stays dimmed after a rescan or restart.
  const st = store.get(); st.unsubscribed = st.unsubscribed || {};
  const list = st.unsubscribed[id] || (st.unsubscribed[id] = []);
  if (!list.includes(g.email)) { list.push(g.email); if (list.length > 2000) list.shift(); store.save(); }
  return r;
});
handle('thread', (id, threadId) => { later.seen(id, [threadId]); return accountObj(id).getThread(threadId); });
handle('draft', async (id, draftId) => { const d = await accountObj(id).getDraft(draftId); const x = later.scheduleFor(id, draftId); if (x) d.scheduledAt = x.sendAt; return d; });
handle('draft-delete', async (id, draftId) => { await accountObj(id).deleteDraft(draftId); later.dropDraft(id, draftId); });
handle('send-as', (id) => accountObj(id).sendAs());
handle('refresh-counts', () => pollAll());

const ACTIONS = {
  archive: (a, t) => a.modifyThread(t, [], ['INBOX']),
  inbox: (a, t) => a.modifyThread(t, ['INBOX'], []),
  read: (a, t) => a.modifyThread(t, [], ['UNREAD']),
  unread: (a, t) => a.modifyThread(t, ['UNREAD'], []),
  star: (a, t) => a.modifyThread(t, ['STARRED'], []),
  unstar: (a, t) => a.modifyThread(t, [], ['STARRED']),
  important: (a, t) => a.modifyThread(t, ['IMPORTANT'], []),
  notimportant: (a, t) => a.modifyThread(t, [], ['IMPORTANT']),
  spam: (a, t) => a.modifyThread(t, ['SPAM'], ['INBOX']),
  notspam: (a, t) => a.modifyThread(t, ['INBOX'], ['SPAM']),
  trash: (a, t) => a.trashThread(t),
  untrash: (a, t) => a.untrashThread(t),
  forever: (a, t) => a.deleteThreadForever(t),
  label: (a, t, x) => a.modifyThread(t, [x], []),
  unlabel: (a, t, x) => a.modifyThread(t, [], [x]),
  move: (a, t, x) => a.modifyThread(t, [x], ['INBOX']),
  snooze: (a, t, until) => later.snooze(a, t, until),
  unsnooze: (a, t) => later.unsnooze(a, t),
};
handle('action', async (id, threadIds, action, extra) => {
  const fn = ACTIONS[action];
  if (!fn) throw new Error('Unknown action');
  if (action === 'forever') {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Delete forever', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, title: DISPLAY_NAME, message: 'Delete ' + threadIds.length + (threadIds.length === 1 ? ' conversation' : ' conversations') + ' forever?', detail: 'This cannot be undone.' });
    if (r.response !== 0) return { done: [], cancelled: true };
  }
  const a = accountObj(id);
  // Several at once (Gmail allows a few parallel requests); one failure no longer stops the rest.
  const done = []; const failed = []; let firstErr = null;
  const queue = threadIds.slice();
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length) {
      const t = queue.shift();
      try { await fn(a, t, extra); done.push(t); }
      catch (e) { failed.push(t); firstErr = firstErr || e; if (e instanceof AuthError || e.code === 'needs_auth') throw e; }
    }
  }));
  if (threadIds.length > 1) log('action', action, 'done=' + done.length, 'failed=' + failed.length);
  if (!['read', 'unread', 'star', 'unstar', 'important', 'notimportant', 'label', 'unlabel'].includes(action)) later.seen(id, done);
  if (!done.length && firstErr) throw firstErr;
  setTimeout(() => pollOne(store.get().accounts.find((m) => m.id === id) || {}).then(refreshTray), 800);
  return { done, failed, error: firstErr ? firstErr.message : null };
});

// "Select all conversations in this view": works on every matching message, not only the loaded page.
const BULK = {
  archive: { add: [], remove: ['INBOX'], undo: { add: ['INBOX'], remove: [] } },
  read: { add: [], remove: ['UNREAD'], undo: { add: ['UNREAD'], remove: [] } },
  unread: { add: ['UNREAD'], remove: [], undo: { add: [], remove: ['UNREAD'] } },
  star: { add: ['STARRED'], remove: [], undo: { add: [], remove: ['STARRED'] } },
  spam: { add: ['SPAM'], remove: ['INBOX'], undo: { add: ['INBOX'], remove: ['SPAM'] } },
  trash: { add: ['TRASH'], remove: ['INBOX'], undo: null },
};
const bulkUndo = new Map();
handle('action-all', async (id, query, action) => {
  const b = BULK[action];
  if (!b) throw new Error('That action can\'t be done on everything at once.');
  const a = accountObj(id);
  const q = query || {};
  let ids = await a.messageIds(q.q || '', q.labelIds && q.labelIds.length ? q.labelIds : null, 20000);
  if (action === 'read') ids = await a.messageIds(((q.q || '') + ' is:unread').trim(), q.labelIds && q.labelIds.length ? q.labelIds : null, 20000);
  if (!ids.length) return { count: 0, undo: null };
  if (action === 'trash') {
    try { await a.batchModify(ids, b.add, b.remove); }
    catch (e) {
      log('bulk trash by labels failed, trashing one by one', e.message);
      const queue = ids.slice();
      await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) { const m = queue.shift(); try { await a.trashMessage(m); } catch (_) {} } }));
    }
  } else await a.batchModify(ids, b.add, b.remove);
  log('bulk', action, 'messages=' + ids.length);
  let token = null;
  if (b.undo) { token = crypto.randomBytes(6).toString('hex'); bulkUndo.set(token, { id, ids, add: b.undo.add, remove: b.undo.remove }); setTimeout(() => bulkUndo.delete(token), 120000); }
  setTimeout(pollAll, 500);
  return { count: ids.length, undo: token };
});
handle('action-all-undo', async (token) => {
  const u = bulkUndo.get(token);
  if (!u) throw new Error('Too late to undo.');
  bulkUndo.delete(token);
  await accountObj(u.id).batchModify(u.ids, u.add, u.remove);
  setTimeout(pollAll, 500);
  return u.ids.length;
});

handle('attachment-save', async (id, att) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safeName(att.filename)) });
  if (r.canceled || !r.filePath) return null;
  const buf = att.data ? mime.fromB64url(att.data) : await accountObj(id).attachment(att.messageId, att.attachmentId);
  fs.writeFileSync(r.filePath, buf);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
handle('attachment-open', async (id, att) => {
  const buf = att.data ? mime.fromB64url(att.data) : await accountObj(id).attachment(att.messageId, att.attachmentId);
  const dir = path.join(os.tmpdir(), 'Gmail Desk attachments', crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, safeName(att.filename));
  fs.writeFileSync(p, buf);
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return p;
});
function safeName(n) { return String(n || 'attachment').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'attachment'; }

handle('save-temp-file', async (name, base64) => {
  const dir = path.join(os.tmpdir(), 'Gmail Desk attachments', 'pasted');
  fs.mkdirSync(dir, { recursive: true });
  const safe = safeName(name || 'pasted_image.png');
  const p = path.join(dir, `${Date.now()}_${safe}`);
  const buf = Buffer.from(base64, 'base64');
  fs.writeFileSync(p, buf);
  return { path: p, name: safe, size: buf.length };
});

handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
});

// Build the outgoing message in the main process. Quoted originals are added here so
// email HTML never enters the app's own page.
async function buildMessage(id, d) {
  const a = accountObj(id);
  const meta = store.get().accounts.find((m) => m.id === id) || {};
  let html = d.html || '';
  let subject = d.subject || '';
  let inReplyTo = d.inReplyTo || '';
  let references = d.references || '';
  const atts = [];
  let total = 0;
  for (const f of d.files || []) {
    const st = fs.statSync(f.path); total += st.size;
    if (total > 24 * 1024 * 1024) throw new Error('Attachments are over Gmail\'s 25 MB limit. Remove some, or share big files with a Drive link.');
    atts.push({ filename: f.name, mimeType: guessType(f.name), data: fs.readFileSync(f.path) });
  }
  if (d.mode && d.mode !== 'new' && d.threadId && d.sourceMessageId) {
    const t = await a.getThread(d.threadId);
    const src = t.messages.find((m) => m.id === d.sourceMessageId) || t.messages[t.messages.length - 1];
    if (src) {
      if (d.mode === 'forward') {
        if (!/^fwd?:/i.test(subject)) subject = subject || 'Fwd: ' + src.subject;
        if (d.includeQuote !== false) {
          html += '<br><br><div class="gmail_quote">---------- Forwarded message ---------<br>From: ' + mime.escapeHtml(src.from) + '<br>Date: ' + mime.escapeHtml(src.date) + '<br>Subject: ' + mime.escapeHtml(src.subject) + '<br>To: ' + mime.escapeHtml(src.to) + (src.cc ? '<br>Cc: ' + mime.escapeHtml(src.cc) : '') + '<br><br>' + (src.html || mime.textToHtml(src.text)) + '</div>';
        }
        for (const att of src.attachments || []) {
          if (d.dropForwardAttachments && d.dropForwardAttachments.includes(att.attachmentId)) continue;
          const buf = att.data ? mime.fromB64url(att.data) : await a.attachment(att.messageId, att.attachmentId);
          total += buf.length;
          if (total > 24 * 1024 * 1024) throw new Error('The original attachments plus yours are over Gmail\'s 25 MB limit.');
          atts.push({ filename: att.filename, mimeType: att.mimeType, data: buf });
        }
      } else {
        if (!subject) subject = /^re:/i.test(src.subject) ? src.subject : 'Re: ' + src.subject;
        inReplyTo = src.messageIdHeader || inReplyTo;
        references = [src.references, src.messageIdHeader].filter(Boolean).join(' ');
        if (d.includeQuote !== false) {
          html += '<br><div class="gmail_quote"><div dir="ltr">On ' + mime.escapeHtml(src.date) + ', ' + mime.escapeHtml(src.from) + ' wrote:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' + (src.html || mime.textToHtml(src.text)) + '</blockquote></div>';
        }
      }
    }
  }
  const fromName = d.fromName || meta.name || '';
  const fromAddr = d.from || meta.email;
  const raw = mime.buildRaw({
    from: fromName ? fromName + ' <' + fromAddr + '>' : fromAddr,
    to: d.to, cc: d.cc, bcc: d.bcc, subject, html, inReplyTo, references, attachments: atts,
  });
  return { raw, threadId: d.mode === 'forward' ? null : (d.threadId || null), subject };
}
function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', heic: 'image/heic' })[ext] || 'application/octet-stream';
}

handle('send', async (id, d) => {
  const built = await buildMessage(id, d); // fail fast on attachment problems before the undo window
  if (d.draftId) later.dropDraft(id, d.draftId); // sending a scheduled email now replaces its schedule
  try { const me = (store.get().accounts.find((m) => m.id === id) || {}).email; contacts.add(id, [].concat(d.to || [], d.cc || [], d.bcc || []).join(','), 3, Date.now(), me); } catch (_) {}
  const delay = Math.max(0, Math.min(30, Number(store.get().undoSeconds) || 0)) * 1000;
  const pid = crypto.randomBytes(6).toString('hex');
  const run = async () => {
    pending.delete(pid);
    try {
      const r = await accountObj(id).sendRaw(built.raw, built.threadId);
      if (d.draftId) { try { await accountObj(id).deleteDraft(d.draftId); } catch (_) {} }
      send('send-status', { pid, status: 'sent', accountId: id, threadId: r.threadId });
    } catch (e) {
      send('send-status', { pid, status: 'failed', error: e.message, accountId: id, draft: d });
    }
  };
  if (!delay) { await run(); return { pid, delayed: false }; }
  pending.set(pid, { timer: setTimeout(run, delay), run });
  return { pid, delayed: true, seconds: delay / 1000 };
});
// Schedule send: save the finished email as a Gmail draft and send that draft at sendAt.
handle('send-schedule', async (id, d, sendAt) => {
  sendAt = Number(sendAt);
  if (!(sendAt > Date.now() + 30 * 1000)) throw new Error('Pick a time at least a minute from now.');
  const built = await buildMessage(id, d);
  const a = accountObj(id);
  let draftId = d.draftId;
  if (draftId) { try { await a.updateDraft(draftId, built.raw, built.threadId); } catch (e) { if (e.status !== 404) throw e; draftId = null; } }
  if (!draftId) draftId = (await a.createDraft(built.raw, built.threadId)).id;
  try { const me = (store.get().accounts.find((m) => m.id === id) || {}).email; contacts.add(id, [].concat(d.to || [], d.cc || [], d.bcc || []).join(','), 3, Date.now(), me); } catch (_) {}
  later.scheduleDraft(id, draftId, sendAt, { threadId: built.threadId, to: [].concat(d.to || []).join(', '), subject: built.subject });
  return { draftId, sendAt };
});
handle('schedule-cancel', (id, draftId) => { later.dropDraft(id, draftId); return true; });
handle('send-undo', (pid) => {
  const t = pending.get(pid);
  if (!t) return false;
  clearTimeout(t.timer); pending.delete(pid);
  return true;
});
handle('draft-save', async (id, d) => {
  const built = await buildMessage(id, Object.assign({}, d, { includeQuote: false }));
  const a = accountObj(id);
  if (d.draftId) { await a.updateDraft(d.draftId, built.raw, built.threadId); return d.draftId; }
  const r = await a.createDraft(built.raw, built.threadId);
  return r.id;
});

// ---------------------------------------------------------------- quit
async function quit() {
  quitting = true;
  if (pending.size) {
    // Send anything still inside its undo window before closing, so nothing is lost.
    const runs = [...pending.values()].map((p) => { clearTimeout(p.timer); return p.run(); });
    pending.clear();
    await Promise.race([Promise.allSettled(runs), new Promise((r) => setTimeout(r, 15000))]);
  }
  store.flush();
  app.quit();
}
app.on('before-quit', (e) => {
  quitting = true;
  store.flush();
  if (pending.size) { e.preventDefault(); quit(); }
});
app.on('window-all-closed', () => { /* keep running in the tray */ });

