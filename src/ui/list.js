'use strict';
/* Message list, toolbar and conversation actions. */

const PAGE = 50;
async function loadList(opts = {}) {
  if (!S.acct) return;
  if (S.view.kind === 'cleanup' || S.view.kind === 'calendar') { if (!opts.more && !opts.silent) renderList(); return; }
  const more = !!opts.more;
  const silent = !!opts.silent;
  const id = S.acct;
  if (more) {
    // Older pages: never wipe what is already shown, and never run two at once.
    if (!S.next || S.listState === 'more' || S.listState === 'loading') return;
    const seq = S.viewSeq;
    S.listState = 'more'; S.moreErr = ''; renderMoreRow();
    try {
      const r = await gd.threads(id, Object.assign({}, viewQuery(), { pageToken: S.next, max: PAGE }));
      if (seq !== S.viewSeq || id !== S.acct) return;
      const have = new Set(S.threads.map((t) => t.id));
      S.threads = S.threads.concat(r.threads.filter((t) => !have.has(t.id)));
      S.next = r.nextPageToken;
      S.listState = 'ok';
      renderList();
    } catch (e) {
      if (seq !== S.viewSeq) return;
      S.listState = 'ok'; S.moreErr = e.message;
      renderMoreRow();
    }
    return;
  }
  if (silent) {
    // Refresh the newest page and merge it in, keeping older pages you already loaded.
    if (S.listState !== 'ok') return;
    const seq = S.viewSeq;
    try {
      const r = await gd.threads(id, Object.assign({}, viewQuery(), { max: PAGE }));
      if (seq !== S.viewSeq || id !== S.acct || S.listState !== 'ok') return;
      const fresh = new Set(r.threads.map((t) => t.id));
      const older = S.threads.slice(r.threads.length).filter((t) => !fresh.has(t.id));
      const hadMore = S.threads.length > r.threads.length;
      S.threads = r.threads.concat(hadMore ? older : []);
      if (!hadMore) S.next = r.nextPageToken;
      const ids = new Set(S.threads.map((t) => t.id)); for (const x of [...S.sel]) if (!ids.has(x)) S.sel.delete(x);
      const scroll = $('list').scrollTop;
      renderList();
      $('list').scrollTop = scroll;
    } catch (_) { /* keep what is shown */ }
    return;
  }
  const seq = ++S.viewSeq;
  S.selAll = false; S.lastSelId = null;
  S.threads = []; S.next = null; S.listState = 'loading'; S.moreErr = ''; renderList();
  try {
    const r = await gd.threads(id, Object.assign({}, viewQuery(), { max: PAGE }));
    if (seq !== S.viewSeq || id !== S.acct) return;
    S.threads = r.threads; S.next = r.nextPageToken; S.listState = 'ok';
    const ids = new Set(S.threads.map((t) => t.id)); for (const x of [...S.sel]) if (!ids.has(x)) S.sel.delete(x);
  } catch (e) {
    if (seq !== S.viewSeq) return;
    S.listState = 'error'; S.listErr = e.message;
  }
  renderList();
  $('list').scrollTop = 0;
}

function moreRow() {
  if (!S.next && !S.moreErr) return null;
  if (S.moreErr) return h('div', { class: 'more', id: 'more-row' }, h('span', { class: 'tb-info', style: 'margin:0 10px 0 0', text: 'Could not load older mail: ' + S.moreErr }), h('button', { class: 'btn', text: 'Try again', onclick: () => { S.moreErr = ''; loadList({ more: true }); } }));
  return h('div', { class: 'more', id: 'more-row' }, h('button', { class: 'btn', disabled: S.listState === 'more', text: S.listState === 'more' ? 'Loading older mail…' : 'Load older mail', onclick: () => loadList({ more: true }) }));
}
function renderMoreRow() {
  const old = document.getElementById('more-row');
  const fresh = moreRow();
  if (old && fresh) old.replaceWith(fresh); else if (old) old.remove(); else if (fresh) $('list').append(fresh);
  renderToolbar();
}
// Keep loading older mail as you scroll down, like Gmail.
$('list').addEventListener('scroll', () => {
  const el = $('list');
  if (S.next && S.listState === 'ok' && !S.moreErr && el.scrollTop + el.clientHeight > el.scrollHeight - 400) loadList({ more: true });
});

