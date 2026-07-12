// Pointer-lock mouse look + WASD + arm buttons → sim input struct.
export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.yaw = 0;
    this.pitch = 0.15;
    this.keys = new Set();
    this.grabL = false;
    this.grabR = false;
    this.locked = false;
    this.onEmote = null; // wired by emote wheel

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0028;
      this.pitch = Math.max(-1.2, Math.min(1.35, this.pitch + e.movementY * 0.0028));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.grabL = true;
      if (e.button === 2) this.grabR = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.grabL = false;
      if (e.button === 2) this.grabR = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear(); this.grabL = false; this.grabR = false;
    });
  }

  /** Camera-relative input for the sim. Move axes: x=right, z=forward. */
  sample() {
    let x = 0, z = 0;
    if (this.keys.has('KeyW')) z += 1;
    if (this.keys.has('KeyS')) z -= 1;
    if (this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('KeyD')) x += 1;
    return {
      moveX: x, moveZ: z,
      yaw: this.yaw, pitch: this.pitch,
      jump: this.keys.has('Space'),
      grabL: this.grabL, grabR: this.grabR,
    };
  }
}
