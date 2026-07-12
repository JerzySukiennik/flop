// Transport-agnostic host/client session logic. Browsers inject WebRTC
// transports (peer.js); gates inject loopback transports. Identical code
// path either way — that's what makes Gate D honest.
//
// Transport interface: { send(channel, arrayBuffer), close(), onMessage(cb),
//   onClose(cb), peerId } where channel ∈ {'state','events'}.
import { TUNING } from '../game/tuning.js';
import {
  MSG, encodeInput, decodeInput, encodeState, decodeState,
  encodeEventJson, decodeEventJson, encodeSnapshotChunks, SnapshotAssembler,
} from './protocol.js';

export class HostSession {
  /**
   * @param sim built Sim (level already instantiated)
   * @param opts { now: () => ms, deflate: (u8)=>u8, localSlot }
   */
  constructor(sim, opts) {
    this.sim = sim;
    this.now = opts.now;
    this.deflate = opts.deflate;
    this.localSlot = opts.localSlot ?? 0;
    this.peers = new Map(); // peerId → {transport, slot, lastSeq, lastHeard}
    this.propEntities = sim.entities
      .map((e, index) => ({ index, body: e.body, type: e.type }))
      .filter((e) => e.type === 'prop');
    this.lastStateSent = 0;
    this.lastFullSnap = 0;
    this.snapId = 0;
    this.onEvent = null;       // game-level events surface here
    this.joinOrder = [];       // peerIds in join order (host first) for election
  }

  addPeer(peerId, transport, slot) {
    const peer = { transport, slot, lastSeq: -1, lastHeard: this.now(), peerId };
    this.peers.set(peerId, peer);
    this.joinOrder.push(peerId);
    transport.onMessage((channel, data) => this._onMessage(peer, channel, data));
    transport.onClose(() => this.removePeer(peerId));
    this.broadcastEvent({ t: 'roster', roster: this.roster() });
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    this.joinOrder = this.joinOrder.filter((id) => id !== peerId);
    this.sim.deactivatePlayer(peer.slot);
    this.broadcastEvent({ t: 'roster', roster: this.roster() });
  }

  roster() {
    const r = [];
    for (let slot = 0; slot < 4; slot++) {
      if (!this.sim.players[slot] || !this.sim.activeSlots.has(slot)) continue;
      const peer = [...this.peers.values()].find((p) => p.slot === slot);
      r.push({ slot, peerId: peer ? peer.peerId : 'host' });
    }
    return r;
  }

  _onMessage(peer, channel, data) {
    const dv = new DataView(data);
    const type = dv.getUint8(0);
    peer.lastHeard = this.now();
    if (type === MSG.INPUT) {
      const { seq, input } = decodeInput(dv);
      // drop stale out-of-order input (unreliable channel)
      if (seqNewer(seq, peer.lastSeq)) {
        peer.lastSeq = seq;
        this.sim.setInput(peer.slot, input);
      }
    } else if (type === MSG.EVENT_JSON) {
      const ev = decodeEventJson(dv);
      this.onEvent?.(peer.slot, ev);
      if (ev.relay) this.broadcastEvent({ ...ev, fromSlot: peer.slot }, peer.peerId);
    }
  }

  broadcastEvent(obj, exceptPeerId = null) {
    const buf = encodeEventJson(obj);
    for (const p of this.peers.values()) {
      if (p.peerId !== exceptPeerId) p.transport.send('events', buf);
    }
  }

  /** Call every render frame; steps sim + broadcasts on schedule. */
  update(elapsed) {
    this.sim.advance(elapsed);
    const t = this.now();
    if (t - this.lastStateSent >= 1000 / TUNING.net.snapshotHz) {
      this.lastStateSent = t;
      const buf = encodeState(this.sim, this.propEntities);
      for (const p of this.peers.values()) p.transport.send('state', buf);
    }
    if (t - this.lastFullSnap >= TUNING.net.fullSnapshotEveryMs && this.peers.size > 0) {
      this.lastFullSnap = t;
      const raw = this.sim.world.takeSnapshot();
      const packed = this.deflate ? this.deflate(raw) : raw;
      const chunks = encodeSnapshotChunks(this.snapId++, packed);
      const meta = encodeEventJson({
        t: 'snapmeta', snapId: this.snapId - 1, tick: this.sim.tick,
        deflated: !!this.deflate, manifestHash: this.sim.manifestHash(),
        roster: this.roster(),
      });
      for (const p of this.peers.values()) {
        p.transport.send('events', meta);
        for (const c of chunks) p.transport.send('events', c);
      }
    }
  }
}

