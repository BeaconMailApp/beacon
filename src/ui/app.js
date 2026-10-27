'use strict';
/* Gmail Desk interface. All Gmail calls go through window.gd (main process). */

// ===================================================================== helpers
const $ = (id) => document.getElementById(id);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // only ever used with constant icon markup
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.setAttribute('style', v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const ICONS = {
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
  important: '<path d="M3 5h12l6 7-6 7H3l5-7Z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  draft: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M9 15h6"/>',
  all: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  spam: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9Z"/><path d="M12 8v4M12 16h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  label: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  unarchive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="m9 15 3-3 3 3M12 12v6"/>',
  mailOpen: '<path d="M21.2 8.4 12 3 2.8 8.4A2 2 0 0 0 2 10v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-.8-1.6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/>',
  move: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/><path d="M12 10v6M9 13l3 3 3-3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  replyAll: '<path d="M7 17 2 12l5-5"/><path d="M12 17 7 12l5-5"/><path d="M22 18v-2a4 4 0 0 0-4-4H7"/>',
  forward: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  min: '<path d="M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  open: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>',
  italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  underline: '<path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  ul: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  ol: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  clear: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/><path d="m3 3 18 18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  notimp: '<path d="M3 5h12l6 7-6 7H3l5-7Z"/><path d="m4 4 16 16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sweep: '<path d="m15 4 5 5"/><path d="M13.5 5.5 6 13l5 5 7.5-7.5"/><path d="M6 13c-1.5 1.5-3 2-4 2l7 7c0-1 .5-2.5 2-4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
};
const icon = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = ICONS[name] || ''; return s; };
const tbBtn = (name, title, fn, cls) => h('button', { class: 'tb' + (cls ? ' ' + cls : ''), title, 'aria-label': title, onclick: fn }, icon(name));

function nameOf(addr) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(addr || '');
  if (m && m[1].trim()) return m[1].trim();
  return (m ? m[2] : String(addr || '')).trim();
}
function emailOf(addr) { const m = /<([^>]+)>/.exec(addr || ''); return (m ? m[1] : String(addr || '')).trim().toLowerCase(); }
function splitAddrs(s) {
  // Split on commas/semicolons that are not inside quotes.
  const out = []; let cur = ''; let q = false;
  for (const ch of String(s || '')) {
    if (ch === '"') q = !q;
    if ((ch === ',' || ch === ';') && !q) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const validAddr = (a) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(emailOf(a));
function colorFor(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return ['#2a5bd7', '#d9480f', '#2b8a3e', '#ae3ec9', '#c2255c', '#0b7285', '#e67700', '#5c7cfa', '#087f5b', '#9c36b5'][x % 10]; }
function fmtListDate(ms) {
  if (!ms) return '';
  const d = new Date(ms); const n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: '2-digit', month: 'numeric', day: 'numeric' });
}
function fmtFullDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const diff = (Date.now() - ms) / 1000;
  let rel = '';
  if (diff < 3600) rel = Math.max(1, Math.round(diff / 60)) + ' min ago';
  else if (diff < 86400) { const n = Math.round(diff / 3600); rel = n + (n === 1 ? ' hour ago' : ' hours ago'); }
  else if (diff < 86400 * 7) { const n = Math.round(diff / 86400); rel = n + (n === 1 ? ' day ago' : ' days ago'); }
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' }) + (rel ? ' (' + rel + ')' : '');
}
function fmtSize(n) { if (!n) return ''; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
function isTyping(e) { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }

let toastTimer = null;
function toast(msg, actionLabel, action, ms) {
  const t = $('toast');
  t.replaceChildren(h('span', { text: msg }));
  if (actionLabel) t.append(h('button', { text: actionLabel, onclick: () => { t.hidden = true; action(); } }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms || (actionLabel ? 8000 : 4000));
}
function closeMenus() { document.querySelectorAll('.menu').forEach((m) => m.remove()); }
function popMenu(anchor, items) {
  closeMenus();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { m.append(h('div', { class: 'sep' })); continue; }
    if (it.head) { m.append(h('div', { class: 'head', text: it.head })); continue; }
    if (it.el) { m.append(it.el); continue; }
    m.append(h('button', { role: 'menuitem', onclick: (e) => { e.stopPropagation(); closeMenus(); it.fn(); } }, it.icon ? icon(it.icon) : null, h('span', { text: it.label })));
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
  m.style.top = (r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  const first = m.querySelector('input,button'); if (first) first.focus();
  return m;
}
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });

function modal(build) {
  const back = $('modal-back');
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  const close = () => { back.hidden = true; back.replaceChildren(); };
  build(box, close);
  back.replaceChildren(box);
  back.hidden = false;
  back.onclick = (e) => { if (e.target === back) close(); };
  const f = box.querySelector('input,select,button'); if (f) f.focus();
  return close;
}
function askText(title, placeholder, okLabel) {
  return new Promise((resolve) => {
    modal((box, close) => {
      const inp = h('input', { type: 'text', placeholder, style: 'width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit' });
      const done = (v) => { close(); resolve(v); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value.trim()); if (e.key === 'Escape') done(null); });
      box.append(h('h2', { text: title }), h('div', { style: 'height:12px' }), inp,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', text: 'Cancel', onclick: () => done(null) }), h('button', { class: 'btn primary', text: okLabel || 'OK', onclick: () => done(inp.value.trim()) })));
    });
  });
}

