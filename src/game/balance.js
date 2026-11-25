// Balance + locomotion controller for one bean ragdoll. Pure functions of
// sim state — deterministic given identical inputs.
//
// The bean is effectively a hover-stabilized inverted pendulum: one heavy
// torso held up by a spring toward standHeight + a PD torque toward
// upright, with stubby legs swung by hip PD motors for show and ground
// contact. Far more controllable than a segmented spine — that's the point.
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
    this.prevTorsoVel = v3();
    this.koCount = 0;
    this.tiltTimer = 0;
    this.plant = null;
    // Pose targets written by arms.js; consumed here for ball-joint PD.
    this.poseTargets = {
      shoulderL: qIdent(), shoulderR: qIdent(),
      hipL: qIdent(), hipR: qIdent(),
    };
    this.armGainMul = { L: 1, R: 1 }; // boosted by arms.js while aiming
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
    const torso = bodies.torso;

    // --- state machine ---
    this.stateTimer += dt;
    const torsoRot = torso.rotation();
    const torsoUp = qRotate(torsoRot, UP);
    const tilt = Math.acos(Math.max(-1, Math.min(1, torsoUp.y)));
    const torsoVel = torso.linvel();
    const dvTorso = vLen(vSub(torsoVel, this.prevTorsoVel));
    this.prevTorsoVel = { ...torsoVel };
    if (this.state === 'active') {
      // Fought-and-lost: sustained heavy lean means the assist lost. Give up
      // and flop — this is what makes him *able* to fall over.
      if (tilt > B.fightTilt) this.tiltTimer += dt;
      else this.tiltTimer = Math.max(0, this.tiltTimer - 2 * dt);
      if (tilt > B.tiltLimit || dvTorso > B.koImpactSpeed || this.tiltTimer > B.fightTime) {
        this.knockOut();
        this.tiltTimer = 0;
      }
    } else if (this.state === 'ko' && this.stateTimer > B.koTime) {
      this.state = 'recover'; this.stateTimer = 0;
    } else if (this.state === 'recover' && this.stateTimer > B.recoverTime) {
      this.state = 'active'; this.stateTimer = 0;
    }
    const gain = this.gainScale();

    // --- grounded check: ray straight down from torso, ignore own body ---
    const pPos = torso.translation();
    const rayGroups = ((1 << this.playerIndex) << 16) | (0xffff & ~(1 << this.playerIndex));
    const ray = new RAPIER.Ray(pPos, v3(0, -1, 0));
    const hit = world.castRay(ray, B.standHeight + 0.55, true, undefined, rayGroups);
    this.grounded = hit !== null && hit.timeOfImpact < B.standHeight + 0.35;
    const groundY = hit ? pPos.y - hit.timeOfImpact : -Infinity;

    // Fight factor: full assist while roughly upright, fading past fadeStart —
    // quiet standing is stable but real momentum can topple him. While
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
    // Skipped while climbing: the climb lift replaces it (they'd fight).
    if (this.grounded && gain > 0.5 && this.externalLift === 0) {
      const targetY = groundY + B.standHeight;
      const vy = torso.linvel().y;
      let f = B.hoverKp * (targetY - pPos.y) - B.hoverKd * vy;
      f = Math.max(-B.hoverMaxDown, Math.min(B.hoverMaxUp, f)) * Math.min(1, uprightFactor) * gain;
      torso.addForce(v3(0, f, 0), true);
    }
    if (this.externalLift > 0) {
      torso.addForce(v3(0, this.externalLift, 0), true);
      this.externalLift = 0;
    }

    // --- upright PD torque on the torso ---
    {
      const axis = vCross(torsoUp, UP); // torque direction to right the torso
      const wAng = torso.angvel();
      const t = vClampLen(
        vSub(vScale(axis, B.uprightKp), vScale(v3(wAng.x, 0, wAng.z), B.uprightKd)),
        B.uprightMaxTorque,
      );
      const fight = gain * (this.grounded ? 1 : 0.35) * Math.max(0.1, uprightFactor);
      torso.addTorque(vScale(t, fight), true);
    }

    // --- yaw PD: face input.yaw ---
    {
      const fwd = qRotate(torsoRot, v3(0, 0, 1));
      const curYaw = Math.atan2(fwd.x, fwd.z);
      let err = input.yaw - curYaw;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      const wy = torso.angvel().y;
      const t = Math.max(-B.yawMaxTorque, Math.min(B.yawMaxTorque, B.yawKp * err - B.yawKd * wy));
      torso.addTorque(v3(0, t * gain * Math.min(1, uprightFactor), 0), true);
    }

    // --- locomotion: horizontal drive + gait ---
    const moveLen = Math.hypot(input.moveX, input.moveZ);
    const moving = moveLen > 0.01;
    let vDesired = v3();
    if (moving) {
      const dir = qRotate(yawQuat(input.yaw), vNorm(v3(input.moveX, 0, input.moveZ)));
      vDesired = vScale(dir, W.speed * Math.min(1, moveLen));
    }
    {
      const vel = torso.linvel();
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
      torso.addForce(vScale(f, drive * gain * Math.min(1, Math.max(uprightFactor, 0.15))), true);
    }

    // --- gait oscillator → stubby leg swings ---
    if (moving && this.grounded && gain > 0.5) {
      this.gaitPhase += 2 * Math.PI * W.gaitFreq * dt * Math.min(1, moveLen);
      const s = Math.sin(this.gaitPhase);
      this.poseTargets.hipL = qFromAxisAngle(v3(1, 0, 0), -s * W.hipSwing);
      this.poseTargets.hipR = qFromAxisAngle(v3(1, 0, 0), s * W.hipSwing);
    } else {
      this.gaitPhase = 0;
      this.poseTargets.hipL = qIdent();
      this.poseTargets.hipR = qIdent();
    }

    // --- jump ---
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (input.jump && this.grounded && this.jumpCooldown === 0 && this.state === 'active') {
      torso.applyImpulse(v3(0, W.jumpImpulse, 0), true);
      this.jumpCooldown = 0.5;
    }

    // --- ball-joint PD motors toward pose targets ---
    this.applyBallMotor('shoulderL', gain * this.armGainMul.L);
    this.applyBallMotor('shoulderR', gain * this.armGainMul.R);
    this.applyBallMotor('hipL', gain);
    this.applyBallMotor('hipR', gain);
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
