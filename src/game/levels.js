// Declarative level instancer + runtime. DETERMINISM CONTRACT (§5.3):
// - iterate JSON arrays in order, never object keys
// - no randomness, no awaits, no conditional body creation
// - every created body registers in sim.entities in creation order
import { TUNING } from './tuning.js';
import { GROUP_WORLD } from './sim.js';
import { v3 } from './math3.js';

const DEG = Math.PI / 180;

function quatFromEuler(e) {
  if (!e) return { x: 0, y: 0, z: 0, w: 1 };
  const [rx, ry, rz] = e.map((d) => d * DEG / 2);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

function makeCollider(RAPIER, def) {
  let col;
  if (def.shape === 'ball') col = RAPIER.ColliderDesc.ball(def.size[0]);
  else if (def.shape === 'cylinder') col = RAPIER.ColliderDesc.cylinder(def.size[0], def.size[1]);
  else if (def.shape === 'capsule') col = RAPIER.ColliderDesc.capsule(def.size[0], def.size[1]);
  else col = RAPIER.ColliderDesc.cuboid(def.size[0], def.size[1], def.size[2]);
  col.setFriction(def.friction ?? 0.8).setCollisionGroups(GROUP_WORLD);
  if (def.restitution) col.setRestitution(def.restitution);
  return col;
}

/**
 * Instantiate a level into the sim. Returns a LevelRuntime.
 * Every peer runs this with the same JSON → identical world (§5.3).
 */
export function instantiateLevel(RAPIER, sim, level) {
  const byId = new Map(); // "s:id"/"d:id" → body

  for (const def of level.statics ?? []) {
    const desc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(...def.pos).setRotation(quatFromEuler(def.rot));
    const body = sim.world.createRigidBody(desc);
    sim.world.createCollider(makeCollider(RAPIER, def), body);
    body.userData = { kind: 'static', id: def.id, grabbable: def.grabbable !== false };
    sim.register(body, `s:${def.id}`, 'static');
    byId.set(`s:${def.id}`, body);
  }

  for (const def of level.dynamics ?? []) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...def.pos).setRotation(quatFromEuler(def.rot))
      .setLinearDamping(def.linDamp ?? 0.05).setAngularDamping(def.angDamp ?? 0.1);
    const body = sim.world.createRigidBody(desc);
    const col = makeCollider(RAPIER, def);
    col.setMass(def.mass);
    sim.world.createCollider(col, body);
    body.userData = { kind: 'prop', id: def.id, grabbable: def.grabbable !== false };
    sim.register(body, `d:${def.id}`, 'prop');
    byId.set(`d:${def.id}`, body);
  }

  // Ropes: chains of capsule links joined by sphericals, hung from a static
  // anchor; optional end attachment to a dynamic body.
  for (const def of level.ropes ?? []) {
    const segLen = def.length / def.segments;
    let prev = null;
    for (let i = 0; i < def.segments; i++) {
      const y = def.from[1] - segLen * (i + 0.5);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(def.from[0], y, def.from[2])
        .setLinearDamping(0.2).setAngularDamping(0.4);
      const body = sim.world.createRigidBody(desc);
      const col = RAPIER.ColliderDesc.capsule(segLen / 2 - 0.02, def.radius ?? 0.045)
        .setFriction(1.0).setCollisionGroups(GROUP_WORLD).setMass(def.segmentMass ?? 1.5);
      sim.world.createCollider(col, body);
      body.userData = { kind: 'prop', id: `${def.id}_${i}`, grabbable: true };
      sim.register(body, `r:${def.id}:${i}`, 'prop');
      const jd = prev === null
        ? RAPIER.JointData.spherical(v3(0, 0, 0), v3(0, segLen / 2, 0))
        : RAPIER.JointData.spherical(v3(0, -segLen / 2, 0), v3(0, segLen / 2, 0));
      const parent = prev === null
        ? (byId.get(def.anchor) ?? anchorBody(RAPIER, sim, def))
        : prev;
      // anchor joint: static parent anchors at rope origin (world → local ok: statics sit at identity or known rot)
      if (prev === null) {
        const pt = parent.translation();
        jd.anchor1 = { x: def.from[0] - pt.x, y: def.from[1] - pt.y, z: def.from[2] - pt.z };
      }
      sim.world.createImpulseJoint(jd, parent, body, true);
      prev = body;
    }
    if (def.attach) {
      const target = byId.get(def.attach);
      const tp = target.translation();
      const endY = def.from[1] - def.length;
      const jd = RAPIER.JointData.spherical(
        v3(0, -segLen / 2, 0),
        { x: def.from[0] - tp.x, y: endY - tp.y, z: def.from[2] - tp.z },
      );
      sim.world.createImpulseJoint(jd, prev, target, true);
    }
    byId.set(`r:${def.id}:last`, prev);
  }

  // Contraption joints between placed bodies.
  const joints = new Map();
  for (const def of level.joints ?? []) {
    const a = byId.get(def.a), b = byId.get(def.b);
    const pa = a.translation(), pb = b.translation();
    const anchorA = { x: def.anchor[0] - pa.x, y: def.anchor[1] - pa.y, z: def.anchor[2] - pa.z };
    const anchorB = { x: def.anchor[0] - pb.x, y: def.anchor[1] - pb.y, z: def.anchor[2] - pb.z };
    let jd;
    if (def.type === 'revolute') jd = RAPIER.JointData.revolute(anchorA, anchorB, v3(...def.axis));
    else if (def.type === 'prismatic') jd = RAPIER.JointData.prismatic(anchorA, anchorB, v3(...def.axis));
    else jd = RAPIER.JointData.spherical(anchorA, anchorB);
    const joint = sim.world.createImpulseJoint(jd, a, b, true);
    joint.setContactsEnabled(false);
    if (def.limits && joint.setLimits) joint.setLimits(def.limits[0], def.limits[1]);
    if (def.motor) joint.configureMotorPosition(def.motor.target ?? 0, def.motor.stiffness, def.motor.damping);
    joints.set(def.id, { joint, def, a, b });
  }

  return new LevelRuntime(RAPIER, sim, level, byId, joints);
}

