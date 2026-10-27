'use strict';
/* Inbox cleanup: mail grouped by sender, with one-click archive, mark read, delete and unsubscribe. */

const CLEAN_SCOPES = [
  { key: 'promotions', label: 'Promotions' },
  { key: 'social', label: 'Social' },
  { key: 'updates', label: 'Updates' },
  { key: 'unread', label: 'Unread' },
  { key: 'inbox', label: 'Whole Inbox' },
];
S.clean = { acct: null, scope: 'promotions', state: 'idle', done: 0, total: 0, err: '', result: null, sort: 'count', busy: new Set(), cache: {} };

function openCleanup() { setView({ kind: 'cleanup' }); }

function cleanupScan(force) {
  const c = S.clean;
  const key = S.acct + '|' + c.scope;
  if (!force && c.cache[key]) { c.result = c.cache[key]; c.state = 'ok'; c.acct = S.acct; renderList(); return; }
  const seq = (c.seq = (c.seq || 0) + 1);
  const acct = S.acct; const scope = c.scope;
  Object.assign(c, { acct, state: 'scanning', done: 0, total: 0, err: '', result: null });
  renderList();
  gd.cleanupScan(acct, scope).then((r) => {
    c.cache[acct + '|' + scope] = r;
    if (seq !== c.seq) return;
    c.result = r; c.state = 'ok';
    if (S.view.kind === 'cleanup') renderList();
  }).catch((e) => {
    if (seq !== c.seq) return;
    c.state = 'error'; c.err = e.message;
    if (S.view.kind === 'cleanup') renderList();
  });
}
gd.onCleanupProgress((p) => {
  const c = S.clean;
  if (p.accountId !== c.acct || p.scope !== c.scope || c.state !== 'scanning') return;
  c.done = p.done; c.total = p.total;
  const bar = document.getElementById('clean-bar');
  const txt = document.getElementById('clean-txt');
  if (bar) bar.style.width = (p.total ? Math.round((p.done / p.total) * 100) : 5) + '%';
  if (txt) txt.textContent = 'Reading ' + p.done.toLocaleString() + ' of ' + p.total.toLocaleString() + ' emails…';
});

function renderCleanup() {
  const c = S.clean;
  if (c.acct !== S.acct || c.state === 'idle') { c.acct = S.acct; c.state = 'idle'; cleanupScan(false); return; }
  // Scope chips live where the inbox tabs normally are.
  const tabs = $('tabs');
  tabs.hidden = false;
  tabs.replaceChildren(...CLEAN_SCOPES.map((s) => h('button', { class: 'tab' + (c.scope === s.key ? ' active' : ''), onclick: () => { if (c.scope === s.key) return; c.scope = s.key; cleanupScan(false); } }, s.label)));

  const tb = $('toolbar');
  const sortSel = h('select', { class: 'clean-sort', 'aria-label': 'Sort senders', onchange: (e) => { c.sort = e.target.value; renderList(); } },
    ...[['count', 'Most emails'], ['unread', 'Most unread'], ['recent', 'Most recent'], ['name', 'Name']].map(([v, t]) => h('option', { value: v, selected: c.sort === v, text: t })));
  const r = c.result;
  const info = c.state === 'ok' && r ? r.senders.length.toLocaleString() + (r.senders.length === 1 ? ' sender' : ' senders') + ' in ' + (r.capped ? 'the newest ' : '') + r.scanned.toLocaleString() + ' emails' : '';
  tb.replaceChildren(tbBtn('refresh', 'Scan again', () => cleanupScan(true)), h('span', { class: 'tb-sep' }), sortSel, h('span', { class: 'tb-info', text: info }));

  const box = $('list');
  if (c.state === 'scanning') {
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 5;
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Sorting your ' + CLEAN_SCOPES.find((s) => s.key === c.scope).label + ' mail by sender' }),
      h('div', { class: 'clean-prog' }, h('div', { id: 'clean-bar', style: 'width:' + pct + '%' })),
      h('div', { id: 'clean-txt', text: c.total ? 'Reading ' + c.done.toLocaleString() + ' of ' + c.total.toLocaleString() + ' emails…' : 'Finding emails…' })));
    return;
  }
  if (c.state === 'error') {
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Could not scan this mail' }), c.err, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', text: 'Try again', onclick: () => cleanupScan(true) }))));
    return;
  }
  if (!r || !r.senders.length) {
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Nothing to clean up' }), 'There is no mail in ' + CLEAN_SCOPES.find((s) => s.key === c.scope).label + ' right now.'));
    return;
  }
  const list = r.senders.slice();
  const by = { count: (a, b) => b.count - a.count || b.last - a.last, unread: (a, b) => b.unread - a.unread || b.count - a.count, recent: (a, b) => b.last - a.last, name: (a, b) => (a.name || a.email).localeCompare(b.name || b.email) };
  list.sort(by[c.sort] || by.count);
  box.replaceChildren(h('div', { class: 'clean-hint', text: 'Biggest senders first. Each button acts on all of that sender\'s mail in ' + CLEAN_SCOPES.find((s) => s.key === c.scope).label.toLowerCase() + ', not only what is listed. Archive and Mark read can be undone for a few seconds; deleted mail stays in Trash for 30 days.' }), ...list.map(senderRow));
  $('panes').classList.toggle('cleanup', !S.openId && !(S.comp && !S.comp.inline));
}

