'use strict';
/* One email's ⋮ menu (like Gmail's): reply, forward, delete, mark unread, block, report spam,
   filter messages like this, translate, print, download and show original. Also the Unsubscribe
   link next to the sender. */

S.unsubbed = {}; // accountId -> Set of sender addresses already unsubscribed

function messageMenuItems(m) {
  const addr = emailOf(m.from);
  const who = nameOf(m.from) || addr;
  return [
    { label: 'Reply', icon: 'reply', fn: () => startReply('reply', m.id) },
    { label: 'Reply all', icon: 'replyAll', fn: () => startReply('replyall', m.id) },
    { label: 'Forward', icon: 'forward', fn: () => startReply('forward', m.id) },
    '-',
    { label: 'Delete this message', icon: 'trash', fn: () => deleteOneMessage(m) },
    { label: 'Mark unread from here', icon: 'mail', fn: () => markUnreadFromHere(m) },
    '-',
    { label: 'Block "' + who + '"', icon: 'block', fn: () => blockSender(m) },
    { label: 'Report spam', icon: 'spam', fn: () => S.thread && act([S.thread.id], 'spam') },
    '-',
    { label: 'Filter messages like this', icon: 'filter', fn: () => filterDialog({ from: addr }) },
    { label: 'Translate', icon: 'translate', fn: () => translateMessage(m) },
    { label: 'Print', icon: 'print', fn: () => printThread([m.id]) },
    { label: 'Download message', icon: 'download', fn: () => downloadMessage(m) },
    { label: 'Show original', icon: 'code', fn: () => showOriginal(m) },
    '-',
    { label: 'Always show pictures from ' + addr, icon: 'image', fn: () => trustSender(addr) },
  ];
}

async function deleteOneMessage(m) {
  const t = S.thread; if (!t) return;
  if (t.messages.length <= 1) { act([t.id], 'trash'); return; }
  try {
    await gd.msgTrash(S.acct, m.id);
    t.messages = t.messages.filter((x) => x.id !== m.id);
    renderReader();
    toast('Message moved to Trash');
  } catch (e) { toast('Could not delete it: ' + e.message, null, null, 8000); }
}

async function markUnreadFromHere(m) {
  try { await gd.msgUnread(S.acct, m.id); } catch (e) { toast(e.message); return; }
  const row = S.thread && threadById(S.thread.id);
  if (row) row.unread = true;
  closeThread();
  renderList();
  toast('Marked unread from that message');
}

// ----------------------------------------------------------------- unsubscribe next to the sender
function unsubLink(m) {
  if (!/<(https:|mailto:)/i.test(m.listUnsubscribe || '')) return null;
  const done = (S.unsubbed[S.acct] || new Set()).has(emailOf(m.from));
  if (done) return h('span', { class: 'unsub-link done', title: 'You already unsubscribed from this sender', text: 'Unsubscribed' });
  return h('button', { class: 'unsub-link', title: 'Stop getting emails from this sender', text: 'Unsubscribe', onclick: (e) => { e.stopPropagation(); unsubscribeFrom(m); } });
}
async function loadUnsubbed() {
  const acct = S.acct;
  if (S.unsubbed[acct]) return;
  S.unsubbed[acct] = new Set();
  try { (await gd.unsubscribed(acct)).forEach((x) => S.unsubbed[acct].add(x)); if (S.thread) renderReader(); } catch (_) {}
}
async function unsubscribeFrom(m) {
  const who = nameOf(m.from) || emailOf(m.from);
  const all = String(m.listUnsubscribe || '');
  const mailto = (/<mailto:([^>?]+)/i.exec(all) || [])[1];
  const how = /<https:/i.test(all)
    ? 'Beacon asks ' + who + ' to take you off their list. If they don\'t support that, their unsubscribe page opens in your browser' + (mailto ? ', or Beacon sends a short unsubscribe email to ' + decodeURIComponent(mailto) : '') + '.'
    : 'Beacon will send a short unsubscribe email from your address to ' + decodeURIComponent(mailto || 'them') + '.';
  const a = await confirmBox('Unsubscribe from ' + who + '?', how + ' The emails you already have stay where they are.', 'Unsubscribe');
  if (!a.ok) return;
  try {
    const r = await gd.msgUnsub(S.acct, m.id);
    (S.unsubbed[S.acct] = S.unsubbed[S.acct] || new Set()).add(emailOf(m.from));
    renderReader();
    toast(r.method === 'browser' ? 'Opened their unsubscribe page in your browser' : 'Unsubscribed from ' + who + (r.method === 'email' ? ' (email sent)' : ''));
  } catch (e) { toast('Could not unsubscribe: ' + e.message, null, null, 8000); }
}

