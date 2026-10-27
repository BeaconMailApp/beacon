'use strict';
// Cleans HTML before it goes into the compose editor (signatures, drafts, mailto bodies).
// DOMParser builds an inert document (no scripts or handlers run), and only allowlisted
// tags and attributes are copied across.
(function () {
  const TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV', 'SPAN', 'FONT', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'IMG', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'HR', 'SUB', 'SUP', 'SMALL', 'BIG', 'CODE', 'PRE']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'SOURCE', 'FRAME', 'FRAMESET']);
  const ATTRS = { A: ['href', 'title'], IMG: ['src', 'alt', 'width', 'height', 'title'], FONT: ['color', 'size', 'face'], TD: ['colspan', 'rowspan', 'align', 'valign', 'width'], TH: ['colspan', 'rowspan', 'align', 'width'], TABLE: ['width', 'cellpadding', 'cellspacing', 'border'], '*': ['style', 'dir', 'align'] };
  const safeUrl = (u, img) => {
    const s = String(u || '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    if (img && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s)) return s;
    return null;
  };
  const safeStyle = (s) => String(s || '').replace(/expression\s*\(|url\s*\(|javascript:|@import|behavior\s*:/gi, '').slice(0, 600);

  function clean(node, doc) {
    const out = doc.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { out.appendChild(doc.createTextNode(child.nodeValue)); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (!TAGS.has(tag)) { out.appendChild(clean(child, doc)); continue; }
      const el = doc.createElement(tag.toLowerCase());
      const allowed = (ATTRS[tag] || []).concat(ATTRS['*']);
      for (const a of Array.from(child.attributes)) {
        const name = a.name.toLowerCase();
        if (!allowed.includes(name)) continue;
        if (name === 'href') { const u = safeUrl(a.value, false); if (u) { el.setAttribute('href', u); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); } continue; }
        if (name === 'src') { const u = safeUrl(a.value, true); if (u) el.setAttribute('src', u); continue; }
        if (name === 'style') { el.setAttribute('style', safeStyle(a.value)); continue; }
        el.setAttribute(name, a.value.slice(0, 300));
      }
      if (tag === 'IMG' && !el.getAttribute('src')) continue;
      el.appendChild(clean(child, doc));
      out.appendChild(el);
    }
    return out;
  }

  /** Returns a DocumentFragment, owned by the current document, that is safe to insert. */
  window.safeFragment = function (html) {
    const parsed = new DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html');
    return clean(parsed.body, document);
  };
})();
