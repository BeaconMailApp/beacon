'use strict';
// Finds a one-time code (sign-in, verification, 2FA) in a new email's subject and preview,
// so the Windows alert can show it with a Copy button.

const WORDS = /\b(codes?|passcode|otp|one[- ]?time|verification|verify|verifying|security|log ?in|sign[- ]?in|2fa|two[- ]?(?:factor|step)|pin|confirmation|confirm|authenticat\w*|access)\b/gi;
// Words that mean the number is something else (money, order and tracking numbers, phone numbers).
const NOT_A_CODE = /\b(order|invoice|receipt|tracking|account (?:ending|number)|acct|ticket|case|ref(?:erence)?|zip|phone|call|fax|suite|apt|room|flight|confirmation number)\s*(?:#|no\.?|number)?\s*:?\s*$/i;

/** Returns {code, copy} or null. copy is what goes on the clipboard (digits without spaces or dashes). */
function findCode(subject, snippet) {
  const text = String(subject || '') + ' \n ' + String(snippet || '');
  const words = [];
  for (const m of text.matchAll(WORDS)) words.push(m.index);
  if (!words.length) return null;

  const cands = [];
  // Google and others: G-123456
  for (const m of text.matchAll(/\b[A-Z]-(\d{4,8})\b/g)) cands.push({ code: m[0], copy: m[1], at: m.index });
  // 123456, 1234, 12345678, 123 456, 123-456
  for (const m of text.matchAll(/(^|[^\w$€£#.\/:-])(\d{3}[ -]\d{3}|\d{4,8})(?![\w%]|[.,:\/-]\d)/g)) {
    const code = m[2]; const at = m.index + m[1].length;
    const digits = code.replace(/\D/g, '');
    if (/^(19|20)\d\d$/.test(digits)) continue; // a year
    if (/^0+$/.test(digits)) continue;
    const before = text.slice(Math.max(0, at - 40), at);
    if (NOT_A_CODE.test(before)) continue;
    cands.push({ code, copy: digits, at });
  }
  // Letters and digits mixed, like AB12CD (only right after a code word, to avoid random words)
  for (const m of text.matchAll(/\b(?=[A-Z0-9]{5,8}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8}\b/g)) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(code|passcode|otp|pin)\b[^\n]{0,20}$/i.test(before)) cands.push({ code: m[0], copy: m[0], at: m.index });
  }
  if (!cands.length) return null;
  // The candidate closest to a code word wins; it must be fairly close.
  let best = null;
  for (const c of cands) {
    const d = Math.min(...words.map((w) => Math.abs(w - c.at)));
    if (d <= 80 && (!best || d < best.d)) best = Object.assign({ d }, c);
  }
  return best ? { code: best.code, copy: best.copy } : null;
}

module.exports = { findCode };
