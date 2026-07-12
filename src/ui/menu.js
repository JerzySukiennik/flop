// Main menu + lobby browser + character customizer (colors/pattern/hat,
// persisted in localStorage — add-on #2).
export const HATS = ['none', 'cone', 'tophat', 'crown'];
export const COLORS = [0xff6b4a, 0x4a9dff, 0x6bdb6b, 0xffd24a, 0xd66bff, 0x4affd5, 0xff6baa, 0xc8c8c8];

export function loadCustomization() {
  try {
    const c = JSON.parse(localStorage.getItem('flop-custom') ?? '{}');
    return { color: c.color ?? COLORS[0], hat: HATS.includes(c.hat) ? c.hat : 'none', name: c.name ?? '' };
  } catch { return { color: COLORS[0], hat: 'none', name: '' }; }
}

export function saveCustomization(c) {
  localStorage.setItem('flop-custom', JSON.stringify(c));
}

export class Menu {
  constructor({ onSolo, onHost, onJoin, listLobbies }) {
    this.custom = loadCustomization();
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;inset:0;z-index:900;display:flex;align-items:center;
      justify-content:center;background:linear-gradient(160deg,#1c2230 0%,#2a3348 60%,#3a2f3f 100%);
      font-family:system-ui,sans-serif;color:#fff`;
    el.innerHTML = `
      <div style="width:420px;max-width:92vw">
        <div style="font-size:64px;font-weight:900;letter-spacing:6px;text-align:center;
          text-shadow:0 6px 0 rgba(0,0,0,.35)">FLOP</div>
        <div style="text-align:center;color:#9fb3d8;margin:-4px 0 22px;font-size:14px">
          a wobbly co-op physics disaster · 1–4 players</div>

        <input id="m-name" placeholder="your name" maxlength="14" style="width:100%;box-sizing:border-box;
          padding:10px 14px;border-radius:10px;border:none;background:rgba(255,255,255,.12);color:#fff;
          font-size:15px;outline:none;margin-bottom:12px">

        <div style="display:flex;gap:6px;margin-bottom:8px" id="m-colors"></div>
        <div style="display:flex;gap:6px;margin-bottom:18px" id="m-hats"></div>

        <button id="m-solo" class="mbtn" style="background:#3d78d8">Practice solo</button>
        <button id="m-host" class="mbtn" style="background:#3fa650">Host co-op game</button>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="m-code" placeholder="CODE" maxlength="4" style="flex:1;padding:10px 14px;text-transform:uppercase;
            border-radius:10px;border:none;background:rgba(255,255,255,.12);color:#fff;font-size:16px;
            letter-spacing:5px;outline:none;text-align:center">
          <button id="m-join" class="mbtn" style="flex:2;background:#c8843a;margin-top:0">Join by code</button>
        </div>

        <div style="margin-top:18px;font-size:13px;color:#9fb3d8;display:flex;justify-content:space-between">
          <span>Public lobbies</span><a id="m-refresh" style="cursor:pointer;color:#9be7ff;pointer-events:auto">refresh</a>
        </div>
        <div id="m-lobbies" style="margin-top:6px;max-height:140px;overflow:auto"></div>
        <div id="m-status" style="margin-top:12px;text-align:center;color:#ffd24a;font-size:13px;min-height:18px"></div>
      </div>
      <style>.mbtn{display:block;width:100%;padding:12px;border:none;border-radius:10px;color:#fff;
        font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}
        .mbtn:hover{filter:brightness(1.12)}</style>`;
    document.body.appendChild(el);
    this.el = el;

    const nameInput = el.querySelector('#m-name');
    nameInput.value = this.custom.name;
    nameInput.addEventListener('input', () => { this.custom.name = nameInput.value; saveCustomization(this.custom); });

    const colorsEl = el.querySelector('#m-colors');
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.style.cssText = `flex:1;height:30px;border-radius:8px;border:3px solid ${c === this.custom.color ? '#fff' : 'transparent'};
        background:#${c.toString(16).padStart(6, '0')};cursor:pointer`;
      b.addEventListener('click', () => {
        this.custom.color = c; saveCustomization(this.custom);
        [...colorsEl.children].forEach((x, i) => { x.style.borderColor = COLORS[i] === c ? '#fff' : 'transparent'; });
      });
      colorsEl.appendChild(b);
    }
    const hatsEl = el.querySelector('#m-hats');
    for (const h of HATS) {
      const b = document.createElement('button');
      b.textContent = h;
      b.dataset.hat = h;
      b.style.cssText = `flex:1;padding:6px 0;border-radius:8px;border:none;cursor:pointer;font-size:12.5px;
        background:${h === this.custom.hat ? '#5a7ab8' : 'rgba(255,255,255,.12)'};color:#fff`;
      b.addEventListener('click', () => {
        this.custom.hat = h; saveCustomization(this.custom);
        [...hatsEl.children].forEach((x) => { x.style.background = x.dataset.hat === h ? '#5a7ab8' : 'rgba(255,255,255,.12)'; });
      });
      hatsEl.appendChild(b);
    }

    el.querySelector('#m-solo').addEventListener('click', () => onSolo());
    el.querySelector('#m-host').addEventListener('click', () => onHost());
    el.querySelector('#m-join').addEventListener('click', () => {
      const code = el.querySelector('#m-code').value.trim().toUpperCase();
      if (code.length === 4) onJoin(code);
      else this.status('enter a 4-letter room code');
    });
    el.querySelector('#m-refresh').addEventListener('click', () => this.refreshLobbies(listLobbies, onJoin));
    this._listLobbies = listLobbies;
    this._onJoin = onJoin;
  }

  async refreshLobbies(listLobbies = this._listLobbies, onJoin = this._onJoin) {
    const box = this.el.querySelector('#m-lobbies');
    box.innerHTML = '<div style="color:#7a8db0;font-size:13px">loading…</div>';
    try {
      const lobbies = await listLobbies();
      box.innerHTML = '';
      if (!lobbies.length) {
        box.innerHTML = '<div style="color:#7a8db0;font-size:13px">no open lobbies — host one!</div>';
        return;
      }
      for (const lobby of lobbies) {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;justify-content:space-between;align-items:center;
          background:rgba(255,255,255,.08);border-radius:8px;padding:7px 12px;margin-bottom:5px;
          cursor:pointer;font-size:14px;pointer-events:auto`;
        row.innerHTML = `<span>${escapeHtml(lobby.name)} · <b>${lobby.code}</b></span>
          <span style="color:#9fb3d8">${lobby.playerCount}/4 · ${lobby.level}</span>`;
        row.addEventListener('click', () => onJoin(lobby.code));
        box.appendChild(row);
      }
    } catch (err) {
      box.innerHTML = `<div style="color:#ff8a7a;font-size:13px">lobby list failed: ${escapeHtml(err.message)}</div>`;
    }
  }

  status(text) { this.el.querySelector('#m-status').textContent = text; }
  hide() { this.el.style.display = 'none'; }
  show() { this.el.style.display = 'flex'; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
