// Game orchestrator (browser): world build/teardown, solo/host/client flows,
// per-frame update, camera, spectator free-cam, emotes, level changes,
// host migration. All physics decisions live in src/game/ — this file wires.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { deflateSync, inflateSync } from 'fflate';
import { buildGameSim, LEVELS } from './game/recipe.js';
import { HostSession, ClientSession, electHost } from './net/session.js';
import { promoteToHost } from './net/migration.js';
import { createDialer } from './net/peer.js';
import { RagdollView, PLAYER_COLORS } from './render/ragdollView.js';
import { LevelView } from './render/levelView.js';

const now = () => performance.now();
const deflate = (u8) => deflateSync(u8);
const inflate = (u8) => inflateSync(u8);

export class Game {
  constructor({ scene, camera, input, hud, customization }) {
    this.scene = scene;
    this.camera = camera;
    this.input = input;
    this.hud = hud;
    this.customization = customization;   // local player's {color, hat, name}
    this.customBySlot = {};               // networked customizations
    this.mode = null;                     // 'solo' | 'host' | 'client'
    this.localSlot = 0;
    this.generation = 0;
    this.world = null;                    // {sim, runtime, level, levelView, ragdollViews}
    this.hostSession = null;
    this.clientSession = null;
    this.sig = null;
    this.dialer = null;
    this.roomCode = null;
    this.freeCam = false;
    this._freeCamPos = new THREE.Vector3();
    this._prevCamKey = false;
    this._migrating = false;
    this.levelName = 'hub';
    this.grappleLines = {};               // slot → THREE.Line
  }

  // ---------- world lifecycle ----------
  _buildWorld(levelName) {
    this._teardownWorld();
    const { sim, runtime, level } = buildGameSim(RAPIER, levelName);
    const levelView = new LevelView(this.scene, level, sim);
    const ragdollViews = [];
    for (let slot = 0; slot < 4; slot++) {
      const view = new RagdollView(this.scene, slot, this.customBySlot[slot] ?? {});
      view.setVisible(false);
      ragdollViews.push(view);
    }
    this.world = { sim, runtime, level, levelView, ragdollViews };
    this.levelName = levelName;
    runtime.onEvent = (ev) => this._onGameEvent(ev, true);
    return this.world;
  }

  _teardownWorld() {
    if (!this.world) return;
    this.world.levelView.dispose();
    for (const v of this.world.ragdollViews) v.dispose(this.scene);
    for (const line of Object.values(this.grappleLines)) this.scene.remove(line);
    this.grappleLines = {};
    this.world.sim.world.free();
    this.world = null;
  }

  _applyCustomization(slot, custom) {
    this.customBySlot[slot] = custom;
    const view = this.world?.ragdollViews[slot];
    if (view) {
      if (custom.color) view.setColor(custom.color);
      if (custom.hat) view.setHat(custom.hat);
    }
  }

  // ---------- modes ----------
  startSolo(levelName = 'hub') {
    this.mode = 'solo';
    this.localSlot = 0;
    this._buildWorld(levelName);
    const { sim, runtime } = this.world;
    sim.activatePlayer(0, runtime.spawnPoint(0));
    this._applyCustomization(0, this.customization);
    this.hud.setRoom(null);
    this.hud.setRoster([{ slot: 0 }], this._rosterColors(), 0);
    this.hud.message(`${this.world.level.name} — solo practice`);
  }

  async startHost(sig, levelName = 'hub') {
    this.mode = 'host';
    this.localSlot = 0;
    this.sig = sig;
    this._buildWorld(levelName);
    const { sim, runtime } = this.world;
    sim.activatePlayer(0, runtime.spawnPoint(0));
    this._applyCustomization(0, this.customization);

    this.roomCode = await sig.createLobby(`${this.customization.name || 'Flopper'}'s game`, levelName);
    this.hostSession = new HostSession(sim, { now, deflate, localSlot: 0 });
    this.hostSession.generation = this.generation;
    this.hostSession.joinOrder.push(sig.uid);
    this.hostSession.onEvent = (slot, ev) => this._onPeerEvent(slot, ev);
    this.dialer = createDialer(sig, this.roomCode);
    sig.listenInbox(this.roomCode, (msg) => {
      this.dialer.routeSignal(msg, (transport) => this._acceptJoin(msg.from, transport));
    });
    this.hud.setRoom(this.roomCode);
    this._refreshRosterHud();
    this.hud.message(`Hosting — room code ${this.roomCode}`, 5000);
  }

