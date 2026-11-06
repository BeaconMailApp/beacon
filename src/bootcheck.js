'use strict';
/* Startup safety net.
   1. Beacon notes each step of starting in startup.json and marks it done once the window has
      asked for your mail. If a start never finishes, the next start writes where it stopped to
      the log and skips optional startup work.
   2. A small watchdog thread checks that the main process is still responding. If it stops for
      20 seconds, the watchdog writes that to the log (with the last startup step).
   3. If you open Beacon while the running copy is frozen (for example a white window), the new
      copy ends the frozen one and starts fresh, instead of quietly doing nothing.
   The 2.9.18 white window would have fixed itself on the next open with this in place. */
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const FROZEN_MS = 30 * 1000; // no response this long means frozen
const WARN_MS = 20 * 1000;

let dir = null; let rec = null; let beat = null;
const startFile = () => path.join(dir, 'startup.json');
const beatFile = (d) => path.join(d || dir, 'heartbeat.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function write() { try { fs.writeFileSync(startFile(), JSON.stringify(rec)); } catch (_) {} }

/** Call once at start. Returns the earlier start that never finished (and is not running), or null. */
function begin(userData, version) {
  dir = userData;
  const prev = readJson(startFile());
  rec = { version, pid: process.pid, started: Date.now(), step: 'start', done: false };
  write();
  startWatchdog();
  if (prev && !prev.done && prev.pid !== process.pid && !alive(prev.pid)) return prev;
  return null;
}
function step(name) { if (!rec || rec.done) return; rec.step = name; write(); }
function done() { if (!rec || rec.done) return; rec.done = true; rec.step = 'ready'; rec.readyAt = Date.now(); write(); }

function startWatchdog() {
  try {
    const buf = new SharedArrayBuffer(8); beat = new BigInt64Array(buf);
    Atomics.store(beat, 0, BigInt(Date.now()));
    const tick = setInterval(() => Atomics.store(beat, 0, BigInt(Date.now())), 1000); tick.unref();
    const w = new Worker(WATCHDOG, { eval: true, workerData: { buf, beatFile: beatFile(), startFile: startFile(), logFile: path.join(dir, 'beacon.log'), pid: process.pid, warnMs: WARN_MS } });
    w.on('error', () => {}); w.unref();
  } catch (_) { /* the safety net is optional */ }
}
const WATCHDOG = `
const { workerData: d } = require('worker_threads'); const fs = require('fs');
const beat = new BigInt64Array(d.buf); let last = Date.now(); let warned = false;
setInterval(() => {
  const now = Date.now(); const gap = now - last; last = now;
  const mainBeat = Number(Atomics.load(beat, 0));
  try { fs.writeFileSync(d.beatFile, JSON.stringify({ pid: d.pid, mainBeat, at: now })); } catch (_) {}
  if (gap > 10000) return; // the computer was asleep, not frozen
  const stuck = now - mainBeat;
  if (stuck > d.warnMs && !warned) {
    warned = true; let s = {}; try { s = JSON.parse(fs.readFileSync(d.startFile, 'utf8')); } catch (_) {}
    try { fs.appendFileSync(d.logFile, new Date(now).toISOString() + ' watchdog: Beacon is not responding (' + Math.round(stuck / 1000) + 's, startup step ' + (s.done ? 'done' : s.step) + ')\\n'); } catch (_) {}
  } else if (stuck < 3000 && warned) {
    warned = false;
    try { fs.appendFileSync(d.logFile, new Date(now).toISOString() + ' watchdog: Beacon is responding again\\n'); } catch (_) {}
  }
}, 5000);
`;

/** For a second copy that could not get the single-instance lock: the pid of the running copy if it is frozen. */
function frozenPid(userData) {
  const b = readJson(beatFile(userData));
  if (!b || !b.pid || b.pid === process.pid || !alive(b.pid)) return 0;
  const now = Date.now();
  if (now - b.at > 15000) return 0; // the watchdog is not running (an older Beacon, or asleep): unknown, leave it
  return b.at - b.mainBeat > FROZEN_MS ? b.pid : 0;
}

module.exports = { begin, step, done, frozenPid };
