'use strict';
// "For You": decides which emails matter to you. Everything runs on this computer.
// It starts from sensible signals (people you write to, threads you replied in, Gmail's tabs)
// and learns from what you do: opening, starring, replying, deleting unread, and the
// Important / Not important buttons.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const contacts = require('./contacts');

const models = new Map();
const timers = {};
const file = (id) => path.join(app.getPath('userData'), 'priority', id + '.json');
const blank = () => ({ v: 1, senders: {}, domains: {}, threads: {}, words: { imp: {}, not: {} }, nImp: 0, nNot: 0 });

function load(id) {
  if (models.has(id)) return models.get(id);
  let m = blank();
  try { m = Object.assign(blank(), JSON.parse(fs.readFileSync(file(id), 'utf8'))); } catch (_) {}
  models.set(id, m);
  return m;
}
function save(id) {
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(file(id)), { recursive: true }); fs.writeFileSync(file(id), JSON.stringify(models.get(id))); } catch (_) {}
  }, 1500);
}
function forget(id) { models.delete(id); try { fs.rmSync(file(id), { force: true }); } catch (_) {} }

const emailOf = (f) => { const m = /<([^>]+)>/.exec(f || ''); return (m ? m[1] : String(f || '')).trim().toLowerCase(); };
const domainOf = (e) => (e.split('@')[1] || '');
const COMMON = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton|protonmail|zoho)\.(com|net|me)$/;
const AUTOMATED = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer|newsletters?|news|marketing|promo(tions)?|offers|deals|digest|updates?|info|hello|team|support|billing|receipts?|bounces?)([._+-]|@)/i;
const GOOD_WORDS = /\b(interview|offer letter|job offer|appointment|reschedul\w*|confirm(ed)? your (appointment|interview)|application (status|received|update)|court|hearing|claim|surplus|lease|landlord|past due|overdue|payment due|due (today|tomorrow)|action required|urgent|deadline|signature|sign (the|this)|contract|invoice|verification code|security alert|password reset)\b/i;
const SLOP_WORDS = /(\d+% off|\bsale\b|\bdeals?\b|webinar|newsletter|digest|limited time|free shipping|last chance|ends (tonight|today|soon)|recommended for you|jobs you may|new jobs|top picks|you('|’)re invited to shop|flash|exclusive offer|black friday|cyber monday|coupon|promo code|\bsave \$?\d+)/i;
const STOP = new Set('the a an and or of to in on for with at by from your you is are was be this that it we our us my me re fwd fw new now get just more all can will not have has'.split(' '));

function tokens(row) {
  const text = ((row.subject || '') + ' ' + (row.snippet || '')).toLowerCase();
  const out = new Set();
  for (const w of text.match(/[a-z][a-z0-9$%']{2,20}/g) || []) if (!STOP.has(w)) out.add(w);
  return [...out].slice(0, 40);
}

/** Scores one list row. Returns {score, important, why}. */
function score(id, row, me) {
  const m = load(id);
  const from = emailOf(row.from);
  const labels = new Set(row.labelIds || []);
  const reasons = [];
  let s = -0.3;
  const add = (v, why) => { s += v; if (why && Math.abs(v) >= 0.7) reasons.push([v, why]); };

  const forced = m.threads[row.id];
  if (forced !== undefined) return { score: forced ? 10 : -10, important: !!forced, why: forced ? 'You marked this important' : 'You marked this not important' };

  if (labels.has('CATEGORY_PERSONAL')) add(0.8, 'In your Primary tab');
  else if (labels.has('CATEGORY_PROMOTIONS')) add(-2.2, 'Promotion');
  else if (labels.has('CATEGORY_SOCIAL')) add(-1.5, 'Social network update');
  else if (labels.has('CATEGORY_FORUMS')) add(-1.2, 'Mailing list');
  else if (labels.has('CATEGORY_UPDATES')) add(-0.6, 'Automated update');
  if (labels.has('IMPORTANT')) add(0.6);
  if (labels.has('STARRED')) add(1.5, 'Starred');

  const participants = String(row.participants || '').split(/,\s*/);
  if (participants.includes('me') && row.count > 1) add(2.0, 'You replied in this conversation');
  const c = from ? contacts.score(id, from) : 0;
  if (c >= 3) add(1.8 + Math.min(1, Math.log2(1 + c) / 4), 'Someone you email');
  else if (c > 0) add(0.4);
  if (from && AUTOMATED.test(from)) add(-1.0, 'Sent by an automated address');
  if (me && from === String(me).toLowerCase()) add(-0.5);

  const subj = (row.subject || '') + ' ' + (row.snippet || '').slice(0, 160);
  if (GOOD_WORDS.test(subj)) add(1.1, 'Looks time sensitive');
  if (SLOP_WORDS.test(subj)) add(-0.9, 'Looks like marketing');

  const sd = m.senders[from];
  if (sd) {
    const explicit = Math.max(-5, Math.min(5, 2.5 * ((sd.pos || 0) - (sd.neg || 0))));
    if (explicit) add(explicit, explicit > 0 ? 'You marked this sender important' : 'You marked this sender not important');
    const implicit = Math.max(-2, Math.min(2, 0.35 * (sd.open || 0) + 0.9 * (sd.star || 0) - 0.5 * (sd.ignore || 0)));
    if (implicit) add(implicit, implicit > 0 ? 'You usually read their emails' : 'You usually delete their emails unread');
  }
  const dom = domainOf(from);
  const dd = dom && !COMMON.test(dom) ? m.domains[dom] : null;
  if (dd) add(Math.max(-2, Math.min(2, 0.8 * ((dd.pos || 0) - (dd.neg || 0)))));

  // Word learning from your Important / Not important clicks (naive Bayes, kicks in after a few).
  if (m.nImp + m.nNot >= 4) {
    let lo = 0;
    const ti = Object.values(m.words.imp).reduce((a, b) => a + b, 0) + 1;
    const tn = Object.values(m.words.not).reduce((a, b) => a + b, 0) + 1;
    for (const w of tokens(row)) {
      const a = (m.words.imp[w] || 0); const b = (m.words.not[w] || 0);
      if (a + b < 2) continue;
      lo += Math.log(((a + 1) / ti) / ((b + 1) / tn));
    }
    lo = Math.max(-1.5, Math.min(1.5, lo * 0.5));
    if (Math.abs(lo) >= 0.7) add(lo, lo > 0 ? 'Similar to emails you marked important' : 'Similar to emails you marked not important');
    else s += lo;
  }

  reasons.sort((a, b) => (s >= 0 ? b[0] - a[0] : a[0] - b[0]));
  const important = s >= 0;
  const why = (reasons.find((r) => (important ? r[0] > 0 : r[0] < 0)) || [0, important ? 'Looks personal' : 'Looks like bulk mail'])[1];
  return { score: Math.round(s * 100) / 100, important, why };
}

function scoreRows(id, rows, me) {
  for (const r of rows || []) if (r && !r.isDraft) r.priority = score(id, r, me);
  return rows;
}

/** Your explicit choice for some conversations. */
function teach(id, rows, important) {
  const m = load(id);
  const key = important ? 'pos' : 'neg';
  const other = important ? 'neg' : 'pos';
  const seen = new Set();
  for (const r of rows || []) {
    if (!r || !r.id) continue;
    m.threads[r.id] = !!important;
    const from = emailOf(r.from);
    if (from && !seen.has(from)) {
      seen.add(from);
      const sd = m.senders[from] || (m.senders[from] = {});
      // A change of mind cancels the old vote before adding the new one.
      if (sd[other]) sd[other]--; else sd[key] = (sd[key] || 0) + 1;
      const dom = domainOf(from);
      if (dom && !COMMON.test(dom)) { const dd = m.domains[dom] || (m.domains[dom] = {}); if (dd[other]) dd[other]--; else dd[key] = (dd[key] || 0) + 1; }
    }
    const bag = important ? m.words.imp : m.words.not;
    for (const w of tokens(r)) bag[w] = (bag[w] || 0) + 1;
    if (important) m.nImp++; else m.nNot++;
  }
  trim(m);
  save(id);
}

/** Things you do anyway: open, star, delete without reading. Small nudges, not votes. */
function learn(id, kind, rows) {
  const m = load(id);
  const field = { open: 'open', star: 'star', ignore: 'ignore' }[kind];
  if (!field) return;
  for (const r of rows || []) {
    const from = emailOf(r && r.from);
    if (!from) continue;
    const sd = m.senders[from] || (m.senders[from] = {});
    sd[field] = Math.min(20, (sd[field] || 0) + 1);
    if (field === 'open' && sd.ignore) sd.ignore = Math.max(0, sd.ignore - 0.5);
  }
  trim(m);
  save(id);
}

function trim(m) {
  const t = Object.keys(m.threads); if (t.length > 3000) for (const k of t.slice(0, t.length - 3000)) delete m.threads[k];
  for (const bag of [m.words.imp, m.words.not]) { const k = Object.keys(bag); if (k.length > 6000) { k.sort((a, b) => bag[a] - bag[b]); for (const w of k.slice(0, k.length - 6000)) delete bag[w]; } }
}

function reset(id) { models.set(id, blank()); save(id); }
function stats(id) { const m = load(id); return { taught: m.nImp + m.nNot, senders: Object.keys(m.senders).length }; }

module.exports = { score, scoreRows, teach, learn, forget, reset, stats };
