// Balance + locomotion controller for one ragdoll. Pure functions of sim
// state — deterministic given identical inputs (no Math.random, no Date).
import { TUNING } from './tuning.js';
import {
  v3, vAdd, vSub, vScale, vDot, vCross, vLen, vNorm, vClampLen,
  qMul, qConj, qRotate, qToScaledAxis, qFromAxisAngle, yawQuat, qIdent,
} from './math3.js';

const UP = v3(0, 1, 0);

export class BalanceController {
  constructor(ragdoll, playerIndex) {
    this.ragdoll = ragdoll;
    this.playerIndex = playerIndex;
    this.gaitPhase = 0;
    this.state = 'active';      // 'active' | 'ko' | 'recover'
    this.stateTimer = 0;
    this.grounded = false;
    this.jumpCooldown = 0;
    this.prevHeadVel = v3();
    this.koCount = 0;
    this.tiltTimer = 0;
    // Pose targets written by arms.js; consumed here for ball-joint PD.
    this.poseTargets = {
      spine: qIdent(), neck: qIdent(),
      shoulderL: qIdent(), shoulderR: qIdent(),
      hipL: qIdent(), hipR: qIdent(),
    };
    this.armGainMul = { L: 1, R: 1 }; // boosted by arms.js while aiming
    this.hingeTargets = { elbowL: -0.25, elbowR: -0.25, kneeL: 0.08, kneeR: 0.08, ankleL: 0, ankleR: 0 };
    this.externalLift = 0; // climb assist force from arms.js
  }

  /** gainScale: 0 while KO'd, ramps back during recover. */
  gainScale() {
    if (this.state === 'ko') return 0.04;
    if (this.state === 'recover') return 0.04 + 0.96 * Math.min(1, this.stateTimer / TUNING.balance.recoverTime);
    return 1;
  }

  knockOut() {
    if (this.state !== 'ko') { this.state = 'ko'; this.stateTimer = 0; this.koCount++; }
  }