  async _acceptJoin(peerId, transport) {
    await transport.opened;
    const { sim, runtime } = this.world;
    // reuse slot if this peer was here before (migration re-dial), else lowest free
    let slot = this.hostSession.peers.get(peerId)?.slot;
    if (slot === undefined) {
      const taken = new Set([this.localSlot, ...[...this.hostSession.peers.values()].map((p) => p.slot)]);
      slot = [0, 1, 2, 3].find((s) => !taken.has(s));
    }
    if (slot === undefined) {
      transport.send('events', encodeJsonEvent({ t: 'full' }));
      transport.close();
      return;
    }
    transport.peerId = peerId;
    this.hostSession.addPeer(peerId, transport, slot);
    sim.activatePlayer(slot, runtime.spawnPoint(slot));
    this.hostSession.broadcastEvent({
      t: 'welcome', forPeer: peerId, slot, level: this.levelName,
      generation: this.generation, customs: this.customBySlot,
    });
    this.sig.updateLobby({ playerCount: 1 + this.hostSession.peers.size, level: this.levelName });
    this._refreshRosterHud();
    this.hud.message(`P${slot + 1} joined!`);
  }

  async startClient(sig, code) {
    this.mode = 'client';
    this.sig = sig;
    const lobby = await sig.getLobby(code);
    if (!lobby) throw new Error(`room ${code} not found`);
    this.roomCode = code;
    this.dialer = createDialer(sig, code);
    sig.listenInbox(code, (msg) => {
      this.dialer.routeSignal(msg, (t) => this._clientAcceptHostDial(t));
    });
    const transport = await this.dialer.dial(lobby.hostPeerId);
    this.currentHostId = lobby.hostPeerId;
    await Promise.race([
      transport.opened,
      new Promise((_, rej) => setTimeout(() => rej(new Error('connection timed out (NAT?)')), 15000)),
    ]);
    this._attachClientSession(transport);
    this.hud.setRoom(code);
  }

  _attachClientSession(transport) {
    this.clientSession = new ClientSession({
      now, inflate, transport, localSlot: this.localSlot, generation: this.generation,
    });
    this.clientSession.onEvent = (ev) => this._onNetEvent(ev);
    this.clientSession.onDesync = (got, want) => {
      console.error(`[flop] MANIFEST DESYNC: host=${got} local=${want}`);
      this.hud.message('⚠ desync detected — rejoining…', 4000);
    };
  }

  _clientAcceptHostDial(transport) {
    // new host (post-migration) dialed us
    transport.opened.then(() => {
      this._attachClientSession(transport);
      this._migrating = false;
    });
  }

  _onNetEvent(ev) {
    if (ev.t === 'welcome') {
      if (ev.forPeer && ev.forPeer !== this.sig.uid) {
        if (ev.customs) for (const [slot, c] of Object.entries(ev.customs)) this._applyCustomization(+slot, c);
        return;
      }
      this.localSlot = ev.slot;
      this.generation = ev.generation ?? 0;
      this._buildWorld(ev.level);
      if (this.clientSession) {
        this.clientSession.localSlot = ev.slot;
        this.clientSession.resetForLevel(this.generation, this.world.sim.manifestHash());
      }
      for (const [slot, c] of Object.entries(ev.customs ?? {})) this._applyCustomization(+slot, c);
      this.clientSession.sendEvent({ t: 'custom', custom: this.customization, relay: true });
      this.hud.message(`Joined as P${ev.slot + 1} — ${this.world.level.name}`);
    } else if (ev.t === 'custom' && ev.fromSlot !== undefined) {
      this._applyCustomization(ev.fromSlot, ev.custom);
    } else if (ev.t === 'levelChange') {
      this.generation = ev.generation;
      this._buildWorld(ev.target);
      this.clientSession.resetForLevel(this.generation, this.world.sim.manifestHash());
      this.hud.message(`→ ${this.world.level.name}`);
    } else if (ev.t === 'emote') {
      this.world?.ragdollViews[ev.fromSlot ?? ev.slot]?.showEmote(ev.emoji);
    } else if (ev.t === 'roster') {
      this._refreshRosterHud(ev.roster);
    } else if (ev.t === 'game') {
      this._onGameEvent(ev.ev, false);
    } else if (ev.t === 'full') {
      this.hud.message('room is full (4/4)', 4000);
    }
  }