function renderTabs() {
  const tabs = $('tabs');
  const show = S.view.kind === 'folder' && S.view.key === 'inbox';
  tabs.hidden = !show;
  if (!show) return;
  tabs.replaceChildren(...TABS.map((t) => h('button', { class: 'tab' + (t.forYou ? ' fy' : '') + ((S.view.tab || 'foryou') === t.key ? ' active' : ''), onclick: () => { S.view.tab = t.key; S.sel.clear(); closeThread(true); loadList(); renderTabs(); } }, t.label)));
}

function selectedIds() { return [...S.sel]; }
function threadById(id) { return S.threads.find((t) => t.id === id); }

function renderToolbar() {
  const tb = $('toolbar');
  const n = S.sel.size;
  const all = S.threads.length > 0 && n === S.threads.length;
  const cb = h('input', { type: 'checkbox', class: 'check', checked: all, 'aria-label': 'Select all', title: 'Select all on this page' });
  cb.indeterminate = n > 0 && !all;
  cb.addEventListener('change', () => { if (cb.checked) S.threads.forEach((t) => S.sel.add(t.id)); else S.sel.clear(); renderList(); });
  const v = S.view;
  const kids = v.from === 'cleanup'
    ? [tbBtn('back', 'Back to Clean up (Esc)', backToCleanup, 'back-btn'), h('span', { class: 'tb-sep' }), cb]
    : [cb];
  const inSpam = v.kind === 'folder' && v.key === 'spam';
  const inTrash = v.kind === 'folder' && v.key === 'trash';
  const inDrafts = v.kind === 'folder' && (v.key === 'drafts' || v.key === 'scheduled');
  const inSnoozed = v.kind === 'folder' && v.key === 'snoozed';
  if (n && !inDrafts) {
    const ids = selectedIds();
    const anyUnread = ids.some((x) => (threadById(x) || {}).unread);
    if (inSnoozed) kids.push(h('button', { class: 'tb text', text: 'Unsnooze', title: 'Back to the Inbox now', onclick: () => act(ids, 'unsnooze') }), (() => { const b = tbBtn('clock', 'Change snooze time', () => snoozeMenu(b, ids)); return b; })(), tbBtn('trash', 'Delete (#)', () => act(ids, 'trash')));
    else if (inSpam) kids.push(h('button', { class: 'tb text', text: 'Not spam', onclick: () => act(ids, 'notspam') }), tbBtn('trash', 'Delete forever', () => act(ids, 'forever')));
    else if (inTrash) kids.push(h('button', { class: 'tb text', text: 'Restore', onclick: () => act(ids, 'untrash') }), h('button', { class: 'tb text', text: 'Delete forever', onclick: () => act(ids, 'forever') }));
    else {
      const inInbox = v.kind === 'folder' && v.key === 'inbox';
      kids.push(inInbox || ids.some((x) => ((threadById(x) || {}).labelIds || []).includes('INBOX')) ? tbBtn('archive', 'Archive (e)', () => act(ids, 'archive')) : tbBtn('unarchive', 'Move to Inbox', () => act(ids, 'inbox')));
      kids.push(tbBtn('spam', 'Report spam (!)', () => act(ids, 'spam')), tbBtn('trash', 'Delete (#)', () => act(ids, 'trash')));
      const sz = tbBtn('clock', 'Snooze (b)', () => snoozeMenu(sz, ids));
      kids.push(sz, h('span', { class: 'tb-sep' }));
      kids.push(anyUnread ? tbBtn('mailOpen', 'Mark as read', () => act(ids, 'read')) : tbBtn('mail', 'Mark as unread', () => act(ids, 'unread')));
      const mv = tbBtn('move', 'Move to', () => moveMenu(mv, ids));
      const lb = tbBtn('label', 'Labels', () => labelMenu(lb, ids, labelsOf(ids)));
      kids.push(mv, lb, tbBtn('star', 'Star', () => act(ids, 'star')));
      kids.push(h('span', { class: 'tb-sep' }), tbBtn('important', 'Important: show in For You (+)', () => teach(ids, true)), tbBtn('notimp', 'Not important: keep out of For You (-)', () => teach(ids, false)));
    }
  } else {
    kids.push(tbBtn('refresh', 'Refresh', () => { loadList(); gd.refreshCounts(); }));
    if (inTrash || inSpam) kids.push(h('span', { class: 'tb-info', style: 'margin-left:6px', text: inTrash ? 'Items in Trash are deleted by Gmail after 30 days.' : 'Spam is deleted by Gmail after 30 days.' }));
  }
  if (!all) S.selAll = false;
  const info = S.selAll ? 'Every conversation in ' + viewTitle() + ' selected' : n ? n + ' selected' : ((S.listState === 'ok' || S.listState === 'more') && S.threads.length ? S.threads.length.toLocaleString() + (S.next ? '+ conversations' : ' conversations') : '');
  kids.push(h('span', { class: 'tb-info', text: info }));
  // Gmail-style: after "select all", offer every conversation in the view, not only the loaded ones.
  const canAll = all && S.next && !inDrafts && !inTrash && !inSpam && S.view.kind !== 'cleanup' && !viewQuery().forYou;
  if (canAll || S.selAll) {
    kids.push(h('div', { class: 'selall-bar' }, S.selAll
      ? [h('span', { text: 'All conversations in ' + viewTitle() + ' are selected, not only the ' + S.threads.length + ' shown.' }), h('button', { class: 'linkish', text: 'Clear selection', onclick: () => { S.selAll = false; S.sel.clear(); renderList(); } })]
      : [h('span', { text: 'All ' + S.threads.length + ' conversations on screen are selected.' }), h('button', { class: 'linkish', text: 'Select every conversation in ' + viewTitle(), onclick: () => { S.selAll = true; renderToolbar(); } })]));
  }
  tb.replaceChildren(...kids);
}
function labelsOf(ids) {
  const sets = ids.map((x) => new Set(((x === (S.thread && S.thread.id) && S.thread.labelIds) || (threadById(x) || {}).labelIds || [])));
  return S.labels.filter((l) => sets.length && sets.every((s) => s.has(l.id))).map((l) => l.id);
}

