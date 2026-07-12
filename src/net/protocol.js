// Binary wire protocol. Little-endian DataView, headless-testable.
// Channel 'state' (unreliable): INPUT (client→host), STATE (host→clients).
// Channel 'events' (reliable): JSON control messages + chunked full snapshots.
import { TUNING } from '../game/tuning.js';

export const MSG = { INPUT: 1, STATE: 2, EVENT_JSON: 3, SNAP_CHUNK: 4 };

const POS_SCALE = 32767 / TUNING.net.worldBound;
const VEL_SCALE = 32767 / TUNING.net.maxVel;
const ANG_SCALE = 10430; // rad → i16 (±π fits)
const QUAT_SCALE = 32767;

const clamp16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v)));

// ---------- input ----------
export function encodeInput(seq, input) {
  const buf = new ArrayBuffer(12);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG.INPUT);
  dv.setUint16(1, seq, true);
  dv.setInt8(3, Math.round(Math.max(-1, Math.min(1, input.moveX)) * 127));
  dv.setInt8(4, Math.round(Math.max(-1, Math.min(1, input.moveZ)) * 127));
  dv.setInt16(5, clamp16(wrapPi(input.yaw) * ANG_SCALE), true);
  dv.setInt16(7, clamp16(input.pitch * ANG_SCALE), true);
  dv.setUint8(9, (input.jump ? 1 : 0) | (input.grabL ? 2 : 0) | (input.grabR ? 4 : 0));
  dv.setUint16(10, 0, true); // reserved
  return buf;
}

export function decodeInput(dv) {
  return {
    seq: dv.getUint16(1, true),
    input: {
      moveX: dv.getInt8(3) / 127,
      moveZ: dv.getInt8(4) / 127,
      yaw: dv.getInt16(5, true) / ANG_SCALE,
      pitch: dv.getInt16(7, true) / ANG_SCALE,
      jump: (dv.getUint8(9) & 1) !== 0,
      grabL: (dv.getUint8(9) & 2) !== 0,
      grabR: (dv.getUint8(9) & 4) !== 0,
    },
  };
}

function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------- state snapshot ----------
// Layout: u8 type | u32 tick | u8 playerMask | per player: u8 flags,
// 13 × body(20 B) | u16 propCount | per prop: u16 entityIndex + body(20 B).
// body: pos i16×3, quat i16×4 (normalized), linvel i16×3.
const BODY_BYTES = 20;

function writeBody(dv, off, body) {
  const p = body.translation(), q = body.rotation(), v = body.linvel();
  dv.setInt16(off, clamp16(p.x * POS_SCALE), true);
  dv.setInt16(off + 2, clamp16(p.y * POS_SCALE), true);
  dv.setInt16(off + 4, clamp16(p.z * POS_SCALE), true);
  dv.setInt16(off + 6, clamp16(q.x * QUAT_SCALE), true);
  dv.setInt16(off + 8, clamp16(q.y * QUAT_SCALE), true);
  dv.setInt16(off + 10, clamp16(q.z * QUAT_SCALE), true);
  dv.setInt16(off + 12, clamp16(q.w * QUAT_SCALE), true);
  dv.setInt16(off + 14, clamp16(v.x * VEL_SCALE), true);
  dv.setInt16(off + 16, clamp16(v.y * VEL_SCALE), true);
  dv.setInt16(off + 18, clamp16(v.z * VEL_SCALE), true);
  return off + BODY_BYTES;
}

function readBody(dv, off, out) {
  out.px = dv.getInt16(off, true) / POS_SCALE;
  out.py = dv.getInt16(off + 2, true) / POS_SCALE;
  out.pz = dv.getInt16(off + 4, true) / POS_SCALE;
  let qx = dv.getInt16(off + 6, true) / QUAT_SCALE;
  let qy = dv.getInt16(off + 8, true) / QUAT_SCALE;
  let qz = dv.getInt16(off + 10, true) / QUAT_SCALE;
  let qw = dv.getInt16(off + 12, true) / QUAT_SCALE;
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  out.qx = qx / n; out.qy = qy / n; out.qz = qz / n; out.qw = qw / n;
  out.vx = dv.getInt16(off + 14, true) / VEL_SCALE;
  out.vy = dv.getInt16(off + 16, true) / VEL_SCALE;
  out.vz = dv.getInt16(off + 18, true) / VEL_SCALE;
  return off + BODY_BYTES;
}

