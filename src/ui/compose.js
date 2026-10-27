'use strict';
/* Compose, reply, forward and drafts. */

async function loadSendAs(acctId) {
  if (S.sendAs[acctId]) return S.sendAs[acctId];
  try { S.sendAs[acctId] = await gd.sendAs(acctId); } catch (_) { S.sendAs[acctId] = []; }
  return S.sendAs[acctId];
}
function defaultFrom(list) { return list.find((x) => x.isDefault) || list.find((x) => x.isPrimary) || list[0] || null; }

function newComp(fields) {
  return Object.assign({
    acct: S.acct, mode: 'new', inline: false, threadId: null, sourceMessageId: null, draftId: null,
    to: '', cc: '', bcc: '', subject: '', html: '', from: '', fromName: '', showCc: false, includeQuote: true,
    files: [], forwardAtts: [], dropForward: [], err: '', busy: false, max: false, sigHtml: '', dirty: false,
  }, fields);
}

async function startCompose(fields) {
  await stashComposer();
  const list = await loadSendAs(S.acct);
  const from = defaultFrom(list);
  S.comp = newComp(Object.assign({ from: from ? from.sendAsEmail : '', fromName: from ? from.displayName : '', sigHtml: from ? from.signature || '' : '' }, fields || {}));
  if (S.comp.showCc === false && (S.comp.cc || S.comp.bcc)) S.comp.showCc = true;
  renderComposerHost();
  focusComposer(S.comp.to ? 'body' : 'to');
}

async function startReply(mode, messageId) {
  const t = S.thread; if (!t) return;
  await stashComposer();
  const me = ((acctMeta() || {}).email || '').toLowerCase();
  const src = (messageId && t.messages.find((m) => m.id === messageId)) || [...t.messages].reverse().find((m) => emailOf(m.from) !== me) || t.messages[t.messages.length - 1];
  const list = await loadSendAs(S.acct);
  const mine = new Set(list.map((x) => (x.sendAsEmail || '').toLowerCase()).concat([me]));
  // Reply from the address the mail was sent to, when it is one of ours.
  const toMe = splitAddrs(src.to + ',' + src.cc).map(emailOf).find((a) => mine.has(a));
  const from = list.find((x) => (x.sendAsEmail || '').toLowerCase() === toMe) || defaultFrom(list);
  let to = '', cc = '';
  const fromIsMe = mine.has(emailOf(src.from));
  if (mode === 'reply' || mode === 'replyall') {
    to = fromIsMe ? src.to : (src.replyTo || src.from);
    if (mode === 'replyall') {
      const seen = new Set(splitAddrs(to).map(emailOf));
      const others = splitAddrs(src.to + ',' + src.cc).filter((a) => { const e = emailOf(a); if (mine.has(e) || seen.has(e)) return false; seen.add(e); return true; });
      cc = others.join(', ');
    }
  }
  S.comp = newComp({
    mode, inline: true, threadId: t.id, sourceMessageId: src.id,
    to, cc, showCc: !!cc, subject: mode === 'forward' ? 'Fwd: ' + (src.subject || '').replace(/^(fwd?:\s*)+/i, '') : '',
    from: from ? from.sendAsEmail : '', fromName: from ? from.displayName : '', sigHtml: from ? from.signature || '' : '',
    forwardAtts: mode === 'forward' ? src.attachments.slice() : [], quoteFrom: nameOf(src.from), quoteDate: fmtFullDate(src.internalDate),
  });
  renderReader();
  focusComposer(mode === 'forward' ? 'to' : 'body');
  const el = document.getElementById('composer'); if (el) el.scrollIntoView({ block: 'nearest' });
}

async function openDraft(draftId) {
  await stashComposer();
  try {
    const d = await gd.draft(S.acct, draftId);
    const list = await loadSendAs(S.acct);
    const from = defaultFrom(list);
    S.comp = newComp({ draftId, threadId: d.threadId, to: d.to, cc: d.cc, bcc: d.bcc, showCc: !!(d.cc || d.bcc), subject: d.subject, html: d.html, from: from ? from.sendAsEmail : '', fromName: from ? from.displayName : '', inReplyTo: d.inReplyTo, references: d.references, loadedDraft: true, scheduledAt: d.scheduledAt || null });
    renderComposerHost();
    focusComposer('body');
  } catch (e) { toast(e.message); }
}

