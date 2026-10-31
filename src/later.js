'use strict';
// Schedule send and snooze. Gmail's API has neither, so Beacon keeps the list in
// settings.json and a timer here does the work while the app runs (in the tray counts).
// Anything that came due while the computer was off happens at the next start.
//
// Schedule send: the email is saved as a Gmail draft; at the time, the draft is sent.
// Snooze: the conversation leaves the Inbox and gets a "Snoozed" label; at the time it
// comes back to the Inbox, unread, and is pinned to the top until you open it.

const store = require('./store');
const { log } = require('./log');

const TICK_MS = 30 * 1000;
const LATE_MS = 10 * 60 * 1000; // more than this after the time counts as "late"
const PIN_MS = 3 * 86400 * 1000; // how long a returned snooze stays pinned if never opened
const LABEL_NAMES = ['Snoozed', 'Snoozed (Gmail Desk)'];

let deps = null; // { accountObj, notify, send, sendState, accountIds }
let ticking = false;

const s = () => {
  const d = store.get();
  if (!Array.isArray(d.scheduled)) d.scheduled = [];
  if (!Array.isArray(d.snoozed)) d.snoozed = [];
  if (!d.backFromSnooze || typeof d.backFromSnooze !== 'object') d.backFromSnooze = {};
  if (!d.snoozeLabel || typeof d.snoozeLabel !== 'object') d.snoozeLabel = {};
  return d;
};
const changed = () => { store.save(); if (deps) deps.sendState(); };
const notFound = (e) => e && (e.status === 404 || /not found|Requested entity was not found|Invalid label/i.test(e.message || ''));
const when = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------------------------------------------------------------- schedule send
function scheduleDraft(acct, draftId, sendAt, info) {
  const d = s();
  d.scheduled = d.scheduled.filter((x) => !(x.acct === acct && x.draftId === draftId));
  d.scheduled.push({ acct, draftId, sendAt, threadId: info.threadId || null, to: info.to || '', subject: info.subject || '', tries: 0, nextTry: 0, error: '', failed: false });
  log('scheduled', acct, 'at', new Date(sendAt).toISOString());
  changed();
}
/** The draft was sent now, discarded or edited into a normal draft: forget its schedule. */
function dropDraft(acct, draftId) {
  const d = s(); const before = d.scheduled.length;
  d.scheduled = d.scheduled.filter((x) => !(x.acct === acct && x.draftId === draftId));
  if (d.scheduled.length !== before) changed();
}
const scheduleFor = (acct, draftId) => s().scheduled.find((x) => x.acct === acct && x.draftId === draftId) || null;

/** Rows for the Scheduled folder, soonest first. */
function scheduledRows(acct) {
  return s().scheduled.filter((x) => x.acct === acct).sort((a, b) => a.sendAt - b.sendAt).map((x) => ({
    id: 'sched-' + x.draftId, draftId: x.draftId, isDraft: true, scheduledAt: x.sendAt, failed: x.failed, error: x.error,
    to: x.to, subject: x.subject || '(no subject)', snippet: x.failed ? 'Not sent: ' + x.error : 'Sends ' + when(x.sendAt),
    date: x.sendAt, unread: false, starred: false, count: 1, labelIds: [], participants: x.to,
  }));
}