// ----------------------------------------------------------------- filters and block
/** Asks for the Google permission that filters need, then tries again. */
function askFilterPermission(retry) {
  modal((box, close) => {
    box.append(
      h('h2', { text: 'Allow Beacon to make filters' }),
      h('p', { class: 'sub', text: 'Blocking a sender and filters are saved in your Gmail settings, so they also work on your phone and on the web. That takes one more Google permission.' }),
      h('ol', { class: 'perm-steps' },
        h('li', { text: 'Click Allow. Your browser opens the Google sign-in.' }),
        h('li', { text: 'Tick the box about managing your basic mail settings (filters), along with the others, then Continue.' }),
        h('li', { text: 'Come back to Beacon. It finishes what you asked right away.' })),
      h('div', { class: 'modal-actions' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', text: 'Not now', onclick: () => close() }),
        h('button', { class: 'btn primary', text: 'Allow', onclick: async (e) => {
          e.target.disabled = true;
          try { await gd.reauth(S.acct); S.st = await gd.state(); close(); await retry(true); }
          catch (err) { e.target.disabled = false; toast(signInHelp(err), null, null, 8000); }
        } })));
  });
}

async function makeFilter(f, again) {
  try { return await gd.filterCreate(S.acct, f); }
  catch (e) {
    if (e.code === 'filters_scope' && !again) { askFilterPermission(() => makeFilter(f, true).then((r) => r && toast(f.doneMsg || 'Filter created'))); return null; }
    throw e;
  }
}

async function blockSender(m) {
  const addr = emailOf(m.from); const who = nameOf(m.from) || addr;
  const a = await confirmBox('Block ' + who + '?', 'Emails from ' + addr + ' will go straight to Trash, here and in Gmail on your phone and the web. You can undo it later in Gmail\'s Settings > Filters and Blocked Addresses.', 'Block', { checkbox: 'Also move the emails you already have from them to Trash' });
  if (!a.ok) return;
  const f = { criteria: { from: addr }, actions: { trash: true, skipInbox: true }, applyExisting: !!a.checked, doneMsg: who + ' is blocked' };
  try {
    const r = await makeFilter(f);
    if (!r) return;
    toast(who + ' is blocked' + (r.applied ? ' and ' + r.applied + ' emails went to Trash' : ''));
    if (a.checked && S.thread) { closeThread(); loadList({ silent: true }); }
  } catch (e) { toast('Could not block them: ' + e.message, null, null, 8000); }
}

function filterDialog(pre) {
  modal((box, close) => {
    box.classList.add('filter-modal');
    const inp = (ph, v) => h('input', { class: 'ev-in', type: 'text', placeholder: ph, value: v || '' });
    const f = { from: inp('someone@example.com', pre.from), to: inp('', pre.to), subject: inp('', pre.subject), query: inp('words in the email', '') };
    const att = h('input', { type: 'checkbox' });
    const acts = [['skipInbox', 'Skip the Inbox (archive it)'], ['markRead', 'Mark as read'], ['star', 'Star it'], ['important', 'Always mark it as important'], ['notImportant', 'Never mark it as important'], ['neverSpam', 'Never send it to Spam'], ['trash', 'Delete it']];
    const boxes = Object.fromEntries(acts.map(([k]) => [k, h('input', { type: 'checkbox' })]));
    const label = h('select', { class: 'ev-in' }, h('option', { value: '', text: 'Don\'t add a label' }), ...S.labels.map((l) => h('option', { value: l.id, text: l.name })));
    const existing = h('input', { type: 'checkbox', checked: true });
    const err = h('div', { class: 'c-err', role: 'alert' });
    const row = (lbl, el) => h('div', { class: 'ev-row' }, h('label', { class: 'ev-lbl', text: lbl }), h('div', { class: 'ev-val' }, el));
    const create = async (btn) => {
      err.textContent = '';
      const criteria = { from: f.from.value, to: f.to.value, subject: f.subject.value, query: f.query.value, hasAttachment: att.checked };
      const actions = Object.fromEntries(acts.map(([k]) => [k, boxes[k].checked])); actions.label = label.value || '';
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await makeFilter({ criteria, actions, applyExisting: existing.checked, doneMsg: 'Filter created' });
        if (!r) return; // the permission window took its place; the filter is made after you allow it
        close();
        toast('Filter created' + (r.applied ? ' and applied to ' + r.applied + ' emails you already have' : ''));
        loadList({ silent: true });
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Create filter'; }
    };
    const go = h('button', { class: 'btn primary', text: 'Create filter', onclick: (e) => create(e.currentTarget) });
    box.append(
      h('div', { class: 'ev-top' }, h('h2', { text: 'Filter messages like this' }), tbBtn('close', 'Close', () => close())),
      h('p', { class: 'sub', text: 'Saved in your Gmail settings, so it also works on your phone and on the web.' }),
      h('div', { class: 'filter-sec', text: 'When an email matches' }),
      row('From', f.from), row('To', f.to), row('Subject', f.subject), row('Has the words', f.query),
      row('', h('label', { class: 'ev-check' }, att, 'Has an attachment')),
      h('div', { class: 'filter-sec', text: 'Do this' }),
      h('div', { class: 'filter-acts' }, ...acts.map(([k, t]) => h('label', { class: 'ev-check' }, boxes[k], t))),
      row('Label', label),
      h('label', { class: 'ev-check', style: 'margin-top:10px' }, existing, 'Also apply to matching emails I already have'),
      err,
      h('div', { class: 'modal-actions' }, h('span', { class: 'grow' }), h('button', { class: 'btn', text: 'Cancel', onclick: () => close() }), go));
  });
}

// ----------------------------------------------------------------- translate, download, show original
function translateMessage(m) {
  let text = m.text || '';
  if (!text && m.html) { const d = new DOMParser().parseFromString(m.html, 'text/html'); d.querySelectorAll('style,script').forEach((n) => n.remove()); text = d.body ? d.body.innerText || d.body.textContent || '' : ''; }
  text = (m.subject ? m.subject + '\n\n' : '') + text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) { toast('There is no text in this email to translate.'); return; }
  const cut = text.length > 4500;
  gd.external('https://translate.google.com/?sl=auto&tl=' + encodeURIComponent((navigator.language || 'en').split('-')[0]) + '&op=translate&text=' + encodeURIComponent(text.slice(0, 4500)));
  toast(cut ? 'Opened Google Translate with the first part of the email (it was too long to send all of it)' : 'Opened Google Translate in your browser');
}

