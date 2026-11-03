'use strict';
/* The formatting bar in the composer (the Aa button): font, size, text and background color,
   strikethrough, alignment and indent. Works like Gmail's, and the result is plain email HTML
   (font tags and inline styles) that every mail app shows. */

const FONTS = [
  ['Sans Serif', 'arial, helvetica, sans-serif'], ['Serif', '"times new roman", serif'], ['Fixed width', '"courier new", monospace'],
  ['Wide', '"arial black", sans-serif'], ['Narrow', '"arial narrow", sans-serif'], ['Comic Sans MS', '"comic sans ms", sans-serif'],
  ['Garamond', 'garamond, "times new roman", serif'], ['Georgia', 'georgia, serif'], ['Tahoma', 'tahoma, sans-serif'],
  ['Trebuchet MS', '"trebuchet ms", sans-serif'], ['Verdana', 'verdana, sans-serif'],
];
const SIZES = [['Small', '2'], ['Normal', '3'], ['Large', '4'], ['Huge', '6']];
// Gmail's color grid: a gray row, a bright row, then lighter and darker shades.
const PALETTE = [
  '#000000', '#444444', '#666666', '#999999', '#cccccc', '#eeeeee', '#f3f3f3', '#ffffff',
  '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#9900ff', '#ff00ff',
  '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c6', '#674ea7', '#a64d79',
  '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75', '#741b47',
  '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#073763', '#20124d', '#4c1130',
];

// Picking from a list or a color grid moves focus off the editor, so remember where the cursor was.
let fmtRange = null;
document.addEventListener('selectionchange', () => {
  const ed = document.getElementById('c-editor'); const sel = getSelection();
  if (ed && sel.rangeCount && ed.contains(sel.anchorNode)) fmtRange = sel.getRangeAt(0).cloneRange();
});
function fmtApply(cmd, value, css) {
  const ed = document.getElementById('c-editor'); if (!ed) return;
  ed.focus();
  if (fmtRange && ed.contains(fmtRange.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(fmtRange); }
  document.execCommand('styleWithCSS', false, !!css);
  document.execCommand(cmd, false, value);
  document.execCommand('styleWithCSS', false, false);
  if (S.comp) S.comp.dirty = true;
}

function colorPopup(anchor) {
  const grid = (label, cmd) => h('div', { class: 'cp-sec' }, h('div', { class: 'cp-lbl', text: label }),
    h('div', { class: 'cp-grid' }, ...PALETTE.map((c) => h('button', { class: 'cp-sw', title: c, 'aria-label': label + ' ' + c, style: 'background:' + c,
      onmousedown: (e) => e.preventDefault(), onclick: () => { fmtApply(cmd, c, true); closeMenus(); } }))));
  const m = popMenu(anchor, [{ el: h('div', { class: 'cp' }, grid('Background color', 'hiliteColor'), grid('Text color', 'foreColor')) }]);
  m.classList.add('cp-menu');
  m.addEventListener('mousedown', (e) => { if (e.target.closest('.cp-sw')) e.preventDefault(); });
  return m;
}

/** The extra row of formatting tools (text color lives on the main row, next to underline). Shown or hidden with the Aa button; the choice is remembered. */
function formatBar() {
  const sel = (label, options, onPick) => {
    const s = h('select', { class: 'fb-sel', title: label, 'aria-label': label },
      h('option', { value: '', text: label, disabled: true, selected: true }), ...options.map(([t, v]) => h('option', { value: v, text: t })));
    s.addEventListener('change', () => { const v = s.value; s.selectedIndex = 0; if (v) onPick(v); });
    return s;
  };
  const font = sel('Font', FONTS, (v) => fmtApply('fontName', v));
  [...font.options].forEach((o) => { if (o.value) o.style.fontFamily = o.value; });
  const size = sel('Size', SIZES, (v) => fmtApply('fontSize', v));
  const b = (ic, title, cmd, val) => h('button', { class: 'fb-btn', title, 'aria-label': title, onmousedown: (e) => e.preventDefault(), onclick: () => fmtApply(cmd, val) }, icon(ic));
  return h('div', { class: 'fmt-bar' }, font, size, h('span', { class: 'tb-sep' }),
    b('strike', 'Strikethrough', 'strikeThrough'), h('span', { class: 'tb-sep' }),
    b('alignLeft', 'Align left', 'justifyLeft'), b('alignCenter', 'Center', 'justifyCenter'), b('alignRight', 'Align right', 'justifyRight'), h('span', { class: 'tb-sep' }),
    b('outdent', 'Indent less', 'outdent'), b('indent', 'Indent more', 'indent'));
}
function fmtBarShown() { try { return localStorage.getItem('beacon.fmtBar') === '1'; } catch (_) { return false; } }
function toggleFmtBar(btn) {
  const on = !fmtBarShown();
  try { localStorage.setItem('beacon.fmtBar', on ? '1' : '0'); } catch (_) {}
  const comp = btn.closest('.composer'); if (!comp) return;
  const bar = comp.querySelector('.fmt-bar');
  if (bar) bar.hidden = !on;
  btn.classList.toggle('on', on);
}
