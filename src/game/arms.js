// Arm aiming + grab. While LMB/RMB held, that arm's motors drive the hand
// toward the camera-aim point; on hand contact with a grabbable body a
// spherical joint forms. Joints break when the solver can't hold them
// (anchor separation > grabBreakDistance) — heavy things rip free naturally.
import { TUNING } from './tuning.js';
import { PARTS, HAND_LOCAL } from './ragdoll.js';
import {
  v3, vAdd, vSub, vScale, vLen, vNorm, vCross, vDot,
  qMul, qConj, qRotate, qFromAxisAngle, qNormalize, qIdent, yawQuat,
} from './math3.js';

export class ArmsController {
  constructor(ragdoll, playerIndex, balance) {
    this.ragdoll = ragdoll;
    this.playerIndex = playerIndex;
    this.balance = balance;
    this.grabs = { L: null, R: null }; // {joint, otherBody, ownAnchorLocal, otherAnchorLocal}
    this.restOffsets = PARTS.map((p) => ({ ...p.pos }));
    // Grappling hook (hub toy, add-on #3): spring joint hand → hit point.
    this.grapple = { has: false, joint: null, anchorBody: null, prevBtn: false, target: null };
  }

  /** Hub-only grappling hook. Runs inside the fixed step (host authority). */
  updateGrapple(RAPIER, world, input, sim) {
    const level = sim.levelRuntime?.level;
    const g = this.grapple;
    if (!level?.grappleAllowed) {
      if (g.joint) { world.removeImpulseJoint(g.joint, true); g.joint = null; }
      g.has = false;
      return;
    }
    const pelvis = this.ragdoll.bodies.pelvis.translation();
    const zone = level.grappleZone;
    if (!g.has && zone
      && Math.abs(pelvis.x - zone.pos[0]) <= zone.size[0]
      && Math.abs(pelvis.y - zone.pos[1]) <= zone.size[1] + 1
      && Math.abs(pelvis.z - zone.pos[2]) <= zone.size[2]) {
      g.has = true;
      sim.levelRuntime.onEvent?.({ t: 'grapplePickup', slot: this.playerIndex });
    }
    const pressed = input.grapple && !g.prevBtn;
    g.prevBtn = input.grapple;
    if (!g.has || !pressed) return;
    if (g.joint) {
      world.removeImpulseJoint(g.joint, true);
      g.joint = null;
      g.target = null;
      return;
    }
    const head = this.ragdoll.bodies.head;
    const origin = head.translation();
    const dir = qRotate(
      qMul(yawQuat(input.yaw), qFromAxisAngle(v3(1, 0, 0), -input.pitch)),
      v3(0, 0, 1),
    );
    const groups = ((1 << this.playerIndex) << 16) | (0xffff & ~(1 << this.playerIndex));
    const ray = new RAPIER.Ray(
      { x: origin.x + dir.x * 0.4, y: origin.y + dir.y * 0.4, z: origin.z + dir.z * 0.4 }, dir,
    );
    const hit = world.castRay(ray, 20, true, undefined, groups);
    if (!hit) return;
    const other = hit.collider.parent();
    if (!other) return;
    const hitPoint = {
      x: ray.origin.x + ray.dir.x * hit.timeOfImpact,
      y: ray.origin.y + ray.dir.y * hit.timeOfImpact,
      z: ray.origin.z + ray.dir.z * hit.timeOfImpact,
    };
    const dist = hit.timeOfImpact + 0.4;
    const otherLocal = qRotate(qConj(other.rotation()), vSub(hitPoint, other.translation()));
    const jd = RAPIER.JointData.spring(dist * 0.35, 220, 18, HAND_LOCAL.R, otherLocal);
    g.joint = world.createImpulseJoint(jd, this.ragdoll.bodies.forearmR, other, true);
    g.target = hitPoint;
    sim.levelRuntime.onEvent?.({ t: 'grappleFire', slot: this.playerIndex, point: [hitPoint.x, hitPoint.y, hitPoint.z] });
  }

  releaseArm(world, side) {
    const g = this.grabs[side];
    if (g) {
      world.removeImpulseJoint(g.joint, true);
      this.grabs[side] = null;
    }
  }

  releaseAll(world) {
    this.releaseArm(world, 'L');
    this.releaseArm(world, 'R');
    if (this.grapple.joint) {
      world.removeImpulseJoint(this.grapple.joint, true);
      this.grapple.joint = null;
      this.grapple.target = null;
    }
  }