function renderList() {
  if (S.view.kind === 'cleanup' || S.view.kind === 'calendar') {
    const a0 = acctMeta();
    if (!(a0 && a0.needsAuth)) { if (S.view.kind === 'calendar') renderCalendar(); else renderCleanup(); return; }
    $('tabs').hidden = true;
  }
  $('panes').classList.remove('cleanup');
  renderTabs();
  renderToolbar();
  const box = $('list');
  const a = acctMeta();
  if (a && a.needsAuth) {
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Sign in again to ' + a.email }), 'Google signed this account out of Beacon. This happens if you changed your password or removed the app\'s access.', h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn primary', text: 'Sign in again', onclick: () => reauth(a.id) }))));
    return;
  }
  if (S.listState === 'loading') { box.replaceChildren(...Array.from({ length: 9 }, () => h('div', { class: 'skel' }))); return; }
  if (S.listState === 'error') {
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Could not load ' + viewTitle().toLowerCase() }), S.listErr, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', text: 'Try again', onclick: () => loadList() }))));
    return;
  }
  if (!S.threads.length) {
    const fy = viewQuery().forYou;
    const msg = fy === 'imp' ? ['Nothing important right now', 'Mail from people you write to, replies to you and things that need action land here. Press + on any email to teach it what matters.'] : S.view.kind === 'search' ? ['No results', 'Nothing matched "' + S.view.q + '". Gmail search words like from:, subject:, has:attachment and older_than:1y work here.'] : ['Nothing here', S.view.kind === 'folder' && S.view.key === 'inbox' ? 'You\'re all caught up in this tab.' : 'No conversations in ' + viewTitle() + '.'];
    const inTab = S.view.kind === 'folder' && S.view.key === 'inbox' && !['everything', 'other'].includes(S.view.tab || 'foryou');
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: msg[0] }), msg[1],
      inTab ? h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', text: 'Show everything in the inbox', onclick: () => { S.view.tab = 'everything'; loadList(); } })) : null));
    return;
  }
  const rows = S.threads.map((t) => listRow(t));
  const mr = moreRow(); if (mr) rows.push(mr);
  box.replaceChildren(...rows);
}

