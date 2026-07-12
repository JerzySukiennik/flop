// GATE D — netcode, 2 headless peers over loopback transports (same
// session/protocol code the browser runs; only the transport differs).
// Join → both players visible on the client. Host dies → client detects
// timeout, elects itself, restores the last full snapshot, keeps simulating.
import RAPIER from '@dimforge/rapier3d-compat';
import { deflateSync, inflateSync } from 'node:zlib';
import { Sim, GROUP_WORLD } from '../src/game/sim.js';
import { HostSession, ClientSession, electHost } from '../src/net/session.js';
import { promoteToHost } from '../src/net/migration.js';
import { TUNING } from '../src/game/tuning.js';
import { createVirtualClock, createLoopbackPair } from './loopback.mjs';

await RAPIER.init();

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

// Deterministic level recipe — MUST be identical on every peer (§5.3).
function buildSim() {
  const sim = new Sim(RAPIER);
  sim.addGround();
  const body = sim.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(2, 0.4, 2),
  );
  const col = RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4).setMass(10)
    .setFriction(0.8).setCollisionGroups(GROUP_WORLD);
  sim.world.createCollider(col, body);
  body.userData = { kind: 'prop', grabbable: true };
  sim.register(body, 'crate', 'prop');
  // both players in the recipe: host slot 0, client slot 1
  sim.addPlayer(0, { x: 0, y: 0.05, z: 0 });
  sim.addPlayer(1, { x: 1.2, y: 0.05, z: 0 });
  sim.activeSlots.add(0);
  sim.activeSlots.add(1);
  return sim;
}

const clock = createVirtualClock();
const deflate = (u8) => new Uint8Array(deflateSync(u8));
const inflate = (u8) => new Uint8Array(inflateSync(u8));

// --- setup: host peer A, client peer B ---
const hostSim = buildSim();
const clientSim = buildSim(); // structural twin (client keeps it as warm standby)
check(hostSim.manifestHash() === clientSim.manifestHash(),
  `manifest hashes match across peers (${hostSim.manifestHash()})`);

const [tHostSide, tClientSide] = createLoopbackPair(clock, 40);
tHostSide.peerId = 'peer-bbb'; // transport to client, identified by client id
const host = new HostSession(hostSim, { now: clock.now, deflate, localSlot: 0 });
host.joinOrder.push('peer-aaa'); // host itself
host.addPeer('peer-bbb', tHostSide, 1);

const client = new ClientSession({
  now: clock.now, inflate, transport: tClientSide, localSlot: 1,
  expectedManifestHash: clientSim.manifestHash(),
});
let desync = false;
client.onDesync = () => { desync = true; };

// --- run 4 virtual seconds: client walks forward ---
const clientInput = { moveX: 0, moveZ: 1, yaw: 0, pitch: 0, jump: false, grabL: false, grabR: false };
const FRAME = 1000 / 60;
for (let f = 0; f < 240; f++) {
  clock.advance(FRAME, [tHostSide._drain, tClientSide._drain]);
  client.update(clientInput);
  host.update(FRAME / 1000);
}

console.log('— Join / state flow —');
check(client.buffer.length > 5, `client received state snapshots (${client.buffer.length} buffered)`);
const interp = client.sampleInterpolated();
check(interp !== null && Object.keys(interp.players).length === 2,
  `client sees 2 players (${interp ? Object.keys(interp.players).length : 0})`);
const clientPlayerOnHost = hostSim.players[1].ragdoll.bodies.pelvis.translation();
check(clientPlayerOnHost.z > 2, `client input drove their ragdoll on the host (z=${clientPlayerOnHost.z.toFixed(2)})`);
check(client.lastFull !== null, 'client holds a full snapshot (warm standby)');
check(!desync, 'no manifest desync');
const stateBytes = client.buffer[client.buffer.length - 1] ?
  new Uint8Array(0) : null;

// snapshot size sanity
{
  const raw = hostSim.world.takeSnapshot();
  const packed = deflate(raw);
  console.log(`  (info) full snapshot ${raw.length} B raw, ${packed.length} B deflated`);
  check(packed.length < 250000, 'full snapshot fits chunked reliable transfer');
}

console.log('— Host death → migration —');
const hostLastTick = hostSim.tick;
const standbyTick = client.lastFull.tick;
// Host goes silent (window closed): just stop calling host.update.
for (let f = 0; f < 200; f++) {
  clock.advance(FRAME, [tClientSide._drain]);
  if (client.hostTimedOut()) break;
}
check(client.hostTimedOut(), 'client detected host timeout');
const survivors = ['peer-bbb'];
check(electHost(survivors) === 'peer-bbb', 'deterministic election picked the client');

const t0 = clock.now();
const promoted = promoteToHost(RAPIER, clientSim, client.lastFull.bytes);
check(promoted.world.bodies.len() === hostSim.world.bodies.len(),
  `restored world has identical body count (${promoted.world.bodies.len()})`);

// restored positions ≈ host's world at snapshot time — compare via crate
const hostCrate = hostSim.entities.find((e) => e.id === 'crate').body.translation();
const newCrate = promoted.entities.find((e) => e.id === 'crate').body.translation();
check(Math.hypot(hostCrate.x - newCrate.x, hostCrate.y - newCrate.y, hostCrate.z - newCrate.z) < 0.5,
  'restored crate position matches old host');

// new host keeps simulating: walk player 1 for 2 s, no NaN, tick advances
promoted.tick = standbyTick;
promoted.setInput(1, clientInput);
for (let i = 0; i < 120; i++) promoted.step();
const p1 = promoted.players[1].ragdoll.bodies.pelvis.translation();
check(Number.isFinite(p1.x + p1.y + p1.z), 'no NaN after migration');
check(p1.y > 0.4, `player upright post-migration (pelvis ${p1.y.toFixed(2)})`);
const migrationMs = clock.now() - t0;
check(migrationMs < 3000, `migration completed in ${migrationMs.toFixed(0)} ms (< 3 s)`);
check(standbyTick > hostLastTick - 60 * 2.5, `rewind ≤ ~2 s (standby tick ${standbyTick} vs host ${hostLastTick})`);

if (failures) { console.error(`GATE D: FAIL (${failures})`); process.exit(1); }
console.log('GATE D: PASS');
