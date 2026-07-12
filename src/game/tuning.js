// EVERY physics/feel constant lives here. Surfaced in the ?debug=1 panel.
// Units: meters, kilograms, seconds, Newtons, radians.

export const TUNING = {
  dt: 1 / 60,
  gravity: -9.81,

  // --- body dimensions (rest pose: standing, arms hanging) ---
  body: {
    pelvis: { mass: 11 },
    chest: { mass: 24 },
    head: { mass: 5 },
    upperArm: { mass: 2 },
    forearm: { mass: 1.5 },
    thigh: { mass: 7 },
    shin: { mass: 3.5 },
    foot: { mass: 1 },
    linearDamping: 0.08,
    angularDamping: 0.6,
    friction: 0.7,
    footFriction: 1.1,
  },

  // --- balance / stand ---
  balance: {
    standHeight: 0.98,     // pelvis center height above ground when standing
    hoverKp: 5200,         // N/m pelvis hover spring
    hoverKd: 620,          // N·s/m
    hoverMaxUp: 1500,      // N cap (≈2.2× body weight)
    hoverMaxDown: 150,     // N — barely pulls down, jumps must escape
    marionetteChest: 0.22,  // fraction of hover force applied at chest instead of pelvis
    uprightKp: 300,        // N·m/rad torso upright PD (split pelvis/chest)
    uprightKd: 34,
    uprightMaxTorque: 400,
    fadeStart: 0.5,        // rad — full fight below this lean, fading above
    recoverBoost: 1.7,     // upright torque multiplier while struggling up
    yawKp: 90,             // face camera yaw
    yawKd: 12,
    yawMaxTorque: 110,
    tiltLimit: 1.15,       // rad (~66°) beyond which we're "falling"
    fightTilt: 0.72,       // rad — leaning harder than this counts as losing
    fightTime: 0.42,       // s of sustained heavy lean before giving up (KO)
    koTime: 1.4,           // s of limp comedy after a knockout
    recoverTime: 0.7,      // s to ramp gains back
    koImpactSpeed: 7.5,    // m/s body-part impact speed that knocks out
  },

  // --- ball-joint PD motors (hand-rolled; JS bindings expose no spherical motors) ---
  // kp N·m/rad, kd N·m·s/rad, max N·m
  motors: {
    spine: { kp: 420, kd: 42, max: 480 },
    neck: { kp: 32, kd: 4, max: 40 },
    shoulder: { kp: 65, kd: 7, max: 90 },   // raised while aiming (armAimBoost)
    hip: { kp: 260, kd: 26, max: 320 },
    // revolute (built-in rapier motors): stiffness/damping in solver units
    elbow: { stiffness: 55, damping: 8 },
    knee: { stiffness: 220, damping: 25 },
    ankle: { stiffness: 45, damping: 6 },
    armAimBoost: 2.4,      // shoulder/elbow gain multiplier while that arm aims
  },

  // --- locomotion ---
  walk: {
    speed: 2.6,            // m/s target
    accelForce: 420,       // N horizontal drive on pelvis
    airControl: 0.25,      // fraction of drive when airborne
    gaitFreq: 2.4,         // steps/s at full speed
    hipSwing: 0.6,         // rad thigh swing amplitude
    kneeLift: 1.0,         // rad knee bend during swing phase
    plantKp: 260,          // N/m idle anchor spring (stops slow moonwalking)
    jumpImpulse: 310,      // N·s vertical, pelvis+chest split
    jumpCrouch: 0.12,      // s pre-wind
  },

  // --- arms / grab (Gate B) ---
  arms: {
    reach: 1.65,           // m max hand target distance from shoulder
    grabBreakDistance: 0.14, // m of joint separation before the grip rips free
    handSensorRadius: 0.07,
    climbAssistForce: 380, // N up on pelvis when both hands latched + pushing forward
  },

  net: {
    inputHz: 30,
    snapshotHz: 20,
    interpDelayMs: 100,
    fullSnapshotEveryMs: 2000,
    heartbeatTimeoutMs: 3000,
    worldBound: 256,       // |coord| max for int16 quantization
    maxVel: 64,            // |velocity| max for int16 quantization
  },
};