// ===================================================================== state
const FOLDERS = [
  { key: 'inbox', label: 'Inbox', icon: 'inbox' },
  { key: 'starred', label: 'Starred', icon: 'star', q: 'is:starred' },
  { key: 'snoozed', label: 'Snoozed', icon: 'clock', snoozed: true },
  { key: 'important', label: 'Important', icon: 'important', labelIds: ['IMPORTANT'] },
  { key: 'sent', label: 'Sent', icon: 'send', labelIds: ['SENT'] },
  { key: 'scheduled', label: 'Scheduled', icon: 'schedSend', scheduled: true },
  { key: 'drafts', label: 'Drafts', icon: 'draft', drafts: true },
  { key: 'all', label: 'All Mail', icon: 'all', q: '' },
  { key: 'spam', label: 'Spam', icon: 'spam', labelIds: ['SPAM'] },
  { key: 'trash', label: 'Trash', icon: 'trash', labelIds: ['TRASH'] },
];
const TABS = [
  // For You is scored on this computer (see priority.js). The rest are Gmail's category labels;
  // the category: search words do not work on every account.
  { key: 'foryou', label: 'For You', forYou: 'imp', labelIds: [] },
  { key: 'other', label: 'Everything else', forYou: 'rest', labelIds: [] },
  { key: 'primary', label: 'Primary', labelIds: ['CATEGORY_PERSONAL'] },
  { key: 'promotions', label: 'Promotions', labelIds: ['CATEGORY_PROMOTIONS'] },
  { key: 'social', label: 'Social', labelIds: ['CATEGORY_SOCIAL'] },
  { key: 'updates', label: 'Updates', labelIds: ['CATEGORY_UPDATES'] },
  { key: 'everything', label: 'Everything', labelIds: [] },
];
const S = {
  st: null, acct: null,
  view: { kind: 'folder', key: 'inbox', tab: 'foryou' }, // or {kind:'label', id, name} or {kind:'search', q}
  threads: [], next: null, listState: 'idle', listErr: '', viewSeq: 0, moreErr: '',
  sel: new Set(), lastSelId: null, openId: null, thread: null, threadState: 'idle', threadErr: '', expanded: new Set(), showImages: new Set(),
  labels: [], comp: null, sendAs: {},
};
const acctMeta = () => (S.st ? S.st.accounts.find((a) => a.id === S.acct) : null);

