'use strict';
// Test mode (GMAIL_DESK_MOCK=1): fake accounts so the interface can be tried without Google.
// Not shipped in builds. Any method not listed here answers with an empty result.

const day = (n, h, m) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); if (h != null) d.setHours(h, m || 0); return d; };
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const timed = (title, n, h1, m1, h2, m2, location) => ({ id: title, title, start: day(n, h1, m1).toISOString(), end: day(n, h2, m2).toISOString(), allDay: false, location: location || '', link: 'https://calendar.google.com/' });
const allDay = (title, n, len) => ({ id: title, title, start: ymd(day(n)), end: ymd(day(n + (len || 1))), allDay: true, location: '', link: 'https://calendar.google.com/' });

const now = new Date();
const EVENTS = [
  timed('Morning check-in', 0, 8, 30, 9, 0),
  timed('Call with the probate attorney', 0, now.getHours(), 0, now.getHours() + 1, 0, 'Phone'),
  timed('Bank appointment', 0, 15, 0, 16, 0, '123 Main St'),
  allDay('Court filing deadline', 1),
  timed('Dentist', 2, 10, 0, 10, 45, 'Smile Dental'),
  allDay('Trip to Columbus', 3, 3),
  timed('Dinner with Michelle', 4, 18, 30, 20, 0, 'Olive Garden'),
];

const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: 't' + i, subject: 'Test conversation ' + (i + 1), from: 'Sender ' + i + ' <sender' + i + '@example.com>', to: 'me', participants: 'Sender ' + i, snippet: 'This is fake mail for test mode.', date: Date.now() - i * 3600e3, count: 1, unread: i < 2, starred: false, important: false, labelIds: ['INBOX'], hasAttachment: false }));

class MockAccount {
  constructor(meta) {
    this.meta = meta;
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? async () => ({}) : undefined) });
  }
  hasScope() { return this.meta.id !== 'mock2'; }
  hasCalendar() { return this.hasScope(); }
  async profile() { return { emailAddress: this.meta.email, historyId: '1' }; }
  // Labels, drafts and sending live in memory, so snooze and schedule send can be tried.
  get st() { if (!this._st) this._st = { labels: [], drafts: new Map(), sent: [], rows: new Map(ROWS.map((r) => [r.id, Object.assign({}, r, { labelIds: r.labelIds.slice() })])) }; return this._st; }
  async labels() { return this.st.labels.slice(); }
  async createLabel(name) { const l = { id: 'Label_' + (this.st.labels.length + 1), name, type: 'user' }; this.st.labels.push(l); return l; }
  async label() { return { threadsUnread: 2 }; }
  async modifyThread(id, add, remove) {
    const r = this.st.rows.get(id); if (!r) { const e = new Error('Requested entity was not found.'); e.status = 404; throw e; }
    r.labelIds = r.labelIds.filter((l) => !(remove || []).includes(l)).concat((add || []).filter((l) => !r.labelIds.includes(l)));
    r.unread = r.labelIds.includes('UNREAD'); return {};
  }
  async threadSummary(id) { const r = this.st.rows.get(id); if (!r) { const e = new Error('Requested entity was not found.'); e.status = 404; throw e; } return Object.assign({}, r, { labelIds: r.labelIds.slice() }); }
  async listThreads({ labelIds } = {}) {
    const rows = [...this.st.rows.values()].filter((r) => (labelIds || []).every((l) => l.startsWith('CATEGORY_') || r.labelIds.includes(l))).map((r) => Object.assign({}, r, { labelIds: r.labelIds.slice() }));
    return { threads: rows, nextPageToken: null, estimate: rows.length };
  }
  async createDraft(raw, threadId) { const id = 'draft' + (this.st.drafts.size + 1); this.st.drafts.set(id, { raw, threadId }); return { id }; }
  async updateDraft(id, raw, threadId) { this.st.drafts.set(id, { raw, threadId }); return { id }; }
  async deleteDraft(id) { this.st.drafts.delete(id); return {}; }
  async sendDraft(id) { if (!this.st.drafts.has(id)) { const e = new Error('Requested entity was not found.'); e.status = 404; throw e; } this.st.drafts.delete(id); this.st.sent.push({ id, at: Date.now() }); return { id: 'sent-' + id, threadId: 't-sent-' + id }; }
  async listDrafts() { return { threads: [...this.st.drafts.keys()].map((id) => ({ id: 'thr-' + id, draftId: id, isDraft: true, to: 'someone@example.com', subject: 'Draft ' + id, snippet: '', date: Date.now(), count: 1, labelIds: [] })), nextPageToken: null }; }
  async sendAs() { return []; }
  async getThread(id) {
    // A long conversation, so the reply box has to share the reading pane with tall messages.
    const para = '<p>' + 'This is a long fake message used in test mode to fill the reading pane. '.repeat(12) + '</p>';
    const messages = [0, 1, 2].map((i) => ({
      id: id + '-m' + i, threadId: id, labelIds: ['INBOX'], snippet: 'Fake message ' + (i + 1), internalDate: Date.now() - (3 - i) * 3600e3,
      from: i === 1 ? this.meta.email : 'Sender <sender@example.com>', to: i === 1 ? 'sender@example.com' : this.meta.email, cc: '', replyTo: '',
      subject: 'Test conversation', date: '', messageIdHeader: '<m' + i + '@example.com>', references: '', listUnsubscribe: '',
      html: para.repeat(4), text: '', attachments: [],
    }));
    return { id, messages, unread: false, starred: false, inbox: true, spam: false, trash: false, important: false, labelIds: ['INBOX'] };
  }
  async calendarEvents() {
    if (!this.hasScope()) { const e = new Error('Connect Google Calendar to see your events here.'); e.code = 'calendar_scope'; throw e; }
    return EVENTS;
  }
}

module.exports = { MockAccount };
