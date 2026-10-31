'use strict';
// Google Calendar for Beacon: reads events for a date range and saves edits.
// The window sends plain objects; everything that talks to Google happens here.

const { log } = require('./log');

const WRITABLE = new Set(['owner', 'writer']);

// The same colors Google Calendar offers, in the order its color pickers show them.
// Event colors are Google's 11 fixed event colors (saved as colorId 1 to 11).
const EVENT_COLORS = [
  ['11', 'Tomato', '#d50000'], ['4', 'Flamingo', '#e67c73'], ['6', 'Tangerine', '#f4511e'], ['5', 'Banana', '#f6bf26'],
  ['2', 'Sage', '#33b679'], ['10', 'Basil', '#0b8043'], ['7', 'Peacock', '#039be5'], ['9', 'Blueberry', '#3f51b5'],
  ['1', 'Lavender', '#7986cb'], ['3', 'Grape', '#8e24aa'], ['8', 'Graphite', '#616161'],
];
// Calendar colors: Google Calendar's 24, saved as the calendar's color in your Google calendar list.
const CALENDAR_COLORS = [
  ['Radicchio', '#ad1457'], ['Tangerine', '#f4511e'], ['Citron', '#e4c441'], ['Basil', '#0b8043'], ['Blueberry', '#3f51b5'], ['Grape', '#8e24aa'],
  ['Cherry blossom', '#d81b60'], ['Pumpkin', '#ef6c00'], ['Avocado', '#c0ca33'], ['Eucalyptus', '#009688'], ['Lavender', '#7986cb'], ['Cocoa', '#795548'],
  ['Tomato', '#d50000'], ['Mango', '#f09300'], ['Pistachio', '#7cb342'], ['Peacock', '#039be5'], ['Wisteria', '#b39ddb'], ['Graphite', '#616161'],
  ['Flamingo', '#e67c73'], ['Banana', '#f6bf26'], ['Sage', '#33b679'], ['Cobalt', '#4285f4'], ['Amethyst', '#9e69af'], ['Birch', '#a79b8e'],
];
const EVENT_HEX = Object.fromEntries(EVENT_COLORS.map(([id, , hex]) => [id, hex]));
const PALETTE = { event: EVENT_COLORS.map(([id, name, hex]) => ({ id, name, hex })), calendar: CALENDAR_COLORS.map(([name, hex]) => ({ name, hex })) };

/** Dark or light text, whichever reads better on this color. */
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16); const r = n >> 16; const g = (n >> 8) & 255; const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#1d1d1d' : '#ffffff';
}

/** Sets a calendar's color in your Google calendar list, so it matches on your phone and the web. */
async function setCalendarColor(account, calId, hex) {
  const c = CALENDAR_COLORS.find(([, x]) => x === String(hex).toLowerCase());
  if (!c) throw new Error('Pick one of the colors shown.');
  await account.calListPatch(calId, { backgroundColor: c[1], foregroundColor: textOn(c[1]) });
  log('calendar color changed', calId);
  return c[1];
}

/** Sets one event's color (one of Google's 11), or '' to go back to the calendar's color. */
async function setEventColor(account, calId, eventId, colorId) {
  const id = String(colorId || '');
  if (id && !EVENT_HEX[id]) throw new Error('Pick one of the colors shown.');
  await account.calPatch(calId, eventId, { colorId: id || null }, { sendUpdates: 'none' });
  return true;
}

function normCalendar(c) {
  return {
    id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#4285f4',
    primary: !!c.primary, writable: WRITABLE.has(c.accessRole), role: c.accessRole, defaultHidden: c.selected === false || !!c.hidden,
  };
}

