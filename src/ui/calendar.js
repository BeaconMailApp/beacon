'use strict';
/* Google Calendar: day, week and month views with an event editor. */

const HOUR_PX = 48;
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return undefined; } })();
S.cal = { acct: null, view: null, anchor: new Date(), cals: [], events: [], state: 'idle', err: '', code: '', failed: [], seq: 0, scrolled: false };

// ------------------------------------------------------------ date helpers (all local time)
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const hm = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const evStart = (e) => (e.allDay ? parseDay(e.start) : new Date(e.start));
const evEnd = (e) => (e.allDay ? parseDay(e.end || e.start) : new Date(e.end || e.start));
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function calRange() {
  const c = S.cal; const a = dayStart(c.anchor);
  if (c.view === 'day') return { start: a, end: addDays(a, 1), days: 1 };
  if (c.view === 'week') { const s = addDays(a, -a.getDay()); return { start: s, end: addDays(s, 7), days: 7 }; }
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const s = addDays(first, -first.getDay());
  return { start: s, end: addDays(s, 42), days: 42 };
}
function calTitle() {
  const c = S.cal; const r = calRange();
  if (c.view === 'day') return c.anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (c.view === 'month') return c.anchor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const e = addDays(r.end, -1);
  if (r.start.getMonth() === e.getMonth()) return r.start.toLocaleDateString([], { month: 'long', year: 'numeric' });
  return r.start.toLocaleDateString([], { month: 'short' }) + ' to ' + e.toLocaleDateString([], { month: 'short', year: 'numeric' });
}

// ------------------------------------------------------------ data
function hiddenCals() {
  const h = (S.st.settings.calHidden || {})[S.acct];
  return new Set(h || S.cal.cals.filter((x) => x.defaultHidden).map((x) => x.id));
}
function openCalendar() { setView({ kind: 'calendar' }); }

async function calLoad(opts = {}) {
  const c = S.cal;
  const a = acctMeta();
  if (!a) return;
  if (c.acct !== S.acct) { c.acct = S.acct; c.cals = []; c.events = []; c.state = 'idle'; }
  if (!c.view) c.view = S.st.settings.calView || 'week';
  if (!a.calendar) { c.state = 'connect'; renderList(); return; }
  const seq = ++c.seq;
  if (!opts.silent) { c.state = 'loading'; renderList(); }
  try {
    if (!c.cals.length || opts.fresh) c.cals = await gd.calCalendars(S.acct, !!opts.fresh);
    const hidden = hiddenCals();
    const r = calRange();
    const res = await gd.calEvents(S.acct, r.start.toISOString(), r.end.toISOString(), c.cals.filter((x) => !hidden.has(x.id)).map((x) => x.id));
    if (seq !== c.seq || S.view.kind !== 'calendar') return;
    c.events = res.events; c.failed = res.failed; c.state = 'ok';
  } catch (e) {
    if (seq !== c.seq) return;
    c.state = (e.code === 'calendar_disabled' || e.code === 'calendar_scope') ? 'connect' : 'error';
    c.err = e.message; c.code = e.code || '';
  }
  if (S.view.kind === 'calendar') renderList();
}
function calGo(dir) {
  const c = S.cal;
  if (dir === 0) c.anchor = new Date();
  else if (c.view === 'day') c.anchor = addDays(c.anchor, dir);
  else if (c.view === 'week') c.anchor = addDays(c.anchor, 7 * dir);
  else c.anchor = new Date(c.anchor.getFullYear(), c.anchor.getMonth() + dir, 1);
  c.scrolled = false;
  calLoad();
}
function calSetView(v) { S.cal.view = v; S.cal.scrolled = false; gd.settings({ calView: v }).then((st) => { S.st = st; }).catch(() => {}); calLoad(); }

