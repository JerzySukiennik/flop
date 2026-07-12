// ?debug=1 tuning panel — auto-generated number inputs over the TUNING tree.
// Cheap on purpose: the tuning hour must be cheap (trap list #8).
import { TUNING } from '../game/tuning.js';

export function mountDebugPanel() {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:8px;right:8px;max-height:92vh;overflow:auto;
    background:rgba(16,18,22,.92);color:#cfe3ff;font:11px/1.5 monospace;padding:10px;
    border-radius:8px;z-index:1000;width:240px`;
  el.innerHTML = '<b>FLOP tuning</b> <small>(live)</small><br><br>';

  const walk = (obj, path) => {
    for (const [key, val] of Object.entries(obj)) {
      const p = path ? `${path}.${key}` : key;
      if (typeof val === 'number') {
        const row = document.createElement('div');
        const label = document.createElement('span');
        label.textContent = p;
        label.style.cssText = 'display:inline-block;width:130px;overflow:hidden';
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.value = val;
        inp.step = Math.abs(val) > 10 ? 10 : 0.05;
        inp.style.cssText = 'width:70px;background:#222;color:#9f9;border:1px solid #444';
        inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v)) obj[key] = v;
        });
        row.append(label, inp);
        el.appendChild(row);
      } else if (val && typeof val === 'object') {
        const h = document.createElement('div');
        h.textContent = `— ${p} —`;
        h.style.cssText = 'margin-top:6px;color:#8fb3e8';
        el.appendChild(h);
        walk(val, p);
      }
    }
  };
  walk(TUNING, '');
  document.body.appendChild(el);
  return el;
}
