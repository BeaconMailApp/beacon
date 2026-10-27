'use strict';
// Address book for To/Cc suggestions, learned from mail you sent (strongest) and mail you read.
// Stored per account in the app's data folder. Nothing leaves your computer.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { log } = require('./log');

const books = new Map(); // accountId -> {updated, people: {email: {name, score, last}}}
const building = new Map();
const lastTry = new Map(); // don't retry a failed build more than once an hour
const file = (id) => path.join(app.getPath('userData'), 'contacts', id + '.json');
const SKIP = /(no-?reply|do-?not-?reply|donotreply|notifications?@|notify@|mailer-daemon|bounce|postmaster|alerts?@|newsletter|marketing@|news@|updates?@|info@|hello@|support@|billing@|receipts?@|members\.ebay\.com)/i;

function load(id) {
  if (books.has(id)) return books.get(id);
  let b = { updated: 0, people: {} };
  try { b = JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch (_) {}
  if (b.v !== 2) { b.v = 2; b.updated = 0; b.seen = []; } // 2.4: count mail you sent separately; rebuild once
  books.set(id, b);
  return b;
}
let saveTimers = {};
function save(id) {
  clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(file(id)), { recursive: true }); fs.writeFileSync(file(id), JSON.stringify(books.get(id))); } catch (_) {}
  }, 1500);
}

function parseList(s) {
  const out = []; let cur = ''; let q = false;
  for (const ch of String(s || '')) { if (ch === '"') q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur);
  return out.map((a) => {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(a);
    const email = (m ? m[2] : a).trim().toLowerCase();
    const name = m ? m[1].trim() : '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email, name } : null;
  }).filter(Boolean);
}

function add(id, header, weight, when, me) {
  const b = load(id);
  for (const p of parseList(header)) {
    if (me && p.email === me.toLowerCase()) continue;
    if (weight < 3 && SKIP.test(p.email)) continue; // only learn automated senders if you wrote to them
    const cur = b.people[p.email] || { name: '', score: 0, last: 0 };
    cur.score += weight;
    if (weight >= 3) cur.sent = (cur.sent || 0) + 1;
    if (p.name && (!cur.name || weight >= 3)) cur.name = p.name;
    cur.last = Math.max(cur.last, when || 0);
    b.people[p.email] = cur;
  }
  save(id);
}

/** Learn from list rows already loaded (free: no extra Gmail calls). */
function learnFromRows(id, rows, me) {
  const b = load(id);
  const seen = new Set(b.seen || []);
  let changed = false;
  for (const r of rows || []) {
    if (!r || !r.from || seen.has(r.id)) continue; // count each conversation once, not on every refresh
    seen.add(r.id); changed = true;
    add(id, r.from, 1, r.date, me);
  }
  if (changed) { b.seen = [...seen].slice(-5000); save(id); }
}

/** How many times you've written to this address (0 if never). */
function score(id, email) { const p = load(id).people[String(email || '').toLowerCase()]; return p ? (p.sent || 0) : 0; }

/** Reads recent sent mail in the background, a few messages at a time. */
function build(id, account, me) {
  const b = load(id);
  if (building.has(id)) return building.get(id);
  if (Date.now() - (b.updated || 0) < 3 * 86400000 || Date.now() - (lastTry.get(id) || 0) < 3600000) return Promise.resolve();
  lastTry.set(id, Date.now());
  const job = (async () => {
    try {
      const ids = await account.messageIds('in:sent newer_than:2y', null, 250);
      for (const p of Object.values(b.people)) p.sent = 0; // recount from scratch so rebuilds don't double it
      for (let i = 0; i < ids.length; i += 2) {
        await Promise.all(ids.slice(i, i + 2).map(async (mid) => {
          try {
            const m = await account.messageHeaders(mid, ['To', 'Cc']);
            const hd = (m.payload && m.payload.headers) || [];
            const get = (n) => (hd.find((x) => x.name.toLowerCase() === n.toLowerCase()) || {}).value || '';
            add(id, get('To') + ',' + get('Cc'), 3, Number(m.internalDate || 0), me);
          } catch (_) {}
        }));
        await new Promise((r) => setTimeout(r, 250));
      }
      b.updated = Date.now(); save(id);
      log('contacts built', id, Object.keys(b.people).length);
    } catch (e) { log('contacts build failed', String(e && e.message)); }
    finally { building.delete(id); }
  })();
  building.set(id, job);
  return job;
}

function search(id, q, limit = 8) {
  const b = load(id);
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const now = Date.now();
  const res = [];
  for (const [email, p] of Object.entries(b.people)) {
    const name = (p.name || '').toLowerCase();
    const words = name.split(/\s+/).concat(email.split(/[@._-]/));
    let match = 0;
    if (email.startsWith(q) || name.startsWith(q)) match = 3;
    else if (words.some((w) => w && w.startsWith(q))) match = 2;
    else if (email.includes(q) || name.includes(q)) match = 1;
    if (!match) continue;
    const recency = p.last ? Math.max(0, 1 - (now - p.last) / (365 * 86400000)) : 0;
    res.push({ email, name: p.name || '', rank: match * 10 + Math.log2(1 + p.score) * 3 + recency * 4 });
  }
  return res.sort((a, b2) => b2.rank - a.rank).slice(0, limit).map(({ email, name }) => ({ email, name }));
}

function forget(id) { books.delete(id); try { fs.rmSync(file(id), { force: true }); } catch (_) {} }

module.exports = { build, search, learnFromRows, add, forget, score };
