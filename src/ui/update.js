'use strict';
/* Automatic updates: a rail button and a message when a newer version is ready, and the Settings row. */

const UPD = { st: null, announced: '' };

function renderUpdateButton() {
  const b = $('btn-update');
  const r = UPD.st && UPD.st.ready;
  const o = UPD.st && UPD.st.online;
  b.hidden = !r && !o;
  if (!r && !o) return;
  b.title = r ? 'Beacon ' + r.version + ' is ready. Click to restart and update.' : 'Beacon ' + o.version + ' is out. Click to open the download page.';
  b.setAttribute('aria-label', b.title);
}

function onUpdateState(st) {
  UPD.st = st;
  renderUpdateButton();
  const r = st && st.ready;
  if (r && UPD.announced !== r.version) {
    UPD.announced = r.version;
    toast('Beacon ' + r.version + ' is ready', 'Restart now', installUpdate, 15000);
  }
  const o = st && st.online;
  if (!r && o && UPD.announced !== 'online ' + o.version) {
    UPD.announced = 'online ' + o.version;
    toast('Beacon ' + o.version + ' is out', 'Download', () => gd.external(o.url), 15000);
  }
}
function onUpdateButton() {
  if (UPD.st && !UPD.st.ready && UPD.st.online) { gd.external(UPD.st.online.url); return; }
  installUpdate();
}

async function installUpdate() {
  // Save any reply or new email in progress as a draft before the app restarts.
  try { await stashComposer(); } catch (_) {}
  toast('Updating Beacon… it reopens in a few seconds.', null, null, 20000);
  try { await gd.installUpdate(); } catch (e) { toast('Could not update: ' + e.message, null, null, 12000); }
}

/** The Updates row for the Settings window. */
function updateSettingsRow() {
  const info = h('small', { text: 'Checking…' });
  const btns = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end' });
  const draw = (st) => {
    UPD.st = st; renderUpdateButton();
    btns.replaceChildren();
    if (st.online && !st.ready) {
      info.textContent = 'Version ' + st.online.version + ' is out. Download it, unzip it and run it to update (your accounts and settings stay).';
      btns.append(h('button', { class: 'btn primary', text: 'Download', onclick: () => gd.external(st.online.url) }));
      return;
    }
    if (!st.enabled) { info.textContent = 'You have version ' + (S.st && S.st.version) + '. Updates install from the installed app.'; return; }
    if (st.ready) {
      info.textContent = 'Version ' + st.ready.version + ' is ready (from ' + st.ready.from + ').';
      btns.append(h('button', { class: 'btn primary', text: 'Restart and update', onclick: () => { $('modal-back').hidden = true; installUpdate(); } }));
      return;
    }
    info.textContent = (st.checking ? 'Checking…' : 'You have the newest version.') + ' Beacon checks GitHub for new versions, and also looks in your Downloads and Desktop folders.' + (st.error ? ' Last problem: ' + st.error : '');
    btns.append(h('button', { class: 'btn', text: 'Check now', onclick: async (e) => {
      e.target.disabled = true; info.textContent = 'Checking…';
      try { draw(await gd.checkUpdate()); } catch (err) { info.textContent = err.message; e.target.disabled = false; }
    } }));
  };
  gd.updateState().then(draw).catch(() => { info.textContent = ''; });
  return h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Updates', info), btns);
}

$('btn-update').addEventListener('click', onUpdateButton);
gd.onUpdate(onUpdateState);
gd.onUpdateInstallRequest(installUpdate);
gd.onUpdated(({ to }) => toast('Beacon updated to ' + to, null, null, 8000));
gd.updateState().then(onUpdateState).catch(() => {});
