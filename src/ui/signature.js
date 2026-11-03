'use strict';
/* Email signatures: the Signature window in Settings, and which signature goes on new emails, replies and forwards.
   The main signature is saved in Gmail (so the web and the phone use it too). Whether it goes on new emails or
   replies, and a separate reply signature, are kept in Beacon's settings on this computer, because Gmail's API
   has no place for them. */

/** This address's choices, with the defaults filled in. */
function sigPrefs(acct, email) {
  const all = (S.st && S.st.settings && S.st.settings.signatures) || {};
  const p = (all[acct] || {})[String(email || '').toLowerCase()] || {};
  return { onNew: p.onNew !== false, onReply: ['same', 'other', 'none'].includes(p.onReply) ? p.onReply : 'same', replyHtml: p.replyHtml || '' };
}

/** The signature HTML to start an email with. mode is new, reply, replyall or forward. */
function pickSig(acct, from, mode) {
  if (!from) return '';
  const p = sigPrefs(acct, from.sendAsEmail);
  const main = from.signature || '';
  if (!mode || mode === 'new') return p.onNew ? main : '';
  if (p.onReply === 'none') return '';
  if (p.onReply === 'other') return p.replyHtml;
  return main;
}

/** The signature block that sits at the bottom of the message editor. */
function sigBlock(html) {
  const sig = h('div', { class: 'sig' });
  sig.append(h('div', { text: '-- ' }), safeFragment(html));
  return sig;
}

/** Clean HTML out of a signature editor, ready to save. Empty when there is nothing in it. */
function sigEditorHtml(ed) {
  if (!ed.textContent.trim() && !ed.querySelector('img')) return '';
  const wrap = document.createElement('div');
  wrap.append(safeFragment(ed.innerHTML));
  wrap.querySelectorAll('a').forEach((a) => { a.removeAttribute('target'); a.removeAttribute('rel'); });
  return wrap.innerHTML.trim();
}

/** A small editor with bold, italic, underline, link and clear. Returns {el, editor}. */
function sigEditor(html, label) {
  const editor = h('div', { class: 'c-editor sig-editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, 'data-placeholder': 'Your name, phone number, website…', spellcheck: 'true' });
  if (html) editor.append(safeFragment(html));
  editor.addEventListener('paste', (e) => {
    const cd = e.clipboardData; if (!cd) return;
    const hasImage = Array.from(cd.items || []).some((it) => it.kind === 'file' && /^image\//.test(it.type || ''));
    const htm = cd.getData('text/html'); const text = cd.getData('text/plain');
    e.preventDefault();
    if (!htm && !text) { if (hasImage) toast('A picture in a signature has to be on the web. Copy it from a web page (right click > Copy image) and paste that.', null, null, 8000); return; }
    const frag = htm ? safeFragment(htm) : document.createTextNode(text);
    const sel = getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) { editor.append(frag); return; }
    const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(frag); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  });

  // Links: a small box under the buttons, so this window stays open.
  let saved = null;
  const linkIn = h('input', { class: 'ev-in', type: 'text', placeholder: 'https://example.com', 'aria-label': 'Link to' });
  const addLink = () => {
    const url = linkIn.value.trim(); linkRow.hidden = true; linkIn.value = '';
    if (!url) return;
    const href = /^(https?:|mailto:|tel:)/i.test(url) ? url : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? 'mailto:' + url : 'https://' + url);
    editor.focus();
    const sel = getSelection();
    if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
    if (saved && !saved.collapsed) document.execCommand('createLink', false, href);
    else { const a = h('a', { href, text: url }); const r = saved || (() => { const x = document.createRange(); x.selectNodeContents(editor); x.collapse(false); return x; })(); r.insertNode(a); r.setStartAfter(a); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    saved = null;
  };
  linkIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); linkRow.hidden = true; editor.focus(); } });
  const linkRow = h('div', { class: 'sig-link' }, linkIn, h('button', { class: 'btn', text: 'Add link', onclick: addLink }));
  linkRow.hidden = true;

  const b = (ic, title, fn) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: () => { editor.focus(); fn(); } }, icon(ic));
  const tools = h('div', { class: 'fmt sig-fmt' },
    b('bold', 'Bold', () => document.execCommand('bold')),
    b('italic', 'Italic', () => document.execCommand('italic')),
    b('underline', 'Underline', () => document.execCommand('underline')),
    h('button', { type: 'button', title: 'Link', 'aria-label': 'Link', onmousedown: (e) => e.preventDefault(), onclick: () => {
      const sel = getSelection();
      saved = sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      linkRow.hidden = false; linkIn.focus();
    } }, icon('link')),
    b('clear', 'Remove formatting', () => document.execCommand('removeFormat')));
  return { el: h('div', { class: 'sig-box' }, tools, linkRow, editor), editor };
}

