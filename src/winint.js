'use strict';
// Windows install / uninstall / start with Windows / mailto registration.

const { app, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const APP_NAME = 'Gmail Desk'; // internal name: install folder, exe and saved data keep it so nothing is lost
const DISPLAY_NAME = 'Beacon'; // the name people see
const AUMID = 'com.lawrencerank.gmaildesk';
const IS_WIN = process.platform === 'win32';
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
// Update testing installs into a scratch folder and leaves the real install, registry and shortcuts alone.
const TEST = !!process.env.GMAIL_DESK_TEST_INSTALL_DIR;
const INSTALL_DIR = TEST ? path.resolve(process.env.GMAIL_DESK_TEST_INSTALL_DIR) : path.join(LOCALAPPDATA, 'Programs', APP_NAME);
const INSTALLED_EXE = path.join(INSTALL_DIR, APP_NAME + '.exe');
const START_MENU_LNK = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', DISPLAY_NAME + '.lnk');
const OLD_LNKS = () => [path.join(path.dirname(START_MENU_LNK), APP_NAME + '.lnk'), path.join(app.getPath('desktop'), APP_NAME + '.lnk')];
const desktopLnk = () => path.join(app.getPath('desktop'), DISPLAY_NAME + '.lnk');
const iconPath = () => path.join(INSTALL_DIR, 'resources', 'app', 'assets', 'beacon.ico'); // new file name so Windows drops its cached old icon

const isInstalled = () => IS_WIN && path.resolve(path.dirname(process.execPath)).toLowerCase() === path.resolve(INSTALL_DIR).toLowerCase();

function reg(args) { try { execFileSync('reg', args, { windowsHide: true, stdio: 'ignore' }); return true; } catch (_) { return false; } }

/** Ends other running copies of Gmail Desk (an older version left in the tray). */
function killOthers() {
  if (!IS_WIN || TEST) return;
  try { execFileSync('taskkill', ['/F', '/IM', APP_NAME + '.exe', '/FI', 'PID ne ' + process.pid], { windowsHide: true, stdio: 'ignore' }); } catch (_) {}
}

function applyStartup(on) {
  if (!IS_WIN) return;
  app.setLoginItemSettings({ openAtLogin: !!(on && isInstalled()), path: process.execPath, args: ['--hidden'] });
}

function registerMailto() {
  if (!IS_WIN) return;
  reg(['add', 'HKCU\\Software\\Classes\\GmailDesk.mailto', '/ve', '/d', 'Beacon mail link', '/f']);
  reg(['add', 'HKCU\\Software\\Classes\\GmailDesk.mailto', '/v', 'URL Protocol', '/d', '', '/f']);
  reg(['add', 'HKCU\\Software\\Classes\\GmailDesk.mailto\\DefaultIcon', '/ve', '/d', iconPath(), '/f']);
  reg(['add', 'HKCU\\Software\\Classes\\GmailDesk.mailto\\shell\\open\\command', '/ve', '/d', '"' + INSTALLED_EXE + '" "%1"', '/f']);
  reg(['add', 'HKCU\\Software\\GmailDesk\\Capabilities', '/v', 'ApplicationName', '/d', DISPLAY_NAME, '/f']);
  reg(['add', 'HKCU\\Software\\GmailDesk\\Capabilities', '/v', 'ApplicationDescription', '/d', 'Beacon for Gmail: your Gmail as a Windows app', '/f']);
  reg(['add', 'HKCU\\Software\\GmailDesk\\Capabilities\\URLAssociations', '/v', 'mailto', '/d', 'GmailDesk.mailto', '/f']);
  reg(['add', 'HKCU\\Software\\RegisteredApplications', '/v', APP_NAME, '/d', 'Software\\GmailDesk\\Capabilities', '/f']);
}

function folderSizeKb(dir) {
  let total = 0;
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { try { total += fs.statSync(p).size; } catch (_) {} } } };
  try { walk(dir); } catch (_) {}
  return Math.round(total / 1024);
}

/** Copies this copy of the app into the install folder and starts it from there.
 *  args go to the installed copy (for example --hidden after a background update). */