// ------------------------------------------------------------ rendering
function renderCalendar() {
  const c = S.cal;
  if (c.acct !== S.acct || c.state === 'idle') { calLoad(); return; }
  $('panes').classList.toggle('cleanup', !S.openId && !(S.comp && !S.comp.inline));
  const tabs = $('tabs');
  tabs.hidden = false;
  tabs.replaceChildren(...[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([k, t]) => h('button', { class: 'tab' + (c.view === k ? ' active' : ''), onclick: () => calSetView(k) }, t)));
  const calsBtn = h('button', { class: 'tb text', text: 'Calendars', title: 'Choose which calendars to show', onclick: () => calendarsMenu(calsBtn) });
  $('toolbar').replaceChildren(...[
    h('button', { class: 'btn', text: 'Today', onclick: () => calGo(0) }),
    tbBtn('back', 'Previous', () => calGo(-1)), h('span', { class: 'cal-next' }, tbBtn('back', 'Next', () => calGo(1))),
    h('span', { class: 'cal-title', text: calTitle() }),
    h('span', { class: 'grow' }),
    c.state === 'ok' && c.failed.length ? h('span', { class: 'tb-info', style: 'margin:0', text: 'Could not load: ' + c.failed.join(', ') }) : null,
    c.cals.length ? calsBtn : null,
    tbBtn('refresh', 'Refresh', () => calLoad({ fresh: true })),
    c.state === 'ok' ? a11yBtn('New event', () => openEventEditor(null, defaultNewTimes())) : null].filter(Boolean));
  const box = $('list');
  if (c.state === 'connect') { box.replaceChildren(calConnectCard()); return; }
  if (c.state === 'loading' && !c.events.length) { box.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'skel' }))); return; }
  if (c.state === 'error') {
    box.replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Could not load your calendar' }), c.err, h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', text: 'Try again', onclick: () => calLoad({ fresh: true }) }))));
    return;
  }
  const prevScroll = box.querySelector('.cal-body') ? box.querySelector('.cal-body').scrollTop : null;
  box.replaceChildren(c.view === 'month' ? monthView() : timeView());
  const body = box.querySelector('.cal-body');
  if (body) {
    const r = calRange(); const now = new Date();
    if (prevScroll !== null && c.scrolled) body.scrollTop = prevScroll;
    else { body.scrollTop = (now >= r.start && now < r.end ? Math.max(7, Math.min(now.getHours() - 1, 16)) : 7) * HOUR_PX; c.scrolled = true; }
  }
}
function a11yBtn(label, fn) { return h('button', { class: 'btn primary cal-new', onclick: fn }, icon('plus'), label); }

function calConnectCard() {
  const c = S.cal;
  const pid = S.st.projectId || '';
  const disabled = c.code === 'calendar_disabled';
  return h('div', { class: 'empty cal-connect' },
    h('b', { text: disabled ? 'Turn on the Google Calendar API' : 'Connect your Google Calendar' }),
    h('div', { text: disabled ? c.err : 'Two quick steps, once per account. Beacon only sees your calendar after you allow it.' }),
    h('ol', {},
      h('li', {}, h('span', { text: 'Turn on the Google Calendar API in your Google Cloud project (the same one Beacon uses). Click Enable on the page that opens, then come back.' }),
        h('div', {}, h('button', { class: 'btn', onclick: () => gd.external('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com' + (pid ? '?project=' + encodeURIComponent(pid) : '')) }, icon('external'), 'Open the Calendar API page'))),
      h('li', {}, h('span', { text: 'Sign in again and tick the calendar boxes on the Google screen.' }),
        h('div', {}, h('button', { class: 'btn primary', onclick: async (e) => {
          e.target.disabled = true;
          try { const ok = await gd.calConnect(S.acct); S.st = await gd.state(); if (!ok) toast('The calendar boxes were not ticked. Try again and tick them.', null, null, 8000); c.state = 'idle'; c.code = ''; calLoad({ fresh: true }); }
          catch (err) { toast(err.message, null, null, 8000); e.target.disabled = false; }
        } }, 'Connect calendar')))));
}

function calendarsMenu(anchor) {
  const hidden = hiddenCals();
  const items = [{ head: 'Show calendars' }];
  for (const cal of S.cal.cals) {
    const cb = h('input', { type: 'checkbox', checked: !hidden.has(cal.id) });
    let colors = null;
    const sw = h('button', { type: 'button', class: 'swatch sw-btn', style: 'background:' + cal.color, title: 'Change color', 'aria-label': 'Change the color of ' + cal.name,
      onclick: async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (colors) { colors.remove(); colors = null; return; }
        document.querySelectorAll('.menu .cal-colors').forEach((x) => x.remove());
        colors = await calendarColorRow(cal, sw);
        wrap.append(colors);
      } });
    const row = h('label', { class: 'cal-pick' }, cb, h('span', { text: cal.name + (cal.writable ? '' : ' (view only)') }));
    const wrap = h('div', { class: 'cal-pick-wrap' }, h('div', { class: 'cal-pick-row' }, sw, row));
    cb.addEventListener('change', async () => {
      if (cb.checked) hidden.delete(cal.id); else hidden.add(cal.id);
      const all = Object.assign({}, S.st.settings.calHidden || {}); all[S.acct] = [...hidden];
      try { S.st = await gd.settings({ calHidden: all }); } catch (_) {}
      calLoad({ silent: true });
    });
    items.push({ el: wrap });
  }
  items.push({ el: h('div', { class: 'cal-pick-hint', text: 'Click a color square to change that calendar\'s color. It changes in Google Calendar too.' }) });
  const m = popMenu(anchor, items);
  m.addEventListener('click', (e) => e.stopPropagation());
}