function senderRow(g) {
  const c = S.clean;
  const busy = c.busy.has(g.email);
  const nm = g.name || g.email.split('@')[0];
  const btn = (label, title, fn, cls) => h('button', { class: 'tb text' + (cls ? ' ' + cls : ''), title, disabled: busy, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  return h('div', { class: 'row sender' + (g.unread ? ' unread' : '') + (busy ? ' busy' : ''), role: 'listitem', 'data-email': g.email },
    h('span', { class: 'av', style: 'background:' + colorFor(g.email), text: nm.charAt(0).toUpperCase() }),
    h('div', { class: 'body' },
      h('div', { class: 'top' }, h('span', { class: 'who', text: nm }), h('span', { class: 'addr', text: g.email })),
      h('div', { class: 'subj', text: g.count.toLocaleString() + (g.count === 1 ? ' email' : ' emails') + (g.unread ? ' · ' + g.unread.toLocaleString() + ' unread' : '') + ' · last ' + fmtListDate(g.last) }),
      h('div', { class: 'snip', text: g.subject || '' })),
    h('div', { class: 'clean-acts' },
      g.unsubbed ? h('button', { class: 'tb text unsubbed', disabled: true, title: 'You already unsubscribed. Mail they sent before stays until you delete or archive it.' }, icon('check'), 'Unsubscribed')
        : g.unsub ? btn('Unsubscribe', 'Stop getting mail from this sender', () => cleanUnsub(g)) : null,
      btn('Archive all', 'Take all of their mail out of the inbox', () => cleanAct(g, 'archive')),
      g.unread ? btn('Mark read', 'Mark all of their mail as read', () => cleanAct(g, 'read')) : null,
      btn('Delete all', 'Move all of their mail to Trash', () => cleanAct(g, 'trash'), 'danger'),
      btn('View', 'Show their emails', () => { const q = 'from:' + g.email; $('search').value = q; S.view = { kind: 'search', q }; S.sel.clear(); closeThread(true); renderSide(); loadList(); })));
}

function confirmBox(title, text, okLabel, opts = {}) {
  return new Promise((resolve) => {
    modal((box, close) => {
      let cb = null;
      const done = (ok) => { close(); resolve({ ok, checked: !!(cb && cb.checked) }); };
      box.append(h('h2', { text: title }), h('p', { class: 'modal-text', text: text }));
      if (opts.checkbox) { cb = h('input', { type: 'checkbox', checked: !!opts.checked }); box.append(h('label', { class: 'modal-check' }, cb, opts.checkbox)); }
      box.append(h('div', { class: 'modal-actions' }, h('button', { class: 'btn', text: 'Cancel', onclick: () => done(false) }), h('button', { class: 'btn primary' + (opts.danger ? ' danger-fill' : ''), text: okLabel, onclick: () => done(true) })));
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    });
  });
}

const CLEAN_DONE = { archive: 'Archived', read: 'Marked as read', trash: 'Moved to Trash' };
async function cleanAct(g, action, { quiet } = {}) {
  const c = S.clean;
  const nm = g.name || g.email;
  if (action === 'trash' && !quiet) {
    const a = await confirmBox('Delete all mail from ' + nm + '?', 'Every email from ' + g.email + ' in ' + CLEAN_SCOPES.find((s) => s.key === c.scope).label.toLowerCase() + ' goes to Trash. Gmail keeps Trash for 30 days, so you can still get them back from there.', 'Move to Trash', { danger: true });
    if (!a.ok) return;
  }
  const acct = S.acct; const scope = c.scope;
  c.busy.add(g.email); renderList();
  try {
    const r = await gd.cleanupAct(acct, scope, g.email, action);
    const res = c.cache[acct + '|' + scope];
    const before = Object.assign({}, g);
    if (res) {
      if (action === 'read' && scope !== 'unread') { const x = res.senders.find((s) => s.email === g.email); if (x) x.unread = 0; }
      else res.senders = res.senders.filter((s) => s.email !== g.email);
    }
    if (!quiet) {
      const msg = CLEAN_DONE[action] + ' ' + r.count.toLocaleString() + (r.count === 1 ? ' email' : ' emails') + ' from ' + nm;
      if (r.undo) toast(msg, 'Undo', async () => {
        try {
          await gd.cleanupUndo(r.undo);
          toast('Undone');
          if (res && !res.senders.find((s) => s.email === g.email)) res.senders.push(Object.assign(g, before));
          else if (res && action === 'read') { const x = res.senders.find((s) => s.email === g.email); if (x) x.unread = before.unread; }
          if (S.view.kind === 'cleanup') renderList();
        } catch (e) { toast(e.message); }
      }, 10000);
      else toast(msg);
    }
    gd.refreshCounts();
    return r;
  } catch (e) { toast('Could not do that: ' + e.message, null, null, 8000); }
  finally { c.busy.delete(g.email); if (S.view.kind === 'cleanup') renderList(); }
}

async function cleanUnsub(g) {
  const nm = g.name || g.email;
  const u = g.unsub;
  const how = u.oneClick ? 'Beacon will ask ' + nm + ' to take you off their list. Nothing is sent from your address.'
    : u.mailto ? 'Beacon will send a short unsubscribe email from your address to ' + decodeURIComponent(u.mailto.replace(/^mailto:/i, '').split('?')[0]) + '.'
      : 'Their unsubscribe page will open in your browser. Finish there.';
  const a = await confirmBox('Unsubscribe from ' + nm + '?', how + ' Their emails stay here so you can delete them when you are ready.', 'Unsubscribe');
  if (!a.ok) return;
  const c = S.clean;
  c.busy.add(g.email); renderList();
  let r;
  try { r = await gd.unsubscribe(S.acct, g.email); }
  catch (e) { toast('Could not unsubscribe: ' + e.message, null, null, 8000); c.busy.delete(g.email); renderList(); return; }
  c.busy.delete(g.email);
  const msg = r.method === 'browser' ? 'Opened their unsubscribe page in your browser' : 'Unsubscribed from ' + nm + (r.method === 'email' ? ' (email sent)' : '');
  g.unsubbed = true; // the row stays, with the button dimmed, until you delete their mail
  renderList(); toast(msg);
}

function cleanupHelp() {
  return h('div', { class: 'r-empty' }, h('div', { style: 'max-width:380px' }, icon('archive'),
    h('div', { style: 'font-size:16px;color:var(--fg);margin-bottom:8px', text: 'Clean up your inbox' }),
    h('div', { style: 'line-height:1.6', text: 'Your mail is grouped by who sent it, biggest senders first. Archive, mark read or delete everything from a sender in one click, or unsubscribe so it stops coming. Archive and Mark read can be undone for a short time; deleted mail stays in Trash for 30 days.' })));
}
