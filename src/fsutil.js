'use strict';
/* Safe folder delete and copy cleanup for Windows.
   Folders that came from OneDrive keep the Read-only attribute when they are copied or zipped.
   fs.rmSync could hang Beacon's main process on such a folder, which showed as a white window
   at start (2.9.18). These helpers clear Read-only as they go and never wait or retry. */
const fs = require('fs');
const path = require('path');

/** Deletes a file or folder and everything in it. Throws if something cannot be removed. */
function removeTree(p) {
  let st;
  try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (st.isDirectory()) {
    try { fs.chmodSync(p, 0o777); } catch (_) {}
    for (const n of fs.readdirSync(p)) removeTree(path.join(p, n));
    fs.rmdirSync(p);
    return;
  }
  try { fs.unlinkSync(p); } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    fs.chmodSync(p, 0o666); fs.unlinkSync(p);
  }
}

/** The same as removeTree, but off the main thread, so it can never freeze the window. */
async function removeTreeAsync(p) {
  const fsp = fs.promises;
  let st;
  try { st = await fsp.lstat(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (st.isDirectory()) {
    try { await fsp.chmod(p, 0o777); } catch (_) {}
    for (const n of await fsp.readdir(p)) await removeTreeAsync(path.join(p, n));
    await fsp.rmdir(p);
    return;
  }
  try { await fsp.unlink(p); } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    await fsp.chmod(p, 0o666); await fsp.unlink(p);
  }
}

/** Clears Read-only on a folder and everything in it, so it can be replaced or deleted later. */
function clearReadOnly(dir) {
  let st; try { st = fs.lstatSync(dir); } catch (_) { return; }
  if (!st.isDirectory()) return;
  try { fs.chmodSync(dir, 0o777); } catch (_) {}
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) clearReadOnly(p);
    else if (d.isFile()) { try { fs.chmodSync(p, 0o666); } catch (_) {} }
  }
}

module.exports = { removeTree, removeTreeAsync, clearReadOnly };
