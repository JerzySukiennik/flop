// Radial emote/ping wheel (add-on #1). Hold Q → wheel; release → send.
const EMOTES = ['👋', '😂', '😱', '❤️', '👉', '🎉'];

export class EmoteWheel {
  constructor(onEmote) {
    this.onEmote = onEmote;
    this.open = false;
    this.selected = -1;
    this.el = document.createElement('div');
    this.el.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
      width:260px;height:260px;display:none;z-index:600;pointer-events:none`;
    for (const [i, emoji] of EMOTES.entries()) {
      const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const item = document.createElement('div');
      item.textContent = emoji;
      item.style.cssText = `position:absolute;left:${130 + Math.cos(a) * 92 - 28}px;
        top:${130 + Math.sin(a) * 92 - 28}px;width:56px;height:56px;border-radius:50%;
        background:rgba(18,20,26,.85);display:flex;align-items:center;justify-content:center;
        font-size:30px;transition:transform .08s,background .08s`;
      this.el.appendChild(item);
    }
    document.body.appendChild(this.el);

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ' && !e.repeat) { this.open = true; this.el.style.display = 'block'; }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyQ') {
        this.el.style.display = 'none';
        this.open = false;
        if (this.selected >= 0) this.onEmote(EMOTES[this.selected]);
        this.selected = -1;
        this._highlight();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.open) return;
      // pointer-locked: accumulate movement into a virtual offset
      this._vx = (this._vx ?? 0) + (e.movementX ?? 0);
      this._vy = (this._vy ?? 0) + (e.movementY ?? 0);
      const len = Math.hypot(this._vx, this._vy);
      if (len < 20) { this.selected = -1; this._highlight(); return; }
      let angle = Math.atan2(this._vy, this._vx) + Math.PI / 2;
      if (angle < 0) angle += Math.PI * 2;
      this.selected = Math.round(angle / (Math.PI * 2 / EMOTES.length)) % EMOTES.length;
      this._highlight();
    });
  }

  _highlight() {
    [...this.el.children].forEach((c, i) => {
      c.style.transform = i === this.selected ? 'scale(1.25)' : 'scale(1)';
      c.style.background = i === this.selected ? 'rgba(80,140,255,.9)' : 'rgba(18,20,26,.85)';
    });
    if (this.open) { /* reset accumulation drift slowly */ }
  }
}