function listRow(t) {
  const sel = S.sel.has(t.id);
  const cb = h('input', {
    type: 'checkbox', class: 'check', checked: sel, 'aria-label': 'Select ' + t.subject,
    onclick: (e) => {
      e.stopPropagation();
      const myIdx = S.threads.findIndex((x) => x.id === t.id);
      if (e.shiftKey && S.lastSelId && S.lastSelId !== t.id) {
        const lastIdx = S.threads.findIndex((x) => x.id === S.lastSelId);
        if (lastIdx !== -1 && myIdx !== -1) {
          const start = Math.min(lastIdx, myIdx);
          const end = Math.max(lastIdx, myIdx);
          const shouldCheck = cb.checked;
          for (let i = start; i <= end; i++) {
            const rowT = S.threads[i];
            if (shouldCheck) S.sel.add(rowT.id);
            else S.sel.delete(rowT.id);
          }
          S.lastSelId = t.id;
          renderList();
          return;
        }
      }
      S.lastSelId = t.id;
      if (cb.checked) S.sel.add(t.id); else S.sel.delete(t.id);
      renderList();
    }
  });
  const star = h('button', { class: 'star' + (t.starred ? ' on' : ''), title: t.starred ? 'Starred' : 'Not starred', 'aria-label': t.starred ? 'Remove star' : 'Add star', onclick: (e) => { e.stopPropagation(); act([t.id], t.starred ? 'unstar' : 'star'); } }, icon('star'));
  const who = t.isDraft ? h('span', {}, t.scheduledAt ? h('span', { class: 'pill sched' + (t.failed ? ' failed' : ''), text: t.failed ? 'Not sent' : 'Scheduled' }) : h('span', { class: 'pill draft', text: 'Draft' }), ' ', nameOf(t.to) || '(no recipient)') : (S.view.kind === 'folder' && S.view.key === 'sent' ? 'To: ' + (nameOf(t.to) || '') : t.participants || nameOf(t.from));
  const labelPills = (t.labelIds || []).map((id) => S.labels.find((l) => l.id === id)).filter(Boolean).filter((l) => !(S.view.kind === 'label' && S.view.id === l.id)).slice(0, 3).map((l) => h('span', { class: 'pill', text: l.name }));
  const quick = h('div', { class: 'quick' },
    !t.isDraft && (t.labelIds || []).includes('INBOX') ? tbBtn('archive', 'Archive', (e) => { e.stopPropagation(); act([t.id], 'archive'); }) : null,
    !t.isDraft ? tbBtn('trash', 'Delete', (e) => { e.stopPropagation(); act([t.id], (t.labelIds || []).includes('TRASH') ? 'forever' : 'trash'); }) : tbBtn('trash', 'Discard draft', (e) => { e.stopPropagation(); discardDraft(t.draftId); }),
    !t.isDraft ? (t.unread ? tbBtn('mailOpen', 'Mark as read', (e) => { e.stopPropagation(); act([t.id], 'read'); }) : tbBtn('mail', 'Mark as unread', (e) => { e.stopPropagation(); act([t.id], 'unread'); })) : null);
  return h('div', {
    class: 'row' + (t.unread ? ' unread' : '') + (sel ? ' selected' : '') + (t.id === S.openId ? ' open' : ''), role: 'listitem', tabindex: '0', 'data-id': t.id,
    onclick: () => (t.isDraft ? openDraft(t.draftId) : openThread(t.id)),
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); t.isDraft ? openDraft(t.draftId) : openThread(t.id); } },
  }, cb, t.isDraft ? h('span', { style: 'width:28px' }) : star,
  h('div', { class: 'body' },
    h('div', { class: 'top' }, h('span', { class: 'who' }, who), t.count > 1 ? h('span', { class: 'count', text: String(t.count) }) : null,
      t.priority && viewQuery().forYou ? h('span', { class: 'why' + (t.priority.important ? ' imp' : ''), text: t.priority.why, title: 'Why it is ' + (t.priority.important ? 'in For You' : 'in Everything else') + '. Press + or - to teach it.' }) : null),
    h('div', { class: 'subj' }, t.backFromSnooze ? h('span', { class: 'pill back', text: 'Back from snooze' }) : null, ...labelPills, t.subject || '(no subject)'),
    h('div', { class: 'snip', text: t.snippet || '' })),
  h('div', { class: 'meta' }, t.snoozedUntil ? h('span', { class: 'date until', title: 'Comes back ' + fmtWhen(t.snoozedUntil), text: 'Until ' + fmtShort(t.snoozedUntil) }) : t.scheduledAt ? h('span', { class: 'date until', title: 'Sends ' + fmtWhen(t.scheduledAt), text: fmtShort(t.scheduledAt) }) : h('span', { class: 'date', text: fmtListDate(t.date) }), t.hasAttachment ? h('span', { class: 'clip' }, icon('clip')) : null),
  quick);
}

