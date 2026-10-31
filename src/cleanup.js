'use strict';
// Inbox cleanup: groups mail by sender so whole senders can be archived, deleted or unsubscribed.

const { log } = require('./log');

const SCOPES = {
  promotions: { label: 'Promotions', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] },
  social: { label: 'Social', labelIds: ['INBOX', 'CATEGORY_SOCIAL'] },
  updates: { label: 'Updates', labelIds: ['INBOX', 'CATEGORY_UPDATES'] },
  unread: { label: 'Unread in Inbox', labelIds: ['INBOX', 'UNREAD'] },
  inbox: { label: 'Whole Inbox', labelIds: ['INBOX'] },
};

const header = (m, n) => (((m.payload && m.payload.headers) || []).find((x) => x.name.toLowerCase() === n.toLowerCase()) || {}).value || '';
function parseFrom(f) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(f || '');
  return { name: m && m[1].trim() ? m[1].trim() : '', email: (m ? m[2] : f || '').trim().toLowerCase() };
}
function parseUnsub(h, post) {
  const parts = String(h || '').match(/<([^>]+)>/g) || [];
  const urls = parts.map((p) => p.slice(1, -1).trim());
  const http = urls.find((u) => /^https:\/\//i.test(u)) || null;
  const mailto = urls.find((u) => /^mailto:/i.test(u)) || null;
  return { http, mailto, oneClick: !!(http && /one-click/i.test(post || '')) };
}

/** Scans up to `limit` messages in the chosen part of the inbox and groups them by sender. */
async function scan(account, scopeKey, onProgress, limit = 600) {
  const sc = SCOPES[scopeKey] || SCOPES.promotions;
  const ids = await account.messageIds('', sc.labelIds, limit);
  const groups = new Map();
  let done = 0;
  const CONC = 3;
  for (let i = 0; i < ids.length; i += CONC) {
    await Promise.all(ids.slice(i, i + CONC).map(async (id) => {
      try {
        const m = await account.messageHeaders(id, ['From', 'Subject', 'List-Unsubscribe', 'List-Unsubscribe-Post']);
        if ((m.labelIds || []).includes('SENT')) return; // your own replies are not clutter
        const f = parseFrom(header(m, 'From'));
        if (!f.email) return;
        const g = groups.get(f.email) || { email: f.email, name: f.name, count: 0, unread: 0, last: 0, subject: '', unsub: null, ids: [] };
        g.count++;
        g.ids.push(id);
        if ((m.labelIds || []).includes('UNREAD')) g.unread++;
        const when = Number(m.internalDate || 0);
        if (when > g.last) { g.last = when; g.subject = header(m, 'Subject'); if (f.name) g.name = f.name; }
        const u = parseUnsub(header(m, 'List-Unsubscribe'), header(m, 'List-Unsubscribe-Post'));
        if ((u.http || u.mailto) && (!g.unsub || (u.oneClick && !g.unsub.oneClick))) g.unsub = u;
        groups.set(f.email, g);
      } catch (_) {}
      done++;
    }));
    if (onProgress) onProgress(done, ids.length);
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last);
  log('cleanup scan', scopeKey, 'messages=' + ids.length, 'senders=' + list.length);
  return { scope: scopeKey, label: sc.label, scanned: ids.length, capped: ids.length >= limit, senders: list };
}

/** Applies an action to every message from `email` in the chosen scope (not only the scanned ones).
 *  Returns {count, undo} where undo (if any) says how to put the labels back. */
async function act(account, scopeKey, email, action) {
  const sc = SCOPES[scopeKey] || SCOPES.promotions;
  const q = 'from:' + JSON.stringify(email);
  if (action === 'archive') {
    const ids = await account.messageIds(q, sc.labelIds, 5000);
    if (ids.length) await account.batchModify(ids, [], ['INBOX']);
    return { count: ids.length, undo: ids.length ? { ids, add: ['INBOX'], remove: [] } : null };
  }
  if (action === 'read') {
    const ids = await account.messageIds(q + ' is:unread', sc.labelIds, 5000);
    if (ids.length) await account.batchModify(ids, [], ['UNREAD']);
    return { count: ids.length, undo: ids.length ? { ids, add: ['UNREAD'], remove: [] } : null };
  }
  if (action === 'trash') {
    const ids = await account.messageIds(q, sc.labelIds, 5000);
    try { if (ids.length) await account.batchModify(ids, ['TRASH'], ['INBOX']); }
    catch (e) {
      log('batch trash failed, trashing one by one', e.message);
      for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map((id) => account.trashMessage(id)));
    }
    return { count: ids.length, undo: null };
  }
  throw new Error('Unknown cleanup action');
}

/** Unsubscribes the best way the sender allows. Returns how it was done. */
async function unsubscribe(account, unsub, fromAddr, sendRaw) {
  if (!unsub) throw new Error('This sender does not offer an unsubscribe link.');
  if (unsub.oneClick && unsub.http) {
    try {
      const r = await fetch(unsub.http, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', redirect: 'follow' });
      if (r.ok) return { method: 'one-click' };
      log('one-click unsubscribe http', r.status);
    } catch (e) { log('one-click unsubscribe failed', e.message); }
  }
  if (unsub.mailto) {
    const u = new URL(unsub.mailto);
    const to = decodeURIComponent(u.pathname);
    const subject = u.searchParams.get('subject') || 'unsubscribe';
    const body = u.searchParams.get('body') || 'unsubscribe';
    await sendRaw({ to: [to], subject, text: body, html: body });
    return { method: 'email', to };
  }
  if (unsub.http) return { method: 'browser', url: unsub.http };
  throw new Error('This sender does not offer an unsubscribe link.');
}

module.exports = { scan, act, unsubscribe, parseUnsub, parseFrom, SCOPES };
