// Fixed-step authoritative simulation. Runs identically headless (Node, gates)
// and in the browser (host). Deterministic construction order everywhere.
import { TUNING } from './tuning.js';
import { createRagdoll } from './ragdoll.js';
import { BalanceController } from './balance.js';
import { ArmsController } from './arms.js';
import { v3 } from './math3.js';

export const GROUP_WORLD = ((1 << 8) << 16) | 0xffff;

export const DEFAULT_INPUT = () => ({
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  jump: false, grabL: false, grabR: false,
});

export class Sim {
  constructor(RAPIER) {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World(v3(0, TUNING.gravity, 0));
    this.world.timestep = TUNING.dt;
    this.tick = 0;
    this.players = [null, null, null, null]; // slot-indexed, fixed size
    // Slots with a human attached. The RECIPE always builds 4 ragdolls
    // (parked off-map when unused) so world structure never changes on
    // join/leave — that's what keeps manifest hashes stable (§5.3).
    this.activeSlots = new Set();
    this.entities = [];      // creation-order registry: {id, body, type}
    this.manifest = [];      // creation-order ids — hashed for §5.3 guard
    this.accumulator = 0;
  }

  /** Register a body in the deterministic entity registry. */
  register(body, id, type) {
    this.entities.push({ id, body, type });
    this.manifest.push(`${id}:${type}`);
    return body;
  }

  manifestHash() {
    // FNV-1a 32-bit ×2 seeds — cheap, synchronous, deterministic.
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x811c9dc5;
    const s = this.manifest.join('|');
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = ((h1 ^ c) * 0x01000193) >>> 0;
      h2 = ((h2 ^ ((c << 1) | 1)) * 0x01000193) >>> 0;
    }
    return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  }

  addGround(halfExtent = 40) {
    const body = this.world.createRigidBody(this.RAPIER.RigidBodyDesc.fixed());
    const col = this.RAPIER.ColliderDesc.cuboid(halfExtent, 0.5, halfExtent)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.0)
      .setCollisionGroups(GROUP_WORLD);
    this.world.createCollider(col, body);
    this.register(body, 'ground', 'static');
    return body;
  }

  addPlayer(slot, spawnPos, yaw = 0) {
    if (this.players[slot]) throw new Error(`slot ${slot} occupied`);
    const ragdoll = createRagdoll(this.RAPIER, this.world, slot, spawnPos, yaw);
    for (const [i, body] of ragdoll.partList.entries()) {
      this.register(body, `p${slot}b${i}`, 'bodypart');
    }
    const balance = new BalanceController(ragdoll, slot);
    const arms = new ArmsController(ragdoll, slot, balance);
    const player = { slot, ragdoll, balance, arms, input: DEFAULT_INPUT(), spawn: { ...spawnPos } };
    this.players[slot] = player;
    return player;
  }

  /** Human joins slot: teleport parked ragdoll in, activate. */
  activatePlayer(slot, pos) {
    this.activeSlots.add(slot);
    this.respawnPlayer(slot, pos);
  }

  /** Human leaves: release grips, park the ragdoll off-map, deactivate. */
  deactivatePlayer(slot) {
    this.activeSlots.delete(slot);
    const p = this.players[slot];
    if (!p) return;
    p.arms.releaseAll(this.world);
    p.input = DEFAULT_INPUT();
    this.respawnPlayer(slot, { x: slot * 4 - 6, y: 0.2, z: -120 });
  }

  setInput(slot, input) {
    const p = this.players[slot];
    if (p) p.input = { ...p.input, ...input };
  }

  respawnPlayer(slot, pos) {
    const p = this.players[slot];
    if (!p) return;
    p.arms.releaseAll(this.world);
    // Teleport all parts preserving the rest-pose offsets around the pelvis.
    for (const [i, body] of p.ragdoll.partList.entries()) {
      const rest = p.arms.restOffsets[i];
      body.setTranslation(
        { x: pos.x + rest.x, y: pos.y + rest.y, z: pos.z + rest.z },
        true,
      );
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel(v3(), true);
      body.setAngvel(v3(), true);
    }
    p.balance.state = 'active';
    p.balance.stateTimer = 0;
  }

  /** One fixed 60 Hz tick. Call from an accumulator loop, never with raw dt. */
  step() {
    const dt = TUNING.dt;
    for (const p of this.players) {
      if (!p) continue;
      p.arms.update(this.RAPIER, this.world, p.input, dt, this);
      p.balance.update(this.RAPIER, this.world, p.input, dt);
    }
    this.world.step();
    for (const p of this.players) {
      if (!p) continue;
      // Reset per-tick forces (rapier accumulates addForce until reset).
      for (const body of p.ragdoll.partList) { body.resetForces(true); body.resetTorques(true); }
    }
    this.tick++;
  }

  /** Advance with wall-clock time; steps 0..n fixed ticks. */
  advance(elapsed, onTick) {
    this.accumulator = Math.min(this.accumulator + elapsed, 0.25); // spiral-of-death guard
    while (this.accumulator >= TUNING.dt) {
      this.step();
      onTick?.(this.tick);
      this.accumulator -= TUNING.dt;
    }
  }
}