// ----------------------------------------------------------------- actions with undo
const LEAVES = { snooze: () => true, unsnooze: (v) => v.kind === 'folder' && v.key === 'snoozed', archive: (v) => !(v.kind === 'folder' && ['all', 'starred', 'sent', 'important'].includes(v.key)) && !(v.kind === 'label'), spam: () => true, trash: () => true, untrash: () => true, notspam: () => true, forever: () => true, move: () => true, inbox: (v) => !(v.kind === 'folder' && v.key === 'all') && !(v.kind === 'label') && !(v.kind === 'search'), unlabel: (v, extra) => v.kind === 'label' && v.id === extra, unstar: (v) => v.kind === 'folder' && v.key === 'starred', read: (v) => v.kind === 'search' && /is:unread/.test(v.q) };
const UNDO = { snooze: 'unsnooze', archive: 'inbox', spam: 'notspam', trash: 'untrash', inbox: 'archive', notspam: 'spam', move: 'unmove', label: 'unlabel', unlabel: 'label', star: 'unstar', unstar: 'star', read: 'unread', unread: 'read', untrash: 'trash', important: 'notimportant', notimportant: 'important' };
const DONE_MSG = { snooze: 'Snoozed', unsnooze: 'Back in your Inbox', archive: 'Archived', spam: 'Reported as spam', trash: 'Moved to Trash', inbox: 'Moved to Inbox', notspam: 'Moved out of Spam', untrash: 'Restored', forever: 'Deleted forever', move: 'Moved', label: 'Label added', unlabel: 'Label removed', read: 'Marked as read', unread: 'Marked as unread', star: 'Starred', unstar: 'Star removed', important: 'Marked important', notimportant: 'Marked not important' };