function eventsOnDay(day) {
  const s = dayStart(day); const e = addDays(s, 1);
  return S.cal.events.filter((ev) => evStart(ev) < e && (evEnd(ev) > s || (+evEnd(ev) === +evStart(ev) && evStart(ev) >= s)));
}

function eventChip(ev, opts = {}) {
  const st = evStart(ev);
  const declined = ev.myStatus === 'declined';
  const label = (ev.allDay || opts.noTime ? '' : fmtTime(st) + ' ') + (ev.title || '(no title)');
  return h('button', { class: 'cal-chip' + (ev.allDay ? ' allday' : '') + (declined ? ' declined' : '') + (ev.myStatus === 'needsAction' ? ' pending' : ''), title: label, style: ev.allDay ? 'background:' + ev.color + ';--tc:' + textOn(ev.color) : '--c:' + ev.color, onclick: (e) => { e.stopPropagation(); openEventEditor(ev); } },
    ev.allDay ? null : h('span', { class: 'dot' }), h('span', { class: 't', text: label }));
}

function timeView() {
  const r = calRange();
  const days = Array.from({ length: r.days }, (_, i) => addDays(r.start, i));
  const today = new Date();
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const head = h('div', { class: 'cal-head', style: 'grid-template-columns:' + cols }, h('div'),
    ...days.map((d) => h('button', { class: 'cal-dayhead' + (sameDay(d, today) ? ' today' : ''), onclick: () => { S.cal.anchor = d; calSetView('day'); } },
      h('span', { class: 'wd', text: WEEKDAYS[d.getDay()] }), h('span', { class: 'dn', text: String(d.getDate()) }))));
  const allday = h('div', { class: 'cal-allday', style: 'grid-template-columns:' + cols }, h('div', { class: 'lbl', text: 'All day' }),
    ...days.map((d) => h('div', { class: 'cell', ondblclick: () => openEventEditor(null, { allDay: true, start: d, end: d }) },
      ...eventsOnDay(d).filter((e) => e.allDay || (evEnd(e) - evStart(e) >= 86400000)).map((e) => eventChip(e, { noTime: true })))));
  const gutter = h('div', { class: 'cal-gutter' }, ...Array.from({ length: 24 }, (_, hr) => h('div', { class: 'hr', text: hr ? new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: 'numeric' }) : '' })));
  const columns = days.map((d) => {
    const col = h('div', { class: 'cal-col' + (sameDay(d, today) ? ' today' : '') });
    col.addEventListener('click', (e) => {
      if (e.target !== col) return;
      const mins = Math.max(0, Math.min(23.5 * 60, Math.round((e.offsetY / HOUR_PX) * 2) * 30));
      const s = new Date(d); s.setHours(0, mins, 0, 0);
      openEventEditor(null, { start: s, end: new Date(+s + 3600000) });
    });
    const timed = eventsOnDay(d).filter((e) => !e.allDay && (evEnd(e) - evStart(e) < 86400000));
    for (const p of layoutDay(timed, d)) {
      const e = p.ev; const st = evStart(e); const en = evEnd(e);
      const block = h('button', { class: 'cal-ev' + (e.myStatus === 'declined' ? ' declined' : '') + (e.myStatus === 'needsAction' ? ' pending' : '') + (p.height < 30 ? ' short' : ''),
        style: `top:${p.top}px;height:${Math.max(18, p.height - 2)}px;left:calc(${p.left * 100}% + 1px);width:calc(${p.width * 100}% - 3px);--c:${e.color};--tc:${textOn(e.color)}`,
        title: (e.title || '(no title)') + '\n' + fmtTime(st) + ' to ' + fmtTime(en) + (e.location ? '\n' + e.location : ''), onclick: (ev) => { ev.stopPropagation(); openEventEditor(e); } },
      h('span', { class: 't', text: e.title || '(no title)' }), h('span', { class: 'tm', text: fmtTime(st) + ' to ' + fmtTime(en) }), e.location && p.height > 56 ? h('span', { class: 'tm', text: e.location }) : null);
      col.append(block);
    }
    if (sameDay(d, today)) { const n = new Date(); col.append(h('div', { class: 'cal-now', style: 'top:' + ((n.getHours() * 60 + n.getMinutes()) * HOUR_PX / 60) + 'px' })); }
    return col;
  });
  const body = h('div', { class: 'cal-body' }, h('div', { class: 'cal-bodygrid', style: 'grid-template-columns:' + cols + ';height:' + (24 * HOUR_PX) + 'px' }, gutter, ...columns));
  return h('div', { class: 'cal-wrap' }, head, allday, body);
}

