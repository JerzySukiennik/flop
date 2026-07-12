// GATE B — grab mechanics, headless. Blocks level puzzles.
// 1. Aim at a light box → spring joint forms. 2. Release → joint gone, box
// falls. 3. Heavy crate rips free when dragged. 4. Players can grab players.
// 5. Hanging from a wall holds body weight (climb prerequisite).
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, GROUP_WORLD } from '../src/game/sim.js';

await RAPIER.init();

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

function addBox(sim, id, pos, half, massKg, fixed = false) {
  const desc = fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
  desc.setTranslation(pos.x, pos.y, pos.z);
  const body = sim.world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setFriction(0.8).setCollisionGroups(GROUP_WORLD);
  if (!fixed) col.setMass(massKg);
  sim.world.createCollider(col, body);
  body.userData = { kind: 'prop', grabbable: true };
  sim.register(body, id, fixed ? 'static' : 'prop');
  return body;
}

console.log('— Test 1: grab a light box —');
{
  const sim = new Sim(RAPIER);
  sim.addGround();
  const p = sim.addPlayer(0, { x: 0, y: 0.05, z: 0 });
  addBox(sim, 'pedestal', { x: 0.26, y: 0.5, z: 0.75 }, { x: 0.2, y: 0.5, z: 0.2 }, 0, true);
  const box = addBox(sim, 'box', { x: 0.26, y: 1.15, z: 0.75 }, { x: 0.15, y: 0.15, z: 0.15 }, 5);
  for (let i = 0; i < 120; i++) sim.step(); // settle
  sim.setInput(0, { grabR: true, yaw: 0, pitch: -0.25 });
  let grabbed = false;
  for (let i = 0; i < 360 && !grabbed; i++) {
    sim.step();
    grabbed = p.arms.grabs.R !== null;
  }
  check(grabbed, 'right arm latched onto the box');
  check(grabbed && p.arms.grabs.R.otherBody.handle === box.handle, 'latched body IS the box');

  // hold for a second — joint must persist
  for (let i = 0; i < 60; i++) sim.step();
  check(p.arms.grabs.R !== null, 'grip persists while holding a 5 kg box');

  console.log('— Test 2: release —');
  const yHeld = box.translation().y;
  sim.setInput(0, { grabR: false });
  sim.step();
  check(p.arms.grabs.R === null, 'joint destroyed on release');
  for (let i = 0; i < 90; i++) sim.step();
  check(box.translation().y < yHeld - 0.05 || box.translation().y < 0.4,
    `box fell after release (${yHeld.toFixed(2)} → ${box.translation().y.toFixed(2)})`);
}

console.log('— Test 3: heavy crate rips free —');
{
  const sim = new Sim(RAPIER);
  sim.addGround();
  const p = sim.addPlayer(0, { x: 0, y: 0.05, z: 0 });
  addBox(sim, 'heavy', { x: 0.26, y: 0.6, z: 0.85 }, { x: 0.6, y: 0.6, z: 0.6 }, 500);
  for (let i = 0; i < 120; i++) sim.step();
  sim.setInput(0, { grabR: true, yaw: 0, pitch: -0.35 });
  let grabbed = false;
  for (let i = 0; i < 360 && !grabbed; i++) { sim.step(); grabbed = p.arms.grabs.R !== null; }
  check(grabbed, 'latched onto 500 kg crate');
  // yank the crate away hard — force spike far beyond grip budget must rip
  const crate = p.arms.grabs.R?.otherBody;
  crate?.applyImpulse({ x: 0, y: 0, z: 2600 }, true);
  let ripped = false;
  for (let i = 0; i < 120 && !ripped; i++) { sim.step(); ripped = p.arms.grabs.R === null; }
  check(ripped, 'grip ripped free under overload');
  const pv = p.ragdoll.bodies.pelvis.linvel();
  check(Math.hypot(pv.x, pv.y, pv.z) < 4.5,
    `player was not dragged along at crate speed (|v|=${Math.hypot(pv.x, pv.y, pv.z).toFixed(1)})`);
}

console.log('— Test 4: players grab players —');
{
  const sim = new Sim(RAPIER);
  sim.addGround();
  const p0 = sim.addPlayer(0, { x: 0, y: 0.05, z: 0 });
  const p1 = sim.addPlayer(1, { x: 0.3, y: 0.05, z: 0.78 }, Math.PI);
  for (let i = 0; i < 120; i++) sim.step();
  sim.setInput(0, { grabL: true, grabR: true, yaw: 0, pitch: 0.1 });
  let grabbedPart = null;
  for (let i = 0; i < 360 && !grabbedPart; i++) {
    sim.step();
    const g = p0.arms.grabs.L ?? p0.arms.grabs.R;
    if (g && g.otherBody.userData?.kind === 'bodypart' && g.otherBody.userData.player === 1) {
      grabbedPart = g.otherBody.userData.part;
    }
  }
  check(grabbedPart !== null, `player 0 grabbed player 1 (part: ${grabbedPart})`);
}

console.log('— Test 5: hang from a ledge (grip holds body weight) —');
{
  const sim = new Sim(RAPIER);
  sim.addGround();
  // ledge: thin fixed slab at 1.55 m, player right under it
  addBox(sim, 'ledge', { x: 0, y: 1.55, z: 0.55 }, { x: 1.0, y: 0.06, z: 0.35 }, 0, true);
  const p = sim.addPlayer(0, { x: 0, y: 0.05, z: 0 });
  for (let i = 0; i < 60; i++) sim.step();
  sim.setInput(0, { grabL: true, grabR: true, yaw: 0, pitch: 0.55 });
  let both = false;
  for (let i = 0; i < 420 && !both; i++) {
    sim.step();
    both = p.arms.grabs.L !== null && p.arms.grabs.R !== null;
  }
  check(both, 'both hands latched onto the ledge');
  // climb intent: W held → assist + arm pull
  sim.setInput(0, { moveZ: 1, grabL: true, grabR: true });
  let maxPelvis = 0;
  for (let i = 0; i < 300; i++) {
    sim.step();
    maxPelvis = Math.max(maxPelvis, p.ragdoll.bodies.pelvis.translation().y);
  }
  check(p.arms.grabs.L !== null || p.arms.grabs.R !== null, 'grip survived hanging (holds body weight)');
  check(maxPelvis > 1.05, `body hoisted while climbing (pelvis peaked at ${maxPelvis.toFixed(2)} m)`);
}

if (failures) { console.error(`GATE B: FAIL (${failures})`); process.exit(1); }
console.log('GATE B: PASS');