  /** Level-runtime events. authoritative=true when we run the sim. */
  _onGameEvent(ev, authoritative) {
    if (authoritative && this.hostSession) {
      this.hostSession.broadcastEvent({ t: 'game', ev });
    }
    switch (ev.t) {
      case 'checkpoint': this.hud.message('✓ checkpoint'); break;
      case 'respawn': if (ev.slot === this.localSlot) this.hud.message('back to checkpoint…'); break;
      case 'portalArmed': this.hud.message(`portal → ${ev.target} in ${ev.seconds}s — pile in!`, 4500); break;
      case 'lever': this.hud.message(ev.active ? '⚙ lever ON' : '⚙ lever off', 1200); break;
      case 'valve': this.hud.message('⚙ gate open!'); break;
      case 'grapplePickup': if (ev.slot === this.localSlot) this.hud.message('🪝 grappling hook! press E to fire'); break;
      case 'levelChange':
        if (authoritative) this.changeLevel(ev.target);
        break;
      default: break;
    }
  }

  _onPeerEvent(slot, ev) {
    if (ev.t === 'custom') this._applyCustomization(slot, ev.custom);
    if (ev.t === 'emote') this.world?.ragdollViews[slot]?.showEmote(ev.emoji);
  }

  /** Host: rebuild world on a new level and tell everyone. */
  changeLevel(target) {
    if (this.mode === 'client') return;
    const activeBefore = [...(this.world?.sim.activeSlots ?? [])];
    this.generation = (this.generation + 1) & 0xff;
    this._buildWorld(target);
    const { sim, runtime } = this.world;
    for (const slot of activeBefore) sim.activatePlayer(slot, runtime.spawnPoint(slot));
    for (const [slot, c] of Object.entries(this.customBySlot)) this._applyCustomization(+slot, c);
    if (this.hostSession) {
      this.hostSession.rebindSim(sim, this.generation);
      this.hostSession.broadcastEvent({ t: 'levelChange', target, generation: this.generation });
      this.sig?.updateLobby({ level: target });
    }
    this.hud.message(`→ ${this.world.level.name}`);
  }

  sendEmote(emoji) {
    this.world?.ragdollViews[this.localSlot]?.showEmote(emoji);
    if (this.mode === 'client') this.clientSession?.sendEvent({ t: 'emote', emoji, relay: true });
    else this.hostSession?.broadcastEvent({ t: 'emote', emoji, fromSlot: this.localSlot });
  }

  _rosterColors() {
    const colors = {};
    for (let s = 0; s < 4; s++) colors[s] = this.customBySlot[s]?.color ?? PLAYER_COLORS[s];
    return colors;
  }

  _refreshRosterHud(roster) {
    const r = roster
      ?? (this.hostSession ? this.hostSession.roster()
        : [...(this.world?.sim.activeSlots ?? [])].map((slot) => ({ slot })));
    this.hud.setRoster(r, this._rosterColors(), this.localSlot);
  }

  // ---------- migration ----------
  async _checkMigration() {
    const cs = this.clientSession;
    if (!cs || this._migrating || !cs.hostTimedOut()) return;
    if (!cs.lastFull) { this.hud.message('host lost — no snapshot, back to menu', 5000); this.mode = 'dead'; return; }
    this._migrating = true;
    this.hud.message('host lost — migrating…', 3000);
    const roster = cs.lastFull.roster ?? cs.roster;
    const peers = roster.map((r) => (r.peerId === 'host' ? this.currentHostId : r.peerId))
      .filter((id) => id !== this.currentHostId);
    const winner = electHost(peers);
    if (winner === this.sig.uid) {
      // I become the host.
      promoteToHost(RAPIER, this.world.sim, cs.lastFull.bytes);
      this.world.sim.activeSlots.clear();
      const slotByPeer = new Map(roster.map((r) => [r.peerId === 'host' ? this.currentHostId : r.peerId, r.slot]));
      for (const [, slot] of slotByPeer) {
        if (slot !== undefined) this.world.sim.activeSlots.add(slot);
      }
      this.world.sim.activeSlots.delete(slotByPeer.get(this.currentHostId)); // dead host leaves
      this.mode = 'host';
      this.localSlot = slotByPeer.get(this.sig.uid) ?? this.localSlot;
      this.clientSession = null;
      this.hostSession = new HostSession(this.world.sim, { now, deflate, localSlot: this.localSlot });
      this.hostSession.generation = this.generation;
      this.hostSession.onEvent = (slot, ev) => this._onPeerEvent(slot, ev);
      await this.sig.claimLobby(this.roomCode, this.levelName, peers.length);
      // remaining peers will time out too, elect me, and dial me via inbox
      this.hud.message('you are the new host!', 4000);
      this.hud.setRoom(this.roomCode);
      this._migrating = false;
    } else {
      // dial the elected host after a grace period
      setTimeout(async () => {
        try {
          const t = await this.dialer.dial(winner);
          this.currentHostId = winner;
          await Promise.race([
            t.opened,
            new Promise((_, rej) => setTimeout(() => rej(new Error('migration dial timeout')), 12000)),
          ]);
          this._attachClientSession(t);
          this._migrating = false;
          this.hud.message('migrated to new host');
        } catch {
          this.hud.message('migration failed — back to menu', 5000);
          this.mode = 'dead';
        }
      }, 2500);
    }
  }