/** Positions timed events in one day so overlapping ones sit side by side. */
function layoutDay(evs, day) {
  const s0 = dayStart(day); const e0 = addDays(s0, 1);
  const items = evs.map((ev) => {
    const a = Math.max(+evStart(ev), +s0); const b = Math.min(Math.max(+evEnd(ev), a + 15 * 60000), +e0);
    return { ev, a, b };
  }).sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a));
  const out = []; let cluster = []; let clusterEnd = 0;
  const flush = () => {
    const colsEnd = [];
    for (const it of cluster) {
      let k = colsEnd.findIndex((end) => end <= it.a);
      if (k < 0) { k = colsEnd.length; colsEnd.push(0); }
      colsEnd[k] = it.b; it.col = k;
    }
    for (const it of cluster) out.push({ ev: it.ev, top: (it.a - s0) / 60000 * HOUR_PX / 60, height: (it.b - it.a) / 60000 * HOUR_PX / 60, left: it.col / colsEnd.length, width: 1 / colsEnd.length });
    cluster = [];
  };
  for (const it of items) { if (cluster.length && it.a >= clusterEnd) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.b); }
  if (cluster.length) flush();
  return out;
}

function monthView() {
  const r = calRange();
  const month = S.cal.anchor.getMonth();
  const today = new Date();
  const grid = h('div', { class: 'cal-month' }, ...WEEKDAYS.map((w) => h('div', { class: 'mwd', text: w })));
  for (let i = 0; i < 42; i++) {
    const d = addDays(r.start, i);
    const evs = eventsOnDay(d).sort((a, b) => (b.allDay - a.allDay) || (evStart(a) - evStart(b)));
    const cell = h('div', { class: 'mcell' + (d.getMonth() !== month ? ' other' : '') + (sameDay(d, today) ? ' today' : ''), onclick: (e) => { if (e.target === cell) { const s = new Date(d); s.setHours(9, 0, 0, 0); openEventEditor(null, { start: s, end: new Date(+s + 3600000) }); } } },
      h('button', { class: 'mnum', text: String(d.getDate()), title: 'Open this day', onclick: (e) => { e.stopPropagation(); S.cal.anchor = d; calSetView('day'); } }));
    evs.slice(0, 3).forEach((ev) => cell.append(eventChip(ev)));
    if (evs.length > 3) cell.append(h('button', { class: 'mmore', text: '+' + (evs.length - 3) + ' more', onclick: (e) => { e.stopPropagation(); S.cal.anchor = d; calSetView('day'); } }));
    grid.append(cell);
  }
  return h('div', { class: 'cal-wrap month' }, grid);
}

function defaultNewTimes() {
  const s = new Date(S.cal.view === 'day' ? S.cal.anchor : (calRange().start <= new Date() && new Date() < calRange().end ? new Date() : calRange().start));
  const now = new Date();
  if (sameDay(s, now)) s.setHours(now.getHours() + 1, 0, 0, 0); else s.setHours(9, 0, 0, 0);
  return { start: s, end: new Date(+s + 3600000) };
}

// ------------------------------------------------------------ event editor
const REPEATS = (d) => [
  ['', 'Does not repeat'], ['RRULE:FREQ=DAILY', 'Every day'],
  ['RRULE:FREQ=WEEKLY;BYDAY=' + ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()], 'Every week on ' + d.toLocaleDateString([], { weekday: 'long' })],
  ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday (Mon to Fri)'],
  ['RRULE:FREQ=MONTHLY', 'Every month on day ' + d.getDate()], ['RRULE:FREQ=YEARLY', 'Every year on ' + d.toLocaleDateString([], { month: 'long', day: 'numeric' })]];