async function sendDue(x, now) {
  if (x.failed || now < x.sendAt || now < (x.nextTry || 0)) return;
  let a; try { a = deps.accountObj(x.acct); } catch (_) { return; }
  try {
    const r = await a.sendDraft(x.draftId);
    s().scheduled = s().scheduled.filter((y) => y !== x);
    log('scheduled sent', x.acct, now - x.sendAt > LATE_MS ? 'late' : 'on time');
    deps.send('send-status', { status: 'sent', accountId: x.acct, threadId: r.threadId, scheduled: true });
    if (now - x.sendAt > LATE_MS) deps.notify('Scheduled email sent late', '"' + (x.subject || '(no subject)') + '" was due ' + when(x.sendAt) + ' while Beacon was closed. It has been sent now.');
    changed();
  } catch (e) {
    if (e.code === 'needs_auth') return; // wait for the user to sign in again
    if (notFound(e)) {
      s().scheduled = s().scheduled.filter((y) => y !== x);
      deps.notify('Scheduled email not sent', '"' + (x.subject || '(no subject)') + '" was deleted from Drafts before its time.');
      log('scheduled draft gone', x.acct);
      changed();
      return;
    }
    x.tries = (x.tries || 0) + 1; x.error = e.message || String(e);
    x.nextTry = now + Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** (x.tries - 1));
    log('scheduled send failed', x.acct, 'try', x.tries, x.error.slice(0, 200));
    if (x.tries >= 6) {
      x.failed = true;
      deps.notify('Scheduled email not sent', '"' + (x.subject || '(no subject)') + '": ' + x.error + ' It is in Scheduled; open it to send it yourself.');
    }
    changed();
  }
}

// ---------------------------------------------------------------- snooze
async function snoozeLabel(a) {
  const acct = a.meta.id; const d = s();
  if (d.snoozeLabel[acct]) return d.snoozeLabel[acct];
  const labels = await a.labels();
  let l = labels.find((x) => x.type === 'user' && LABEL_NAMES.includes(x.name));
  for (const name of LABEL_NAMES) {
    if (l) break;
    try { l = await a.createLabel(name); } catch (e) { log('snooze label', name, String(e.message).slice(0, 120)); }
  }
  if (!l) throw new Error('Could not make the Snoozed label in Gmail.');
  d.snoozeLabel[acct] = l.id; store.save();
  return l.id;
}

async function snooze(a, threadId, until) {
  until = Number(until);
  if (!(until > Date.now())) throw new Error('Pick a time in the future.');
  const acct = a.meta.id;
  let label = await snoozeLabel(a);
  try { await a.modifyThread(threadId, [label], ['INBOX']); }
  catch (e) {
    if (!/label/i.test(e.message || '')) throw e;
    delete s().snoozeLabel[acct]; label = await snoozeLabel(a); // the label was deleted in Gmail: make it again
    await a.modifyThread(threadId, [label], ['INBOX']);
  }
  const d = s();
  d.snoozed = d.snoozed.filter((x) => !(x.acct === acct && x.threadId === threadId));
  d.snoozed.push({ acct, threadId, until });
  if (d.backFromSnooze[acct]) delete d.backFromSnooze[acct][threadId];
  changed();
}

async function unsnooze(a, threadId) {
  const acct = a.meta.id; const d = s();
  const label = d.snoozeLabel[acct];
  await a.modifyThread(threadId, ['INBOX'], label ? [label] : []);
  d.snoozed = d.snoozed.filter((x) => !(x.acct === acct && x.threadId === threadId));
  changed();
}

async function wake(x, now) {
  if (now < x.until || now < (x.nextTry || 0)) return;
  let a; try { a = deps.accountObj(x.acct); } catch (_) { return; }
  const d = s(); const label = d.snoozeLabel[x.acct];
  try {
    await a.modifyThread(x.threadId, ['INBOX', 'UNREAD'], label ? [label] : []);
    d.snoozed = d.snoozed.filter((y) => y !== x);
    (d.backFromSnooze[x.acct] = d.backFromSnooze[x.acct] || {})[x.threadId] = now;
    let subject = '';
    try { subject = (await a.threadSummary(x.threadId)).subject; } catch (_) {}
    deps.notify('Back from snooze', (subject || 'A conversation') + (now - x.until > LATE_MS ? ' (was due ' + when(x.until) + ')' : ''));
    deps.send('mail-changed', x.acct);
    log('snooze returned', x.acct);
    changed();
  } catch (e) {
    if (e.code === 'needs_auth') return;
    if (notFound(e) && !/label/i.test(e.message || '')) { d.snoozed = d.snoozed.filter((y) => y !== x); log('snoozed thread gone', x.acct); changed(); return; }
    if (/label/i.test(e.message || '')) { delete d.snoozeLabel[x.acct]; store.save(); }
    x.nextTry = now + 2 * 60 * 1000;
    log('snooze return failed', x.acct, String(e.message).slice(0, 200));
  }
}