export class ClientSession {
  /**
   * @param opts { now, inflate, transport, localSlot, expectedManifestHash }
   */
  constructor(opts) {
    this.now = opts.now;
    this.inflate = opts.inflate;
    this.transport = opts.transport;
    this.localSlot = opts.localSlot;
    this.expectedManifestHash = opts.expectedManifestHash;
    this.buffer = [];            // decoded STATE snapshots, ascending tick
    this.assembler = new SnapshotAssembler();
    this.lastFull = null;        // {bytes, tick, snapId, roster} — migration standby
    this.pendingSnapMeta = null;
    this.inputSeq = 0;
    this.lastInputSent = 0;
    this.lastHostHeard = this.now();
    this.onEvent = null;
    this.onDesync = null;
    this.roster = [];
    opts.transport.onMessage((channel, data) => this._onMessage(channel, data));
  }

  _onMessage(channel, data) {
    const dv = new DataView(data);
    const type = dv.getUint8(0);
    this.lastHostHeard = this.now();
    if (type === MSG.STATE) {
      const snap = decodeState(dv);
      snap.recvTime = this.now();
      // Keep buffer sorted & bounded.
      this.buffer.push(snap);
      if (this.buffer.length > 40) this.buffer.shift();
    } else if (type === MSG.EVENT_JSON) {
      const ev = decodeEventJson(dv);
      if (ev.t === 'snapmeta') {
        this.pendingSnapMeta = ev;
        if (this.expectedManifestHash && ev.manifestHash !== this.expectedManifestHash) {
          this.onDesync?.(ev.manifestHash, this.expectedManifestHash);
        }
        if (ev.roster) this.roster = ev.roster;
      } else {
        if (ev.t === 'roster') this.roster = ev.roster;
        this.onEvent?.(ev);
      }
    } else if (type === MSG.SNAP_CHUNK) {
      const bytes = this.assembler.feed(dv);
      if (bytes && this.pendingSnapMeta) {
        const raw = this.pendingSnapMeta.deflated && this.inflate ? this.inflate(bytes) : bytes;
        this.lastFull = {
          bytes: raw, tick: this.pendingSnapMeta.tick,
          snapId: this.pendingSnapMeta.snapId, roster: this.pendingSnapMeta.roster,
        };
      }
    }
  }

  sendEvent(obj) { this.transport.send('events', encodeEventJson(obj)); }

  /** Call every frame with current local input. */
  update(input) {
    const t = this.now();
    if (t - this.lastInputSent >= 1000 / TUNING.net.inputHz) {
      this.lastInputSent = t;
      this.transport.send('state', encodeInput(this.inputSeq = (this.inputSeq + 1) & 0xffff, input));
    }
  }

  hostTimedOut() {
    return this.now() - this.lastHostHeard > TUNING.net.heartbeatTimeoutMs;
  }

  /** Interpolated transforms at render time (now - interpDelay). */
  sampleInterpolated() {
    const renderTime = this.now() - TUNING.net.interpDelayMs;
    const buf = this.buffer;
    if (buf.length === 0) return null;
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].recvTime <= renderTime) { a = buf[i]; b = buf[Math.min(i + 1, buf.length - 1)]; break; }
    }
    const span = b.recvTime - a.recvTime;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTime - a.recvTime) / span)) : 1;
    return interpState(a, b, alpha);
  }
}

function interpState(a, b, t) {
  const out = { tick: b.tick, players: {}, props: [] };
  for (const slot of Object.keys(b.players)) {
    const pa = a.players[slot], pb = b.players[slot];
    if (!pa) { out.players[slot] = pb; continue; }
    out.players[slot] = {
      flags: pb.flags,
      bodies: pb.bodies.map((bb, i) => lerpBody(pa.bodies[i], bb, t)),
    };
  }
  const aProps = new Map(a.props.map((p) => [p.index, p]));
  for (const pb of b.props) {
    const pa = aProps.get(pb.index);
    out.props.push(pa ? { index: pb.index, ...lerpBody(pa, pb, t) } : pb);
  }
  return out;
}

function lerpBody(a, b, t) {
  // nlerp on quats (shortest path) — plenty for 20 Hz snapshots
  let dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  const s = dot < 0 ? -1 : 1;
  let qx = a.qx + (s * b.qx - a.qx) * t;
  let qy = a.qy + (s * b.qy - a.qy) * t;
  let qz = a.qz + (s * b.qz - a.qz) * t;
  let qw = a.qw + (s * b.qw - a.qw) * t;
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  return {
    px: a.px + (b.px - a.px) * t,
    py: a.py + (b.py - a.py) * t,
    pz: a.pz + (b.pz - a.pz) * t,
    qx: qx / n, qy: qy / n, qz: qz / n, qw: qw / n,
    vx: b.vx, vy: b.vy, vz: b.vz,
  };
}

function seqNewer(a, b) {
  return b === -1 || ((a - b) & 0xffff) < 0x8000 && a !== b;
}

/** Deterministic host election: lowest peerId string wins. */
export function electHost(peerIds) {
  return [...peerIds].sort()[0];
}