function applyTheme() {
  const t = S.st ? S.st.settings.theme : 'dark';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('btn-theme').replaceChildren(icon(dark ? 'sun' : 'moon'));
  $('btn-theme').title = dark ? 'Switch to light' : 'Switch to dark';
}
const isDark = () => document.documentElement.dataset.theme === 'dark';
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ===================================================================== account rail
function renderRail() {
  const box = $('rail-accts');
  const counts = (S.st && S.st.counts) || {};
  box.replaceChildren(...(S.st ? S.st.accounts : []).map((a, i) => {
    const b = h('button', {
      class: 'acct-dot' + (a.id === S.acct ? ' active' : ''), style: 'background:' + a.color,
      title: (a.email || 'Account') + (counts[a.id] ? ' · ' + counts[a.id] + ' unread' : '') + (a.needsAuth ? ' · needs sign in' : '') + (i < 9 ? ' · Ctrl+' + (i + 1) : ''),
      'aria-label': (a.email || 'Account') + (counts[a.id] ? ', ' + counts[a.id] + ' unread' : ''),
      onclick: () => switchAccount(a.id),
      oncontextmenu: (e) => { e.preventDefault(); accountMenu(b, a, i); },
    }, (a.email || '?').charAt(0).toUpperCase());
    if (counts[a.id]) b.append(h('span', { class: 'badge', text: counts[a.id] > 99 ? '99+' : String(counts[a.id]) }));
    if (a.needsAuth) b.append(h('span', { class: 'warn', text: '!' }));
    return b;
  }));
}
function accountMenu(anchor, a, i) {
  const n = S.st.accounts.length;
  popMenu(anchor, [
    { head: a.email || 'Account' },
    a.needsAuth ? { label: 'Sign in again', icon: 'refresh', fn: () => reauth(a.id) } : null,
    i > 0 ? { label: 'Move up', fn: () => gd.moveAccount(a.id, -1) } : null,
    i < n - 1 ? { label: 'Move down', fn: () => gd.moveAccount(a.id, 1) } : null,
    '-',
    { label: 'Remove account', icon: 'trash', fn: async () => { await gd.removeAccount(a.id).catch((e) => toast(e.message)); } },
  ].filter(Boolean));
}
async function addAccount() {
  toast('Finish signing in to Google in your browser…', 'Cancel', () => gd.cancelSignIn().catch(() => {}), 300000);
  try {
    const id = await gd.addAccount();
    S.st = await gd.state();
    toast('Signed in as ' + ((S.st.accounts.find((a) => a.id === id) || {}).email || 'your account'));
    $('welcome').hidden = true;
    switchAccount(id, true);
  } catch (e) {
    toast(signInHelp(e), null, null, 15000);
    if (!S.st || !S.st.accounts.length) renderWelcome(signInHelp(e));
  }
}
async function reauth(id) {
  toast('Finish signing in to Google in your browser…', 'Cancel', () => gd.cancelSignIn().catch(() => {}), 300000);
  try { await gd.reauth(id); S.st = await gd.state(); renderAll(); loadList(); toast('Signed in again'); }
  catch (e) { toast(signInHelp(e), null, null, 15000); }
}
function signInHelp(e) {
  const m = e.message || '';
  if (e.code === 'cancelled') return 'Sign-in cancelled.';
  if (/access_denied/i.test(m) || /cancel/i.test(m)) return 'Sign-in was cancelled. If Google said the app is only for test users, add your email under Audience > Test users in Google Cloud, or click Publish app there.';
  return m;
}
async function switchAccount(id, force) {
  if (!force && id === S.acct) return;
  await stashComposer();
  S.acct = id;
  gd.switchAccount(id);
  S.view = { kind: 'folder', key: 'inbox', tab: 'foryou' };
  S.openId = null; S.thread = null; S.sel.clear(); S.labels = [];
  $('search').value = '';
  renderAll();
  loadLabels();
  loadList();
}

