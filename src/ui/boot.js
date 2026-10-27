'use strict';
/* Startup, first-run welcome, settings, keyboard shortcuts and live events. */

function renderAll() {
  applyTheme();
  renderRail();
  renderSide();
  renderList();
  renderReader();
}

// First run without a Google key (the public download): walk through making one.
function renderSetup(err) {
  const w = $('welcome');
  w.hidden = false;
  const link = (text, url) => h('button', { class: 'btn', text, onclick: () => gd.external(url) });
  w.replaceChildren(h('div', { class: 'card setup' }, h('div', { class: 'logo' }, icon('mail')),
    h('h1', { text: 'Set up Beacon' }),
    h('p', { text: 'Beacon talks straight to Google with a free key that belongs to you, so your mail never goes through anyone else. Making the key takes about 10 minutes, once.' }),
    h('ol', {},
      h('li', {}, 'Create a free Google Cloud project (any name).', h('div', {}, link('Create a project', 'https://console.cloud.google.com/projectcreate'))),
      h('li', {}, 'Turn on the Gmail API. For the calendar, also turn on the Google Calendar API.', h('div', {}, link('Gmail API', 'https://console.cloud.google.com/apis/library/gmail.googleapis.com'), link('Calendar API', 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com'))),
      h('li', {}, 'Open Google Auth Platform and click Get started. Give it a name (for example Beacon), your email, and pick ', h('b', { text: 'External' }), '. Then on the Audience page click ', h('b', { text: 'Publish app' }), '.', h('div', {}, link('Google Auth Platform', 'https://console.cloud.google.com/auth/overview'))),
      h('li', {}, 'Open Clients, click ', h('b', { text: 'Create client' }), ', choose ', h('b', { text: 'Desktop app' }), ', create it, then click ', h('b', { text: 'Download JSON' }), '.', h('div', {}, link('Clients', 'https://console.cloud.google.com/auth/clients'))),
      h('li', {}, 'Load that file here, then sign in.')),
    h('button', { class: 'btn primary', style: 'padding:10px 22px;font-size:15px', onclick: async () => {
      try { if (await gd.loadClient()) { S.st = await gd.state(); renderWelcome(); toast('Google key loaded'); } } catch (e) { renderSetup(e.message); }
    } }, 'Load my Google key file'),
    err ? h('div', { class: 'err', role: 'alert', text: err }) : null));
}

function renderWelcome(err) {
  if (S.st && !S.st.hasClient) { renderSetup(err); return; }
  const w = $('welcome');
  w.hidden = false;
  const logo = h('div', { class: 'logo' }, icon('mail'));
  const btn = h('button', { class: 'btn primary', style: 'padding:10px 22px;font-size:15px', onclick: addAccount }, 'Sign in with Google');
  w.replaceChildren(h('div', { class: 'card' }, logo,
    h('h1', { text: 'Welcome to Beacon' }),
    h('p', { text: 'Your Gmail as a real Windows app. Sign in once in your web browser and your mail shows up here.' }),
    h('ol', {},
      h('li', {}, 'Click ', h('b', { text: 'Sign in with Google' }), '. Your browser opens.'),
      h('li', {}, 'Pick your Gmail account.'),
      h('li', {}, 'Google will say ', h('b', { text: '"Google hasn\'t verified this app"' }), '. That\'s expected, because this app is yours. Click ', h('b', { text: 'Advanced' }), ', then ', h('b', { text: 'Go to Beacon' }), '.'),
      h('li', {}, 'If you see a box for Gmail access, ', h('b', { text: 'tick it' }), ', then click ', h('b', { text: 'Continue' }), '.'),
      h('li', {}, 'Come back here. Your inbox loads on its own.')),
    btn,
    h('p', { style: 'margin-top:16px;font-size:12px', text: 'If sign-in fails: make sure the Gmail API is turned on, and on the Audience page either click Publish app or add your Gmail address as a test user.' }),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn', text: 'Turn on the Gmail API', onclick: () => gd.external('https://console.cloud.google.com/apis/library/gmail.googleapis.com' + (S.st && S.st.projectId ? '?project=' + encodeURIComponent(S.st.projectId) : '')) }),
      h('button', { class: 'btn', text: 'Open Audience page', onclick: () => gd.external('https://console.cloud.google.com/auth/audience' + (S.st && S.st.projectId ? '?project=' + encodeURIComponent(S.st.projectId) : '')) })),
    err ? h('div', { class: 'err', role: 'alert', text: err }) : null));
}

function settingsModal() {
  const st = S.st; const set = st.settings;
  modal((box, close) => {
    const sw = (key, label, sub, disabled) => {
      const inp = h('input', { type: 'checkbox', checked: !!set[key], disabled: !!disabled, 'aria-label': label, onchange: async (e) => { S.st = await gd.settings({ [key]: e.target.checked }); applyTheme(); renderReader(); } });
      return h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, label, sub ? h('small', { text: sub }) : null), h('label', { class: 'switch' }, inp, h('span')));
    };
    const theme = h('select', { 'aria-label': 'Theme', onchange: async (e) => { S.st = await gd.settings({ theme: e.target.value }); applyTheme(); renderReader(); } },
      ...[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match Windows']].map(([v, l]) => h('option', { value: v, selected: set.theme === v, text: l })));
    const undo = h('select', { 'aria-label': 'Undo send', onchange: async (e) => { S.st = await gd.settings({ undoSeconds: Number(e.target.value) }); } },
      ...[0, 5, 10, 20, 30].map((n) => h('option', { value: String(n), selected: Number(set.undoSeconds) === n, text: n ? n + ' seconds' : 'Off' })));
    const accts = st.accounts.map((a, i) => h('div', { class: 'set-row' },
      h('span', { class: 'mini-avatar', style: 'background:' + a.color }, (a.email || '?').charAt(0).toUpperCase()),
      h('div', { class: 'lbl' }, a.email, a.needsAuth ? h('small', { style: 'color:var(--warn)', text: 'Needs you to sign in again' }) : h('small', { text: i < 9 ? 'Ctrl+' + (i + 1) + ' to switch' : '' })),
      a.needsAuth ? h('button', { class: 'btn', text: 'Sign in again', onclick: () => { close(); reauth(a.id); } }) : null,
      h('button', { class: 'btn danger', text: 'Remove', onclick: async () => { close(); await gd.removeAccount(a.id).catch((e) => toast(e.message)); } })));
    box.append(
      h('h2', { text: 'Settings' }), h('p', { class: 'sub', text: 'Beacon ' + st.version + (st.mock ? ' (test mode)' : '') }),
      updateSettingsRow(),
      h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Theme'), theme),
      sw('darkEmails', 'Dark email bodies', 'Turns bright emails dark when the dark theme is on'),
      sw('notify', 'New mail alerts', 'A Windows notification with the sender and subject'),
      sw('importantAlerts', 'Only alert me for For You emails', 'Skips alerts for mail For You thinks is not important'),
      sw('primaryOnly', 'Count Primary only', 'The unread number ignores Promotions, Social and Updates'),
      sw('alwaysImages', 'Always show pictures in emails', 'When off, pictures load only when you ask (blocks tracking pixels)'),
      h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Undo send', h('small', { text: 'How long you have to take a sent email back' })), undo),
      sw('startup', 'Start with Windows', st.installed ? 'Opens quietly in the tray when you sign in to Windows' : 'Available after you install Beacon', !st.installed),
      h('h2', { text: 'Accounts', style: 'margin-top:18px;font-size:16px' }), ...accts,
      h('div', { class: 'modal-actions', style: 'justify-content:flex-start' },
        h('button', { class: 'btn', text: 'Add account', onclick: () => { close(); addAccount(); } }),
        h('button', { class: 'btn', text: 'Reset what For You learned', title: 'For the account you are looking at', onclick: async () => { const a = await confirmBox('Reset For You for ' + (acctMeta() || {}).email + '?', 'It forgets your Important and Not important choices and what it learned from your habits, and starts over from the basic signals.', 'Reset', { danger: true }); if (a.ok) { await gd.priorityReset(S.acct); toast('For You starts fresh'); loadList(); } } }),
        st.installed ? h('button', { class: 'btn', text: 'Make Beacon my email app', onclick: () => gd.makeDefault() }) : null),
      h('div', { class: 'modal-actions' },
        st.installed ? h('button', { class: 'btn danger', text: 'Uninstall', onclick: () => gd.uninstall() }) : null,
        h('button', { class: 'btn', text: 'Use a different Google key', title: 'Load a Google key file (Desktop app client JSON)', onclick: async () => { try { if (await gd.loadClient()) { S.st = await gd.state(); toast('Google key loaded. Sign in again to your accounts.'); } } catch (e) { toast(e.message, null, null, 10000); } } }),
        h('button', { class: 'btn', text: 'Show log file', onclick: () => gd.openLog() }),
        h('button', { class: 'btn', text: 'Quit Beacon', onclick: () => gd.quit() }),
        h('button', { class: 'btn primary', text: 'Done', onclick: close })));
  });
}

function shortcutsModal() {
  const rows = [['c', 'Compose'], ['/', 'Search'], ['j / k', 'Next / previous conversation'], ['Enter or o', 'Open'], ['u or Esc', 'Back to the list'], ['e', 'Archive'], ['#', 'Delete'], ['!', 'Report spam'], ['s', 'Star'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['b', 'Snooze'], ['Shift+U / Shift+I', 'Mark unread / read'], ['+ / -', 'Important / not important (teaches For You)'], ['x', 'Select'], ['Ctrl+Enter', 'Send'], ['Ctrl+1…9', 'Switch account'], ['?', 'This list']];
  modal((box, close) => box.append(h('h2', { text: 'Keyboard shortcuts' }), h('div', { style: 'height:8px' }),
    ...rows.map(([k, d]) => h('div', { class: 'set-row' }, h('div', { class: 'lbl', text: d }), h('b', { text: k }))),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', text: 'Close', onclick: close }))));
}

// ----------------------------------------------------------------- keyboard
function moveFocus(dir) {
  if (!S.threads.length) return;
  const curId = S.openId || (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id);
  let i = S.threads.findIndex((t) => t.id === curId);
  i = Math.max(0, Math.min(S.threads.length - 1, i < 0 ? 0 : i + dir));
  const t = S.threads[i];
  if (S.openId && !t.isDraft) openThread(t.id);
  const row = document.querySelector('.row[data-id="' + CSS.escape(t.id) + '"]');
  if (row) { row.focus(); row.scrollIntoView({ block: 'nearest' }); }
}
function targetIds() {
  if (S.sel.size) return [...S.sel];
  if (S.openId) return [S.openId];
  const f = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id;
  return f ? [f] : [];
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) { const a = S.st && S.st.accounts[Number(e.key) - 1]; if (a) { e.preventDefault(); switchAccount(a.id); } return; }
  if (e.key === 'Escape') {
    if (!$('modal-back').hidden) { $('modal-back').hidden = true; return; }
    if (document.querySelector('.menu')) { closeMenus(); return; }
    if (!isTyping(e) && S.openId) { closeThread(); return; }
  }
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || !$('modal-back').hidden) return;
  const k = e.key;
  const ids = targetIds();
  const map = {
    c: () => startCompose(), '/': () => $('search').focus(), j: () => moveFocus(1), k: () => moveFocus(-1),
    o: () => { const f = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id; if (f) openThread(f); },
    u: () => closeThread(), e: () => act(ids, 'archive'), '#': () => act(ids, 'trash'), '!': () => act(ids, 'spam'),
    s: () => { const t = threadById(ids[0]) || S.thread; if (t) act(ids, t.starred ? 'unstar' : 'star'); },
    r: () => S.thread && startReply('reply'), a: () => S.thread && startReply('replyall'), f: () => S.thread && startReply('forward'),
    b: () => { if (!ids.length) return; const anchor = document.querySelector('.r-tools [aria-label^="Snooze"]') || document.querySelector('#toolbar [aria-label^="Snooze"]') || $('search'); snoozeMenu(anchor, ids); },
    U: () => act(ids, 'unread'), I: () => act(ids, 'read'), '?': shortcutsModal, '+': () => teach(ids, true), '=': () => teach(ids, true), '-': () => teach(ids, false),
    x: () => { const f = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id; if (f) { if (S.sel.has(f)) S.sel.delete(f); else S.sel.add(f); renderList(); const row = document.querySelector('.row[data-id="' + CSS.escape(f) + '"]'); if (row) row.focus(); } },
  };
  const fn = map[k];
  if (fn) { e.preventDefault(); fn(); }
});

// ----------------------------------------------------------------- wiring
$('btn-compose').addEventListener('click', () => startCompose());
$('btn-add-acct').addEventListener('click', addAccount);
$('btn-settings').addEventListener('click', settingsModal);
$('btn-theme').addEventListener('click', async () => { S.st = await gd.settings({ theme: isDark() ? 'light' : 'dark' }); applyTheme(); renderReader(); });
$('btn-new-label').addEventListener('click', async () => { const n = await askText('New label', 'Label name', 'Create'); if (n) createLabel(n); });
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search').value.trim();
  if (!q) { setView({ kind: 'folder', key: 'inbox', tab: S.view.tab || 'foryou' }); return; }
  S.view = { kind: 'search', q }; S.sel.clear(); closeThread(true); renderSide(); loadList();
});
$('search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('search').value = ''; $('search').blur(); } });

gd.onState((st) => {
  const had = S.st ? S.st.accounts.map((a) => a.id).join() : '';
  S.st = st;
  if (!st.accounts.length) { renderWelcome(); return; }
  $('welcome').hidden = true;
  if (!st.accounts.find((a) => a.id === S.acct)) { switchAccount(st.active || st.accounts[0].id, true); return; }
  applyTheme(); renderRail(); renderSide();
  if (had !== st.accounts.map((a) => a.id).join()) renderList();
});
gd.onCounts((c) => { if (!S.st) return; S.st.counts = c; renderRail(); renderSide(); });
gd.onMailChanged((id) => {
  if (id !== S.acct) return;
  const v = S.view;
  if (S.sel.size) return;
  if ((v.kind === 'folder' && (v.key === 'inbox' || v.key === 'all' || v.key === 'important')) || v.kind === 'label') loadList({ silent: true });
});
gd.onOpenThread(async ({ accountId, threadId }) => {
  if (accountId !== S.acct) await switchAccount(accountId);
  openThread(threadId);
});
gd.onSwitchAccount((id) => switchAccount(id));
gd.onComposeNew(() => startCompose());
gd.onComposeMailto((f) => startCompose({ to: f.to || '', cc: f.cc || '', bcc: f.bcc || '', subject: f.subject || '', html: escapeHtml(f.body || '').replace(/\r?\n/g, '<br>') }));
gd.onSendStatus((s) => {
  if (s.status === 'sent') {
    toast('Message sent', 'View', () => { if (s.accountId === S.acct) openThread(s.threadId); });
    if (s.accountId === S.acct && S.thread && S.thread.id === s.threadId) { const id = S.openId; S.openId = null; openThread(id); }
    if (s.accountId === S.acct && S.view.kind === 'folder' && ['sent', 'drafts', 'scheduled'].includes(S.view.key)) loadList({ silent: true });
  } else if (s.status === 'failed') {
    toast('Could not send: ' + s.error, null, null, 12000);
    // Put the message back in a composer so nothing is lost.
    if (s.draft && !S.comp) {
      S.comp = newComp({ acct: s.accountId, mode: s.draft.mode || 'new', threadId: s.draft.threadId, sourceMessageId: s.draft.sourceMessageId, draftId: s.draft.draftId, to: (s.draft.to || []).join(', '), cc: (s.draft.cc || []).join(', '), bcc: (s.draft.bcc || []).join(', '), subject: s.draft.subject || '', html: s.draft.html || '', from: s.draft.from, fromName: s.draft.fromName, files: (s.draft.files || []).map((f) => ({ path: f.path, name: f.name, size: 0 })), err: 'Not sent: ' + s.error, includeQuote: s.draft.includeQuote !== false });
      S.comp.inline = false; renderComposerHost();
    }
  }
});

(async function start() {
  try { S.st = await gd.state(); } catch (e) { renderWelcome(e.message); return; }
  applyTheme();
  if (!S.st.accounts.length) { renderWelcome(); return; }
  S.acct = S.st.active || S.st.accounts[0].id;
  renderAll();
  loadLabels();
  loadList();
})();
