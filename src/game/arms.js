// Arm aiming + grab for the bean rig (single-segment arms). While LMB/RMB
// held, that arm's shoulder PD drives the arm toward the camera-aim point;
// on hand-tip contact with a grabbable body a spring joint forms. Springs
// break under sustained overstretch — heavy things rip free naturally.
import { TUNING } from './tuning.js';
import { PARTS, HAND_LOCAL, HEAD_LOCAL } from './ragdoll.js';
import {
  v3, vAdd, vSub, vScale, vLen, vNorm, vCross, vDot,
  qMul, qConj, qRotate, qFromAxisAngle, qNormalize, qIdent, yawQuat,
} from './math3.js';

export class ArmsController {
  constructor(ragdoll, playerIndex, balance) {
    this.ragdoll = ragdoll;
    this.playerIndex = playerIndex;
    this.balance = balance;
    this.grabs = { L: null, R: null }; // {joint, otherBody, ownAnchorLocal, otherAnchorLocal, overstretch}
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
    const torsoPos = this.ragdoll.bodies.torso.translation();
    const zone = level.grappleZone;
    if (!g.has && zone
      && Math.abs(torsoPos.x - zone.pos[0]) <= zone.size[0]
      && Math.abs(torsoPos.y - zone.pos[1]) <= zone.size[1] + 1
      && Math.abs(torsoPos.z - zone.pos[2]) <= zone.size[2]) {
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
    const torso = this.ragdoll.bodies.torso;
    const origin = vAdd(torso.translation(), qRotate(torso.rotation(), v3(HEAD_LOCAL.x, HEAD_LOCAL.y, HEAD_LOCAL.z)));
    const dir = qRotate(
      qMul(yawQuat(input.yaw), qFromAxisAngle(v3(1, 0, 0), -input.pitch)),
      v3(0, 0, 1),
    );
    const groups = ((1 << this.playerIndex) << 16) | (0xffff & ~(1 << this.playerIndex));
    const ray = new RAPIER.Ray(
      { x: origin.x + dir.x * 0.5, y: origin.y + dir.y * 0.5, z: origin.z + dir.z * 0.5 }, dir,
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
    const dist = hit.timeOfImpact + 0.5;
    const otherLocal = qRotate(qConj(other.rotation()), vSub(hitPoint, other.translation()));
    const jd = RAPIER.JointData.spring(dist * 0.35, 220, 18, HAND_LOCAL.R, otherLocal);
    g.joint = world.createImpulseJoint(jd, this.ragdoll.bodies.armR, other, true);
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
    const torso = this.ragdoll.bodies.torso;
    const torsoRot = torso.rotation();
    const aimDir = qRotate(
      qMul(yawQuat(input.yaw), qFromAxisAngle(v3(1, 0, 0), -input.pitch)),
      v3(0, 0, 1),
    );

    for (const side of ['L', 'R']) {
      const wants = side === 'L' ? input.grabL : input.grabR;
      const arm = this.ragdoll.bodies[`arm${side}`];
      const shoulderName = `shoulder${side}`;
      const grab = this.grabs[side];

      if (!wants) {
        if (grab) this.releaseArm(world, side);
        this.balance.armGainMul[side] = 1;
        this.balance.poseTargets[shoulderName] = qIdent();
        continue;
      }

      this.balance.armGainMul[side] = TUNING.motors.armAimBoost;

      // --- aim: drive shoulder so the arm axis points at the target ---
      const shoulderWorld = vAdd(
        torso.translation(),
        qRotate(torsoRot, v3(side === 'L' ? -0.36 : 0.36, 0.30, 0)),
      );
      let target;
      if (grab) {
        // While latched: pull hand toward the hips → hoists the body (climb).
        const pull = (input.moveZ > 0.1 || input.jump) ? -0.8 : -0.3;
        target = vAdd(shoulderWorld, qRotate(torsoRot, v3(0, pull, 0.2)));
      } else {
        target = vAdd(shoulderWorld, vScale(aimDir, A.reach * 0.85));
      }
      // Desired arm direction in torso-local frame; rest arm axis is (0,-1,0).
      const dirLocal = vNorm(qRotate(qConj(torsoRot), vSub(target, shoulderWorld)));
      const rest = v3(0, -1, 0);
      const dot = Math.max(-1, Math.min(1, vDot(rest, dirLocal)));
      let axis = vCross(rest, dirLocal);
      if (vLen(axis) < 1e-4) axis = v3(1, 0, 0);
      this.balance.poseTargets[shoulderName] = qNormalize(
        qFromAxisAngle(vNorm(axis), Math.acos(dot)),
      );

      // --- grab detection ---
      if (!grab) {
        const handWorld = vAdd(arm.translation(), qRotate(arm.rotation(), HAND_LOCAL[side]));
        const groups = ((1 << this.playerIndex) << 16) | (0xffff & ~(1 << this.playerIndex));
        let best = null;
        world.intersectionsWithShape(
          handWorld, qIdent(), new RAPIER.Ball(A.handSensorRadius),
          (collider) => {
            const body = collider.parent();
            if (!body) return true;
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
          const jd = RAPIER.JointData.spring(
            0, A.grabSpringK, A.grabSpringDamping, HAND_LOCAL[side], otherLocal,
          );
          const joint = world.createImpulseJoint(jd, arm, other, true);
          this.grabs[side] = { joint, otherBody: other, ownAnchorLocal: HAND_LOCAL[side], otherAnchorLocal: otherLocal, overstretch: 0 };
        }
      } else {
        // --- break check: sustained overstretch = force beyond grip budget ---
        const other = grab.otherBody;
        if (!other.isValid()) { this.grabs[side] = null; continue; }
        const a1 = vAdd(arm.translation(), qRotate(arm.rotation(), grab.ownAnchorLocal));
        const a2 = vAdd(other.translation(), qRotate(other.rotation(), grab.otherAnchorLocal));
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
