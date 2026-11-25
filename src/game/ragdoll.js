// Active-ragdoll factory — "bean" rig: 5 rigid bodies, 4 joints.
// One chunky torso capsule (with a head collider welded on), two
// single-segment arms, two stubby legs. All ball joints are passive
// constraints driven by PD torque pairs in balance.js (JS bindings expose
// no spherical motors).
import { TUNING } from './tuning.js';
import { v3 } from './math3.js';

// Rest pose: standing at origin, facing +Z. Creation order of PARTS and
// JOINTS is load-bearing for determinism (§5.3).
// Torso spans ~0.33..1.57 m; visual/collider head ball sits at 1.62.
export const PARTS = [
  { name: 'torso', shape: 'capsule', dims: [0.32, 0.30], pos: v3(0, 0.95, 0), mass: 'torso' },
  { name: 'armL', shape: 'capsule', dims: [0.17, 0.075], pos: v3(-0.38, 1.02, 0), mass: 'arm' },
  { name: 'armR', shape: 'capsule', dims: [0.17, 0.075], pos: v3(0.38, 1.02, 0), mass: 'arm' },
  { name: 'legL', shape: 'capsule', dims: [0.15, 0.10], pos: v3(-0.15, 0.25, 0), mass: 'leg' },
  { name: 'legR', shape: 'capsule', dims: [0.15, 0.10], pos: v3(0.15, 0.25, 0), mass: 'leg' },
];

export const NUM_BODIES = PARTS.length;

// Head: extra ball collider welded to the torso body (not a separate body).
export const HEAD_LOCAL = { x: 0, y: 0.67, z: 0, r: 0.21 };

export const JOINTS = [
  { name: 'shoulderL', type: 'ball', parent: 'torso', child: 'armL', anchor: v3(-0.36, 1.25, 0), motor: 'shoulder' },
  { name: 'shoulderR', type: 'ball', parent: 'torso', child: 'armR', anchor: v3(0.36, 1.25, 0), motor: 'shoulder' },
  { name: 'hipL', type: 'ball', parent: 'torso', child: 'legL', anchor: v3(-0.15, 0.44, 0), motor: 'hip' },
  { name: 'hipR', type: 'ball', parent: 'torso', child: 'legR', anchor: v3(0.15, 0.44, 0), motor: 'hip' },
];

// Hand grip points, local to arm bodies (at the tip).
export const HAND_LOCAL = { L: v3(0, -0.245, 0), R: v3(0, -0.245, 0) };

export function playerGroups(playerIndex) {
  const membership = 1 << playerIndex;
  const filter = 0xffff & ~membership; // everything except own body parts
  return (membership << 16) | filter;
}

/**
 * Builds one bean. Deterministic: iterates PARTS then JOINTS in array order.
 */
export function createRagdoll(RAPIER, world, playerIndex, spawnPos, yaw = 0) {
  const T = TUNING.body;
  const groups = playerGroups(playerIndex);
  const bodies = {};
  const partList = [];

  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const spawnRot = { x: 0, y: sy, z: 0, w: cy };
  const rotate = (p) => ({
    x: spawnPos.x + (cy * cy - sy * sy) * p.x + 2 * sy * cy * p.z,
    y: spawnPos.y + p.y,
    z: spawnPos.z - 2 * sy * cy * p.x + (cy * cy - sy * sy) * p.z,
  });

  for (const part of PARTS) {
    const p = rotate(part.pos);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation(spawnRot)
      .setLinearDamping(T.linearDamping)
      .setAngularDamping(T.angularDamping)
      .setCanSleep(false);
    const body = world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.capsule(part.dims[0], part.dims[1])
      .setMass(T[part.mass].mass)
      .setFriction(part.name.startsWith('leg') ? T.footFriction : T.friction)
      .setCollisionGroups(groups);
    world.createCollider(col, body);
    if (part.name === 'torso') {
      const headCol = RAPIER.ColliderDesc.ball(HEAD_LOCAL.r)
        .setTranslation(HEAD_LOCAL.x, HEAD_LOCAL.y, HEAD_LOCAL.z)
        .setMass(T.head.mass)
        .setFriction(T.friction)
        .setCollisionGroups(groups);
      world.createCollider(headCol, body);
    }
    body.userData = { kind: 'bodypart', player: playerIndex, part: part.name, grabbable: true };
    bodies[part.name] = body;
    partList.push(body);
  }

  const partPos = Object.fromEntries(PARTS.map((p) => [p.name, p.pos]));
  const joints = {};
  for (const def of JOINTS) {
    const parent = bodies[def.parent];
    const child = bodies[def.child];
    const a1 = subV(def.anchor, partPos[def.parent]);
    const a2 = subV(def.anchor, partPos[def.child]);
    const jd = RAPIER.JointData.spherical(a1, a2);
    const joint = world.createImpulseJoint(jd, parent, child, true);
    joint.setContactsEnabled(false);
    joints[def.name] = { joint, def };
  }

  return { bodies, joints, partList };
}

function subV(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
