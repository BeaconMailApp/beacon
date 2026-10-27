'use strict';
/* Snooze and schedule send: time choices, the date and time picker, and the menus. */

ICONS.clock = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
ICONS.schedSend = '<path d="m22 2-7 20-4-9-9-4Z"/><circle cx="18" cy="18" r="4.5" fill="var(--panel)"/><path d="M18 16v2l1.2 1"/>';

function fmtWhen(ms) {
  const d = new Date(ms); const now = new Date();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((day - today) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return 'today ' + time;
  if (diff === 1) return 'tomorrow ' + time;
  if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' }) + ' ' + time;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + time;
}
const fmtShort = (ms) => { const d = new Date(ms); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

/** A date daysAhead from today at hour:minute, local time. */
function at(daysAhead, hour, minute) { const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, minute || 0, 0, 0); return d.getTime(); }
function nextWeekday(target, hour) { const d = new Date(); let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7; return at(add, hour); }

function snoozeChoices() {
  const now = new Date(); const out = [];
  if (now.getHours() < 17) out.push({ label: 'Later today', when: at(0, 18) });
  out.push({ label: 'Tomorrow', when: at(1, 8) });
  if (now.getDay() >= 1 && now.getDay() <= 4) out.push({ label: 'This weekend', when: nextWeekday(6, 8) });
  out.push({ label: 'Next week', when: nextWeekday(1, 8) });
  return out;
}
function scheduleChoices() {
  const out = [{ label: 'Tomorrow morning', when: at(1, 8) }, { label: 'Tomorrow afternoon', when: at(1, 13) }];
  if (new Date().getDay() !== 0) out.push({ label: 'Monday morning', when: nextWeekday(1, 8) });
  return out;
}

/** Asks for a date and time. Resolves a timestamp, or null when cancelled. */
function pickDateTime(title, okLabel, startAt) {
  return new Promise((resolve) => {
    modal((box, close) => {
      const pad = (n) => String(n).padStart(2, '0');
      const local = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
      const inp = h('input', { type: 'datetime-local', value: local(startAt || at(1, 8)), min: local(Date.now() + 60000), style: 'width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;color-scheme:inherit' });
      const err = h('div', { class: 'c-err', style: 'margin-top:8px', hidden: true });
      const done = (v) => { close(); resolve(v); };
      const ok = () => {
        const ms = new Date(inp.value).getTime();
        if (!inp.value || isNaN(ms)) { err.textContent = 'Pick a date and a time.'; err.hidden = false; return; }
        if (ms < Date.now() + 60000) { err.textContent = 'Pick a time at least a minute from now.'; err.hidden = false; return; }
        done(ms);
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') done(null); });
      box.append(h('h2', { text: title }), h('div', { style: 'height:12px' }), inp, err,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', text: 'Cancel', onclick: () => done(null) }), h('button', { class: 'btn primary', text: okLabel, onclick: ok })));
    });
  });
}

function choiceItem(c, fn) {
  return { el: h('button', { role: 'menuitem', class: 'when-item', onclick: (e) => { e.stopPropagation(); closeMenus(); fn(c.when); } }, h('span', { text: c.label }), h('small', { text: fmtShort(c.when) })) };
}

function snoozeMenu(anchor, ids) {
  if (!ids.length) return;
  const go = (until) => act(ids, 'snooze', until);
  popMenu(anchor, [{ head: 'Snooze until…' }, ...snoozeChoices().map((c) => choiceItem(c, go)), '-',
    { label: 'Pick date & time', icon: 'clock', fn: async () => { const ms = await pickDateTime('Snooze until', 'Snooze'); if (ms) go(ms); } }]);
}

function scheduleMenu(anchor) {
  popMenu(anchor, [{ head: 'Schedule send' }, ...scheduleChoices().map((c) => choiceItem(c, doSchedule)), '-',
    { label: 'Pick date & time', icon: 'clock', fn: async () => { const ms = await pickDateTime('Schedule send', 'Schedule send', S.comp && S.comp.scheduledAt); if (ms) doSchedule(ms); } }]);
}

const snoozedUntil = (threadId) => (((S.st && S.st.later && S.st.later.snoozed) || {})[S.acct] || {})[threadId] || null;
const snoozeLabelId = () => (((S.st && S.st.later && S.st.later.snoozeLabel) || {})[S.acct]) || null;
