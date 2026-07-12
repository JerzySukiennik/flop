// Firebase RTDB: lobby directory + WebRTC signalling inboxes. This is ALL
// Firebase does. peerId ≡ anonymous-auth uid (rules are keyed on it).
//
// Schema:
//   /lobbies/{roomCode} { name, hostPeerId, hostUid, playerCount, maxPlayers,
//                         level, createdAt, heartbeat }
//   /signals/{roomCode}/{peerId}/inbox/{pushId} { from, kind, payload }
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getDatabase, ref, set, get, update, remove, push, onChildAdded,
  onDisconnect, serverTimestamp,
} from 'firebase/database';
import { firebaseConfig } from './firebase-config.js';

const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ'; // no vowels → no accidental words

export class Signalling {
  constructor() {
    this.app = initializeApp(firebaseConfig);
    this.db = getDatabase(this.app);
    this.auth = getAuth(this.app);
    this.uid = null;
    this.room = null;
    this._inboxUnsub = null;
    this._heartbeatTimer = null;
  }

  async signIn() {
    const cred = await signInAnonymously(this.auth);
    this.uid = cred.user.uid;
    // Two tabs in one browser share the anonymous uid — suffix a per-session
    // tag so a player can join a lobby hosted from the same browser profile.
    // Rules key signal nodes on beginsWith(auth.uid).
    const tag = [...crypto.getRandomValues(new Uint8Array(3))]
      .map((b) => b.toString(36).slice(-1)).join('');
    this.peerId = `${this.uid}-${tag}`;
    return this.peerId;
  }

  randomCode() {
    let code = '';
    const rand = crypto.getRandomValues(new Uint32Array(4));
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[rand[i] % CODE_ALPHABET.length];
    return code;
  }

  async createLobby(name, level) {
    const code = this.randomCode();
    const lobbyRef = ref(this.db, `lobbies/${code}`);
    await set(lobbyRef, {
      name: name || `${code} party`,
      hostPeerId: this.peerId,
      hostUid: this.uid,
      playerCount: 1,
      maxPlayers: 4,
      level,
      createdAt: serverTimestamp(),
      heartbeat: serverTimestamp(),
    });
    onDisconnect(lobbyRef).remove();
    this.room = code;
    this._heartbeatTimer = setInterval(() => {
      update(lobbyRef, { heartbeat: serverTimestamp() }).catch(() => {});
    }, 10000);
    return code;
  }

  async updateLobby(fields) {
    if (!this.room) return;
    await update(ref(this.db, `lobbies/${this.room}`), fields).catch(() => {});
  }

  /** Take over a lobby after host death (rules allow if heartbeat stale). */
  async claimLobby(code, level, playerCount) {
    const lobbyRef = ref(this.db, `lobbies/${code}`);
    const snap = await get(lobbyRef);
    const old = snap.val() ?? {};
    await set(lobbyRef, {
      name: old.name ?? `${code} party`,
      hostPeerId: this.peerId,
      hostUid: this.uid,
      playerCount,
      maxPlayers: 4,
      level,
      createdAt: old.createdAt ?? serverTimestamp(),
      heartbeat: serverTimestamp(),
    });
    onDisconnect(lobbyRef).remove();
    this.room = code;
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      update(lobbyRef, { heartbeat: serverTimestamp() }).catch(() => {});
    }, 10000);
  }

  async listLobbies() {
    const snap = await get(ref(this.db, 'lobbies'));
    const all = snap.val() ?? {};
    const out = [];
    const cutoff = Date.now() - 30000;
    for (const [code, lobby] of Object.entries(all)) {
      if ((lobby.heartbeat ?? 0) < cutoff) {
        // prune stale lobbies on read (no cloud functions on free tier)
        remove(ref(this.db, `lobbies/${code}`)).catch(() => {});
        remove(ref(this.db, `signals/${code}`)).catch(() => {});
        continue;
      }
      out.push({ code, ...lobby });
    }
    return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  async getLobby(code) {
    const snap = await get(ref(this.db, `lobbies/${code}`));
    return snap.val();
  }

  /** Start receiving my inbox for a room; returns unsubscribe. */
  listenInbox(code, onMsg) {
    this.room = code;
    const inboxRef = ref(this.db, `signals/${code}/${this.peerId}/inbox`);
    // claim my signal node (rules: only I can create it)
    set(ref(this.db, `signals/${code}/${this.peerId}/uid`), this.uid).catch(() => {});
    onDisconnect(ref(this.db, `signals/${code}/${this.peerId}`)).remove();
    this._inboxUnsub = onChildAdded(inboxRef, (child) => {
      const msg = child.val();
      remove(child.ref).catch(() => {});
      if (msg && msg.from !== this.peerId) onMsg(msg);
    });
    return this._inboxUnsub;
  }

  /** Push a signalling message into another peer's inbox. */
  sendTo(code, peerId, kind, payload) {
    return push(ref(this.db, `signals/${code}/${peerId}/inbox`), {
      from: this.peerId, kind, payload: JSON.stringify(payload),
    });
  }

  leave() {
    clearInterval(this._heartbeatTimer);
    if (this._inboxUnsub) { this._inboxUnsub(); this._inboxUnsub = null; }
    if (this.room) {
      remove(ref(this.db, `signals/${this.room}/${this.peerId}`)).catch(() => {});
    }
  }
}