const PROGRESS_MSG = { trash: 'Deleting', archive: 'Archiving', spam: 'Reporting', read: 'Marking', unread: 'Marking', star: 'Starring', move: 'Moving', label: 'Labeling', unlabel: 'Updating', forever: 'Deleting', untrash: 'Restoring', notspam: 'Moving', inbox: 'Moving' };
async function act(ids, action, extra, { quiet, fromUndo } = {}) {
  if (S.selAll && !quiet && !fromUndo && ['archive', 'trash', 'spam', 'read', 'unread', 'star'].includes(action)) return actAll(action);
  if (!ids.length) return;
  const acctId = S.acct;
  const unreadRows = ['trash', 'spam'].includes(action) && !fromUndo ? ids.map(threadById).filter((t) => t && t.unread) : [];
  if (unreadRows.length) gd.priorityLearn(acctId, 'ignore', unreadRows.map(rowForTeach)).catch(() => {});
  if (action === 'star') gd.priorityLearn(acctId, 'star', ids.map((x) => threadById(x) || (S.thread && S.thread.id === x ? S.thread : null)).filter(Boolean).map(rowForTeach)).catch(() => {});
  if (ids.length > 3 && !quiet) toast((PROGRESS_MSG[action] || 'Working on') + ' ' + ids.length + ' conversations…', null, null, 120000);
  let failedMsg = '';
  try {
    if (action === 'unmove') { await gd.action(acctId, ids, 'inbox'); await gd.action(acctId, ids, 'unlabel', extra); }
    else {
      const r = await gd.action(acctId, ids, action, extra);
      if (r && r.cancelled) { if (ids.length > 3) $('toast').hidden = true; return; }
      if (r && r.failed && r.failed.length) { ids = r.done; failedMsg = r.failed.length + ' could not be changed: ' + (r.error || 'unknown error'); }
    }
  } catch (e) { toast(e.message, null, null, 8000); return; }
  if (acctId !== S.acct) return;
  // update local copies
  const leaves = LEAVES[action] && LEAVES[action](S.view, extra);
  for (const id of ids) {
    const t = threadById(id);
    if (t) applyLabelChange(t, action, extra);
    if (S.thread && S.thread.id === id) applyLabelChange(S.thread, action, extra);
  }
  if (leaves) {
    const openGone = ids.includes(S.openId);
    let nextId = null;
    if (openGone) { const i = S.threads.findIndex((t) => t.id === S.openId); const rest = S.threads.filter((t) => !ids.includes(t.id)); nextId = rest[Math.min(i, rest.length - 1)] ? rest[Math.min(Math.max(i, 0), rest.length - 1)].id : null; }
    S.threads = S.threads.filter((t) => !ids.includes(t.id));
    ids.forEach((x) => S.sel.delete(x));
    if (openGone) { closeThread(true); if (nextId && window.innerWidth > 920) openThread(nextId); }
    if (!S.threads.length && S.next) setTimeout(() => loadList(), 300); // cleared the page: bring in the next ones
  }
  renderList();
  if (S.thread) renderReader();
  if (failedMsg) toast((DONE_MSG[action] || 'Done') + ' ' + ids.length + '. ' + failedMsg, null, null, 10000);
  else if (!quiet) {
    const label = (DONE_MSG[action] || 'Done') + (ids.length > 1 ? ' (' + ids.length + ')' : '') + (action === 'snooze' ? ' until ' + fmtWhen(extra) : '');
    const undo = UNDO[action];
    if (undo && !fromUndo && !['read', 'unread', 'star', 'unstar'].includes(action)) toast(label, 'Undo', () => act(ids, undo, extra, { fromUndo: true }).then(() => { if (leaves) loadList({ silent: true }); }));
    else toast(label);
  }
  if (['archive', 'trash', 'spam', 'read', 'unread', 'inbox', 'untrash', 'notspam', 'move', 'snooze', 'unsnooze'].includes(action)) gd.refreshCounts();
}
// ----------------------------------------------------------------- For You teaching
function rowForTeach(t) {
  if (t.messages) { const m = [...t.messages].reverse().find((x) => !x.labelIds.includes('SENT')) || t.messages[t.messages.length - 1]; return { id: t.id, from: m.from, subject: t.messages[0].subject, snippet: m.snippet || '', labelIds: t.labelIds }; }
  return { id: t.id, from: t.from, subject: t.subject, snippet: t.snippet, labelIds: t.labelIds };
}
async function teach(ids, important) {
  const rows = ids.map((x) => threadById(x) || (S.thread && S.thread.id === x ? S.thread : null)).filter(Boolean);
  if (!rows.length) return;
  try { await gd.priorityTeach(S.acct, rows.map(rowForTeach), important); } catch (e) { toast(e.message); return; }
  const why = important ? 'You marked this important' : 'You marked this not important';
  for (const x of ids) { const t = threadById(x); if (t) t.priority = { score: important ? 10 : -10, important, why }; }
  if (S.thread && ids.includes(S.thread.id)) S.thread.priority = { important, why };
  const fy = viewQuery().forYou;
  if (fy && (fy === 'imp') !== important) {
    S.threads = S.threads.filter((t) => !ids.includes(t.id)); ids.forEach((x) => S.sel.delete(x));
    if (ids.includes(S.openId)) closeThread(true);
  }
  renderList(); if (S.thread) renderReader();
  const who = rows.length === 1 ? nameOf(rowForTeach(rows[0]).from) : rows.length + ' conversations';
  toast(important ? 'Got it: ' + who + ' shows in For You. More like it will too.' : 'Moved ' + who + ' to Everything else. Mail like it goes there too.', 'Undo', () => teach(ids, !important), 10000);
}

// Every conversation in the current view, using the whole search on Gmail's side (not just loaded rows).
async function actAll(action) {
  const name = viewTitle() + (S.view.kind === 'folder' && S.view.key === 'inbox' ? ' (' + (TABS.find((t) => t.key === (S.view.tab || 'foryou')) || {}).label + ')' : '');
  if (action === 'trash' || action === 'spam') {
    const a = await confirmBox((action === 'trash' ? 'Delete' : 'Report as spam') + ' every conversation in ' + name + '?', action === 'trash' ? 'All of them go to Trash, not only the ones loaded on screen. Gmail keeps Trash for 30 days, so you can still get them back.' : 'All of them move to Spam, not only the ones loaded on screen.', action === 'trash' ? 'Delete all' : 'Report all', { danger: true });
    if (!a.ok) return;
  }
  const acctId = S.acct;
  const q = viewQuery();
  toast((PROGRESS_MSG[action] || 'Working on') + ' everything in ' + name + '…', null, null, 300000);
  try {
    const r = await gd.actionAll(acctId, { q: q.q || '', labelIds: q.labelIds || [] }, action);
    S.selAll = false; S.lastSelId = null; S.sel.clear();
    const msg = (DONE_MSG[action] || 'Done') + ' ' + r.count.toLocaleString() + (r.count === 1 ? ' email' : ' emails');
    if (r.undo) toast(msg, 'Undo', async () => { try { await gd.actionAllUndo(r.undo); toast('Undone'); loadList(); } catch (e) { toast(e.message); } }, 12000);
    else toast(msg);
    if (acctId === S.acct) loadList();
    gd.refreshCounts();
  } catch (e) { toast('Could not do that: ' + e.message, null, null, 10000); }
}