function normEvent(e, cal) {
  const allDay = !!(e.start && e.start.date && !e.start.dateTime);
  const self = (e.attendees || []).find((a) => a.self);
  const organizerSelf = !e.organizer || !!e.organizer.self || e.organizer.email === cal.id;
  return {
    id: e.id, calendarId: cal.id, calendarName: cal.name, color: (e.colorId && EVENT_HEX[e.colorId]) || cal.color, colorId: EVENT_HEX[e.colorId] ? String(e.colorId) : '', calendarColor: cal.color,
    title: e.summary || '', location: e.location || '', description: e.description || '',
    allDay, start: allDay ? e.start.date : e.start.dateTime, end: allDay ? (e.end && e.end.date) : (e.end && e.end.dateTime),
    recurringEventId: e.recurringEventId || null, recurrence: e.recurrence || null,
    originalStart: e.originalStartTime ? (e.originalStartTime.dateTime || e.originalStartTime.date) : null,
    attendees: (e.attendees || []).filter((a) => !a.resource).map((a) => ({ email: a.email, name: a.displayName || '', status: a.responseStatus || 'needsAction', self: !!a.self, organizer: !!a.organizer, optional: !!a.optional })),
    organizer: e.organizer ? (e.organizer.displayName || e.organizer.email || '') : '', organizerSelf,
    myStatus: self ? self.responseStatus : null,
    canEdit: cal.writable && (organizerSelf || !!e.guestsCanModify),
    link: e.htmlLink || '', meet: e.hangoutLink || ((e.conferenceData && (e.conferenceData.entryPoints || []).find((p) => p.entryPointType === 'video')) || {}).uri || '',
    free: e.transparency === 'transparent',
  };
}

/** Lists the account's calendars. */
async function calendars(account) {
  const list = (await account.calCalendars()).map(normCalendar);
  list.sort((a, b) => (b.primary - a.primary) || (b.writable - a.writable) || a.name.localeCompare(b.name));
  return list;
}

/** Events from several calendars between two ISO times. A calendar that fails is skipped and reported. */
async function events(account, cals, timeMin, timeMax) {
  const out = []; const failed = [];
  for (let i = 0; i < cals.length; i += 3) {
    await Promise.all(cals.slice(i, i + 3).map(async (cal) => {
      try {
        const items = await account.calEvents(cal.id, timeMin, timeMax);
        for (const e of items) if (e.status !== 'cancelled' && e.start) out.push(normEvent(e, cal));
      } catch (e) {
        if (e.code === 'calendar_disabled' || e.code === 'calendar_scope' || e.code === 'needs_auth') throw e;
        failed.push(cal.name); log('calendar events failed', cal.id, e.message);
      }
    }));
  }
  out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { events: out, failed };
}

const VALID_RRULE = /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+-]+)*$/;
function when(x) {
  if (!x) throw new Error('Pick a date.');
  if (x.date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new Error('That date is not valid.'); return { date: x.date }; }
  if (!x.dateTime || isNaN(Date.parse(x.dateTime))) throw new Error('That time is not valid.');
  return { dateTime: x.dateTime, timeZone: x.timeZone || undefined };
}
const ms = (x) => (x.date ? Date.parse(x.date + 'T00:00:00') : Date.parse(x.dateTime));

/**
 * Creates or updates an event.
 * d = {calendarId, id?, title, allDay, start:{date}|{dateTime,timeZone}, end, location, description, guests:[email],
 *      recurrence?: 'RRULE:...', meet?: bool, notify?: bool, scope?: 'one'|'all', recurringEventId?, originalStart?, moveTo?}
 */
