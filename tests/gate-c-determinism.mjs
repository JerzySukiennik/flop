// GATE C — determinism & snapshot fidelity. Blocks host migration trust.
// 1. Same recipe twice → identical manifest hash.
// 2. Pure physics: snapshot a world mid-action, restore, step both 60 ticks
//    → positions match the control world (tight ε — same WASM, same order).
// 3. Full sim with ragdoll controllers: restored twin stays within a loose ε
//    (controller micro-state isn't serialized; ≤2 s rewind tolerates it).
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, GROUP_WORLD } from '../src/game/sim.js';
import { promoteToHost } from '../src/net/migration.js';

await RAPIER.init();

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

function buildSim(withPlayers) {
  const sim = new Sim(RAPIER);
  sim.addGround();
  for (let i = 0; i < 6; i++) {
    const body = sim.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(i * 0.5 - 1.5, 2 + i * 0.9, 3)
        .setRotation({ x: 0.2, y: 0.1, z: 0.3, w: 0.927 }),
    );
    const col = RAPIER.ColliderDesc.cuboid(0.3, 0.2, 0.25).setMass(8)
      .setFriction(0.6).setCollisionGroups(GROUP_WORLD);
    sim.world.createCollider(col, body);
    body.userData = { kind: 'prop', grabbable: true };
    sim.register(body, `crate${i}`, 'prop');
  }
  if (withPlayers) {
    sim.addPlayer(0, { x: 0, y: 0.05, z: 0 });
    sim.addPlayer(2, { x: 1.5, y: 0.05, z: 0.5 }, 1.2);
  }
  return sim;
}

console.log('— Test 1: manifest determinism —');
{
  const a = buildSim(true), b = buildSim(true);
  check(a.manifestHash() === b.manifestHash(), `identical recipe → identical hash (${a.manifestHash()})`);
  const c = buildSim(false);
  check(a.manifestHash() !== c.manifestHash(), 'different recipe → different hash (guard actually guards)');
}

console.log('— Test 2: pure-physics snapshot fidelity (tumbling crates) —');
{
  const control = buildSim(false);
  for (let i = 0; i < 90; i++) control.world.step(); // crates mid-tumble
  const snap = control.world.takeSnapshot();
  const twin = buildSim(false);
  const restored = promoteToHost(RAPIER, twin, snap);
  // step both raw worlds in lockstep
  for (let i = 0; i < 60; i++) { control.world.step(); restored.world.step(); }
  let maxErr = 0;
  for (let i = 0; i < 6; i++) {
    const a = control.entities.find((e) => e.id === `crate${i}`).body.translation();
    const b = restored.entities.find((e) => e.id === `crate${i}`).body.translation();
    maxErr = Math.max(maxErr, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  check(maxErr < 1e-4, `restored world tracks control exactly (max err ${maxErr.toExponential(2)} m)`);
}

console.log('— Test 3: full-sim restore with ragdolls —');
{
  const control = buildSim(true);
  control.setInput(0, { moveZ: 1, yaw: 0.3 });
  for (let i = 0; i < 240; i++) control.step(); // walking mid-stride
  const snap = control.world.takeSnapshot();
  const controlTick = control.tick;
  const twin = buildSim(true);
  const restored = promoteToHost(RAPIER, twin, snap);
  restored.tick = controlTick;
  restored.setInput(0, { moveZ: 1, yaw: 0.3 });
  // twin controllers start cold (gait phase differs) — verify bounded drift,
  // structural integrity and continued life, not bit-equality.
  for (let i = 0; i < 120; i++) { control.step(); restored.step(); }
  let ok = true, maxErr = 0;
  for (const slot of [0, 2]) {
    const a = control.players[slot].ragdoll.bodies.pelvis.translation();
    const b = restored.players[slot].ragdoll.bodies.pelvis.translation();
    if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) ok = false;
    maxErr = Math.max(maxErr, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  check(ok, 'no NaN in either world');
  check(maxErr < 1.0, `ragdoll drift bounded after 2 s (${maxErr.toFixed(3)} m — controller micro-state not serialized)`);
  const b0 = restored.players[0].ragdoll.bodies.pelvis.translation();
  check(b0.y > 0.4, `restored ragdoll still standing/walking (pelvis ${b0.y.toFixed(2)})`);
}

if (failures) { console.error(`GATE C: FAIL (${failures})`); process.exit(1); }
console.log('GATE C: PASS');