function applyLabelChange(t, action, extra) {
  const l = new Set(t.labelIds || []);
  const add = (x) => l.add(x), del = (x) => l.delete(x);
  switch (action) {
    case 'archive': del('INBOX'); break; case 'inbox': add('INBOX'); break;
    case 'read': del('UNREAD'); t.unread = false; break; case 'unread': add('UNREAD'); t.unread = true; break;
    case 'star': add('STARRED'); t.starred = true; break; case 'unstar': del('STARRED'); t.starred = false; break;
    case 'spam': add('SPAM'); del('INBOX'); t.spam = true; break; case 'notspam': del('SPAM'); add('INBOX'); t.spam = false; break;
    case 'trash': add('TRASH'); t.trash = true; break; case 'untrash': del('TRASH'); t.trash = false; break;
    case 'label': add(extra); break; case 'unlabel': del(extra); break;
    case 'move': add(extra); del('INBOX'); break;
    case 'important': add('IMPORTANT'); break; case 'notimportant': del('IMPORTANT'); break;
    default: break;
  }
  t.labelIds = [...l];
  t.inbox = l.has('INBOX');
}

function moveMenu(anchor, ids) {
  const filter = h('input', { type: 'text', placeholder: 'Move to…' });
  const listBox = h('div');
  const draw = () => {
    const f = filter.value.trim().toLowerCase();
    listBox.replaceChildren(
      ...(!f || 'inbox'.includes(f) ? [h('button', { onclick: () => { closeMenus(); act(ids, 'inbox'); } }, icon('inbox'), h('span', { text: 'Inbox' }))] : []),
      ...S.labels.filter((l) => !f || l.name.toLowerCase().includes(f)).map((l) => h('button', { onclick: () => { closeMenus(); act(ids, 'move', l.id); } }, icon('label'), h('span', { text: l.name }))),
      ...(f && !S.labels.some((l) => l.name.toLowerCase() === f) ? [h('button', { onclick: async () => { closeMenus(); const l = await createLabel(filter.value.trim()); if (l) act(ids, 'move', l.id); } }, h('span', { text: 'Create "' + filter.value.trim() + '" and move' }))] : []));
  };
  filter.addEventListener('input', draw);
  filter.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = listBox.querySelector('button'); if (b) b.click(); } if (e.key === 'Escape') closeMenus(); });
  draw();
  popMenu(anchor, [{ el: filter }, { el: listBox }]);
}
function labelMenu(anchor, ids, current) {
  const filter = h('input', { type: 'text', placeholder: 'Label as…' });
  const listBox = h('div');
  const have = new Set(current);
  const draw = () => {
    const f = filter.value.trim().toLowerCase();
    listBox.replaceChildren(
      ...S.labels.filter((l) => !f || l.name.toLowerCase().includes(f)).map((l) => h('button', { onclick: () => { closeMenus(); act(ids, have.has(l.id) ? 'unlabel' : 'label', l.id); } }, have.has(l.id) ? icon('check') : h('span', { style: 'width:20px' }), h('span', { text: l.name }))),
      ...(f && !S.labels.some((l) => l.name.toLowerCase() === f) ? [h('button', { onclick: async () => { closeMenus(); const l = await createLabel(filter.value.trim()); if (l) act(ids, 'label', l.id); } }, h('span', { text: 'Create "' + filter.value.trim() + '"' }))] : []),
      ...(!S.labels.length && !f ? [h('div', { class: 'head', text: 'Type a name to create a label' })] : []));
  };
  filter.addEventListener('input', draw);
  filter.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = listBox.querySelector('button'); if (b) b.click(); } if (e.key === 'Escape') closeMenus(); });
  draw();
  popMenu(anchor, [{ el: filter }, { el: listBox }]);
}
async function createLabel(name) {
  if (!name) return null;
  try { const l = await gd.createLabel(S.acct, name); await loadLabels(); toast('Created label "' + name + '"'); return l; }
  catch (e) { toast(e.message); return null; }
}
