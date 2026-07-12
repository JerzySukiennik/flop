// Active-ragdoll factory: 13 rigid bodies + 12 joints.
// Spherical joints are passive constraints (JS bindings expose no spherical
// motors) — orientation control is applied as PD torque pairs in balance.js.
// Elbows/knees/ankles are revolute with built-in rapier position motors.
import { TUNING } from './tuning.js';
import { v3 } from './math3.js';

// Rest pose: standing at origin, facing +Z, arms hanging. All local joint
// anchors derive from these world-space numbers (orientations = identity).
// Creation order of PARTS and JOINTS is load-bearing for determinism (§5.3).
export const PARTS = [
  // name, shape, [dims], center, massKey
  { name: 'pelvis', shape: 'capsule', dims: [0.06, 0.14], pos: v3(0, 0.98, 0), mass: 'pelvis' },
  { name: 'chest', shape: 'capsule', dims: [0.12, 0.15], pos: v3(0, 1.30, 0), mass: 'chest' },
  { name: 'head', shape: 'ball', dims: [0.11], pos: v3(0, 1.62, 0), mass: 'head' },
  { name: 'upperArmL', shape: 'capsule', dims: [0.10, 0.05], pos: v3(-0.26, 1.26, 0), mass: 'upperArm' },
  { name: 'forearmL', shape: 'capsule', dims: [0.11, 0.045], pos: v3(-0.26, 0.99, 0), mass: 'forearm' },
  { name: 'upperArmR', shape: 'capsule', dims: [0.10, 0.05], pos: v3(0.26, 1.26, 0), mass: 'upperArm' },
  { name: 'forearmR', shape: 'capsule', dims: [0.11, 0.045], pos: v3(0.26, 0.99, 0), mass: 'forearm' },
  { name: 'thighL', shape: 'capsule', dims: [0.14, 0.07], pos: v3(-0.10, 0.69, 0), mass: 'thigh' },
  { name: 'shinL', shape: 'capsule', dims: [0.14, 0.055], pos: v3(-0.10, 0.27, 0), mass: 'shin' },
  { name: 'footL', shape: 'cuboid', dims: [0.05, 0.035, 0.11], pos: v3(-0.10, 0.04, 0.03), mass: 'foot' },
  { name: 'thighR', shape: 'capsule', dims: [0.14, 0.07], pos: v3(0.10, 0.69, 0), mass: 'thigh' },
  { name: 'shinR', shape: 'capsule', dims: [0.14, 0.055], pos: v3(0.10, 0.27, 0), mass: 'shin' },
  { name: 'footR', shape: 'cuboid', dims: [0.05, 0.035, 0.11], pos: v3(0.10, 0.04, 0.03), mass: 'foot' },
];

export const JOINTS = [
  // Ball joints (PD-driven): { name, type:'ball', parent, child, anchor(world), motor }
  { name: 'spine', type: 'ball', parent: 'pelvis', child: 'chest', anchor: v3(0, 1.14, 0), motor: 'spine' },
  { name: 'neck', type: 'ball', parent: 'chest', child: 'head', anchor: v3(0, 1.50, 0), motor: 'neck' },
  { name: 'shoulderL', type: 'ball', parent: 'chest', child: 'upperArmL', anchor: v3(-0.26, 1.40, 0), motor: 'shoulder' },
  { name: 'shoulderR', type: 'ball', parent: 'chest', child: 'upperArmR', anchor: v3(0.26, 1.40, 0), motor: 'shoulder' },
  { name: 'hipL', type: 'ball', parent: 'pelvis', child: 'thighL', anchor: v3(-0.10, 0.90, 0), motor: 'hip' },
  { name: 'hipR', type: 'ball', parent: 'pelvis', child: 'thighR', anchor: v3(0.10, 0.90, 0), motor: 'hip' },
  // Revolute joints (rapier motors): axis X, limits in radians.
  // Elbow flexes forward = negative angle; knee flexes back = positive.
  { name: 'elbowL', type: 'hinge', parent: 'upperArmL', child: 'forearmL', anchor: v3(-0.26, 1.12, 0), limits: [-2.5, 0], motor: 'elbow' },
  { name: 'elbowR', type: 'hinge', parent: 'upperArmR', child: 'forearmR', anchor: v3(0.26, 1.12, 0), limits: [-2.5, 0], motor: 'elbow' },
  { name: 'kneeL', type: 'hinge', parent: 'thighL', child: 'shinL', anchor: v3(-0.10, 0.48, 0), limits: [0, 2.4], motor: 'knee' },
  { name: 'kneeR', type: 'hinge', parent: 'thighR', child: 'shinR', anchor: v3(0.10, 0.48, 0), limits: [0, 2.4], motor: 'knee' },
  { name: 'ankleL', type: 'hinge', parent: 'shinL', child: 'footL', anchor: v3(-0.10, 0.09, 0), limits: [-0.5, 0.5], motor: 'ankle' },
  { name: 'ankleR', type: 'hinge', parent: 'shinR', child: 'footR', anchor: v3(0.10, 0.09, 0), limits: [-0.5, 0.5], motor: 'ankle' },
];

// Hand grip points, local to forearm bodies (at the wrist tip).
export const HAND_LOCAL = { L: v3(0, -0.155, 0), R: v3(0, -0.155, 0) };

export function playerGroups(playerIndex) {
  const membership = 1 << playerIndex;
  const filter = 0xffff & ~membership; // everything except own body parts
  return (membership << 16) | filter;
}

/**
 * Builds one ragdoll. Deterministic: iterates PARTS then JOINTS in array order.
 * @returns {{ bodies: Record<string, RigidBody>, joints: Record<string, {joint, def}>, partList: RigidBody[] }}
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
    let col;
    if (part.shape === 'capsule') col = RAPIER.ColliderDesc.capsule(part.dims[0], part.dims[1]);
    else if (part.shape === 'ball') col = RAPIER.ColliderDesc.ball(part.dims[0]);
    else col = RAPIER.ColliderDesc.cuboid(...part.dims);
    col.setMass(T[part.mass].mass)
      .setFriction(part.name.startsWith('foot') ? T.footFriction : T.friction)
      .setCollisionGroups(groups);
    world.createCollider(col, body);
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
    let jd;
    if (def.type === 'ball') {
      jd = RAPIER.JointData.spherical(a1, a2);
    } else {
      jd = RAPIER.JointData.revolute(a1, a2, v3(1, 0, 0));
    }
    const joint = world.createImpulseJoint(jd, parent, child, true);
    joint.setContactsEnabled(false);
    if (def.type === 'hinge') {
      joint.setLimits(def.limits[0], def.limits[1]);
      const m = TUNING.motors[def.motor];
      joint.configureMotorPosition(0, m.stiffness, m.damping);
    }
    joints[def.name] = { joint, def };
  }

  return { bodies, joints, partList };
}

function subV(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
