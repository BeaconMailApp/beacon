'use strict';
// Reading Gmail message payloads and building outgoing MIME messages.

const crypto = require('crypto');

const fromB64url = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const toB64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function header(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function charsetOf(part) {
  const ct = header(part.headers, 'Content-Type');
  const m = /charset="?([^";\s]+)"?/i.exec(ct);
  return m ? m[1].toLowerCase() : 'utf-8';
}

function decodeText(part) {
  const buf = fromB64url(part.body && part.body.data);
  const cs = charsetOf(part);
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(buf); } catch (_) { return buf.toString('utf8'); }
}

/** Walks a Gmail payload. Returns {html, text, attachments:[{filename,mimeType,size,attachmentId,cid,inline}]} */
function parsePayload(payload) {
  const out = { html: '', text: '', attachments: [] };
  const walk = (p) => {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    const disp = header(p.headers, 'Content-Disposition').toLowerCase();
    const cidRaw = header(p.headers, 'Content-ID') || header(p.headers, 'X-Attachment-Id');
    const cid = cidRaw.replace(/^<|>$/g, '');
    const isAttachment = (p.filename && p.filename.length) || disp.startsWith('attachment') || (p.body && p.body.attachmentId && !mt.startsWith('text/'));
    if (p.parts && p.parts.length) { p.parts.forEach(walk); return; }
    if (isAttachment && p.body) {
      out.attachments.push({
        filename: p.filename || (cid ? cid + '.' + (mt.split('/')[1] || 'bin') : 'attachment'),
        mimeType: mt, size: p.body.size || 0, attachmentId: p.body.attachmentId || null,
        data: p.body.data || null, cid, inline: !!cid && (disp.startsWith('inline') || mt.startsWith('image/')),
      });
      return;
    }
    if (mt === 'text/html' && !out.html) out.html = decodeText(p);
    else if (mt === 'text/plain' && !out.text) out.text = decodeText(p);
  };
  walk(payload);
  return out;
}

// ---------- building outgoing mail ----------
const needsEncoding = (s) => /[^\x20-\x7e]/.test(s);
const encodeWord = (s) => (needsEncoding(s) ? '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=' : s);

function encodeAddressList(list) {
  return (list || []).filter(Boolean).map((a) => {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(a);
    if (m && m[1].trim()) {
      const name = m[1].trim().replace(/"/g, '');
      const shown = needsEncoding(name) ? encodeWord(name) : (/[,;:@()<>\[\]\\.]/.test(name) ? '"' + name + '"' : name);
      return shown + ' <' + m[2].trim() + '>';
    }
    return (m ? m[2] : a).trim();
  }).join(', ');
}

function wrap76(b64) { return b64.replace(/.{1,76}/g, '$&\r\n'); }

function htmlToText(html) {
  return String(html || '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * opts: {from, to[], cc[], bcc[], subject, html, text, inReplyTo, references, attachments:[{filename, mimeType, data(Buffer)}]}
 * Returns base64url raw string for the Gmail API.
 */
function buildRaw(opts) {
  const boundary = (p) => '=_gd_' + p + '_' + crypto.randomBytes(12).toString('hex');
  const altB = boundary('alt');
  const lines = [];
  const h = (k, v) => { if (v) lines.push(k + ': ' + v); };
  h('From', opts.from ? encodeAddressList([opts.from]) : '');
  h('To', encodeAddressList(opts.to));
  h('Cc', encodeAddressList(opts.cc));
  h('Bcc', encodeAddressList(opts.bcc));
  h('Subject', encodeWord(opts.subject || ''));
  h('In-Reply-To', opts.inReplyTo);
  h('References', opts.references);
  h('MIME-Version', '1.0');
  h('Date', new Date().toUTCString().replace('GMT', '+0000'));

  const html = opts.html || '';
  const text = opts.text || htmlToText(html);
  const alt = [
    '--' + altB,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '',
    wrap76(Buffer.from(text, 'utf8').toString('base64')),
    '--' + altB,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '',
    wrap76(Buffer.from('<div dir="ltr">' + html + '</div>', 'utf8').toString('base64')),
    '--' + altB + '--', '',
  ].join('\r\n');

  const atts = opts.attachments || [];
  if (!atts.length) {
    lines.push('Content-Type: multipart/alternative; boundary="' + altB + '"', '', alt);
  } else {
    const mixB = boundary('mix');
    lines.push('Content-Type: multipart/mixed; boundary="' + mixB + '"', '');
    lines.push('--' + mixB, 'Content-Type: multipart/alternative; boundary="' + altB + '"', '', alt);
    for (const a of atts) {
      const name = encodeWord(a.filename || 'attachment').replace(/"/g, '');
      lines.push('--' + mixB,
        'Content-Type: ' + (a.mimeType || 'application/octet-stream') + '; name="' + name + '"',
        'Content-Disposition: attachment; filename="' + name + '"',
        'Content-Transfer-Encoding: base64', '',
        wrap76(Buffer.from(a.data).toString('base64')));
    }
    lines.push('--' + mixB + '--', '');
  }
  return toB64url(Buffer.from(lines.join('\r\n'), 'utf8'));
}

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function textToHtml(t) { return escapeHtml(t).replace(/\r?\n/g, '<br>'); }

module.exports = { header, parsePayload, buildRaw, fromB64url, toB64url, htmlToText, escapeHtml, textToHtml };