/** Asks for the Google permission that saving a signature to Gmail needs, then tries again. */
function askSignaturePermission(acct, retry) {
  modal((box, close) => {
    box.append(
      h('h2', { text: 'Allow Beacon to save your signature' }),
      h('p', { class: 'sub', text: 'Your signature is saved in your Gmail settings, so it also shows up on your phone and on the web. That takes one more Google permission (the same one filters use).' }),
      h('ol', { class: 'perm-steps' },
        h('li', { text: 'Click Allow. Your browser opens the Google sign-in.' }),
        h('li', { text: 'Tick the box about managing your basic mail settings, along with the others, then Continue.' }),
        h('li', { text: 'Come back to Beacon. It saves your signature right away.' })),
      h('div', { class: 'modal-actions' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', text: 'Not now', onclick: () => { close(); toast('Signature not saved to Gmail. Your reply settings were kept.'); } }),
        h('button', { class: 'btn primary', text: 'Allow', onclick: async (e) => {
          e.target.disabled = true;
          try { await gd.reauth(acct); S.st = await gd.state(); close(); await retry(); }
          catch (err) { e.target.disabled = false; toast(signInHelp(err), null, null, 8000); }
        } })));
  });
}

/** Saves the main signature to Gmail and updates the copy Beacon keeps for composing. */
async function saveMainSignature(acct, email, html, again) {
  try {
    await gd.signatureSave(acct, email, html);
    const f = (S.sendAs[acct] || []).find((x) => (x.sendAsEmail || '').toLowerCase() === email.toLowerCase());
    if (f) f.signature = html;
    return true;
  } catch (e) {
    if (e.code === 'settings_scope' && !again) {
      askSignaturePermission(acct, async () => { if (await saveMainSignature(acct, email, html, true)) toast('Signature saved'); });
      return false;
    }
    throw e;
  }
}

/** Settings > Signature. */
async function signatureModal(startAcct) {
  const accounts = (S.st && S.st.accounts) || [];
  if (!accounts.length) return;
  let acct = startAcct || S.acct || accounts[0].id;
  let email = '';
  modal((box, close) => {
    box.classList.add('sig-modal');
    const bodyEl = h('div', { class: 'sig-body' }, h('p', { class: 'sub', text: 'Loading your signature…' }));
    const saveBtn = h('button', { class: 'btn primary', text: 'Save', disabled: true });
    let read = null; // returns what is on screen

    const fill = async () => {
      saveBtn.disabled = true;
      bodyEl.replaceChildren(h('p', { class: 'sub', text: 'Loading your signature…' }));
      const list = await loadSendAs(acct);
      if (!list.length) { bodyEl.replaceChildren(h('p', { class: 'sub', text: 'Could not load the addresses for this account. Check your connection and try again.' })); return; }
      const from = list.find((x) => (x.sendAsEmail || '').toLowerCase() === email.toLowerCase()) || defaultFrom(list);
      email = from.sendAsEmail;
      const p = sigPrefs(acct, email);
      const rows = [];
      if (accounts.length > 1) {
        rows.push(h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Account'),
          h('select', { 'aria-label': 'Account', onchange: (e) => { acct = e.target.value; email = ''; fill(); } },
            ...accounts.map((a) => h('option', { value: a.id, selected: a.id === acct, text: a.email })))));
      }
      if (list.length > 1) {
        rows.push(h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Address', h('small', { text: 'Each address you send from has its own signature' })),
          h('select', { 'aria-label': 'Address', onchange: (e) => { email = e.target.value; fill(); } },
            ...list.map((x) => h('option', { value: x.sendAsEmail, selected: x.sendAsEmail === email, text: x.sendAsEmail })))));
      }
      const main = sigEditor(from.signature || '', 'Signature');
      const onNew = h('select', { 'aria-label': 'New emails' },
        h('option', { value: 'yes', selected: p.onNew, text: 'Add my signature' }), h('option', { value: 'no', selected: !p.onNew, text: 'No signature' }));
      const reply = sigEditor(p.replyHtml, 'Reply signature');
      const replyWrap = h('div', { class: 'sig-reply' }, h('div', { class: 'sig-lbl' }, 'Reply and forward signature', h('small', { text: 'Kept in Beacon on this computer' })), reply.el);
      const onReply = h('select', { 'aria-label': 'Replies and forwards', onchange: () => { replyWrap.hidden = onReply.value !== 'other'; if (!replyWrap.hidden) reply.editor.focus(); } },
        h('option', { value: 'same', selected: p.onReply === 'same', text: 'Same signature' }),
        h('option', { value: 'other', selected: p.onReply === 'other', text: 'A different signature' }),
        h('option', { value: 'none', selected: p.onReply === 'none', text: 'No signature' }));
      replyWrap.hidden = p.onReply !== 'other';
      bodyEl.replaceChildren(...rows,
        h('div', { class: 'sig-lbl' }, 'Signature', h('small', { text: 'Saved in Gmail, so your phone and the web use it too' })), main.el,
        h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'New emails'), onNew),
        h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Replies and forwards'), onReply),
        replyWrap);
      read = () => ({ acct, email, oldMain: from.signature || '', main: sigEditorHtml(main.editor), onNew: onNew.value === 'yes', onReply: onReply.value, replyHtml: sigEditorHtml(reply.editor) });
      saveBtn.disabled = false;
    };

    saveBtn.onclick = async () => {
      if (!read) return;
      const v = read();
      if (v.onReply === 'other' && !v.replyHtml) { toast('Type your reply signature, or pick No signature for replies.'); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        // Beacon's own choices first; they need no permission.
        const all = JSON.parse(JSON.stringify((S.st.settings && S.st.settings.signatures) || {}));
        all[v.acct] = all[v.acct] || {};
        all[v.acct][v.email.toLowerCase()] = { onNew: v.onNew, onReply: v.onReply, replyHtml: v.replyHtml };
        S.st = await gd.settings({ signatures: all });
        if (v.main !== v.oldMain) {
          close();
          if (await saveMainSignature(v.acct, v.email, v.main)) toast('Signature saved');
          return;
        }
        close(); toast('Signature saved');
      } catch (e) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; toast('Could not save your signature: ' + e.message, null, null, 8000); }
    };

    box.append(h('h2', { text: 'Signature' }),
      h('p', { class: 'sub', text: 'Added to the bottom of the emails you write. You can still edit or delete it in each email.' }),
      bodyEl,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', text: 'Cancel', onclick: close }), saveBtn));
    fill().catch((e) => bodyEl.replaceChildren(h('p', { class: 'sub', text: 'Could not load your signature: ' + e.message })));
  });
}
