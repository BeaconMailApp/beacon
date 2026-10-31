'use strict';
// Automatic updates. Looks for a newer Beacon build saved on this computer (a "Beacon-x.y.z-Windows"
// or older-style "Gmail-Desk-x.y.z-Windows" zip or folder in Downloads, the Desktop or the project's dist
// folder), unpacks it in the background, and installs it when the user clicks Restart.
// Nothing is downloaded from the internet and nothing installs without that click.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { execFile, spawn } = require('child_process');
const { log } = require('./log');
const win32 = require('./winint');

const CHECK_MS = 5 * 60 * 1000;
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const STAGE_ROOT = process.env.GMAIL_DESK_TEST_STAGE_DIR || path.join(LOCALAPPDATA, 'Beacon Updates');
// Beacon-2.9.0-Windows, Beacon-2.9.0-Windows.zip, Gmail-Desk-2.5.0-Windows_1.zip, "... (1).zip"
const NAME = /^(?:Beacon|Gmail-Desk)-(\d+)\.(\d+)\.(\d+)-Windows(?:[ _(-][^\\/]*?)?(\.zip)?$/i;

let ready = null; // {version, exe, from}
let checking = null;
let lastCheck = 0;
let lastError = '';
const rejected = new Set(); // paths that turned out not to be a usable build
let onReady = () => {};

const parts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = parts(a); const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function enabled() {
  return win32.IS_WIN && app.isPackaged && (win32.isInstalled() || !!process.env.GMAIL_DESK_TEST_INSTALL_DIR);
}

function folders() {
  if (process.env.GMAIL_DESK_UPDATE_DIRS) return process.env.GMAIL_DESK_UPDATE_DIRS.split(path.delimiter).filter(Boolean);
  const list = [];
  for (const k of ['downloads', 'desktop']) { try { list.push(app.getPath(k)); } catch (_) {} }
  try { list.push(path.join(app.getPath('documents'), 'Gmail desktop', 'dist')); } catch (_) {}
  try { list.push(path.join(app.getPath('documents'), 'Beacon', 'dist')); } catch (_) {}
  list.push(path.join(LOCALAPPDATA, 'Beacon Builds')); // where npm run build puts finished builds
  list.push(path.join(LOCALAPPDATA, 'Gmail Desk Builds'));
  return [...new Set(list.map((p) => path.resolve(p).toLowerCase()))].map((low) => list.find((p) => path.resolve(p).toLowerCase() === low));
}

/** Newer builds found on disk, best first. */
function scan() {
  const found = [];
  for (const dir of folders()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      const m = NAME.exec(name);
      if (!m) continue;
      const version = m[1] + '.' + m[2] + '.' + m[3];
      if (!newer(version, app.getVersion())) continue;
      const full = path.join(dir, name);
      let st; try { st = fs.statSync(full); } catch (_) { continue; }
      // A zip still being copied in fails to unpack, so wait until it has sat still for a moment.
      if (Date.now() - st.mtimeMs < 20 * 1000) continue;
      // A rejected copy is tried again if it changes (for example, a finished copy replaced a broken one).
      if (rejected.has(full + '|' + st.size + '|' + st.mtimeMs)) continue;
      const zip = !!m[4];
      if (zip ? !st.isFile() : !st.isDirectory()) continue;
      if (!zip && !appDirIn(full)) continue;
      found.push({ version, path: full, zip, mtime: st.mtimeMs, size: st.size });
    }
  }
  // Highest version wins; for the same version prefer a folder (no unzipping), then the newest file.
  return found.sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0) || (a.zip - b.zip) || (b.mtime - a.mtime));
}

function unzip(zipPath, dest) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return new Promise((resolve, reject) => {
    execFile(tar, ['-x', '-f', zipPath, '-C', dest], { windowsHide: true, timeout: 5 * 60 * 1000 }, (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 200))) : resolve()));
  });
}

const NAMES = [win32.APP_NAME, win32.LEGACY_NAME]; // builds from before 2.9.0 used Gmail Desk

/** The app folder inside an unpacked build (Beacon, or Gmail Desk in older builds), or null. */
function appDirIn(dir) {
  for (const n of NAMES) for (const e of NAMES) if (fs.existsSync(path.join(dir, n, e + '.exe'))) return path.join(dir, n);
  return null;
}