function install({ args = [] } = {}) {
  const src = path.dirname(process.execPath);
  try {
    killOthers();
    const deadline = Date.now() + 8000;
    for (;;) {
      try { fs.rmSync(INSTALL_DIR, { recursive: true, force: true }); break; }
      catch (e) { if (Date.now() > deadline) throw e; execFileSync('cmd.exe', ['/c', 'ping 127.0.0.1 -n 2 > nul'], { windowsHide: true }); }
    }
    fs.mkdirSync(path.dirname(INSTALL_DIR), { recursive: true });
    fs.cpSync(src, INSTALL_DIR, { recursive: true });
    if (TEST) { app.releaseSingleInstanceLock(); spawn(INSTALLED_EXE, args, { detached: true, stdio: 'ignore', cwd: INSTALL_DIR }).unref(); setTimeout(() => app.exit(0), 300); return true; }
    const lnk = { target: INSTALLED_EXE, cwd: INSTALL_DIR, icon: iconPath(), iconIndex: 0, appUserModelId: AUMID, description: 'Beacon for Gmail: your Gmail as a Windows app' };
    for (const old of OLD_LNKS()) { try { fs.rmSync(old, { force: true }); } catch (_) {} } // shortcuts from before the rename
    fs.mkdirSync(path.dirname(START_MENU_LNK), { recursive: true });
    shell.writeShortcutLink(START_MENU_LNK, 'create', lnk);
    try { shell.writeShortcutLink(desktopLnk(), 'create', lnk); } catch (_) {}
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GmailDesk';
    reg(['add', key, '/v', 'DisplayName', '/d', DISPLAY_NAME, '/f']);
    reg(['add', key, '/v', 'DisplayIcon', '/d', iconPath(), '/f']);
    reg(['add', key, '/v', 'DisplayVersion', '/d', app.getVersion(), '/f']);
    reg(['add', key, '/v', 'Publisher', '/d', 'Lawrence Rank', '/f']);
    reg(['add', key, '/v', 'InstallLocation', '/d', INSTALL_DIR, '/f']);
    reg(['add', key, '/v', 'UninstallString', '/d', '"' + INSTALLED_EXE + '" --uninstall', '/f']);
    reg(['add', key, '/v', 'NoModify', '/t', 'REG_DWORD', '/d', '1', '/f']);
    reg(['add', key, '/v', 'NoRepair', '/t', 'REG_DWORD', '/d', '1', '/f']);
    reg(['add', key, '/v', 'EstimatedSize', '/t', 'REG_DWORD', '/d', String(folderSizeKb(INSTALL_DIR)), '/f']);
    registerMailto();
    app.setLoginItemSettings({ openAtLogin: true, path: INSTALLED_EXE, args: ['--hidden'] });
    app.releaseSingleInstanceLock();
    spawn(INSTALLED_EXE, args, { detached: true, stdio: 'ignore', cwd: INSTALL_DIR }).unref();
    setTimeout(() => app.exit(0), 300);
    return true;
  } catch (err) {
    dialog.showErrorBox(DISPLAY_NAME, 'Install did not finish: ' + err.message + '\n\nIf Beacon is open, quit it from the tray icon and try again.');
    app.exit(1);
    return false;
  }
}

async function uninstall(parentWin) {
  if (!IS_WIN) return false;
  const opts = {
    type: 'warning', title: DISPLAY_NAME, buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
    message: 'Uninstall Beacon?', detail: 'This removes the app, its shortcuts and its start with Windows entry. Your email stays in Gmail.',
    checkboxLabel: 'Also remove saved sign-ins and settings', checkboxChecked: true,
  };
  const r = parentWin && !parentWin.isDestroyed() ? await dialog.showMessageBox(parentWin, opts) : await dialog.showMessageBox(opts);
  if (r.response !== 0) return false;
  try { fs.rmSync(START_MENU_LNK, { force: true }); } catch (_) {}
  try { fs.rmSync(desktopLnk(), { force: true }); } catch (_) {}
  for (const old of OLD_LNKS()) { try { fs.rmSync(old, { force: true }); } catch (_) {} }
  app.setLoginItemSettings({ openAtLogin: false, path: INSTALLED_EXE, args: ['--hidden'] });
  reg(['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GmailDesk', '/f']);
  reg(['delete', 'HKCU\\Software\\GmailDesk', '/f']);
  reg(['delete', 'HKCU\\Software\\Classes\\GmailDesk.mailto', '/f']);
  reg(['delete', 'HKCU\\Software\\RegisteredApplications', '/v', APP_NAME, '/f']);
  const targets = ['"' + INSTALL_DIR + '"'];
  if (r.checkboxChecked) targets.push('"' + app.getPath('userData') + '"');
  const cmd = 'ping 127.0.0.1 -n 4 > nul & ' + targets.map((t) => 'rmdir /s /q ' + t).join(' & ');
  spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir() }).unref();
  app.exit(0);
  return true;
}

module.exports = { APP_NAME, DISPLAY_NAME, AUMID, IS_WIN, INSTALL_DIR, isInstalled, killOthers, applyStartup, registerMailto, install, uninstall };