function composeFromMailto(href) {
  try {
    const u = new URL(href);
    const p = u.searchParams;
    startCompose({ to: decodeURIComponent(u.pathname), cc: p.get('cc') || '', bcc: p.get('bcc') || '', subject: p.get('subject') || '', html: escapeHtml(p.get('body') || '').replace(/\r?\n/g, '<br>') });
  } catch (_) { startCompose(); }
}

function renderComposerHost() {
  // Floating composer for new mail and drafts; inline composers live in the reader.
  document.querySelectorAll('.composer.floating').forEach((x) => x.remove());
  if (S.comp && !S.comp.inline) document.body.append(composerEl());
  if (S.comp && S.comp.inline) renderReader();
}

function focusComposer(where) {
  setTimeout(() => {
    const el = document.getElementById(where === 'to' ? 'c-to' : 'c-editor');
    if (!el) return;
    el.focus();
    if (where === 'body') { const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  }, 30);
}

// Pull the live values out of the editor fields into S.comp.
function syncComp() {
  const c = S.comp; if (!c) return;
  const g = (id) => document.getElementById(id);
  if (g('c-to')) c.to = g('c-to').value;
  if (g('c-cc')) c.cc = g('c-cc').value;
  if (g('c-bcc')) c.bcc = g('c-bcc').value;
  if (g('c-subject')) c.subject = g('c-subject').value;
  if (g('c-editor')) c.html = g('c-editor').innerHTML;
  if (g('c-quote')) c.includeQuote = g('c-quote').checked;
}
function compHasContent(c) {
  if (!c) return false;
  const text = (c.html || '').replace(/<div class="sig"[\s\S]*$/i, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  return !!(text || c.files.length || (c.mode === 'new' && (c.to.trim() || c.subject.trim())));
}

/** Saves the open composer as a draft (if it has content) and closes it. */
async function stashComposer(onlyInline) {
  const c = S.comp; if (!c) return;
  if (onlyInline && !c.inline) return;
  syncComp();
  S.comp = null;
  document.querySelectorAll('.composer.floating').forEach((x) => x.remove());
  if (compHasContent(c) && !c.busy) {
    try { await gd.saveDraft(c.acct, payload(c)); toast('Draft saved'); } catch (e) { toast('Could not save draft: ' + e.message); }
  }
}

function payload(c) {
  return {
    mode: c.mode, threadId: c.threadId, sourceMessageId: c.sourceMessageId, draftId: c.draftId,
    from: c.from, fromName: c.fromName, to: splitAddrs(c.to), cc: splitAddrs(c.cc), bcc: splitAddrs(c.bcc),
    subject: c.subject, html: c.html, includeQuote: c.includeQuote, files: c.files.map((f) => ({ path: f.path, name: f.name })),
    dropForwardAttachments: c.dropForward, inReplyTo: c.inReplyTo, references: c.references,
  };
}

function composerEl() {
  const c = S.comp;
  const titles = { new: c.loadedDraft ? 'Draft' : 'New message', reply: 'Reply', replyall: 'Reply all', forward: 'Forward' };
  const close = tbBtn('close', 'Save draft and close', async () => { await stashComposer(); if (c.inline) renderReader(); else renderReader(); });
  const head = h('div', { class: 'c-head' }, h('span', { text: titles[c.mode] + (c.subject && c.mode === 'new' ? ': ' + c.subject : '') }),
    !c.inline ? tbBtn(c.max ? 'min' : 'max', c.max ? 'Smaller' : 'Bigger', () => { syncComp(); c.max = !c.max; renderComposerHost(); }) : null, close);
  const list = S.sendAs[c.acct] || [];
  const fields = [];
  if (list.length > 1) {
    const sel = h('select', { id: 'c-from', 'aria-label': 'From', onchange: (e) => {
      syncComp();
      const f = list.find((x) => x.sendAsEmail === e.target.value);
      const oldSig = c.sigHtml; c.from = f.sendAsEmail; c.fromName = f.displayName; c.sigHtml = f.signature || '';
      const ed = document.getElementById('c-editor'); const sigEl = ed && ed.querySelector('.sig');
      if (sigEl) { sigEl.replaceChildren(safeFragment(c.sigHtml)); } else if (oldSig !== c.sigHtml) { /* none */ }
    } }, ...list.map((x) => h('option', { value: x.sendAsEmail, selected: x.sendAsEmail === c.from, text: (x.displayName ? x.displayName + ' <' + x.sendAsEmail + '>' : x.sendAsEmail) })));
    fields.push(h('div', { class: 'c-field' }, h('label', { for: 'c-from', text: 'From' }), sel));
  }
  const toInput = h('input', { id: 'c-to', type: 'text', value: c.to, autocomplete: 'off', spellcheck: 'false', placeholder: 'name@example.com, another@example.com', oninput: () => { c.dirty = true; } });
  autocomplete(toInput, c);
  fields.push(h('div', { class: 'c-field' }, h('label', { for: 'c-to', text: 'To' }), toInput,
    !c.showCc ? h('div', { class: 'links' }, h('button', { text: 'Cc Bcc', onclick: () => { syncComp(); c.showCc = true; rerender(); } })) : null));
  if (c.showCc) {
    const ccIn = autocomplete(h('input', { id: 'c-cc', type: 'text', value: c.cc, autocomplete: 'off', spellcheck: 'false' }), c);
    const bccIn = autocomplete(h('input', { id: 'c-bcc', type: 'text', value: c.bcc, autocomplete: 'off', spellcheck: 'false' }), c);
    fields.push(h('div', { class: 'c-field' }, h('label', { for: 'c-cc', text: 'Cc' }), ccIn));
    fields.push(h('div', { class: 'c-field' }, h('label', { for: 'c-bcc', text: 'Bcc' }), bccIn));
  }
  if (c.mode === 'new' || c.mode === 'forward') fields.push(h('div', { class: 'c-field' }, h('label', { for: 'c-subject', text: 'Subject' }), h('input', { id: 'c-subject', type: 'text', value: c.subject })));

  const editor = h('div', { id: 'c-editor', class: 'c-editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Message', 'data-placeholder': 'Write your message', spellcheck: 'true' });
  if (c.html) editor.append(safeFragment(c.html));
  else {
    editor.append(h('div', {}, h('br')));
    if (c.sigHtml) { editor.append(h('div', {}, h('br'))); const sig = h('div', { class: 'sig' }); sig.append(h('div', { text: '-- ' }), safeFragment(c.sigHtml)); editor.append(sig); }
  }
  editor.addEventListener('input', () => { c.dirty = true; });
  editor.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;

    // Check for pasted images (e.g. screenshots from Win+Shift+S or PrtScn)
    const items = Array.from(cd.items || []);
    const imgItem = items.find((it) => it.kind === 'file' && it.type && it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (file) {
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result || '';
            const base64 = dataUrl.split(',')[1];
            if (!base64) return;
            const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const timeStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
            const name = `screenshot_${timeStr}.${ext}`;
            const saved = await gd.saveTempFile(name, base64);
            if (saved && saved.path) {
              syncComp();
              c.files.push(saved);
              toast('Screenshot attached (' + fmtSize(saved.size) + ')');
              rerender();
            }
          };
          reader.readAsDataURL(file);
        } catch (err) {
          toast('Could not attach screenshot: ' + err.message);
        }
      }
      return;
    }

    // Paste as clean HTML (or plain text) so pasted pages can't bring scripts or odd styling.
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    const frag = html ? safeFragment(html) : document.createTextNode(text);
    const sel = getSelection();
    if (!sel.rangeCount) { editor.append(frag); return; }
    const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(frag); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  });
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSend(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); insertLink(); }
  });

  const fmt = h('div', { class: 'fmt' },
    fmtBtn('bold', 'Bold (Ctrl+B)', () => document.execCommand('bold')),
    fmtBtn('italic', 'Italic (Ctrl+I)', () => document.execCommand('italic')),
    fmtBtn('underline', 'Underline (Ctrl+U)', () => document.execCommand('underline')),
    fmtBtn('link', 'Link (Ctrl+K)', insertLink),
    fmtBtn('ul', 'Bulleted list', () => document.execCommand('insertUnorderedList')),
    fmtBtn('ol', 'Numbered list', () => document.execCommand('insertOrderedList')),
    fmtBtn('quote', 'Quote', () => document.execCommand('formatBlock', false, 'blockquote')),
    fmtBtn('clear', 'Remove formatting', () => document.execCommand('removeFormat')));

  const quote = (c.mode !== 'new') ? h('label', { class: 'c-quote' }, h('input', { type: 'checkbox', id: 'c-quote', checked: c.includeQuote }), c.mode === 'forward' ? 'Include the forwarded message' : 'Include the message you are replying to' + (c.quoteFrom ? ' (' + c.quoteFrom + ')' : '')) : null;

  const files = h('div', { class: 'c-files' },
    ...c.forwardAtts.filter((a) => !c.dropForward.includes(a.attachmentId)).map((a) => h('span', { class: 'c-file', title: a.filename }, icon('clip'), h('span', { text: a.filename + ' · ' + fmtSize(a.size) }), h('button', { title: 'Remove', 'aria-label': 'Remove ' + a.filename, onclick: () => { syncComp(); c.dropForward.push(a.attachmentId); rerender(); } }, '×'))),
    ...c.files.map((f, i) => h('span', { class: 'c-file', title: f.path }, icon('clip'), h('span', { text: f.name + ' · ' + fmtSize(f.size) }), h('button', { title: 'Remove', 'aria-label': 'Remove ' + f.name, onclick: () => { syncComp(); c.files.splice(i, 1); rerender(); } }, '×'))));
  const totalSize = c.files.reduce((s, f) => s + (f.size || 0), 0) + c.forwardAtts.filter((a) => !c.dropForward.includes(a.attachmentId)).reduce((s, a) => s + (a.size || 0), 0);

  const foot = h('div', { class: 'c-foot' },
    h('div', { class: 'send-split' },
      h('button', { class: 'btn primary', disabled: c.busy, onclick: doSend }, icon('send'), c.busy ? 'Sending…' : c.scheduledAt ? 'Send now' : 'Send'),
      (() => { const b = h('button', { class: 'btn primary sched-btn', disabled: c.busy, title: c.scheduledAt ? 'Change the send time' : 'Schedule send', 'aria-label': 'Schedule send', onclick: () => scheduleMenu(b) }, icon('clock')); return b; })()),
    tbBtn('clip', 'Attach files', async () => { syncComp(); const picked = await gd.pickFiles().catch(() => []); if (picked.length) { c.files.push(...picked); rerender(); } }),
    fmt,
    h('span', { class: 'grow' }),
    totalSize ? h('span', { class: 'tb-info', text: fmtSize(totalSize) + (totalSize > 24 * 1048576 ? ' (over 25 MB)' : '') }) : null,
    h('button', { class: 'tb text', text: 'Save draft', onclick: async () => { syncComp(); try { c.draftId = await gd.saveDraft(c.acct, payload(c)); toast('Draft saved'); } catch (e) { toast(e.message); } } }),
    tbBtn('trash', 'Discard', async () => { const id = c.draftId; S.comp = null; if (id) gd.deleteDraft(c.acct, id).catch(() => {}); document.querySelectorAll('.composer.floating').forEach((x) => x.remove()); renderReader(); toast('Discarded'); if (S.view.kind === 'folder' && S.view.key === 'drafts') loadList({ silent: true }); }));

  const sched = c.scheduledAt ? h('div', { class: 'c-sched' }, icon('clock'), h('span', { text: 'Scheduled to send ' + fmtWhen(c.scheduledAt) + '. Edits you make are sent then.' }),
    h('button', { class: 'linkish', text: 'Cancel schedule', onclick: async () => {
      try { await gd.cancelSchedule(c.acct, c.draftId); c.scheduledAt = null; rerender(); toast('Schedule cancelled. The email is still in Drafts.'); gd.state().then((st) => { S.st = st; renderSide(); }); if (S.view.kind === 'folder' && S.view.key === 'scheduled') loadList({ silent: true }); }
      catch (e) { toast(e.message); }
    } })) : null;
  const el = h('section', { id: 'composer', class: 'composer' + (c.inline ? '' : ' floating') + (c.max ? ' max' : ''), 'aria-label': titles[c.mode] }, head, sched, ...fields, editor, quote, files, c.err ? h('div', { class: 'c-err', role: 'alert', text: c.err }) : null, foot);
  // Drag files from Explorer onto the composer to attach them.
  const handleDragOver = (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('dropzone');
    }
  };
  el.addEventListener('dragenter', handleDragOver);
  el.addEventListener('dragover', handleDragOver);
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('dropzone');
  });
  el.addEventListener('drop', async (e) => {
    el.classList.remove('dropzone');
    const dropFiles = e.dataTransfer && e.dataTransfer.files;
    if (!dropFiles || !dropFiles.length) return;
    e.preventDefault();
    e.stopPropagation();
    syncComp();
    let added = 0;
    for (const f of dropFiles) {
      const p = gd.pathForFile(f);
      if (p) {
        c.files.push({ path: p, name: f.name, size: f.size });
        added++;
      } else {
        try {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          const base64 = btoa(binary);
          const saved = await gd.saveTempFile(f.name, base64);
          if (saved && saved.path) { c.files.push(saved); added++; }
        } catch (_) {}
      }
    }
    if (added) {
      toast(added === 1 ? '1 file attached' : added + ' files attached');
      rerender();
    }
  });
  return el;
}
// ----------------------------------------------------------------- address suggestions
// Suggests people you've written to (and people who wrote to you) as you type in To, Cc or Bcc.
function closeAc() { document.querySelectorAll('.ac').forEach((x) => x.remove()); }
function fmtAddr(p) {
  if (!p.name) return p.email;
  return (/[,;"<>@()]/.test(p.name) ? '"' + p.name.replace(/"/g, '') + '"' : p.name) + ' <' + p.email + '>';
}
function autocomplete(input, c) {
  let items = []; let idx = 0; let timer = null; let seq = 0;
  const lastToken = () => { const v = input.value; const i = Math.max(v.lastIndexOf(','), v.lastIndexOf(';')); return { start: i + 1, text: v.slice(i + 1).trim() }; };
  const show = () => {
    closeAc();
    if (!items.length || document.activeElement !== input) return;
    const box = h('div', { class: 'ac', role: 'listbox' });
    items.forEach((p, i) => box.append(h('button', { class: i === idx ? 'on' : '', role: 'option', 'aria-selected': String(i === idx), onmousedown: (e) => { e.preventDefault(); pick(i); } },
      h('span', { class: 'av', style: 'background:' + colorFor(p.email), text: (p.name || p.email).charAt(0).toUpperCase() }),
      h('span', { class: 'ac-txt' }, h('span', { class: 'ac-name', text: p.name || p.email }), p.name ? h('span', { class: 'ac-mail', text: p.email }) : null))));
    document.body.append(box);
    const r = input.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = (r.bottom + box.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - box.offsetHeight - 4) : r.bottom + 4) + 'px';
  };
  const pick = (i) => {
    const p = items[i]; if (!p) return;
    const t = lastToken();
    const before = input.value.slice(0, t.start).replace(/\s*$/, '');
    input.value = (before ? before + ' ' : '') + fmtAddr(p) + ', ';
    items = []; closeAc(); c.dirty = true;
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const t = lastToken();
    if (!t.text || t.text.includes('<')) { items = []; closeAc(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      let res = [];
      try { res = await gd.searchContacts(c.acct, t.text); } catch (_) {}
      if (my !== seq) return;
      const have = new Set(splitAddrs(input.value.slice(0, t.start)).map(emailOf));
      items = res.filter((p) => !have.has(p.email)).slice(0, 6); idx = 0; show();
    }, 90);
  });
  input.addEventListener('keydown', (e) => {
    if (!items.length || !document.querySelector('.ac')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; show(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; show(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); items = []; closeAc(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) closeAc(); }, 120));
  return input;
}

function fmtBtn(ic, title, fn) { return h('button', { title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: () => { fn(); document.getElementById('c-editor').focus(); } }, icon(ic)); }
function rerender() { if (!S.comp) return; if (S.comp.inline) renderReader(); else renderComposerHost(); }
async function insertLink() {
  const sel = getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const url = await askText('Link to', 'https://example.com', 'Add link');
  if (!url) return;
  const href = /^(https?:|mailto:)/i.test(url) ? url : 'https://' + url;
  const ed = document.getElementById('c-editor'); if (!ed) return;
  ed.focus();
  if (range) { sel.removeAllRanges(); sel.addRange(range); }
  if (range && !range.collapsed) document.execCommand('createLink', false, href);
  else { const a = h('a', { href, text: url }); (range || document.createRange()).insertNode(a); }
}

/** The checks Send and Schedule send share. Shows the problem in the composer and returns false. */
function readyToSend(c) {
  const all = [...splitAddrs(c.to), ...splitAddrs(c.cc), ...splitAddrs(c.bcc)];
  if (!splitAddrs(c.to).length && !splitAddrs(c.cc).length && !splitAddrs(c.bcc).length) { c.err = 'Add at least one recipient.'; rerender(); return false; }
  const bad = all.filter((a) => !validAddr(a));
  if (bad.length) { c.err = 'These don\'t look like email addresses: ' + bad.join(', '); rerender(); return false; }
  const bodyText = (c.html || '').replace(/<div class="sig"[\s\S]*$/i, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (c.mode === 'new' && !c.subject.trim() && !bodyText) { c.err = 'This message has no subject or text.'; rerender(); return false; }
  if (/\battach(ed|ment|ing)\b/i.test(bodyText) && !c.files.length && !c.forwardAtts.filter((a) => !c.dropForward.includes(a.attachmentId)).length && !c.warnedAttach) {
    c.warnedAttach = true; c.err = 'You mentioned an attachment but none is attached. Press Send again to send anyway.'; rerender(); return false;
  }
  return true;
}

async function doSend() {
  const c = S.comp; if (!c || c.busy) return;
  syncComp();
  if (!readyToSend(c)) return;
  c.err = ''; c.busy = true; rerender();
  const p = payload(c);
  try {
    const r = await gd.send(c.acct, p);
    S.comp = null;
    document.querySelectorAll('.composer.floating').forEach((x) => x.remove());
    if (S.thread) renderReader(); else renderReader();
    if (r.delayed) toast('Sending…', 'Undo', async () => {
      const undone = await gd.undoSend(r.pid).catch(() => false);
      if (undone) { S.comp = Object.assign(c, { busy: false, err: '' }); if (c.inline && S.thread && S.thread.id === c.threadId) renderReader(); else { c.inline = false; renderComposerHost(); } toast('Sending undone'); }
      else toast('Too late, it was already sent.');
    }, r.seconds * 1000);
  } catch (e) {
    c.busy = false; c.err = e.message; rerender();
  }
}

async function doSchedule(sendAt) {
  const c = S.comp; if (!c || c.busy) return;
  syncComp();
  if (!readyToSend(c)) return;
  c.err = ''; c.busy = true; rerender();
  try {
    const r = await gd.scheduleSend(c.acct, payload(c), sendAt);
    S.comp = null;
    document.querySelectorAll('.composer.floating').forEach((x) => x.remove());
    renderReader();
    toast('Scheduled to send ' + fmtWhen(r.sendAt), 'View', () => setView({ kind: 'folder', key: 'scheduled' }), 10000);
    if (S.view.kind === 'folder' && ['scheduled', 'drafts'].includes(S.view.key)) loadList({ silent: true });
  } catch (e) {
    c.busy = false; c.err = e.message; rerender();
  }
}

async function discardDraft(draftId) {
  try { await gd.deleteDraft(S.acct, draftId); S.threads = S.threads.filter((t) => t.draftId !== draftId); renderList(); toast('Draft discarded'); }
  catch (e) { toast(e.message); }
}