/** Makes sure a found build really is Beacon and the version its name says. */
function verify(appDir, version) {
  const exe = NAMES.map((n) => path.join(appDir, n + '.exe')).find((p) => fs.existsSync(p));
  if (!exe) throw new Error('no Beacon.exe inside');
  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'resources', 'app', 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!NAMES.includes(pkg.productName)) throw new Error('not a Beacon build');
  // A build with the Google key inside must not be replaced by one without it (the public download).
  if (fs.existsSync(path.join(__dirname, 'client.json')) && !fs.existsSync(path.join(appDir, 'resources', 'app', 'client.json'))) throw new Error('this build has no Google key inside');
  if (pkg.version !== version || !newer(pkg.version, app.getVersion())) throw new Error('version is ' + pkg.version);
  if (!fs.existsSync(path.join(appDir, 'resources', 'app', 'main.js'))) throw new Error('app files missing');
  // Builds from npm run build list every file and its size; a copy that does not match is incomplete.
  const listFile = path.join(appDir, 'resources', 'app', 'manifest.json');
  if (fs.existsSync(listFile)) {
    const { files } = JSON.parse(fs.readFileSync(listFile, 'utf8').replace(/^\uFEFF/, ''));
    for (const [rel, size] of Object.entries(files || {})) {
      let st = null; try { st = fs.statSync(path.join(appDir, rel)); } catch (_) {}
      if (!st || st.size !== size) throw new Error((st ? 'changed' : 'missing') + ' file ' + rel);
    }
  }
  return exe;
}

async function prepare(c) {
  let appDir;
  if (c.zip) {
    const stage = path.join(STAGE_ROOT, c.version);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    await unzip(c.path, stage);
    appDir = appDirIn(stage);
  } else {
    appDir = appDirIn(c.path);
  }
  if (!appDir) throw new Error('no Beacon folder inside');
  return { version: c.version, exe: verify(appDir, c.version), from: c.path };
}

async function runCheck() {
  lastCheck = Date.now();
  lastError = '';
  for (const c of scan()) {
    if (ready && !newer(c.version, ready.version)) return ready;
    try {
      const r = await prepare(c);
      ready = r;
      log('update ready', r.version, 'from', path.basename(r.from));
      onReady(status());
      return ready;
    } catch (e) {
      rejected.add(c.path + '|' + c.size + '|' + c.mtime);
      lastError = path.basename(c.path) + ': ' + e.message;
      log('update skipped', lastError);
    }
  }
  return ready;
}

/** Looks for an update now. Safe to call often; overlapping calls share one check. */
function check() {
  if (!enabled()) return Promise.resolve(null);
  if (!checking) checking = runCheck().catch((e) => { lastError = e.message; log('update check failed', e.message); return ready; }).finally(() => { checking = null; });
  return checking;
}

function status() {
  return {
    enabled: enabled(), current: app.getVersion(), checking: !!checking, lastCheck, error: lastError,
    ready: ready ? { version: ready.version, from: path.basename(ready.from) } : null,
    folders: enabled() ? folders() : [],
  };
}

/** Starts the prepared update. The caller quits right after, so the new copy can replace this one. */
function apply({ hidden } = {}) {
  if (!ready || !fs.existsSync(ready.exe)) throw new Error('No update is ready.');
  log('update installing', ready.version);
  spawn(ready.exe, ['--update'].concat(hidden ? ['--hidden'] : []), { detached: true, stdio: 'ignore', cwd: path.dirname(ready.exe) }).unref();
}

/** Deletes unpacked updates that are already installed (or older). */
function cleanStaged() {
  let names = [];
  try { names = fs.readdirSync(STAGE_ROOT); } catch (_) { return; }
  for (const n of names) if (!newer(n, app.getVersion())) { try { fs.rmSync(path.join(STAGE_ROOT, n), { recursive: true, force: true }); } catch (_) {} }
}

function start(cb) {
  if (cb) onReady = cb;
  if (!enabled()) return;
  cleanStaged();
  setTimeout(check, 15 * 1000);
  setInterval(check, CHECK_MS);
}

module.exports = { start, check, status, apply, newer };