async function downloadMessage(m) {
  try { const p = await gd.msgDownload(S.acct, m.id, m.subject); if (p) toast('Saved to ' + p); }
  catch (e) { toast('Could not download it: ' + e.message, null, null, 8000); }
}

async function showOriginal(m) {
  let o;
  try { o = await gd.msgOriginal(S.acct, m.id); } catch (e) { toast('Could not load it: ' + e.message, null, null, 8000); return; }
  modal((box, close) => {
    box.classList.add('original-modal');
    const badge = (v) => h('span', { class: 'auth ' + (v === 'PASS' ? 'ok' : v ? 'bad' : 'none'), text: v || 'NONE' });
    const kv = (k, v) => h('div', { class: 'orig-row' }, h('span', { class: 'k', text: k }), typeof v === 'string' ? h('span', { class: 'v', text: v || '' }) : v);
    const pre = h('pre', { class: 'orig-src', text: o.source });
    box.append(
      h('div', { class: 'ev-top' }, h('h2', { text: 'Original message' }), tbBtn('close', 'Close', () => close())),
      h('div', { class: 'orig-head' },
        kv('Message ID', o.messageId), kv('Created at', o.date), kv('From', o.from), kv('To', o.to), kv('Subject', o.subject),
        kv('SPF', badge(o.spf)), kv('DKIM', badge(o.dkim)), kv('DMARC', badge(o.dmarc))),
      pre,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', text: 'Download original', onclick: () => downloadMessage(m) }),
        h('button', { class: 'btn', text: 'Copy to clipboard', onclick: () => { navigator.clipboard.writeText(o.source).then(() => toast('Copied'), () => toast('Could not copy')); } }),
        h('span', { class: 'grow' }), h('button', { class: 'btn primary', text: 'Close', onclick: () => close() })));
  });
}
