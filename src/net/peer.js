// WebRTC transport: vanilla RTCPeerConnection + two DataChannels matching
// the transport interface session.js expects. No TURN (documented) —
// public STUN only.
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class RtcTransport {
  constructor(peerId) {
    this.peerId = peerId;
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.channels = { state: null, events: null };
    this._msgHandlers = [];
    this._closeHandlers = [];
    this._openResolve = null;
    this.opened = new Promise((res) => { this._openResolve = res; });
    this._openCount = 0;
    this.onIceCandidate = null;
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.onIceCandidate?.(e.candidate.toJSON());
    };
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) {
        this._fireClose();
      }
    };
  }

  _wireChannel(name, ch) {
    ch.binaryType = 'arraybuffer';
    this.channels[name] = ch;
    const countOpen = () => { if (++this._openCount === 2) this._openResolve(); };
    // The channel may already be open by the time we wire it (ondatachannel
    // can deliver an open channel) — onopen would never fire then.
    if (ch.readyState === 'open') countOpen();
    else ch.onopen = countOpen;
    ch.onmessage = (e) => { for (const cb of this._msgHandlers) cb(name, e.data); };
    ch.onclose = () => this._fireClose();
  }

  /** Offerer creates the channels. */
  async makeOffer() {
    this._wireChannel('state', this.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
    this._wireChannel('events', this.pc.createDataChannel('events', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /** Answerer receives channels via ondatachannel. */
  async makeAnswer(offer) {
    this.pc.ondatachannel = (e) => this._wireChannel(e.channel.label, e.channel);
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._flushPendingCandidates();
    return answer;
  }

  async acceptAnswer(answer) {
    await this.pc.setRemoteDescription(answer);
    await this._flushPendingCandidates();
  }

  /** Candidates can arrive over signalling before the remote description is
   * set (messages process concurrently) — buffer them or they're lost. */
  async addIceCandidate(candidate) {
    if (!this.pc.remoteDescription) {
      (this._pendingCandidates ??= []).push(candidate);
      return;
    }
    try { await this.pc.addIceCandidate(candidate); } catch { /* late/dup */ }
  }

  async _flushPendingCandidates() {
    const pending = this._pendingCandidates ?? [];
    this._pendingCandidates = [];
    for (const c of pending) {
      try { await this.pc.addIceCandidate(c); } catch { /* late/dup */ }
    }
  }

  send(channel, data) {
    const ch = this.channels[channel];
    if (ch && ch.readyState === 'open') {
      try { ch.send(data); } catch { /* buffer full on unreliable — drop */ }
    }
  }

  onMessage(cb) { this._msgHandlers.push(cb); }
  onClose(cb) { this._closeHandlers.push(cb); }

  _fireClose() {
    if (this._closed) return;
    this._closed = true;
    for (const cb of this._closeHandlers) cb();
  }

  close() {
    this._fireClose();
    try { this.pc.close(); } catch { /* already closed */ }
  }
}

/**
 * Dial a peer: create transport, exchange SDP/ICE via signalling inboxes.
 * `sig.listenInbox` must already be running; route replies via `routeSignal`.
 */
export function createDialer(sig, code) {
  const transports = new Map(); // peerId → RtcTransport

  async function dial(peerId) {
    const t = new RtcTransport(peerId);
    transports.set(peerId, t);
    t.onIceCandidate = (c) => sig.sendTo(code, peerId, 'ice', c);
    const offer = await t.makeOffer();
    await sig.sendTo(code, peerId, 'offer', offer);
    return t;
  }

  async function routeSignal(msg, onIncoming) {
    const payload = JSON.parse(msg.payload);
    let t = transports.get(msg.from);
    if (msg.kind === 'offer') {
      if (!t) {
        t = new RtcTransport(msg.from);
        transports.set(msg.from, t);
        t.onIceCandidate = (c) => sig.sendTo(code, msg.from, 'ice', c);
      }
      const answer = await t.makeAnswer(payload);
      await sig.sendTo(code, msg.from, 'answer', answer);
      onIncoming?.(t);
    } else if (msg.kind === 'answer' && t) {
      await t.acceptAnswer(payload);
    } else if (msg.kind === 'ice' && t) {
      await t.addIceCandidate(payload);
    }
  }

  return { dial, routeSignal, transports };
}