/** Puts conversations that just came back from snooze at the top of an Inbox list. */
async function pinReturned(acct, a, result) {
  const back = s().backFromSnooze[acct];
  if (!back) return result;
  const now = Date.now();
  const ids = Object.keys(back).filter((t) => now - back[t] < PIN_MS);
  if (!ids.length) return result;
  const have = new Map(result.threads.map((t) => [t.id, t]));
  const pinned = [];
  for (const id of ids.sort((x, y) => back[y] - back[x])) {
    let row = have.get(id);
    if (!row) { try { row = await a.threadSummary(id); } catch (_) { continue; } }
    if (!(row.labelIds || []).includes('INBOX')) { delete back[id]; continue; } // archived or moved since
    pinned.push(Object.assign({}, row, { backFromSnooze: back[id] }));
  }
  const pinIds = new Set(pinned.map((t) => t.id));
  result.threads = pinned.concat(result.threads.filter((t) => !pinIds.has(t.id)));
  return result;
}
/** Opened, archived or otherwise dealt with: stop pinning it. */
function seen(acct, threadIds) {
  const back = s().backFromSnooze[acct]; if (!back) return;
  let n = 0; for (const t of threadIds) if (back[t]) { delete back[t]; n++; }
  if (n) store.save();
}

/** Rows for the Snoozed folder, soonest return first. */
async function snoozedRows(acct, a) {
  const list = s().snoozed.filter((x) => x.acct === acct).sort((p, q) => p.until - q.until);
  const rows = [];
  for (const x of list) {
    try { rows.push(Object.assign(await a.threadSummary(x.threadId), { snoozedUntil: x.until })); }
    catch (e) { if (notFound(e)) { s().snoozed = s().snoozed.filter((y) => y !== x); store.save(); } }
  }
  return { threads: rows, nextPageToken: null };
}

// ---------------------------------------------------------------- timer and state
async function tick() {
  if (ticking || !deps) return;
  ticking = true;
  try {
    const now = Date.now(); const d = s(); const ids = new Set(deps.accountIds());
    // Accounts that were removed take their schedules with them.
    const keep = (x) => ids.has(x.acct);
    if (d.scheduled.some((x) => !keep(x)) || d.snoozed.some((x) => !keep(x))) { d.scheduled = d.scheduled.filter(keep); d.snoozed = d.snoozed.filter(keep); changed(); }
    for (const x of d.scheduled.slice()) await sendDue(x, now);
    for (const x of d.snoozed.slice()) await wake(x, now);
  } catch (e) { log('later tick failed', String(e.message).slice(0, 200)); }
  finally { ticking = false; }
}

function publicInfo() {
  const d = s(); const out = { snoozed: {}, scheduled: {}, snoozeLabel: Object.assign({}, d.snoozeLabel), back: {} };
  for (const x of d.snoozed) (out.snoozed[x.acct] = out.snoozed[x.acct] || {})[x.threadId] = x.until;
  for (const x of d.scheduled) out.scheduled[x.acct] = (out.scheduled[x.acct] || 0) + 1;
  for (const [acct, m] of Object.entries(d.backFromSnooze)) out.back[acct] = Object.keys(m);
  return out;
}

function start(d) {
  deps = d;
  setTimeout(tick, 5000);
  setInterval(tick, TICK_MS);
}

module.exports = { start, tick, scheduleDraft, dropDraft, scheduleFor, scheduledRows, snooze, unsnooze, pinReturned, seen, snoozedRows, publicInfo };
