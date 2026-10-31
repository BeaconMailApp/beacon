'use strict';
// Fake Gmail account used only for testing the interface (GMAIL_DESK_MOCK=1). Never used in normal runs.

const mime = require('./mime');

const people = [
  ['Whitney Heinrichs', 'whitney@example.com'], ['Morrisville Admissions', 'admissions@example.edu'], ['GEICO', 'billing@example.com'],
  ['Elizabeth', 'liz@example.com'], ['Chase', 'alerts@example.com'], ['Amazon', 'store@example.com'], ['LinkedIn', 'news@example.com'],
];
const subjects = ['Interview request: field service technician', 'Are you also sending your diploma?', 'Your payment is due Oct 25', 'Dinner tonight?', 'Your statement is ready', 'Deals picked for you', 'You appeared in 9 searches'];
const cats = ['CATEGORY_PERSONAL', 'CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL'];

function makeStore(email) {
  const threads = [];
  const now = Date.now();
  for (let i = 0; i < (Number(process.env.MOCK_THREADS) || 46); i++) {
    const k = i % people.length;
    const [name, addr] = people[k];
    const n = i % 5 === 0 ? 3 : 1;
    const msgs = [];
    for (let j = 0; j < n; j++) {
      const mine = n > 1 && j === 1;
      msgs.push({
        id: 'm' + i + '_' + j, threadId: 't' + i, internalDate: String(now - i * 3.6e6 * 5 - (n - j) * 6e5),
        labelIds: ['INBOX', cats[k]].concat(i < 6 && j === n - 1 ? ['UNREAD'] : []).concat(i === 2 ? ['STARRED'] : []).concat(mine ? ['SENT'] : []),
        snippet: mine ? 'Sounds good, thanks for the update.' : 'Hi Lawrence, this is a test message number ' + i + ' so the list has something to show.',
        from: mine ? 'Lawrence Rank <' + email + '>' : name + ' <' + addr + '>', to: mine ? addr : email, subject: (j ? 'Re: ' : '') + subjects[k],
        html: mine ? '<p>Sounds good, thanks for the update.</p>' : '<div style="font-family:Arial"><p>Hi Lawrence,</p><p>This is a <b>test message</b> number ' + i + '. Here is a <a href="https://example.com">link</a> and a tracking image that should be blocked: <img src="https://example.com/pixel.gif" width="1" height="1"></p><table style="background:#f4f4f4;padding:8px"><tr><td>A table cell</td></tr></table><p>Thanks,<br>' + name + '</p></div>',
        attachments: i === 0 && j === 0 ? [{ filename: 'Job description.pdf', mimeType: 'application/pdf', size: 48213, attachmentId: 'att1', messageId: 'm0_0' }] : [],
      });
    }
    threads.push({ id: 't' + i, messages: msgs });
  }
  return { threads, drafts: [], historyId: 1000, labels: [
    { id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_1', name: 'Jobs', type: 'user', color: { backgroundColor: '#16a765' } },
    { id: 'Label_2', name: 'Bills', type: 'user' }, { id: 'Label_3', name: 'School/OCC', type: 'user' },
  ] };
}

function makeCal(email) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const at = (day, h, m = 0) => { const x = new Date(d0); x.setDate(x.getDate() + day); x.setHours(h, m); return x.toISOString(); };
  const date = (day) => { const x = new Date(d0); x.setDate(x.getDate() + day); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const me = { email, self: true, organizer: true, responseStatus: 'accepted' };
  let n = 0;
  const ev = (cal, o) => Object.assign({ id: 'e' + (++n), calId: cal, status: 'confirmed', organizer: { email, self: true }, htmlLink: 'https://calendar.google.com/x' }, o);
  return [
    ev(email, { summary: 'LGSTX interview', location: 'Teams call', start: { dateTime: at(1, 14) }, end: { dateTime: at(1, 15) }, hangoutLink: 'https://meet.google.com/abc-defg-hij', attendees: [me, { email: 'whitney@example.com', displayName: 'Whitney Heinrichs', responseStatus: 'accepted' }] }),
    ev(email, { summary: 'Oil change, Jeep', start: { dateTime: at(0, 10, 30) }, end: { dateTime: at(0, 11, 30) } }),
    ev(email, { summary: 'Overlap A', start: { dateTime: at(0, 13) }, end: { dateTime: at(0, 14, 30) } }),
    ev(email, { summary: 'Overlap B', start: { dateTime: at(0, 13, 30) }, end: { dateTime: at(0, 15) } }),
    ev(email, { summary: 'Dinner with Liz', start: { dateTime: at(2, 18) }, end: { dateTime: at(2, 20) }, organizer: { email: 'liz@example.com' }, attendees: [{ email, self: true, responseStatus: 'needsAction' }, { email: 'liz@example.com', displayName: 'Elizabeth', organizer: true, responseStatus: 'accepted' }] }),
    ev(email, { summary: 'Rent due', start: { date: date(3) }, end: { date: date(4) } }),
    ev(email, { summary: 'Gym', start: { dateTime: at(-1, 7) }, end: { dateTime: at(-1, 8) }, recurringEventId: 'gymseries', originalStartTime: { dateTime: at(-1, 7) } }),
    ev(email, { summary: 'Gym', start: { dateTime: at(6, 7) }, end: { dateTime: at(6, 8) }, recurringEventId: 'gymseries', originalStartTime: { dateTime: at(6, 7) } }),
    ev('en.usa#holiday@group.v.calendar.google.com', { summary: 'Holiday', start: { date: date(5) }, end: { date: date(6) }, organizer: { email: 'en.usa#holiday@group.v.calendar.google.com', displayName: 'Holidays' } }),
    ev(email, { id: 'gymseries', summary: 'Gym', start: { dateTime: at(-8, 7) }, end: { dateTime: at(-8, 8) }, recurrence: ['RRULE:FREQ=WEEKLY'], master: true }),
  ];
}

class MockAccount {
  constructor(meta) { this.meta = meta; this.s = makeStore(meta.email || 'you@example.com'); this.cal = makeCal(meta.email || 'you@example.com'); this.calLog = []; }
  hasCalendar() { return !process.env.MOCK_NOCAL || this.calConnected; }
  canColorCalendars() { return !process.env.MOCK_NOCOLOR || this.colorConnected; }
  async calListPatch(calId, body) { this.calLog.push(['listpatch', calId, body]); (this.calColors = this.calColors || {})[calId] = body.backgroundColor; return body; }
  async calCalendars() {
    if (!this.hasCalendar()) { const e = new Error('no scope'); e.code = 'calendar_scope'; throw e; }
    return [{ id: this.meta.email, summary: this.meta.email, primary: true, accessRole: 'owner', backgroundColor: '#4285f4' },
      { id: 'family@group.calendar.google.com', summary: 'Family', accessRole: 'writer', backgroundColor: '#33b679' },
      { id: 'en.usa#holiday@group.v.calendar.google.com', summary: 'Holidays in United States', accessRole: 'reader', backgroundColor: '#0b8043' }]
      .map((c) => Object.assign(c, (this.calColors || {})[c.id] ? { backgroundColor: this.calColors[c.id] } : {}));
  }
  async calEvents(calId, timeMin, timeMax) {
    await this.delay();
    const a = Date.parse(timeMin), b = Date.parse(timeMax);
    const t = (x) => Date.parse(x.dateTime || (x.date + 'T00:00:00'));
    return this.cal.filter((e) => e.calId === calId && !e.master && t(e.end) > a && t(e.start) < b).map((e) => JSON.parse(JSON.stringify(e)));
  }
  async calGet(calId, id) { const e = this.cal.find((x) => x.id === id && x.calId === calId); if (!e) { const er = new Error('Not Found'); er.status = 404; throw er; } return JSON.parse(JSON.stringify(e)); }
  async calInsert(calId, body, opts) { this.calLog.push(['insert', calId, body, opts]); const e = Object.assign({ id: 'new' + Date.now(), calId, status: 'confirmed', organizer: { email: this.meta.email, self: true } }, body); if (opts && opts.conference) e.hangoutLink = 'https://meet.google.com/new-meet-xyz'; this.cal.push(e); return e; }
  async calPatch(calId, id, body, opts) { this.calLog.push(['patch', calId, id, body, opts]); const e = this.cal.find((x) => x.id === id && x.calId === calId); if (!e) throw new Error('Not Found'); Object.assign(e, body); return e; }
  async calDelete(calId, id, su) { this.calLog.push(['delete', calId, id, su]); this.cal = this.cal.filter((x) => !(x.id === id || x.recurringEventId === id)); }
  async calMove(calId, id, dest) { this.calLog.push(['move', calId, id, dest]); const e = this.cal.find((x) => x.id === id); if (e) e.calId = dest; return e; }
  async delay() { await new Promise((r) => setTimeout(r, 120)); }
  async profile() { return { emailAddress: this.meta.email, historyId: String(this.s.historyId) }; }
  async labels() { return this.s.labels; }
  async label(id) {
    const unread = this.s.threads.filter((t) => t.messages.some((m) => m.labelIds.includes(id) && m.labelIds.includes('UNREAD'))).length;
    return { id, threadsUnread: unread };
  }
  match(t, labelIds, q) {
    const labels = new Set(t.messages.flatMap((m) => m.labelIds));
    if (!labels.has('TRASH') && !labels.has('SPAM')) { /* ok */ } else if (!(labelIds || []).some((l) => l === 'TRASH' || l === 'SPAM') && !/in:(trash|spam)/.test(q || '')) return false;
    if ((labelIds || []).some((l) => !labels.has(l))) return false;
    q = (q || '').toLowerCase();
    for (const tok of q.split(/\s+/).filter(Boolean)) {
      if (tok === 'is:unread' && !labels.has('UNREAD')) return false;
      if (tok === 'is:starred' && !labels.has('STARRED')) return false;
      if (tok === 'in:inbox' && !labels.has('INBOX')) return false;
      if (tok === 'in:sent' && !labels.has('SENT')) return false;
      if (tok === 'in:trash' && !labels.has('TRASH')) return false;
      if (tok === 'in:spam' && !labels.has('SPAM')) return false;
      if (tok.startsWith('category:')) { const c = { primary: 'CATEGORY_PERSONAL', promotions: 'CATEGORY_PROMOTIONS', social: 'CATEGORY_SOCIAL', updates: 'CATEGORY_UPDATES' }[tok.slice(9)]; if (c && !labels.has(c)) return false; continue; }
      if (tok.includes(':')) continue;
      if (!JSON.stringify(t.messages).toLowerCase().includes(tok)) return false;
    }
    return true;
  }
  toApi(t) {
    return { id: t.id, messages: t.messages.map((m) => ({ id: m.id, threadId: t.id, labelIds: m.labelIds, snippet: m.snippet, internalDate: m.internalDate, payload: { mimeType: m.attachments.length ? 'multipart/mixed' : 'text/html', headers: [{ name: 'From', value: m.from }, { name: 'To', value: m.to }, { name: 'Subject', value: m.subject }] } })) };
  }
  async listThreads({ q, labelIds, pageToken, max = 30 }) {
    await this.delay();
    const { summarize } = require('./gmail');
    const all = this.s.threads.filter((t) => this.match(t, labelIds, q));
    const start = Number(pageToken || 0);
    const page = all.slice(start, start + max);
    return { threads: page.map((t) => summarize(this.toApi(t), this.meta.email)), nextPageToken: start + max < all.length ? String(start + max) : null, estimate: all.length };
  }
  async getThread(id) {
    await this.delay();
    const t = this.s.threads.find((x) => x.id === id);
    if (!t) throw new Error('Not found');
    const dm = this.s.drafts.filter((d) => d.threadId === id).map((d) => { const txt = mime.fromB64url(d.raw).toString('utf8'); return { id: 'dm-' + d.id, labelIds: ['DRAFT'], snippet: 'Draft body', internalDate: Date.now(), from: this.meta.email, to: (/^To: (.*)$/m.exec(txt) || [])[1] || '', subject: (/^Subject: (.*)$/m.exec(txt) || [])[1] || '', html: '<p>Draft body</p>', attachments: [] }; });
    const messages = t.messages.concat(dm).map((m) => ({ id: m.id, threadId: id, labelIds: m.labelIds, snippet: m.snippet, internalDate: Number(m.internalDate), from: m.from, to: m.to, cc: '', replyTo: '', subject: m.subject, date: new Date(Number(m.internalDate)).toUTCString(), messageIdHeader: '<' + m.id + '@mock>', references: '', listUnsubscribe: '', html: m.html, text: mime.htmlToText(m.html), attachments: m.attachments, listUnsubscribe: /store@|news@|alerts@/.test(m.from || '') ? '<https://example.com/unsub?u=1>' : '' }));
    const labels = new Set(messages.flatMap((m) => m.labelIds));
    return { id, messages, unread: labels.has('UNREAD'), starred: labels.has('STARRED'), inbox: labels.has('INBOX'), spam: labels.has('SPAM'), trash: labels.has('TRASH'), important: false, labelIds: [...labels] };
  }
  async attachment() { return Buffer.from('%PDF-1.4\n% mock file\n'); }
  async modifyThread(id, add = [], remove = []) {
    const t = this.s.threads.find((x) => x.id === id);
    if (t) t.messages.forEach((m) => { m.labelIds = m.labelIds.filter((l) => !remove.includes(l)); add.forEach((l) => { if (!m.labelIds.includes(l)) m.labelIds.push(l); }); });
    return {};
  }
  trashThread(id) { return this.modifyThread(id, ['TRASH'], ['INBOX']); }
  untrashThread(id) { return this.modifyThread(id, ['INBOX'], ['TRASH']); }
  async deleteThreadForever(id) { this.s.threads = this.s.threads.filter((t) => t.id !== id); }
  async createLabel(name) { const l = { id: 'Label_' + Date.now(), name, type: 'user' }; this.s.labels.push(l); return l; }
  async sendAs() { return [{ sendAsEmail: this.meta.email, displayName: 'Lawrence Rank', isDefault: true, isPrimary: true, signature: '<div>Lawrence Rank<br>(555) 010-0000</div><img src="x" onerror="window.__pwned=1">' }]; }
  async sendRaw(raw, threadId) {
    const txt = mime.fromB64url(raw).toString('utf8');
    this.lastSent = txt;
    const id = 'sent' + Date.now();
    const subject = (/^Subject: (.*)$/m.exec(txt) || [])[1] || '';
    const to = (/^To: (.*)$/m.exec(txt) || [])[1] || '';
    const msg = { id, threadId: threadId || id, internalDate: String(Date.now()), labelIds: ['SENT'], snippet: 'Sent from Gmail Desk', from: 'Lawrence Rank <' + this.meta.email + '>', to, subject, html: '<p>(sent message)</p>', attachments: [] };
    const t = threadId && this.s.threads.find((x) => x.id === threadId);
    if (t) t.messages.push(msg); else this.s.threads.unshift({ id: msg.threadId, messages: [msg] });
    return { id, threadId: msg.threadId };
  }
  async createDraft(raw, threadId) { const d = { id: 'd' + Date.now(), raw, threadId }; this.s.drafts.push(d); return { id: d.id }; }
  async updateDraft(id, raw, threadId) { const d = this.s.drafts.find((x) => x.id === id); if (d) { d.raw = raw; d.threadId = threadId; } return { id }; }
  async draftIdsForThread(threadId) { return Object.fromEntries(this.s.drafts.filter((d) => d.threadId === threadId).map((d) => ['dm-' + d.id, d.id])); }
  async deleteDraft(id) { this.s.drafts = this.s.drafts.filter((d) => d.id !== id); }
  async listDrafts() {
    return { threads: this.s.drafts.map((d) => { const txt = mime.fromB64url(d.raw).toString('utf8'); return { id: d.threadId || d.id, draftId: d.id, from: 'Draft', to: (/^To: (.*)$/m.exec(txt) || [])[1] || '', subject: (/^Subject: (.*)$/m.exec(txt) || [])[1] || '(no subject)', snippet: '', date: Date.now(), unread: false, starred: false, count: 1, isDraft: true, participants: 'Draft' }; }), nextPageToken: null };
  }
  async getDraft(id) { const d = this.s.drafts.find((x) => x.id === id); const txt = mime.fromB64url(d.raw).toString('utf8'); return { draftId: id, threadId: d.threadId, to: (/^To: (.*)$/m.exec(txt) || [])[1] || '', cc: '', bcc: '', subject: (/^Subject: (.*)$/m.exec(txt) || [])[1] || '', html: '<p>Draft body</p>', from: this.meta.email, inReplyTo: (/^In-Reply-To: (.*)$/mi.exec(txt) || [])[1] || '' }; }
  async history() {
    const inc = this.incoming || []; this.incoming = [];
    if (inc.length) this.s.historyId += 1;
    return { historyId: String(this.s.historyId), history: inc.length ? [{ messagesAdded: inc.map((x) => ({ message: { id: x.id, threadId: x.id, labelIds: x.labelIds } })) }] : [] };
  }
  /** Test mode: pretend new mail arrived. */
  inject(list) { this.incoming = (this.incoming || []).concat(list); this.injected = Object.assign(this.injected || {}, Object.fromEntries(list.map((x) => [x.id, x]))); }
  allMsgs() { return this.s.threads.flatMap((t) => t.messages); }
  async messageIds(query, labelIds, limit = 500) {
    await this.delay();
    const q = String(query || '').toLowerCase();
    const from = (/from:"?([^"\s]+)"?/.exec(q) || [])[1];
    return this.allMsgs().filter((m) => {
      const l = m.labelIds;
      if ((l.includes('TRASH') || l.includes('SPAM')) && !(labelIds || []).some((x) => x === 'TRASH' || x === 'SPAM')) return false;
      if ((labelIds || []).some((x) => !l.includes(x))) return false;
      if (from && !m.from.toLowerCase().includes(from)) return false;
      if (/is:unread/.test(q) && !l.includes('UNREAD')) return false;
      if (/in:sent/.test(q) && !l.includes('SENT')) return false;
      return true;
    }).slice(0, limit).map((m) => m.id);
  }
  async messageHeaders(id) {
    const m = this.allMsgs().find((x) => x.id === id);
    if (!m) throw new Error('Not found');
    const hd = [{ name: 'From', value: m.from }, { name: 'To', value: m.to }, { name: 'Subject', value: m.subject }];
    if (/store@/.test(m.from)) hd.push({ name: 'List-Unsubscribe', value: '<https://example.com/unsub?u=1>, <mailto:unsub@example.com?subject=stop>' }, { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' });
    if (/news@/.test(m.from)) hd.push({ name: 'List-Unsubscribe', value: '<mailto:leave@example.com?subject=unsubscribe>' });
    if (/alerts@/.test(m.from)) hd.push({ name: 'List-Unsubscribe', value: '<https://example.com/prefs>' });
    return { id, labelIds: m.labelIds.slice(), internalDate: m.internalDate, payload: { headers: hd } };
  }
  async batchModify(ids, add = [], remove = []) {
    this.batchCalls = (this.batchCalls || 0) + 1;
    const set = new Set(ids);
    for (const m of this.allMsgs()) if (set.has(m.id)) { m.labelIds = m.labelIds.filter((l) => !remove.includes(l)); add.forEach((l) => { if (!m.labelIds.includes(l)) m.labelIds.push(l); }); }
  }
  async trashMessage(id) { return this.batchModify([id], ['TRASH'], ['INBOX']); }
  canFilter() { return !process.env.MOCK_NOFILTER || !!global.__filterOK; }
  async createFilter(criteria, action) { const f = { id: 'f' + Date.now(), criteria, action }; (this.filterList = this.filterList || []).push(f); return f; }
  async filters() { return this.filterList || []; }
  async rawMessage(id) { const m = this.allMsgs().find((x) => x.id === id); if (!m) throw new Error('Not found'); return Buffer.from('Delivered-To: ' + this.meta.email + '\r\nAuthentication-Results: mx.google.com; spf=pass smtp.mailfrom=example.com; dkim=pass header.i=@example.com; dmarc=pass\r\nMessage-ID: <' + m.id + '@mock>\r\nDate: ' + new Date(Number(m.internalDate)).toUTCString() + '\r\nFrom: ' + m.from + '\r\nTo: ' + m.to + '\r\nSubject: ' + m.subject + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n' + m.html); }
  async messageMeta(id) {
    const x = (this.injected || {})[id];
    if (x) return { id, labelIds: x.labelIds, snippet: x.snippet, payload: { headers: [{ name: 'From', value: x.from }, { name: 'Subject', value: x.subject }] } };
    return { id, labelIds: ['INBOX', 'UNREAD'], payload: { headers: [] } };
  }
}

module.exports = { MockAccount };