function descToText(html) {
  if (!/<[a-z][\s\S]*>/i.test(html || '')) return html || '';
  const doc = new DOMParser().parseFromString('<div>' + String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n') + '</div>', 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function chooseScope(verb) {
  return new Promise((resolve) => {
    modal((box, close) => {
      const done = (v) => { close(); resolve(v); };
      box.append(h('h2', { text: verb + ' a repeating event' }), h('p', { class: 'modal-text', text: 'Change only this one, or every event in the series?' }),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', text: 'Cancel', onclick: () => done(null) }), h('button', { class: 'btn', text: 'This event', onclick: () => done('one') }), h('button', { class: 'btn primary', text: 'All events', onclick: () => done('all') })));
    });
  });
}

function openEventEditor(ev, preset) {
  if (ev && !ev.canEdit) { eventDetails(ev); return; }
  const writable = S.cal.cals.filter((x) => x.writable);
  if (!writable.length) { toast('None of your calendars can be edited.'); return; }
  const isNew = !ev;
  const st = isNew ? preset.start : evStart(ev);
  let en = isNew ? preset.end : evEnd(ev);
  const allDay0 = isNew ? !!preset.allDay : ev.allDay;
  if (allDay0 && !isNew) en = addDays(en, -1); // Google's all-day end date is the day after
  const descText = isNew ? '' : descToText(ev.description);
  modal((box, close) => {
    box.classList.add('ev-modal');
    const f = {};
    const inp = (props) => h('input', Object.assign({ class: 'ev-in' }, props));
    f.title = inp({ type: 'text', placeholder: 'Add a title', value: isNew ? '' : ev.title, class: 'ev-in ev-title' });
    f.cal = h('select', { class: 'ev-in', disabled: !isNew && !!ev.recurringEventId }, ...writable.map((c) => h('option', { value: c.id, selected: isNew ? c.primary : c.id === ev.calendarId, text: c.name })));
    f.allDay = h('input', { type: 'checkbox', checked: allDay0 });
    f.sd = inp({ type: 'date', value: ymd(st) }); f.st = inp({ type: 'time', value: hm(st), step: 300 });
    f.ed = inp({ type: 'date', value: ymd(en) }); f.et = inp({ type: 'time', value: hm(en), step: 300 });
    const syncAllDay = () => { f.st.hidden = f.allDay.checked; f.et.hidden = f.allDay.checked; };
    f.allDay.addEventListener('change', syncAllDay); syncAllDay();
    // Keep the same length when the start moves.
    let length = Math.max(0, +en - +st);
    const startVal = () => new Date(f.sd.value + 'T' + (f.allDay.checked ? '00:00' : f.st.value || '00:00'));
    const endVal = () => new Date(f.ed.value + 'T' + (f.allDay.checked ? '00:00' : f.et.value || '00:00'));
    const onStart = () => { const s = startVal(); if (isNaN(s)) return; const e = new Date(+s + length); f.ed.value = ymd(e); f.et.value = hm(e); };
    const onEnd = () => { const s = startVal(); const e = endVal(); if (!isNaN(s) && !isNaN(e)) length = Math.max(0, e - s); };
    f.sd.addEventListener('change', onStart); f.st.addEventListener('change', onStart);
    f.ed.addEventListener('change', onEnd); f.et.addEventListener('change', onEnd);
    const canRepeat = isNew || (!ev.recurringEventId);
    f.repeat = canRepeat ? h('select', { class: 'ev-in' }, ...REPEATS(st).map(([v, t]) => h('option', { value: v, text: t, selected: !isNew && ev.recurrence && ev.recurrence[0] === v }))) : null;
    f.loc = inp({ type: 'text', placeholder: 'Add a location', value: isNew ? '' : ev.location });
    const guests0 = isNew ? [] : ev.attendees.filter((a) => !a.self).map((a) => a.email);
    f.guests = inp({ type: 'text', placeholder: 'Add guests by email', value: guests0.length ? guests0.join(', ') + ', ' : '', autocomplete: 'off', spellcheck: 'false' });
    autocomplete(f.guests, { acct: S.acct, dirty: false });
    f.meet = h('input', { type: 'checkbox' });
    f.desc = h('textarea', { class: 'ev-in', rows: 4, placeholder: 'Add a description' }); f.desc.value = descText;
    f.notify = h('input', { type: 'checkbox', checked: true });
    const colorId0 = isNew ? '' : (ev.colorId || '');
    f.colorId = colorId0;
    const calColorOf = (id) => (S.cal.cals.find((c) => c.id === id) || {}).color;
    f.colors = h('div', { class: 'ev-colors' });
    const drawColors = async () => {
      const g = colorGrid(await eventColorChoices(calColorOf(f.cal.value)), f.colorId, (k) => { f.colorId = k; });
      f.colors.replaceChildren(g);
    };
    drawColors();
    f.cal.addEventListener('change', drawColors);
    const err = h('div', { class: 'c-err', role: 'alert' });
    const row = (label, ...kids) => h('div', { class: 'ev-row' }, h('label', { class: 'ev-lbl', text: label }), h('div', { class: 'ev-val' }, ...kids));

    const save = async (btn) => {
      err.textContent = '';
      const title = f.title.value.trim();
      const s = startVal(); let e = endVal();
      if (isNaN(s) || isNaN(e)) { err.textContent = 'Pick a start and end.'; return; }
      if (e < s) { err.textContent = 'The event ends before it starts.'; return; }
      const guests = splitAddrs(f.guests.value).map(emailOf);
      const bad = guests.filter((g) => !validAddr(g));
      if (bad.length) { err.textContent = 'These don\'t look like email addresses: ' + bad.join(', '); return; }
      const allDay = f.allDay.checked;
      const d = {
        calendarId: isNew ? f.cal.value : ev.calendarId, id: isNew ? undefined : ev.id, title, allDay,
        start: allDay ? { date: ymd(s) } : { dateTime: s.toISOString(), timeZone: TZ },
        end: allDay ? { date: ymd(addDays(e, 1)) } : { dateTime: (+e === +s ? new Date(+s + 1800000) : e).toISOString(), timeZone: TZ },
        location: f.loc.value.trim(), meet: f.meet.checked,
      };
      if (isNew || f.desc.value !== descText) d.description = f.desc.value;
      const guestsChanged = isNew ? guests.length > 0 : guests.join() !== guests0.join();
      if (guestsChanged) {
        const keep = new Map((isNew ? [] : ev.attendees).map((a) => [a.email, a]));
        d.guests = guests.map((g) => ({ email: g, status: (keep.get(g) || {}).status }));
        if (!isNew) for (const a of ev.attendees) if (a.self && !guests.includes(a.email)) d.guests.push({ email: a.email, status: a.status });
      }
      d.notify = guests.length > 0 && f.notify.checked;
      if (f.repeat) d.recurrence = f.repeat.value;
      if (!isNew && f.cal.value !== ev.calendarId) d.moveTo = f.cal.value;
      if (f.colorId !== colorId0) d.colorId = f.colorId;
      if (!isNew && ev.recurringEventId) {
        const scope = await chooseScope('Save');
        if (!scope) return;
        d.scope = scope; d.recurringEventId = ev.recurringEventId; d.originalStart = ev.originalStart || ev.start;
      }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await gd.calSave(S.acct, d);
        close(); toast(isNew ? 'Event added' : 'Event saved');
        calLoad({ silent: true });
      } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Save'; }
    };

    const saveBtn = h('button', { class: 'btn primary', text: 'Save', onclick: (e) => save(e.currentTarget) });
    box.append(
      h('div', { class: 'ev-top' }, f.title, tbBtn('close', 'Close', () => close())),
      row('When', h('div', { class: 'ev-when' }, f.sd, f.st, h('span', { class: 'ev-to', text: 'to' }), f.ed, f.et), h('label', { class: 'ev-check' }, f.allDay, 'All day')),
      f.repeat ? row('Repeat', f.repeat) : row('Repeat', h('span', { class: 'ev-note', text: 'Part of a repeating series' })),
      row('Calendar', f.cal),
      row('Color', f.colors),
      row('Where', f.loc),
      row('Guests', f.guests, h('label', { class: 'ev-check' }, f.notify, 'Email guests about this')),
      !isNew && ev.meet ? row('Video', h('button', { class: 'btn', onclick: () => gd.external(ev.meet) }, icon('external'), 'Join Google Meet')) : row('Video', h('label', { class: 'ev-check' }, f.meet, 'Add a Google Meet video call')),
      row('Notes', f.desc),
      err,
      h('div', { class: 'modal-actions' },
        !isNew ? h('button', { class: 'btn danger', text: 'Delete', onclick: () => deleteEvent(ev, close) }) : null,
        !isNew && ev.link ? h('button', { class: 'btn', text: 'Open in Google Calendar', onclick: () => gd.external(ev.link) }) : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', text: 'Cancel', onclick: () => close() }), saveBtn));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.querySelector('.ac')) close();
      if (e.key === 'Enter' && (e.ctrlKey || e.target === f.title)) { e.preventDefault(); save(saveBtn); }
    });
    setTimeout(() => f.title.focus(), 30);
  });
}

async function deleteEvent(ev, closeEditor) {
  let scope = 'one';
  if (ev.recurringEventId) { scope = await chooseScope('Delete'); if (!scope) return; }
  else {
    const a = await confirmBox('Delete "' + (ev.title || 'this event') + '"?', 'It is removed from ' + ev.calendarName + '.', 'Delete', { danger: true, checkbox: ev.attendees.length > 1 ? 'Email the guests that it is cancelled' : null, checked: true });
    if (!a.ok) return;
    ev._notify = a.checked;
  }
  try {
    await gd.calDelete(S.acct, ev.calendarId, ev.id, { scope, recurringEventId: ev.recurringEventId, notify: !!ev._notify });
    if (closeEditor) closeEditor();
    toast('Event deleted');
    calLoad({ silent: true });
  } catch (e) { toast('Could not delete: ' + e.message, null, null, 8000); }
}

function eventDetails(ev) {
  modal((box, close) => {
    box.classList.add('ev-modal');
    const st = evStart(ev); const en = evEnd(ev);
    const when = ev.allDay
      ? st.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ((en - st) > 86400000 ? ' to ' + addDays(en, -1).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : '')
      : st.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ', ' + fmtTime(st) + ' to ' + fmtTime(en);
    const statusName = { accepted: 'Going', declined: 'Not going', tentative: 'Maybe', needsAction: 'Not answered' };
    const rsvp = async (status) => {
      try { await gd.calRsvp(S.acct, ev.calendarId, ev.id, status); close(); toast('Answer sent: ' + statusName[status]); calLoad({ silent: true }); }
      catch (e) { toast('Could not answer: ' + e.message, null, null, 8000); }
    };
    const detailsColors = h('div', { class: 'ev-line ev-colors-line' });
    eventColorChoices(ev.calendarColor || ev.color).then((choices) => {
      detailsColors.append(h('span', { class: 'muted', text: 'Color' }), colorGrid(choices, ev.colorId || '', async (k, c) => {
        const prev = { colorId: ev.colorId, color: ev.color };
        ev.colorId = k; ev.color = k ? c.hex : (ev.calendarColor || ev.color); renderCalendar();
        try { await gd.calEventColor(S.acct, ev.calendarId, ev.id, k); calLoad({ silent: true }); }
        catch (e) { Object.assign(ev, prev); renderCalendar(); toast('Could not change the color: ' + e.message, null, null, 8000); }
      }));
    }).catch(() => {});
    const desc = h('div', { class: 'ev-desc' }); if (ev.description) desc.append(safeFragment(ev.description.includes('<') ? ev.description : escapeHtml(ev.description).replace(/\n/g, '<br>')));
    box.append(...[
      h('div', { class: 'ev-top' }, h('h2', { text: ev.title || '(no title)' }), tbBtn('close', 'Close', () => close())),
      h('div', { class: 'ev-line', text: when }),
      h('div', { class: 'ev-line muted' }, h('span', { class: 'swatch', style: 'background:' + ev.color }), ev.calendarName + (ev.organizer && !ev.organizerSelf ? ' · organized by ' + ev.organizer : '')),
      ev.location ? h('div', { class: 'ev-line', text: ev.location }) : null,
      (S.cal.cals.find((c) => c.id === ev.calendarId) || {}).writable ? detailsColors : null,
      ev.meet ? h('div', { class: 'ev-line' }, h('button', { class: 'btn', onclick: () => gd.external(ev.meet) }, icon('external'), 'Join Google Meet')) : null,
      ev.description ? desc : null,
      ev.attendees.length ? h('div', { class: 'ev-guests' }, h('div', { class: 'ev-lbl', text: ev.attendees.length + ' guests' }),
        ...ev.attendees.map((a) => h('div', { class: 'ev-guest' }, h('span', { text: (a.name || a.email) + (a.self ? ' (you)' : '') + (a.organizer ? ', organizer' : '') }), h('span', { class: 'st ' + a.status, text: statusName[a.status] || '' })))) : null,
      ev.myStatus ? h('div', { class: 'ev-rsvp' }, h('span', { text: 'Going?' }),
        ...[['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']].map(([k, t]) => h('button', { class: 'btn' + (ev.myStatus === k ? ' primary' : ''), text: t, onclick: () => rsvp(k) }))) : null,
      h('div', { class: 'modal-actions' },
        ev.link ? h('button', { class: 'btn', text: 'Open in Google Calendar', onclick: () => gd.external(ev.link) }) : null,
        h('button', { class: 'btn primary', text: 'Close', onclick: () => close() }))].filter(Boolean));
  });
}

// ----------------------------------------------------------------- colors
// The palette comes from the main process: Google Calendar's 11 event colors and 24 calendar colors.
async function calPalette() {
  if (!S.cal.palette) S.cal.palette = await gd.calPalette();
  return S.cal.palette;
}
/** Dark or light text, whichever reads better on this color. */
function textOn(hex) {
  const n = parseInt(String(hex || '#4285f4').slice(1), 16); const r = n >> 16; const g = (n >> 8) & 255; const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#1d1d1d' : '#ffffff';
}
/** A row of round color buttons. colors: [{key, name, hex}]; the one whose key is current gets a check. */
function colorGrid(colors, current, onPick, cls) {
  const grid = h('div', { class: 'color-grid' + (cls ? ' ' + cls : ''), role: 'radiogroup' });
  const paint = (cur) => grid.querySelectorAll('.cg-sw').forEach((b) => { const on = b.dataset.key === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  for (const c of colors) {
    grid.append(h('button', { type: 'button', class: 'cg-sw' + (c.wide ? ' wide' : ''), role: 'radio', 'data-key': c.key, title: c.name, 'aria-label': c.name, style: '--sw:' + c.hex + ';--tc:' + textOn(c.hex),
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); paint(c.key); onPick(c.key, c); } }, c.wide ? h('span', { text: c.name }) : null));
  }
  paint(current);
  grid.paint = paint;
  return grid;
}

/** Asks for the extra Google permission that changing calendar colors needs, then tries again. */
function askColorPermission(retry) {
  modal((box, close) => {
    box.append(
      h('h2', { text: 'Allow Beacon to change calendar colors' }),
      h('p', { class: 'sub', text: 'Calendar colors are saved to your Google account, so they match on your phone and on the web too. That takes one more Google permission.' }),
      h('ol', { class: 'perm-steps' },
        h('li', { text: 'Click Allow. Your browser opens the Google sign-in.' }),
        h('li', { text: 'Tick the box "See, add, and remove Google calendars you\'re subscribed to", along with the others, then Continue.' }),
        h('li', { text: 'Come back to Beacon. The color is changed right away.' })),
      h('div', { class: 'modal-actions' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', text: 'Not now', onclick: () => close() }),
        h('button', { class: 'btn primary', text: 'Allow', onclick: async (e) => {
          e.target.disabled = true;
          try { await gd.calConnect(S.acct); S.st = await gd.state(); close(); await retry(true); }
          catch (err) { e.target.disabled = false; toast(err.message, null, null, 8000); }
        } })));
  });
}

/** Changes a calendar's color everywhere (Beacon and Google Calendar). */
async function setCalendarColor(cal, hex, again) {
  const before = cal.color;
  cal.color = hex; calRepaint();
  try {
    S.cal.cals = await gd.calColor(S.acct, cal.id, hex);
    toast(cal.name + ' is now ' + ((S.cal.palette.calendar.find((c) => c.hex === hex) || {}).name || 'that color'));
    calLoad({ silent: true });
  } catch (e) {
    cal.color = before; calRepaint();
    if (e.code === 'calendar_color_scope' && !again) askColorPermission(() => setCalendarColor(cal, hex, true));
    else toast('Could not change the color: ' + e.message, null, null, 8000);
  }
}

/** Repaints events right away with the colors in S.cal.cals (before Google answers). */
function calRepaint() {
  const byId = new Map(S.cal.cals.map((c) => [c.id, c.color]));
  for (const ev of S.cal.events) { const cc = byId.get(ev.calendarId); if (cc) { ev.calendarColor = cc; if (!ev.colorId) ev.color = cc; } }
  if (S.view && S.view.kind === 'calendar') renderCalendar();
}

/** The palette shown under a calendar in the Calendars menu. */
async function calendarColorRow(cal, swatchBtn) {
  const pal = await calPalette();
  return colorGrid(pal.calendar.map((c) => ({ key: c.hex, name: c.name, hex: c.hex })), (cal.color || '').toLowerCase(), (hex) => {
    swatchBtn.style.background = hex;
    setCalendarColor(cal, hex);
  }, 'cal-colors');
}

/** Event colors for the editor and the details window: "Calendar color" first, then Google's 11. */
async function eventColorChoices(calColor) {
  const pal = await calPalette();
  return [{ key: '', name: 'Calendar color', hex: calColor || '#4285f4', wide: true }].concat(pal.event.map((c) => ({ key: c.id, name: c.name, hex: c.hex })));
}
