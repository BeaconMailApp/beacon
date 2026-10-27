'use strict';
/* Reading pane: conversation view with safely sandboxed email bodies. */

async function openThread(id) {
  if (S.openId === id && S.thread) return;
  await stashComposer(true);
  S.openId = id; S.thread = null; S.threadState = 'loading'; S.expanded = new Set();
  $('panes').classList.add('has-open');
  renderList(); renderReader();
  const acctId = S.acct;
  try {
    const t = await gd.thread(acctId, id);
    if (S.openId !== id || acctId !== S.acct) return;
    S.thread = t; S.threadState = 'ok';
    const msgs = t.messages;
    msgs.forEach((m, i) => { if (i === msgs.length - 1 || m.labelIds.includes('UNREAD')) S.expanded.add(m.id); });
    renderReader();
    { const row = threadById(id); if (row && row.unread) gd.priorityLearn(acctId, 'open', [rowForTeach(row)]).catch(() => {}); }
    if (t.unread) {
      gd.action(acctId, [id], 'read').then(() => {
        const row = threadById(id); if (row) applyLabelChange(row, 'read');
        if (S.thread && S.thread.id === id) applyLabelChange(S.thread, 'read');
        renderList(); gd.refreshCounts();
      }).catch(() => {});
    }
  } catch (e) {
    if (S.openId !== id) return;
    S.threadState = 'error'; S.threadErr = e.message; renderReader();
  }
}
function closeThread(keepList) {
  S.openId = null; S.thread = null; S.threadState = 'idle';
  if (S.comp && S.comp.inline) S.comp = null;
  $('panes').classList.remove('has-open');
  renderReader();
  if (!keepList) renderList();
}