// ===================================================================== sidebar
function renderSide() {
  const a = acctMeta();
  $('acct-name').textContent = a ? a.email : '';
  const counts = (S.st && S.st.counts) || {};
  const box = $('folders');
  box.replaceChildren(...FOLDERS.map((f) => {
    const active = S.view.kind === 'folder' && S.view.key === f.key;
    const later = (S.st && S.st.later) || {};
    const n = f.key === 'inbox' ? counts[S.acct] : f.key === 'scheduled' ? (later.scheduled || {})[S.acct] : f.key === 'snoozed' ? Object.keys((later.snoozed || {})[S.acct] || {}).length : 0;
    return h('button', { class: 'folder' + (active ? ' active' : ''), onclick: () => setView({ kind: 'folder', key: f.key, tab: f.key === 'inbox' ? (S.view.tab || 'foryou') : undefined }) },
      icon(f.icon), h('span', { class: 'name', text: f.label }), n ? h('span', { class: 'n', text: String(n) }) : null);
  }));
  box.append(h('button', { class: 'folder' + (S.view.kind === 'calendar' ? ' active' : ''), id: 'btn-calendar', title: 'Your Google Calendar', onclick: () => openCalendar() }, icon('calendar'), h('span', { class: 'name', text: 'Calendar' })));
  box.append(h('button', { class: 'folder' + (S.view.kind === 'cleanup' ? ' active' : ''), id: 'btn-cleanup', title: 'Group mail by sender and clear it out fast', onclick: () => openCleanup() }, icon('sweep'), h('span', { class: 'name', text: 'Clean up' })));
  const lb = $('labels');
  lb.replaceChildren(...S.labels.filter((l) => l.id !== snoozeLabelId()).map((l) => {
    const active = S.view.kind === 'label' && S.view.id === l.id;
    return h('button', { class: 'folder' + (active ? ' active' : ''), title: l.name, onclick: () => setView({ kind: 'label', id: l.id, name: l.name }),
      oncontextmenu: (e) => { e.preventDefault(); } },
    h('span', { class: 'swatch', style: l.color && l.color.backgroundColor ? 'background:' + l.color.backgroundColor : '' }), h('span', { class: 'name', text: l.name }));
  }));
  if (!S.labels.length) lb.append(h('div', { class: 'acct-name', text: 'No labels yet' }));
}
async function loadLabels() {
  if (!S.acct) return;
  const id = S.acct;
  try {
    const all = await gd.labels(id);
    if (id !== S.acct) return;
    S.labels = all.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
    renderSide();
  } catch (_) {}
}
function setView(v) {
  S.view = v;
  S.sel.clear();
  if (v.kind !== 'search') $('search').value = '';
  closeThread(true);
  renderSide();
  loadList();
}
function viewQuery() {
  const v = S.view;
  if (v.kind === 'cleanup' || v.kind === 'calendar') return {};
  if (v.kind === 'search') return { q: v.q };
  if (v.kind === 'label') return { labelIds: [v.id] };
  const f = FOLDERS.find((x) => x.key === v.key);
  if (f.key === 'inbox') { const t = TABS.find((x) => x.key === (v.tab || 'foryou')) || TABS[0]; return t.forYou ? { forYou: t.forYou, labelIds: ['INBOX'] } : { labelIds: ['INBOX'].concat(t.labelIds) }; }
  if (f.drafts) return { drafts: true };
  if (f.scheduled) return { scheduled: true };
  if (f.snoozed) return { snoozed: true };
  return { labelIds: f.labelIds, q: f.q };
}
function viewTitle() {
  const v = S.view;
  if (v.kind === 'cleanup') return 'Clean up';
  if (v.kind === 'calendar') return 'Calendar';
  if (v.kind === 'search') return 'Search results';
  if (v.kind === 'label') return v.name;
  return FOLDERS.find((x) => x.key === v.key).label;
}
