// Piccole utilità DOM condivise dall'interfaccia.

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

let toastBox = null;
export function toast(msg, kind = 'info', ms = 3800) {
  if (!toastBox) { toastBox = el('div', { class: 'toasts' }); document.body.append(toastBox); }
  const t = el('div', { class: `toast toast-${kind}` }, msg);
  toastBox.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms);
}

export function bar(value, max = 100, cls = '') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return el('div', { class: `bar ${cls}` }, el('div', { class: 'bar-fill', style: { width: `${pct}%` } }));
}

export function stars(n, max = 4) { return '★'.repeat(n) + '☆'.repeat(max - n); }

export function confirmDialog(text, okLabel = 'Conferma', cancelLabel = 'Annulla') {
  return new Promise((resolve) => {
    const ov = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal' },
      el('p', {}, text),
      el('div', { class: 'row end' },
        el('button', { class: 'btn ghost', onclick: () => { ov.remove(); resolve(false); } }, cancelLabel),
        el('button', { class: 'btn primary', onclick: () => { ov.remove(); resolve(true); } }, okLabel)));
    ov.append(box);
    document.body.append(ov);
  });
}