async function save(account, d) {
  const start = when(d.start); const end = when(d.end);
  if (ms(end) < ms(start)) throw new Error('The event ends before it starts.');
  const body = {
    summary: String(d.title || '').slice(0, 1000), location: String(d.location || '').slice(0, 1000), description: String(d.description || '').slice(0, 8000),
    start: d.allDay ? { date: start.date } : start, end: d.allDay ? { date: end.date } : end,
  };
  if (d.description === undefined || d.description === null) delete body.description; // keep Google's formatted text unless you changed it
  if (Array.isArray(d.guests)) body.attendees = d.guests.filter((g) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email || '')).map((g) => ({ email: g.email, responseStatus: g.status || undefined, optional: g.optional || undefined }));
  if (d.colorId !== undefined) {
    const cid = String(d.colorId || '');
    if (cid && !EVENT_HEX[cid]) throw new Error('Pick one of the colors shown.');
    if (cid) body.colorId = cid; else if (d.id) body.colorId = null; // null puts it back to the calendar's color
  }
  const sendUpdates = d.notify ? 'all' : 'none';
  const conference = !!d.meet;
  if (conference) body.conferenceData = { createRequest: { requestId: 'gd' + Date.now() + Math.random().toString(36).slice(2, 8), conferenceSolutionKey: { type: 'hangoutsMeet' } } };

  if (!d.id) {
    if (d.recurrence) { if (!VALID_RRULE.test(d.recurrence)) throw new Error('That repeat setting is not valid.'); body.recurrence = [d.recurrence]; }
    const r = await account.calInsert(d.calendarId, body, { sendUpdates, conference });
    log('calendar created', d.calendarId);
    return r.id;
  }

  let targetId = d.id;
  if (d.scope === 'all' && d.recurringEventId) {
    // Editing the whole series: shift the series by however much this occurrence moved.
    const master = await account.calGet(d.calendarId, d.recurringEventId);
    const orig = d.originalStart ? (d.allDay ? { date: d.originalStart.slice(0, 10) } : { dateTime: d.originalStart }) : start;
    const shift = ms(start) - ms(orig);
    const length = ms(end) - ms(start);
    const mStart = ms(master.start) + shift;
    if (d.allDay) {
      const day = (t) => { const x = new Date(t); x.setHours(12); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
      body.start = { date: day(mStart) };
      body.end = { date: day(mStart + Math.max(length, 86400000)) };
    } else {
      const tz = start.timeZone || (master.start && master.start.timeZone);
      body.start = { dateTime: new Date(mStart).toISOString(), timeZone: tz };
      body.end = { dateTime: new Date(mStart + length).toISOString(), timeZone: tz };
    }
    targetId = d.recurringEventId;
  } else if (d.recurrence !== undefined && !d.recurringEventId) {
    if (d.recurrence) { if (!VALID_RRULE.test(d.recurrence)) throw new Error('That repeat setting is not valid.'); body.recurrence = [d.recurrence]; }
    else body.recurrence = [];
  }
  await account.calPatch(d.calendarId, targetId, body, { sendUpdates, conference });
  if (d.moveTo && d.moveTo !== d.calendarId) {
    await account.calMove(d.calendarId, targetId, d.moveTo);
  }
  log('calendar updated', d.calendarId, d.scope || 'one');
  return targetId;
}

async function remove(account, calendarId, id, { scope, recurringEventId, notify } = {}) {
  const target = scope === 'all' && recurringEventId ? recurringEventId : id;
  try { await account.calDelete(calendarId, target, notify ? 'all' : 'none'); }
  catch (e) { if (e.status === 410 || e.status === 404) return true; throw e; }
  log('calendar deleted', calendarId, scope || 'one');
  return true;
}

/** Accept, decline or maybe on an invite. */
async function respond(account, calendarId, id, status) {
  if (!['accepted', 'declined', 'tentative'].includes(status)) throw new Error('Unknown answer.');
  const e = await account.calGet(calendarId, id);
  const attendees = (e.attendees || []).map((a) => (a.self ? Object.assign({}, a, { responseStatus: status }) : a));
  if (!attendees.some((a) => a.self)) throw new Error('You are not on the guest list for this event.');
  await account.calPatch(calendarId, id, { attendees }, { sendUpdates: 'all' });
  return true;
}

module.exports = { calendars, events, save, remove, respond, normEvent, normCalendar, setCalendarColor, setEventColor, PALETTE };