function anchorBody(RAPIER, sim, def) {
  const body = sim.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(def.from[0], def.from[1], def.from[2]),
  );
  body.userData = { kind: 'static', id: `${def.id}_anchor`, grabbable: false };
  sim.register(body, `ra:${def.id}`, 'static');
  return body;
}

/**
 * Host-side level logic, run INSIDE the fixed step (deterministic).
 * Triggers are evaluated by AABB tests against player pelvises — no physics
 * event queue, no ordering hazards.
 */
export class LevelRuntime {
  constructor(RAPIER, sim, level, byId, joints) {
    this.RAPIER = RAPIER;
    this.sim = sim;
    this.level = level;
    this.byId = byId;
    this.joints = joints;
    this.checkpointIndex = 0;
    this.leverState = new Map();   // leverId → bool
    this.portalTimer = null;       // {target, ticksLeft}
    this.onEvent = null;           // (ev) => {} — host broadcasts these
    this.valveProgress = new Map();
  }

  spawnPoint(slotOrCheckpoint) {
    const cps = this.level.checkpoints ?? [];
    const cp = cps[Math.min(this.checkpointIndex, cps.length - 1)] ?? { pos: [0, 0.1, 0] };
    const offsets = [[0, 0], [0.9, 0], [0, 0.9], [0.9, 0.9]];
    const o = offsets[slotOrCheckpoint % 4];
    return { x: cp.pos[0] + o[0], y: cp.pos[1] + 0.1, z: cp.pos[2] + o[1] };
  }

