'use strict';
/* Drag the bar between the email list and the reading pane to resize them.
   The width is remembered on this computer. Double click the bar to go back to the default. */
(() => {
  const KEY = 'beacon.listWidth';
  const MIN_LIST = 300;   // narrowest list that still shows sender, subject and date
  const MIN_READER = 440; // narrowest reading pane that still fits an email
  const panes = document.getElementById('panes');
  const list = document.getElementById('list-pane');
  if (!panes || !list) return;

  const bar = document.createElement('div');
  bar.className = 'splitter';
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', 'vertical');
  bar.setAttribute('aria-label', 'Resize email list');
  bar.title = 'Drag to resize. Double click to reset.';
  bar.tabIndex = 0;
  panes.appendChild(bar);

  const load = () => { try { return parseInt(localStorage.getItem(KEY), 10) || 0; } catch (_) { return 0; } };
  const save = (w) => { try { if (w) localStorage.setItem(KEY, String(w)); else localStorage.removeItem(KEY); } catch (_) {} };

  function clamp(w) {
    const total = panes.clientWidth - 12; // right padding of the panes area
    return Math.round(Math.max(MIN_LIST, Math.min(w, total - MIN_READER - 10)));
  }
  function apply(w) {
    if (w) { panes.style.setProperty('--list-w', clamp(w) + 'px'); panes.classList.add('sized'); }
    else { panes.style.removeProperty('--list-w'); panes.classList.remove('sized'); }
    place();
  }
  // Keeps the bar on the edge of the list, whatever layout the panes are in.
  function place() {
    const visible = list.offsetParent !== null && getComputedStyle(panes).gridTemplateColumns.trim().split(/\s+/).length > 1;
    bar.hidden = !visible;
    if (visible) bar.style.left = (list.offsetLeft + list.offsetWidth) + 'px';
  }

  let startX = 0; let startW = 0;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX; startW = list.offsetWidth;
    bar.classList.add('drag'); document.body.classList.add('resizing');
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
  });
  window.addEventListener('pointermove', (e) => {
    if (!bar.classList.contains('drag')) return;
    apply(startW + e.clientX - startX);
  });
  const end = () => {
    if (!bar.classList.contains('drag')) return;
    bar.classList.remove('drag'); document.body.classList.remove('resizing');
    save(list.offsetWidth);
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  bar.addEventListener('dblclick', () => { save(0); apply(0); });
  bar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      apply(list.offsetWidth + (e.key === 'ArrowRight' ? step : -step));
      save(list.offsetWidth);
    }
  });

  // The layout changes when the window resizes or a view switches (Clean up, Calendar, reading only).
  // Waits a frame before changing anything, so a resize never triggers another one in the same frame.
  let queued = 0;
  const relayout = () => {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(() => {
      if (bar.classList.contains('drag')) { place(); return; } // the drag sets the width itself
      const w = load();
      const want = w ? clamp(w) + 'px' : '';
      if (w && panes.classList.contains('sized') && panes.style.getPropertyValue('--list-w') !== want) panes.style.setProperty('--list-w', want);
      place();
    });
  };
  new ResizeObserver(relayout).observe(panes);
  new ResizeObserver(relayout).observe(list);
  new MutationObserver(place).observe(panes, { attributes: true, attributeFilter: ['class'] });

  apply(load());
})();