  update(RAPIER, world, input, dt, sim) {
    const A = TUNING.arms;
    this.updateGrapple(RAPIER, world, input, sim);
    const chest = this.ragdoll.bodies.chest;
    const chestRot = chest.rotation();
    const aimDir = qRotate(
      qMul(yawQuat(input.yaw), qFromAxisAngle(v3(1, 0, 0), -input.pitch)),
      v3(0, 0, 1),
    );

    for (const side of ['L', 'R']) {
      const wants = side === 'L' ? input.grabL : input.grabR;
      const forearm = this.ragdoll.bodies[`forearm${side}`];
      const shoulderName = `shoulder${side}`;
      const grab = this.grabs[side];

      if (!wants) {
        if (grab) this.releaseArm(world, side);
        this.balance.armGainMul[side] = 1;
        this.balance.poseTargets[shoulderName] = qIdent();
        this.balance.hingeTargets[`elbow${side}`] = -0.25;
        continue;
      }

      this.balance.armGainMul[side] = TUNING.motors.armAimBoost;

      // --- aim: drive shoulder so the arm axis points at the target ---
      const upperArm = this.ragdoll.bodies[`upperArm${side}`];
      const shoulderWorld = vAdd(
        chest.translation(),
        qRotate(chestRot, v3(side === 'L' ? -0.26 : 0.26, 0.10, 0)),
      );
      let target;
      if (grab) {
        // While latched: pull hand toward the hips → hoists the body (climb).
        const pull = (input.moveZ > 0.1 || input.jump) ? -0.75 : -0.25;
        target = vAdd(shoulderWorld, qRotate(chestRot, v3(0, pull, 0.18)));
      } else {
        target = vAdd(shoulderWorld, vScale(aimDir, A.reach * 0.85));
      }
      // Desired arm direction in chest-local frame; rest arm axis is (0,-1,0).
      const dirLocal = vNorm(qRotate(qConj(chestRot), vSub(target, shoulderWorld)));
      const rest = v3(0, -1, 0);
      const dot = Math.max(-1, Math.min(1, vDot(rest, dirLocal)));
      let axis = vCross(rest, dirLocal);
      if (vLen(axis) < 1e-4) axis = v3(1, 0, 0);
      this.balance.poseTargets[shoulderName] = qNormalize(
        qFromAxisAngle(vNorm(axis), Math.acos(dot)),
      );
      this.balance.hingeTargets[`elbow${side}`] = grab ? -0.9 : -0.15;

      // --- grab detection ---
      if (!grab) {
        const handWorld = vAdd(forearm.translation(), qRotate(forearm.rotation(), HAND_LOCAL[side]));
        const groups = ((1 << this.playerIndex) << 16) | (0xffff & ~(1 << this.playerIndex));
        let best = null;
        world.intersectionsWithShape(
          handWorld, qIdent(), new RAPIER.Ball(A.handSensorRadius),
          (collider) => {
            const body = collider.parent();
            if (!body) return true; // colliders without bodies: skip
            const ud = body.userData;
            const isGrabbable = body.isFixed() || (ud && ud.grabbable !== false);
            if (isGrabbable && (best === null || collider.handle < best.collider.handle)) {
              best = { collider, body };
            }
            return true;
          },
          undefined, groups,
        );
        if (best) {
          const other = best.body;
          const otherLocal = qRotate(qConj(other.rotation()), vSub(handWorld, other.translation()));
          // Spring, not a hard joint: grip strength is finite by construction.
          // Stretch beyond grabBreakDistance = force beyond budget → rips free.
          const jd = RAPIER.JointData.spring(
            0, A.grabSpringK, A.grabSpringDamping, HAND_LOCAL[side], otherLocal,
          );
          const joint = world.createImpulseJoint(jd, forearm, other, true);
          this.grabs[side] = { joint, otherBody: other, ownAnchorLocal: HAND_LOCAL[side], otherAnchorLocal: otherLocal, overstretch: 0 };
        }
      } else {
        // --- break check: solver losing = separation beyond tolerance ---
        const other = grab.otherBody;
        if (!other.isValid()) { this.grabs[side] = null; continue; }
        const a1 = vAdd(forearm.translation(), qRotate(forearm.rotation(), grab.ownAnchorLocal));
        const a2 = vAdd(other.translation(), qRotate(other.rotation(), grab.otherAnchorLocal));
        // Sustained overstretch = force beyond grip budget; transients forgiven.
        if (vLen(vSub(a1, a2)) > A.grabBreakDistance) grab.overstretch++;
        else grab.overstretch = 0;
        if (grab.overstretch >= TUNING.arms.grabBreakTicks) this.releaseArm(world, side);
      }
    }

    // --- climb assist: both hands latched + pushing forward → gentle lift ---
    if (this.grabs.L && this.grabs.R && (input.moveZ > 0.1 || input.jump)) {
      this.balance.externalLift = A.climbAssistForce;
    }
  }
}