  // ---------- per-frame ----------
  update(elapsed) {
    if (!this.world) return;
    const { sim, runtime, levelView, ragdollViews } = this.world;
    const rawInput = this.input.sample();

    // free-cam toggle (add-on #4)
    const camKey = this.input.keys.has('KeyC');
    if (camKey && !this._prevCamKey) {
      this.freeCam = !this.freeCam;
      if (this.freeCam) this._freeCamPos.copy(this.camera.position);
      this.hud.message(this.freeCam ? 'free-cam (C to return)' : 'back in body', 1500);
    }
    this._prevCamKey = camKey;
    const simInput = this.freeCam
      ? { moveX: 0, moveZ: 0, yaw: rawInput.yaw, pitch: rawInput.pitch, jump: false, grabL: false, grabR: false, grapple: false }
      : rawInput;

    if (this.mode === 'solo') {
      sim.setInput(this.localSlot, simInput);
      sim.advance(elapsed);
    } else if (this.mode === 'host') {
      sim.setInput(this.localSlot, simInput);
      this.hostSession.update(elapsed);
    } else if (this.mode === 'client') {
      this.clientSession?.update(simInput);
      this._checkMigration();
    }

    // --- render state ---
    let localPelvis = null;
    if (this.mode === 'client' && this.clientSession) {
      const interp = this.clientSession.sampleInterpolated();
      if (interp) {
        for (let slot = 0; slot < 4; slot++) {
          const pdata = interp.players[slot];
          ragdollViews[slot].setVisible(!!pdata);
          if (pdata) {
            ragdollViews[slot].updateFromTransforms(pdata.bodies);
            if (slot === this.localSlot) {
              const b = pdata.bodies[0];
              localPelvis = { x: b.px, y: b.py, z: b.pz };
            }
          }
        }
        levelView.updateFromProps(interp.props);
      }
    } else {
      for (let slot = 0; slot < 4; slot++) {
        const active = sim.activeSlots.has(slot);
        ragdollViews[slot].setVisible(active);
        if (active) ragdollViews[slot].updateFromBodies(sim.players[slot].ragdoll.partList);
      }
      levelView.updateFromSim(sim);
      const p = sim.players[this.localSlot]?.ragdoll.bodies.pelvis.translation();
      if (p) localPelvis = p;
      this._updateGrappleLines(sim);
    }
    for (const v of ragdollViews) v.tickEmote(elapsed);

    // --- camera ---
    if (this.freeCam) {
      const speed = 9 * elapsed;
      const yaw = rawInput.yaw, pitch = rawInput.pitch;
      const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      this._freeCamPos.addScaledVector(fwd, rawInput.moveZ * speed);
      this._freeCamPos.addScaledVector(right, rawInput.moveX * speed);
      this.camera.position.copy(this._freeCamPos);
      this.camera.lookAt(this._freeCamPos.clone().add(fwd));
    } else if (localPelvis) {
      const cy = Math.cos(rawInput.pitch), sy = Math.sin(rawInput.pitch);
      const dist = 3.4;
      this.camera.position.set(
        localPelvis.x - Math.sin(rawInput.yaw) * cy * dist,
        localPelvis.y + 0.9 + sy * dist,
        localPelvis.z - Math.cos(rawInput.yaw) * cy * dist,
      );
      this.camera.lookAt(localPelvis.x, localPelvis.y + 0.7, localPelvis.z);
    }
  }

  _updateGrappleLines(sim) {
    for (let slot = 0; slot < 4; slot++) {
      const player = sim.players[slot];
      const g = player?.arms.grapple;
      const active = g?.joint && g.target;
      let line = this.grappleLines[slot];
      if (active) {
        const fa = player.ragdoll.bodies.forearmR.translation();
        if (!line) {
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
          line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd24a }));
          this.scene.add(line);
          this.grappleLines[slot] = line;
        }
        const pos = line.geometry.attributes.position;
        pos.setXYZ(0, fa.x, fa.y, fa.z);
        pos.setXYZ(1, g.target.x, g.target.y, g.target.z);
        pos.needsUpdate = true;
      } else if (line) {
        this.scene.remove(line);
        delete this.grappleLines[slot];
      }
    }
  }
}

function encodeJsonEvent(obj) {
  const body = new TextEncoder().encode(JSON.stringify(obj));
  const buf = new Uint8Array(1 + body.length);
  buf[0] = 3; // MSG.EVENT_JSON
  buf.set(body, 1);
  return buf.buffer;
}
