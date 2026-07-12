// In-game HUD: banner messages, room code, roster, controls hint.
export class Hud {
  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;font-family:system-ui,sans-serif;z-index:500;display:none';
    this.root.innerHTML = `
      <div id="hud-banner" style="position:absolute;top:10%;left:50%;transform:translateX(-50%);
        background:rgba(18,20,26,.82);color:#fff;padding:10px 22px;border-radius:12px;
        font-size:20px;font-weight:600;opacity:0;transition:opacity .3s"></div>
      <div id="hud-room" style="position:absolute;top:14px;right:16px;background:rgba(18,20,26,.7);
        color:#9be7ff;padding:6px 14px;border-radius:9px;font-size:15px;font-weight:700;letter-spacing:2px"></div>
      <div id="hud-roster" style="position:absolute;top:14px;left:16px;display:flex;gap:6px"></div>
      <div id="hud-controls" style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);
        color:rgba(255,255,255,.55);font-size:12.5px;background:rgba(18,20,26,.45);
        padding:5px 14px;border-radius:8px">WASD move · mouse look · LMB/RMB arms · Space jump · Q emotes · C free-cam</div>
      <div id="hud-center" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.65)"></div>`;
    document.body.appendChild(this.root);
    this.banner = this.root.querySelector('#hud-banner');
    this.roomEl = this.root.querySelector('#hud-room');
    this.rosterEl = this.root.querySelector('#hud-roster');
    this._bannerTimer = null;
  }

  show() { this.root.style.display = 'block'; }
  hide() { this.root.style.display = 'none'; }

  message(text, ms = 2600) {
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.banner.style.opacity = '0'; }, ms);
  }

  setRoom(code) { this.roomEl.textContent = code ? `ROOM ${code}` : 'OFFLINE'; }

  setRoster(roster, colors, localSlot) {
    this.rosterEl.innerHTML = '';
    for (const entry of roster) {
      const chip = document.createElement('div');
      const c = `#${(colors[entry.slot] ?? 0xffffff).toString(16).padStart(6, '0')}`;
      chip.style.cssText = `background:rgba(18,20,26,.7);border-left:5px solid ${c};color:#fff;
        padding:5px 10px;border-radius:7px;font-size:13px`;
      chip.textContent = `P${entry.slot + 1}${entry.slot === localSlot ? ' (you)' : ''}`;
      this.rosterEl.appendChild(chip);
    }
  }
}