  update(RAPIER, world, input, dt) {
    const B = TUNING.balance;
    const W = TUNING.walk;
    const { bodies } = this.ragdoll;
    const pelvis = bodies.pelvis;
    const chest = bodies.chest;

    // --- state machine ---
    this.stateTimer += dt;
    const chestRot = chest.rotation();
    const chestUp = qRotate(chestRot, UP);
    const tilt = Math.acos(Math.max(-1, Math.min(1, chestUp.y)));
    const headVel = bodies.head.linvel();
    const dvHead = vLen(vSub(headVel, this.prevHeadVel));
    this.prevHeadVel = { ...headVel };
    if (this.state === 'active') {
      // Fought-and-lost: sustained heavy lean means the assist lost. Give up
      // and flop — this is what makes him *able* to fall over.
      if (tilt > B.fightTilt) this.tiltTimer += dt;
      else this.tiltTimer = Math.max(0, this.tiltTimer - 2 * dt);
      if (tilt > B.tiltLimit || dvHead > B.koImpactSpeed || this.tiltTimer > B.fightTime) {
        this.knockOut();
        this.tiltTimer = 0;
      }
    } else if (this.state === 'ko' && this.stateTimer > B.koTime) {
      this.state = 'recover'; this.stateTimer = 0;
    } else if (this.state === 'recover' && this.stateTimer > B.recoverTime) {
      this.state = 'active'; this.stateTimer = 0;
    }
    const gain = this.gainScale();

    // --- grounded check: ray straight down from pelvis, ignore own body ---
    const pPos = pelvis.translation();
    const rayGroups = ((1 << this.playerIndex) << 16) | (0xffff & ~(1 << this.playerIndex));
    const ray = new RAPIER.Ray(pPos, v3(0, -1, 0));
    const hit = world.castRay(ray, B.standHeight + 0.55, true, undefined, rayGroups);
    this.grounded = hit !== null && hit.timeOfImpact < B.standHeight + 0.35;
    const groundY = hit ? pPos.y - hit.timeOfImpact : -Infinity;

    // Fight factor: full assist while roughly upright, fading past fadeStart —
    // so quiet standing is stable but real momentum can topple him. While
    // recovering he struggles at boosted strength regardless of lean.
    let uprightFactor;
    if (this.state === 'recover') {
      uprightFactor = B.recoverBoost;
    } else if (tilt < B.fadeStart) {
      uprightFactor = 1;
    } else {
      uprightFactor = Math.max(0, 1 - (tilt - B.fadeStart) / (B.tiltLimit - B.fadeStart));
    }

    // --- hover spring (the "balance capsule" without the capsule) ---
    if (this.grounded && gain > 0.5) {
      const targetY = groundY + B.standHeight;
      const vy = pelvis.linvel().y;
      let f = B.hoverKp * (targetY - pPos.y) - B.hoverKd * vy;
      f = Math.max(-B.hoverMaxDown, Math.min(B.hoverMaxUp, f)) * Math.min(1, uprightFactor) * gain;
      const chestShare = f * B.marionetteChest;
      pelvis.addForce(v3(0, f - chestShare, 0), true);
      chest.addForce(v3(0, chestShare, 0), true);
    }
    if (this.externalLift > 0) {
      pelvis.addForce(v3(0, this.externalLift, 0), true);
      this.externalLift = 0;
    }

    // --- upright PD torque on chest + pelvis ---
    {
      const axis = vCross(chestUp, UP); // torque direction to right the torso
      const wAng = chest.angvel();
      const t = vClampLen(
        vSub(vScale(axis, B.uprightKp), vScale(v3(wAng.x, 0, wAng.z), B.uprightKd)),
        B.uprightMaxTorque,
      );
      // The harder he leans, the weaker the fight — that's what lets a good
      // shove actually topple him instead of snapping back like a robot.
      const fight = gain * (this.grounded ? 1 : 0.35) * Math.max(0.1, uprightFactor);
      chest.addTorque(vScale(t, 0.55 * fight), true);
      pelvis.addTorque(vScale(t, 0.45 * fight), true);
    }

    // --- yaw PD: face input.yaw ---
    {
      const pelvisRot = pelvis.rotation();
      const fwd = qRotate(pelvisRot, v3(0, 0, 1));
      const curYaw = Math.atan2(fwd.x, fwd.z);
      let err = input.yaw - curYaw;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      const wy = pelvis.angvel().y;
      const t = Math.max(-B.yawMaxTorque, Math.min(B.yawMaxTorque, B.yawKp * err - B.yawKd * wy));
      pelvis.addTorque(v3(0, t * gain * uprightFactor, 0), true);
    }

    // --- locomotion: horizontal drive + gait ---
    const moveLen = Math.hypot(input.moveX, input.moveZ);
    const moving = moveLen > 0.01;
    let vDesired = v3();
    if (moving) {
      // move vector is camera-relative; input.yaw is camera yaw
      const dir = qRotate(yawQuat(input.yaw), vNorm(v3(input.moveX, 0, input.moveZ)));
      vDesired = vScale(dir, W.speed * Math.min(1, moveLen));
    }
    {
      const vel = pelvis.linvel();
      const vErr = vSub(vDesired, v3(vel.x, 0, vel.z));
      const drive = this.grounded ? 1 : W.airControl;
      let f = vScale(vErr, W.accelForce);
      // Idle anchor: spring toward where he stopped, so he doesn't slowly
      // moonwalk away while "standing still".
      if (!moving && this.grounded && this.state === 'active') {
        if (!this.plant) this.plant = { x: pPos.x, z: pPos.z };
        f = vAdd(f, v3(W.plantKp * (this.plant.x - pPos.x), 0, W.plantKp * (this.plant.z - pPos.z)));
      } else {
        this.plant = null;
      }
      f = vClampLen(f, W.accelForce);
      pelvis.addForce(vScale(f, drive * gain * Math.min(1, Math.max(uprightFactor, 0.15))), true);
    }

    // --- gait oscillator → hip/knee targets ---
    if (moving && this.grounded && gain > 0.5) {
      this.gaitPhase += 2 * Math.PI * W.gaitFreq * dt * Math.min(1, moveLen);
      const s = Math.sin(this.gaitPhase);
      const swingL = s * W.hipSwing, swingR = -s * W.hipSwing;
      // Hip target: rotate thigh about X (forward/back swing) in pelvis frame.
      this.poseTargets.hipL = qFromAxisAngle(v3(1, 0, 0), -swingL);
      this.poseTargets.hipR = qFromAxisAngle(v3(1, 0, 0), -swingR);
      // Knee lifts while that leg swings forward.
      this.hingeTargets.kneeL = Math.max(0, Math.sin(this.gaitPhase + Math.PI / 2)) * W.kneeLift * 0.6 + 0.08;
      this.hingeTargets.kneeR = Math.max(0, Math.sin(this.gaitPhase + 3 * Math.PI / 2)) * W.kneeLift * 0.6 + 0.08;
    } else {
      this.gaitPhase = 0;
      this.poseTargets.hipL = qIdent();
      this.poseTargets.hipR = qIdent();
      this.hingeTargets.kneeL = 0.08;
      this.hingeTargets.kneeR = 0.08;
    }

    // --- jump ---
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (input.jump && this.grounded && this.jumpCooldown === 0 && this.state === 'active') {
      pelvis.applyImpulse(v3(0, W.jumpImpulse * 0.65, 0), true);
      chest.applyImpulse(v3(0, W.jumpImpulse * 0.35, 0), true);
      this.jumpCooldown = 0.5;
    }

    // --- ball-joint PD motors toward pose targets ---
    this.applyBallMotor('spine', gain);
    this.applyBallMotor('neck', gain);
    this.applyBallMotor('shoulderL', gain * this.armGainMul.L);
    this.applyBallMotor('shoulderR', gain * this.armGainMul.R);
    this.applyBallMotor('hipL', gain);
    this.applyBallMotor('hipR', gain);

    // --- hinge motors ---
    for (const [name, target] of Object.entries(this.hingeTargets)) {
      const j = this.ragdoll.joints[name];
      const m = TUNING.motors[j.def.motor];
      const boost = name.startsWith('elbow')
        ? this.armGainMul[name.endsWith('L') ? 'L' : 'R'] : 1;
      j.joint.configureMotorPosition(target, m.stiffness * gain * boost, m.damping);
    }
  }

  /** PD torque pair driving child toward targetLocalQ relative to parent. */
  applyBallMotor(jointName, gainMul) {
    const { def } = this.ragdoll.joints[jointName];
    const parent = this.ragdoll.bodies[def.parent];
    const child = this.ragdoll.bodies[def.child];
    const m = TUNING.motors[def.motor];
    const qP = parent.rotation();
    const qC = child.rotation();
    const qRel = qMul(qConj(qP), qC);
    const qErr = qMul(this.poseTargets[jointName], qConj(qRel)); // in parent frame
    const axisLocal = qToScaledAxis(qErr);
    const axisWorld = qRotate(qP, axisLocal);
    const relW = vSub(child.angvel(), parent.angvel());
    const torque = vClampLen(
      vSub(vScale(axisWorld, m.kp), vScale(relW, m.kd)),
      m.max,
    );
    const t = vScale(torque, gainMul);
    child.addTorque(t, true);
    parent.addTorque(vScale(t, -1), true);
  }
}
