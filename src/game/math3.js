// Minimal vec3/quat helpers — src/game/ must run headless in Node (no three.js).
// Quats are plain {x,y,z,w}, vectors {x,y,z}. All functions allocate; hot paths
// stay cheap because body counts are small (~13/player).

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

export function vAdd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function vScale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function vDot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function vCross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function vLen(a) { return Math.sqrt(vDot(a, a)); }
export function vNorm(a) {
  const l = vLen(a);
  return l > 1e-9 ? vScale(a, 1 / l) : v3();
}
export function vClampLen(a, max) {
  const l = vLen(a);
  return l > max ? vScale(a, max / l) : a;
}
export function vLerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export const qIdent = () => ({ x: 0, y: 0, z: 0, w: 1 });

export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function qConj(q) { return { x: -q.x, y: -q.y, z: -q.z, w: q.w }; }

export function qFromAxisAngle(axis, angle) {
  const h = angle / 2, s = Math.sin(h);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

// Rotate vector by quaternion.
export function qRotate(q, v) {
  const qv = { x: q.x, y: q.y, z: q.z };
  const uv = vCross(qv, v);
  const uuv = vCross(qv, uv);
  return vAdd(v, vScale(vAdd(vScale(uv, q.w), uuv), 2));
}

// Axis-angle (as a single scaled-axis vector, |v| = angle) from a unit quat.
// Takes the short way around.
export function qToScaledAxis(q) {
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-6) return v3();
  const angle = 2 * Math.acos(Math.min(1, w));
  return { x: (x / s) * angle, y: (y / s) * angle, z: (z / s) * angle };
}

export function qNormalize(q) {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

export function yawQuat(yaw) { return qFromAxisAngle(v3(0, 1, 0), yaw); }
