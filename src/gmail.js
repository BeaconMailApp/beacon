'use strict';
// Gmail API client for one account. All network calls and tokens stay in the main process.

const oauth = require('./oauth');
const store = require('./store');
const mime = require('./mime');
const { log } = require('./log');

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3/';

class AuthError extends Error { constructor(msg) { super(msg); this.code = 'needs_auth'; } }

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

class Account {
  constructor(meta, getClient) {
    this.meta = meta; // {id, email, ...}
    this.getClient = getClient;
    this.tok = store.readToken(meta.id);
    this.refreshing = null;
    this.summaries = new Map(); // threadId -> {historyId, row}; skips refetching unchanged conversations
  }

  async accessToken(force) {
    if (!this.tok || !this.tok.refresh_token) throw new AuthError('Sign in again to ' + (this.meta.email || 'this account') + '.');
    if (!force && this.tok.access_token && Date.now() < this.tok.expires_at) return this.tok.access_token;
    if (!this.refreshing) {
      this.refreshing = oauth.refresh(this.getClient(), this.tok.refresh_token)
        .then((t) => { this.tok = Object.assign({}, this.tok, t); store.writeToken(this.meta.id, this.tok); return this.tok.access_token; })
        .catch((e) => { if (e.code === 'invalid_grant') throw new AuthError('Google signed this account out. Sign in again to ' + (this.meta.email || 'it') + '.'); throw e; })
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async api(method, path, { query, body, retry = true, attempt = 0 } = {}) {
    const url = new URL(/^https:\/\//.test(path) ? path : BASE + path);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x)); else url.searchParams.set(k, String(v));
    }
    if (Account.pauseUntil && Date.now() < Account.pauseUntil) await new Promise((r) => setTimeout(r, Account.pauseUntil - Date.now()));
    const token = await this.accessToken();
    let res;
    try {
      res = await fetch(url, { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); return this.api(method, path, { query, body, retry, attempt: attempt + 1 }); }
      log('network error', method, path, String(e && e.message));
      const err = new Error('Could not reach Gmail. Check your internet connection.'); err.code = 'offline'; throw err;
    }
    if (res.status === 401 && retry) { await this.accessToken(true); return this.api(method, path, { query, body, retry: false, attempt }); }
    const text = await res.text();
    // Gmail allows only so many requests per second per user. Back off and try again.
    const limited = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded|quota/i.test(text));
    if (limited && attempt < 4) {
      // A per-minute limit only clears when the minute rolls over, so wait longer for those.
      const perMinute = /per minute/i.test(text);
      const wait = perMinute ? 15000 * (attempt + 1) : 1000 * Math.pow(2, attempt);
      Account.pauseUntil = Math.max(Account.pauseUntil || 0, Date.now() + wait);
      await new Promise((r) => setTimeout(r, wait + Math.random() * 500));
      return this.api(method, path, { query, body, retry, attempt: attempt + 1 });
    }
    let json = {};
    if (text) { try { json = JSON.parse(text); } catch (_) { json = { raw: text }; } }
    if (!res.ok) {
      const msg = (json.error && (json.error.message || json.error.status)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      const isCal = url.pathname.startsWith('/calendar/');
      if (res.status === 403 && /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(text)) {
        err.code = isCal ? 'calendar_disabled' : 'api_disabled';
        err.message = isCal ? 'The Google Calendar API is turned off in your Google Cloud project. Turn it on, wait a minute, then try again.'
          : 'The Gmail API is turned off in your Google Cloud project. Turn it on (see the help link), wait a minute, then try again.';
      } else if (res.status === 403 && /insufficient(Permissions| authentication scopes)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) {
        err.code = isCal ? 'calendar_scope' : 'scope';
        err.message = isCal ? 'Beacon does not have permission to use your calendar yet. Connect your calendar and tick the calendar boxes on the Google screen.' : err.message;
      }
      log('api error', method, path, res.status, msg.slice(0, 300));
      if (res.status === 401) throw new AuthError('Sign in again to ' + (this.meta.email || 'this account') + '.');
      throw err;
    }
    return json;
  }

  // ---------- reading ----------
  profile() { return this.api('GET', 'profile'); }
  labels() { return this.api('GET', 'labels').then((r) => r.labels || []); }
  label(id) { return this.api('GET', 'labels/' + encodeURIComponent(id)); }

  async listThreads({ q, labelIds, pageToken, max = 30 }) {
    const r = await this.api('GET', 'threads', { query: { q, labelIds, pageToken, maxResults: max, includeSpamTrash: (labelIds || []).some((l) => l === 'SPAM' || l === 'TRASH') || /\bin:(spam|trash|anywhere)\b/.test(q || '') } });
    const list = r.threads || [];
    let firstErr = null; let failed = 0;
    const rows = await pool(list, 3, (t) => {
      const c = this.summaries.get(t.id);
      if (c && c.historyId === t.historyId) return c.row;
      return this.threadSummary(t.id).then((row) => {
        if (this.summaries.size > 5000) this.summaries.clear();
        this.summaries.set(t.id, { historyId: t.historyId, row });
        return row;
      }).catch((e) => {
        failed++; if (!firstErr) firstErr = e;
        // Still show the conversation, with what the list call gave us, so nothing disappears.
        return { id: t.id, subject: '(could not load details)', from: '', to: '', participants: '', snippet: decodeEntities(t.snippet || ''), date: 0, count: 1, unread: false, starred: false, important: false, labelIds: [], hasAttachment: false, partial: true };
      });
    });
    if (list.length && failed === list.length && firstErr) throw firstErr;
    if (failed) log('thread details failed', failed, 'of', list.length, String(firstErr && firstErr.message));
    log('list ok', 'q=' + (q || ''), 'labels=' + (labelIds || []).join(','), 'count=' + list.length);
    return { threads: rows, nextPageToken: r.nextPageToken || null, estimate: r.resultSizeEstimate || 0 };
  }

  async threadSummary(id) {
    const t = await this.api('GET', 'threads/' + id, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] } });
    return summarize(t, this.meta.email);
  }

  async getThread(id) {
    const t = await this.api('GET', 'threads/' + id, { query: { format: 'full' } });
    const messages = [];
    for (const m of t.messages || []) {
      const p = mime.parsePayload(m.payload);
      const hd = m.payload ? m.payload.headers : [];
      let html = p.html;
      // Inline images (cid:) become data URLs so they show without remote loading.
      const inline = p.attachments.filter((a) => a.cid && html && html.includes(a.cid));
      for (const a of inline) {
        try {
          let data = a.data;
          if (!data && a.attachmentId && a.size < 3 * 1024 * 1024) data = (await this.api('GET', 'messages/' + m.id + '/attachments/' + a.attachmentId)).data;
          if (data) {
            const url = 'data:' + a.mimeType + ';base64,' + mime.fromB64url(data).toString('base64');
            html = html.split('cid:' + a.cid).join(url);
          }
        } catch (_) {}
      }
      messages.push({
        id: m.id, threadId: m.threadId, labelIds: m.labelIds || [], snippet: m.snippet, internalDate: Number(m.internalDate),
        from: mime.header(hd, 'From'), to: mime.header(hd, 'To'), cc: mime.header(hd, 'Cc'), replyTo: mime.header(hd, 'Reply-To'),
        subject: mime.header(hd, 'Subject'), date: mime.header(hd, 'Date'), messageIdHeader: mime.header(hd, 'Message-ID') || mime.header(hd, 'Message-Id'),
        references: mime.header(hd, 'References'), listUnsubscribe: mime.header(hd, 'List-Unsubscribe'),
        html, text: p.text,
        attachments: p.attachments.filter((a) => !(a.cid && inline.includes(a))).map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, attachmentId: a.attachmentId, messageId: m.id, data: a.data && a.size < 200000 ? a.data : null })),
      });
    }
    const labels = new Set(messages.flatMap((m) => m.labelIds));
    return { id: t.id, messages, unread: labels.has('UNREAD'), starred: labels.has('STARRED'), inbox: labels.has('INBOX'), spam: labels.has('SPAM'), trash: labels.has('TRASH'), important: labels.has('IMPORTANT'), labelIds: [...labels] };
  }

  async attachment(messageId, attachmentId) {
    const r = await this.api('GET', 'messages/' + messageId + '/attachments/' + attachmentId);
    return mime.fromB64url(r.data);
  }

  // ---------- changing ----------
  modifyThread(id, add, remove) { return this.api('POST', 'threads/' + id + '/modify', { body: { addLabelIds: add || [], removeLabelIds: remove || [] } }); }
  trashThread(id) { return this.api('POST', 'threads/' + id + '/trash'); }
  untrashThread(id) { return this.api('POST', 'threads/' + id + '/untrash'); }
  deleteThreadForever(id) { return this.api('DELETE', 'threads/' + id); }
  createLabel(name) { return this.api('POST', 'labels', { body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } }); }

  // ---------- sending ----------
  sendAs() { return this.api('GET', 'settings/sendAs').then((r) => r.sendAs || []).catch(() => []); }
  sendRaw(raw, threadId) { return this.api('POST', 'messages/send', { body: threadId ? { raw, threadId } : { raw } }); }
  createDraft(raw, threadId) { return this.api('POST', 'drafts', { body: { message: threadId ? { raw, threadId } : { raw } } }); }
  updateDraft(id, raw, threadId) { return this.api('PUT', 'drafts/' + id, { body: { id, message: threadId ? { raw, threadId } : { raw } } }); }
  deleteDraft(id) { return this.api('DELETE', 'drafts/' + id); }
  async listDrafts({ pageToken, q }) {
    const r = await this.api('GET', 'drafts', { query: { maxResults: 30, pageToken, q } });
    const rows = await pool(r.drafts || [], 8, async (d) => {
      try {
        const m = await this.api('GET', 'messages/' + d.message.id, { query: { format: 'metadata', metadataHeaders: ['To', 'Subject', 'Date'] } });
        const hd = m.payload ? m.payload.headers : [];
        return { id: m.threadId, draftId: d.id, messageId: d.message.id, from: 'Draft', to: mime.header(hd, 'To'), subject: mime.header(hd, 'Subject') || '(no subject)', snippet: m.snippet || '', date: Number(m.internalDate), unread: false, starred: false, count: 1, isDraft: true, participants: 'Draft to ' + (mime.header(hd, 'To') || 'nobody yet') };
      } catch (_) { return null; }
    });
    return { threads: rows.filter(Boolean), nextPageToken: r.nextPageToken || null };
  }
  async getDraft(draftId) {
    const d = await this.api('GET', 'drafts/' + draftId, { query: { format: 'full' } });
    const m = d.message || {};
    const hd = m.payload ? m.payload.headers : [];
    const p = mime.parsePayload(m.payload);
    return { draftId: d.id, threadId: m.threadId, to: mime.header(hd, 'To'), cc: mime.header(hd, 'Cc'), bcc: mime.header(hd, 'Bcc'), subject: mime.header(hd, 'Subject'), html: p.html || mime.textToHtml(p.text), inReplyTo: mime.header(hd, 'In-Reply-To'), references: mime.header(hd, 'References') };
  }

  // ---------- permissions ----------
  hasScope(s) { return !!(this.tok && String(this.tok.scope || '').split(/\s+/).includes(s)); }

  // ---------- message level (cleanup, contacts, rules) ----------
  async messageIds(query, labelIds, limit = 500) {
    const ids = []; let pageToken;
    do {
      const r = await this.api('GET', 'messages', { query: { q: query, labelIds, maxResults: Math.min(500, limit - ids.length), pageToken } });
      (r.messages || []).forEach((m) => ids.push(m.id));
      pageToken = r.nextPageToken;
    } while (pageToken && ids.length < limit);
    return ids;
  }
  messageHeaders(id, headers) { return this.api('GET', 'messages/' + id, { query: { format: 'metadata', metadataHeaders: headers } }); }
  async batchModify(ids, add, remove) {
    for (let i = 0; i < ids.length; i += 1000) await this.api('POST', 'messages/batchModify', { body: { ids: ids.slice(i, i + 1000), addLabelIds: add || [], removeLabelIds: remove || [] } });
  }
  trashMessage(id) { return this.api('POST', 'messages/' + id + '/trash'); }

  // ---------- drafts sending (schedule send) ----------
  sendDraft(id) { return this.api('POST', 'drafts/send', { body: { id } }); }

  // ---------- Gmail filters (rules) ----------
  filters() { return this.api('GET', 'settings/filters').then((r) => r.filter || []); }
  createFilter(criteria, action) { return this.api('POST', 'settings/filters', { body: { criteria, action } }); }
  deleteFilter(id) { return this.api('DELETE', 'settings/filters/' + encodeURIComponent(id)); }

  // ---------- Google Calendar ----------
  hasCalendar() { return oauth.CAL_SCOPES.every((x) => this.hasScope(x)); }
  async calCalendars() {
    const out = []; let pageToken;
    do {
      const r = await this.api('GET', CAL_BASE + 'users/me/calendarList', { query: { maxResults: 250, pageToken } });
      out.push(...(r.items || [])); pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }
  async calEvents(calId, timeMin, timeMax) {
    const out = []; let pageToken; let n = 0;
    do {
      const r = await this.api('GET', CAL_BASE + 'calendars/' + encodeURIComponent(calId) + '/events', { query: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 250, pageToken } });
      out.push(...(r.items || [])); pageToken = r.nextPageToken;
    } while (pageToken && ++n < 8);
    return out;
  }
  calGet(calId, id) { return this.api('GET', CAL_BASE + 'calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(id)); }
  calInsert(calId, body, { sendUpdates, conference } = {}) {
    return this.api('POST', CAL_BASE + 'calendars/' + encodeURIComponent(calId) + '/events', { body, query: { sendUpdates: sendUpdates || 'none', conferenceDataVersion: conference ? 1 : undefined } });
  }
  calPatch(calId, id, body, { sendUpdates, conference } = {}) {
    return this.api('PATCH', CAL_BASE + 'calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(id), { body, query: { sendUpdates: sendUpdates || 'none', conferenceDataVersion: conference ? 1 : undefined } });
  }
  calDelete(calId, id, sendUpdates) { return this.api('DELETE', CAL_BASE + 'calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(id), { query: { sendUpdates: sendUpdates || 'none' } }); }
  calMove(calId, id, dest) { return this.api('POST', CAL_BASE + 'calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(id) + '/move', { query: { destination: dest } }); }

  // ---------- change tracking ----------
  history(startHistoryId) { return this.api('GET', 'history', { query: { startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: 100 } }); }
  messageMeta(id) { return this.api('GET', 'messages/' + id, { query: { format: 'metadata', metadataHeaders: ['From', 'Subject'] } }); }
}

function summarize(t, me) {
  const msgs = t.messages || [];
  const first = msgs[0] || {};
  const last = msgs[msgs.length - 1] || {};
  const labels = new Set(msgs.flatMap((m) => m.labelIds || []));
  const senders = [];
  for (const m of msgs) {
    const f = mime.header(m.payload && m.payload.headers, 'From');
    const isMe = me && f.toLowerCase().includes(me.toLowerCase());
    const n = isMe ? 'me' : displayName(f);
    if (!senders.includes(n)) senders.push(n);
  }
  return {
    id: t.id,
    subject: mime.header(first.payload && first.payload.headers, 'Subject') || '(no subject)',
    from: mime.header(last.payload && last.payload.headers, 'From'),
    to: mime.header(last.payload && last.payload.headers, 'To'),
    participants: senders.slice(-3).join(', '),
    snippet: decodeEntities(last.snippet || ''),
    date: Number(last.internalDate || 0),
    count: msgs.length,
    unread: labels.has('UNREAD'), starred: labels.has('STARRED'), important: labels.has('IMPORTANT'),
    labelIds: [...labels],
    hasAttachment: msgs.some((m) => /multipart\/mixed/i.test((m.payload && m.payload.mimeType) || '')),
  };
}
function displayName(from) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(from || '');
  if (m && m[1].trim()) return m[1].trim();
  return (m ? m[2] : from || '').split('@')[0];
}
function decodeEntities(s) { return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

module.exports = { Account, AuthError, summarize, displayName };