/**
 * @param sim Sim (host)
 * @param propEntities array of {index, body} for non-player dynamic entities
 */
export function encodeState(sim, propEntities) {
  let playerMask = 0;
  const activePlayers = [];
  for (let i = 0; i < 4; i++) {
    if (sim.players[i]) { playerMask |= 1 << i; activePlayers.push(sim.players[i]); }
  }
  const awakeProps = [];
  for (const e of propEntities) {
    if (!e.body.isSleeping()) awakeProps.push(e);
  }
  const size = 6 + activePlayers.length * (1 + 13 * BODY_BYTES) + 2 + awakeProps.length * (2 + BODY_BYTES);
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG.STATE);
  dv.setUint32(1, sim.tick, true);
  dv.setUint8(5, playerMask);
  let off = 6;
  for (const p of activePlayers) {
    const flags = (p.balance.state === 'ko' ? 1 : 0) | (p.balance.state === 'recover' ? 2 : 0)
      | (p.arms.grabs.L ? 4 : 0) | (p.arms.grabs.R ? 8 : 0);
    dv.setUint8(off, flags); off += 1;
    for (const body of p.ragdoll.partList) off = writeBody(dv, off, body);
  }
  dv.setUint16(off, awakeProps.length, true); off += 2;
  for (const e of awakeProps) {
    dv.setUint16(off, e.index, true); off += 2;
    off = writeBody(dv, off, e.body);
  }
  return buf;
}

export function decodeState(dv) {
  const tick = dv.getUint32(1, true);
  const playerMask = dv.getUint8(5);
  let off = 6;
  const players = {};
  for (let slot = 0; slot < 4; slot++) {
    if (!(playerMask & (1 << slot))) continue;
    const flags = dv.getUint8(off); off += 1;
    const bodies = [];
    for (let b = 0; b < 13; b++) {
      const t = {}; off = readBody(dv, off, t); bodies.push(t);
    }
    players[slot] = { flags, bodies };
  }
  const propCount = dv.getUint16(off, true); off += 2;
  const props = [];
  for (let i = 0; i < propCount; i++) {
    const index = dv.getUint16(off, true); off += 2;
    const t = {}; off = readBody(dv, off, t);
    props.push({ index, ...t });
  }
  return { tick, players, props };
}

// ---------- reliable channel framing ----------
export function encodeEventJson(obj) {
  const body = new TextEncoder().encode(JSON.stringify(obj));
  const buf = new Uint8Array(1 + body.length);
  buf[0] = MSG.EVENT_JSON;
  buf.set(body, 1);
  return buf.buffer;
}

export function decodeEventJson(dv) {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + 1, dv.byteLength - 1);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Full world snapshots are big (rapier world bytes, deflated) → chunked.
// Header: u8 type | u32 snapId | u16 chunkIdx | u16 chunkCount | payload.
const CHUNK_PAYLOAD = 15000;

export function encodeSnapshotChunks(snapId, bytes) {
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK_PAYLOAD));
  const chunks = [];
  for (let i = 0; i < count; i++) {
    const slice = bytes.subarray(i * CHUNK_PAYLOAD, Math.min((i + 1) * CHUNK_PAYLOAD, bytes.length));
    const buf = new Uint8Array(9 + slice.length);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, MSG.SNAP_CHUNK);
    dv.setUint32(1, snapId, true);
    dv.setUint16(5, i, true);
    dv.setUint16(7, count, true);
    buf.set(slice, 9);
    chunks.push(buf.buffer);
  }
  return chunks;
}

/** Stateful reassembler: feed chunks, returns Uint8Array when complete. */
export class SnapshotAssembler {
  constructor() { this.snapId = -1; this.parts = null; this.received = 0; }
  feed(dv) {
    const snapId = dv.getUint32(1, true);
    const idx = dv.getUint16(5, true);
    const count = dv.getUint16(7, true);
    if (snapId !== this.snapId) {
      this.snapId = snapId; this.parts = new Array(count).fill(null); this.received = 0;
    }
    if (this.parts[idx] === null) {
      this.parts[idx] = new Uint8Array(dv.buffer, dv.byteOffset + 9, dv.byteLength - 9).slice();
      this.received++;
    }
    if (this.received === count) {
      const total = this.parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of this.parts) { out.set(p, off); off += p.length; }
      this.parts = null; this.snapId = -1; this.received = 0;
      return out;
    }
    return null;
  }
}