  update(dt) {
    const sim = this.sim;

    // --- water buoyancy ---
    const water = this.level.water;
    if (water) {
      for (const e of sim.entities) {
        if (e.type !== 'prop' && e.type !== 'bodypart') continue;
        const body = e.body;
        const p = body.translation();
        if (p.x < water.min[0] || p.x > water.max[0] || p.z < water.min[2] || p.z > water.max[2]) continue;
        const depth = water.y - p.y;
        if (depth <= 0) continue;
        const frac = Math.min(1, depth / 0.5);
        const mass = body.mass();
        const buoy = e.type === 'bodypart' ? 1.25 : (water.buoyancy ?? 1.1);
        body.addForce(v3(0, mass * 9.81 * frac * buoy, 0), true);
        const vel = body.linvel();
        body.addForce(v3(-vel.x * mass * 0.9 * frac, -vel.y * mass * 1.6 * frac, -vel.z * mass * 0.9 * frac), true);
      }
    }

    // --- levers: revolute joints flip past threshold → toggle targets ---
    for (const def of this.level.levers ?? []) {
      const j = this.joints.get(def.joint);
      if (!j) continue;
      const angle = hingeAngle(j);
      const wasActive = this.leverState.get(def.id) ?? false;
      // Schmitt trigger: engage past threshold, disengage only well below it —
      // a wobbling lever must not machine-gun the contraption.
      const active = wasActive ? angle > def.threshold - 0.45 : angle > def.threshold + 0.1;
      if (active !== wasActive) {
        this.leverState.set(def.id, active);
        this._applyAction(def, active);
        this.onEvent?.({ t: 'lever', id: def.id, active });
      }
    }

    // --- valves: accumulated wheel rotation opens a gate ---
    for (const def of this.level.valves ?? []) {
      const j = this.joints.get(def.joint);
      if (!j) continue;
      const angle = hingeAngle(j);
      const prev = this.valveProgress.get(def.id) ?? 0;
      const progress = Math.max(prev, Math.min(1, angle / def.turns));
      if (progress !== prev) {
        this.valveProgress.set(def.id, progress);
        const gate = this.joints.get(def.gateJoint);
        if (gate) {
          const m = def.gateMotor;
          gate.joint.configureMotorPosition(
            m.closed + (m.open - m.closed) * progress, m.stiffness, m.damping,
          );
        }
        if (progress >= 1 && prev < 1) this.onEvent?.({ t: 'valve', id: def.id });
      }
    }

    // --- triggers: checkpoints, portals, respawn bounds ---
    for (let slot = 0; slot < 4; slot++) {
      const player = sim.players[slot];
      if (!player || !sim.activeSlots.has(slot)) continue; // parked ragdolls don't trip triggers
      const p = player.ragdoll.bodies.pelvis.translation();

      if (p.y < (this.level.killY ?? -8)) {
        sim.respawnPlayer(slot, this.spawnPoint(slot));
        this.onEvent?.({ t: 'respawn', slot });
        continue;
      }

      const cps = this.level.checkpoints ?? [];
      for (let i = this.checkpointIndex + 1; i < cps.length; i++) {
        if (inBox(p, cps[i])) {
          this.checkpointIndex = i;
          this.onEvent?.({ t: 'checkpoint', index: i });
        }
      }

      for (const portal of this.level.portals ?? []) {
        if (inBox(p, portal)) {
          if (!this.portalTimer || this.portalTimer.target !== portal.target) {
            this.portalTimer = { target: portal.target, ticksLeft: 300 };
            this.onEvent?.({ t: 'portalArmed', target: portal.target, seconds: 5 });
          }
        }
      }
    }

    if (this.portalTimer) {
      this.portalTimer.ticksLeft--;
      if (this.portalTimer.ticksLeft <= 0) {
        const target = this.portalTimer.target;
        this.portalTimer = null;
        this.onEvent?.({ t: 'levelChange', target });
      }
    }
  }

  _applyAction(def, active) {
    const action = def.action;
    if (!action) return;
    const j = this.joints.get(action.joint);
    if (!j) return;
    const m = action;
    j.joint.configureMotorPosition(
      active ? m.on : m.off, m.stiffness, m.damping,
    );
  }
}

function hingeAngle(j) {
  // relative rotation about hinge axis approximated from quats (axis = local X)
  const qa = j.a.rotation(), qb = j.b.rotation();
  // q_rel = conj(qa)*qb → twist around X
  const rx = qa.w * qb.x - qa.x * qb.w - qa.y * qb.z + qa.z * qb.y;
  const rw = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;
  return 2 * Math.atan2(rx, rw);
}

function inBox(p, box) {
  const [x, y, z] = box.pos, [hx, hy, hz] = box.size;
  return Math.abs(p.x - x) <= hx && Math.abs(p.y - y) <= hy && Math.abs(p.z - z) <= hz;
}