function renderReader() {
  const box = $('reader');
  if (S.comp && !S.comp.inline && !S.openId) { box.replaceChildren(composerEl()); return; }
  $('panes').classList.toggle('cleanup', (S.view.kind === 'cleanup' || S.view.kind === 'calendar') && !S.openId && !(S.comp && !S.comp.inline));
  if (!S.openId && (S.view.kind === 'cleanup' || S.view.kind === 'calendar')) {
    box.replaceChildren(S.view.kind === 'calendar' ? h('div', { class: 'r-empty' }) : cleanupHelp());
    if (S.comp && !S.comp.inline) box.append(composerEl());
    return;
  }
  if (!S.openId) {
    box.replaceChildren(h('div', { class: 'r-empty' }, h('div', {}, icon('mail'), h('div', { text: S.threads.length ? 'Pick a conversation to read it' : 'No conversation selected' }), h('div', { style: 'font-size:12px;margin-top:6px', text: 'Shortcuts: c compose · / search · j k move · e archive · # delete · r reply' }))));
    if (S.comp && !S.comp.inline) box.append(composerEl());
    return;
  }
  const back = tbBtn('back', 'Back to list (u)', () => closeThread());
  if (S.threadState === 'loading') { box.replaceChildren(h('div', { class: 'r-head' }, h('div', { class: 'r-tools' }, back)), ...Array.from({ length: 4 }, () => h('div', { class: 'skel' }))); return; }
  if (S.threadState === 'error') { box.replaceChildren(h('div', { class: 'r-head' }, h('div', { class: 'r-tools' }, back)), h('div', { class: 'empty' }, h('b', { text: 'Could not open this conversation' }), S.threadErr, h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn', text: 'Try again', onclick: () => { const id = S.openId; S.openId = null; openThread(id); } })))); return; }
  const t = S.thread;
  const ids = [t.id];
  const tools = h('div', { class: 'r-tools' }, back);
  if (t.trash) tools.append(h('button', { class: 'tb text', text: 'Restore', onclick: () => act(ids, 'untrash') }), h('button', { class: 'tb text', text: 'Delete forever', onclick: () => act(ids, 'forever') }));
  else if (t.spam) tools.append(h('button', { class: 'tb text', text: 'Not spam', onclick: () => act(ids, 'notspam') }), tbBtn('trash', 'Delete forever', () => act(ids, 'forever')));
  else {
    tools.append(t.inbox ? tbBtn('archive', 'Archive (e)', () => act(ids, 'archive')) : tbBtn('unarchive', 'Move to Inbox', () => act(ids, 'inbox')));
    tools.append(tbBtn('spam', 'Report spam (!)', () => act(ids, 'spam')), tbBtn('trash', 'Delete (#)', () => act(ids, 'trash')));
    const sz = tbBtn('clock', 'Snooze (b)', () => snoozeMenu(sz, ids));
    tools.append(sz);
  }
  tools.append(h('span', { class: 'tb-sep' }), tbBtn('mail', 'Mark as unread (Shift+U)', () => act(ids, 'unread').then(() => closeThread())));
  { const row = threadById(t.id); const pr = (row && row.priority) || t.priority; const imp = pr ? pr.important : null;
    // Two clear buttons: the lit one is where this email is now. Clicking the lit one does nothing.
    const pick = (want) => () => { if (imp === want) { toast(want ? 'Already in For You' : 'Already in Everything else'); return; } teach(ids, want); };
    tools.append(h('span', { class: 'fy-pair' },
      h('button', { class: 'tb text fy-btn' + (imp === true ? ' on' : ''), title: 'Important: show this sender in For You (+)', onclick: pick(true) }, icon('important'), 'Important'),
      h('button', { class: 'tb text fy-btn' + (imp === false ? ' on off' : ''), title: 'Not important: move this sender to Everything else (-)', onclick: pick(false) }, icon('notimp'), 'Not important'))); }
  const mv = tbBtn('move', 'Move to', () => moveMenu(mv, ids));
  const lb = tbBtn('label', 'Labels', () => labelMenu(lb, ids, labelsOf(ids)));
  const more = tbBtn('more', 'More', () => popMenu(more, [
    { label: t.starred ? 'Remove star' : 'Add star', icon: 'star', fn: () => act(ids, t.starred ? 'unstar' : 'star') },
    { label: t.important ? 'Mark not important' : 'Mark important', icon: 'important', fn: () => act(ids, t.important ? 'notimportant' : 'important') },
    '-',
    { label: 'Open in Gmail on the web', icon: 'external', fn: () => gd.external('https://mail.google.com/mail/u/?authuser=' + encodeURIComponent((acctMeta() || {}).email || '') + '#all/' + t.id) },
    unsubscribeLink(t) ? { label: 'Unsubscribe', icon: 'close', fn: () => gd.external(unsubscribeLink(t)) } : null,
  ].filter(Boolean)));
  tools.append(mv, lb, more);
  const first = t.messages[0] || {};
  const labelPills = (t.labelIds || []).map((id) => S.labels.find((l) => l.id === id)).filter(Boolean).map((l) => h('span', { class: 'pill', text: l.name }));
  const head = h('div', { class: 'r-head' }, tools);
  const title = h('div', { class: 'r-title' }, h('h1', { text: first.subject || '(no subject)' }),
    h('button', { class: 'star tb' + (t.starred ? ' on' : ''), style: t.starred ? 'color:var(--star)' : '', title: t.starred ? 'Starred' : 'Star', onclick: () => act(ids, t.starred ? 'unstar' : 'star') }, icon('star')));
  const nodes = [head, title];
  const until = snoozedUntil(t.id);
  if (until) nodes.push(h('div', { class: 'r-snoozed' }, icon('clock'), h('span', { text: 'Snoozed until ' + fmtWhen(until) + '.' }),
    h('button', { class: 'linkish', text: 'Unsnooze', onclick: () => act(ids, 'unsnooze') })));
  if (labelPills.length) nodes.push(h('div', { class: 'r-labels', style: 'padding:0 24px 8px' }, ...labelPills));
  const msgs = t.messages;
  // Collapse long middles like Gmail: show first, last few, and a "N older" bar.
  const hideMiddle = msgs.length > 4 && S.showAllFor !== t.id;
  msgs.forEach((m, i) => {
    if (hideMiddle && i > 0 && i < msgs.length - 2 && !S.expanded.has(m.id)) {
      if (i === 1) nodes.push(h('div', { style: 'padding:6px 24px 6px 76px;border-bottom:1px solid var(--line)' }, h('button', { class: 'btn', text: (msgs.length - 3) + ' older messages', onclick: () => { S.showAllFor = t.id; renderReader(); } })));
      return;
    }
    nodes.push(messageEl(m, i === msgs.length - 1));
  });
  if (S.comp && S.comp.inline && S.comp.threadId === t.id) nodes.push(composerEl());
  else if (!t.spam) {
    const multi = msgs.some((m) => (splitAddrs(m.to).length + splitAddrs(m.cc).length) > 1);
    nodes.push(h('div', { class: 'reply-bar' },
      h('button', { class: 'btn', onclick: () => startReply('reply') }, icon('reply'), 'Reply'),
      multi ? h('button', { class: 'btn', onclick: () => startReply('replyall') }, icon('replyAll'), 'Reply all') : null,
      h('button', { class: 'btn', onclick: () => startReply('forward') }, icon('forward'), 'Forward')));
  }
  box.replaceChildren(...nodes);
}
function unsubscribeLink(t) {
  for (const m of t.messages) {
    const all = String(m.listUnsubscribe || '').match(/<([^>]+)>/g) || [];
    const http = all.map((x) => x.slice(1, -1)).find((u) => /^https:/i.test(u));
    if (http) return http;
  }
  return null;
}

function messageEl(m, isLast) {
  const open = S.expanded.has(m.id);
  const me = (acctMeta() || {}).email || '';
  const fromMe = emailOf(m.from) === me.toLowerCase();
  const who = fromMe ? 'me' : nameOf(m.from);
  const avatar = h('div', { class: 'avatar', style: 'background:' + colorFor(emailOf(m.from)) }, (who || '?').charAt(0).toUpperCase());
  const fromLine = h('div', { class: 'msg-from' }, h('b', { text: who }), ' ', h('span', { class: 'addr', text: '<' + emailOf(m.from) + '>' }),
    open ? h('div', { class: 'to', text: 'to ' + (splitAddrs(m.to).map((x) => (emailOf(x) === me.toLowerCase() ? 'me' : nameOf(x))).join(', ') || 'undisclosed') + (m.cc ? ', cc ' + splitAddrs(m.cc).map(nameOf).join(', ') : '') }) : h('div', { class: 'snip', text: m.snippet || '' }));
  const dateEl = h('div', { class: 'msg-date' }, m.attachments.length ? icon('clip') : null, fmtFullDate(m.internalDate),
    open ? tbBtn('reply', 'Reply', (e) => { e.stopPropagation(); startReply('reply', m.id); }) : null,
    open ? (() => { const b = tbBtn('more', 'More', (e) => { e.stopPropagation(); popMenu(b, [
      { label: 'Reply', icon: 'reply', fn: () => startReply('reply', m.id) },
      { label: 'Reply all', icon: 'replyAll', fn: () => startReply('replyall', m.id) },
      { label: 'Forward', icon: 'forward', fn: () => startReply('forward', m.id) },
      '-',
      { label: 'Always show images from ' + emailOf(m.from), icon: 'image', fn: () => trustSender(emailOf(m.from)) },
    ]); }); return b; })() : null);
  const headEl = h('div', { class: 'msg-head', onclick: () => { if (open && isLast) return; if (open) S.expanded.delete(m.id); else S.expanded.add(m.id); renderReader(); } }, avatar, fromLine, dateEl);
  const el = h('article', { class: 'msg' + (open ? '' : ' collapsed') }, headEl);
  if (open) el.append(h('div', { class: 'msg-body' }, ...bodyEls(m)));
  return el;
}

function trustSender(addr) {
  const list = new Set(S.st.settings.trustedSenders || []);
  list.add(addr);
  gd.settings({ trustedSenders: [...list] }).then((st) => { S.st = st; renderReader(); toast('Images from ' + addr + ' will always show'); });
}

function imagesAllowed(m) {
  const set = S.st.settings;
  return set.alwaysImages || S.showImages.has(m.id) || (set.trustedSenders || []).includes(emailOf(m.from)) || emailOf(m.from) === ((acctMeta() || {}).email || '').toLowerCase();
}

function bodyEls(m) {
  const out = [];
  const hasRemote = /<img[^>]+src\s*=\s*["']?https?:/i.test(m.html || '') || /url\(\s*['"]?https?:/i.test(m.html || '');
  const allowImg = imagesAllowed(m);
  if (hasRemote && !allowImg) {
    out.push(h('div', { class: 'img-bar' }, icon('image'), h('span', { text: 'Pictures are hidden to protect your privacy.' }),
      h('button', { text: 'Show pictures', onclick: () => { S.showImages.add(m.id); renderReader(); } }),
      h('button', { text: 'Always show from this sender', onclick: () => trustSender(emailOf(m.from)) })));
  }
  out.push(emailFrame(m, allowImg));
  if (m.attachments.length) {
    out.push(h('div', { class: 'atts' }, ...m.attachments.map((a) => {
      const ext = (a.filename.split('.').pop() || '').slice(0, 4).toUpperCase();
      return h('div', { class: 'att', title: a.filename },
        h('div', { class: 'ic', text: ext || 'FILE' }),
        h('div', { class: 'nm' }, h('div', { text: a.filename }), h('small', { text: fmtSize(a.size) })),
        h('div', { class: 'acts' },
          tbBtn('open', 'Open', () => gd.openAttachment(S.acct, a).catch((e) => toast(e.message))),
          tbBtn('download', 'Save', () => gd.saveAttachment(S.acct, a).then((p) => { if (p) toast('Saved to ' + p); }).catch((e) => toast(e.message)))));
    })));
  }
  return out;
}

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function linkifyText(t) {
  return escapeHtml(t).replace(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)'])/g, '<a href="$1">$1</a>').replace(/\r?\n/g, '<br>');
}

function emailFrame(m, allowImg) {
  let body = m.html;
  if (!body) body = '<div style="white-space:normal;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">' + linkifyText(m.text || m.snippet || '') + '</div>';
  // Remove things that could move or reload the frame.
  body = body.replace(/<meta[^>]+http-equiv[^>]*>/gi, '').replace(/<base[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const imgSrc = allowImg ? 'data: https: http: cid:' : 'data: cid:';
  const darkCss = isDark() && S.st.settings.darkEmails
    ? 'html{filter:invert(.92) hue-rotate(180deg);background:#fff}img,video,picture,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}'
    : '';
  const doc = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src ' + imgSrc + '; style-src \'unsafe-inline\'' + (allowImg ? ' https:' : '') + '; font-src data:' + (allowImg ? ' https:' : '') + '; media-src data:">'
    + '<base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#202124}body{font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;overflow-wrap:anywhere;word-break:break-word}'
    + 'img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}a{color:#1a56c8}' + darkCss + '</style></head><body>' + body + '</body></html>';
  const frame = h('iframe', { class: 'msg-frame', sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', title: 'Email from ' + nameOf(m.from) });
  frame.srcdoc = doc;
  let raf = 0; let lastH = 0;
  const fit = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      try {
        const d = frame.contentDocument; if (!d || !d.documentElement) return;
        const hgt = Math.min(Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0) + 4, 20000);
        if (Math.abs(hgt - lastH) > 2) { lastH = hgt; frame.style.height = hgt + 'px'; }
      } catch (_) {}
    });
  };
  frame.addEventListener('load', () => {
    fit();
    try {
      const d = frame.contentDocument;
      d.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
      new ResizeObserver(fit).observe(d.documentElement);
      d.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href') || '';
        if (/^mailto:/i.test(href)) composeFromMailto(href);
        else if (/^https?:/i.test(href)) gd.external(href);
      });
      d.addEventListener('keydown', (e) => document.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, bubbles: true })));
    } catch (_) {}
  });
  return frame;
}
