// GATE A — ragdoll sanity, headless. Blocks ALL level work.
// Spawns one ragdoll on flat ground, steps 600 ticks (10 s) with no input.
// Asserts: no NaN anywhere, |linvel| < 50, pelvis Y sane, head above pelvis,
// still standing at t=10 s. Then: a shove must knock him over (he must be
// able to fall), and he must recover afterwards.
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim } from '../src/game/sim.js';
import { TUNING } from '../src/game/tuning.js';

await RAPIER.init();

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

const sim = new Sim(RAPIER);
sim.addGround();
const player = sim.addPlayer(0, { x: 0, y: 0.02, z: 0 });

const partNames = Object.keys(player.ragdoll.bodies);
function auditBodies(label) {
  let ok = true;
  for (const name of partNames) {
    const b = player.ragdoll.bodies[name];
    const p = b.translation(), v = b.linvel(), q = b.rotation();
    for (const val of [p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w]) {
      if (!Number.isFinite(val)) { console.error(`  NaN in ${name} at ${label}`); ok = false; }
    }
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed >= 50) { console.error(`  |linvel|=${speed.toFixed(1)} in ${name} at ${label}`); ok = false; }
  }
  return ok;
}

console.log('— Phase 1: stand still for 600 ticks —');
let audit = true;
for (let i = 0; i < 600; i++) {
  sim.step();
  if (i % 60 === 0) audit = auditBodies(`tick ${i}`) && audit;
}
audit = auditBodies('tick 600') && audit;
check(audit, 'no NaN, all |linvel| < 50 across 10 s');

const pelvisY = player.ragdoll.bodies.pelvis.translation().y;
const headY = player.ragdoll.bodies.head.translation().y;
check(pelvisY > 0.6 && pelvisY < 1.4, `pelvis Y sane (${pelvisY.toFixed(2)} m)`);
check(headY > pelvisY + 0.3, `head above pelvis (head ${headY.toFixed(2)}, pelvis ${pelvisY.toFixed(2)})`);
check(player.balance.state === 'active', `still standing at t=10 s (state=${player.balance.state})`);
const drift = Math.hypot(
  player.ragdoll.bodies.pelvis.translation().x,
  player.ragdoll.bodies.pelvis.translation().z,
);
check(drift < 0.6, `didn't wander (drift ${drift.toFixed(2)} m)`);

console.log('— Phase 2: shove → must fall over —');
player.ragdoll.bodies.chest.applyImpulse({ x: 260, y: 40, z: 0 }, true);
let fell = false;
for (let i = 0; i < 240; i++) {
  sim.step();
  if (player.balance.state === 'ko') { fell = true; break; }
}
check(fell, 'a hard shove knocks him out (he CAN fall)');

console.log('— Phase 3: recovery —');
for (let i = 0; i < 600; i++) sim.step();
const pelvisY2 = player.ragdoll.bodies.pelvis.translation().y;
const headY2 = player.ragdoll.bodies.head.translation().y;
check(auditBodies('post-recovery'), 'no NaN after knockdown/recovery');
check(player.balance.state === 'active', `back to active (state=${player.balance.state})`);
check(pelvisY2 > 0.6, `stood back up (pelvis ${pelvisY2.toFixed(2)} m)`);
check(headY2 > pelvisY2 + 0.3, `head above pelvis again (${headY2.toFixed(2)})`);

console.log('— Phase 4: walk 3 s, must travel and stay up —');
sim.setInput(0, { moveX: 0, moveZ: 1, yaw: 0 });
const startZ = player.ragdoll.bodies.pelvis.translation().z;
for (let i = 0; i < 180; i++) sim.step();
const endZ = player.ragdoll.bodies.pelvis.translation().z;
check(endZ - startZ > 2.0, `walked forward ${(endZ - startZ).toFixed(2)} m in 3 s`);
check(player.ragdoll.bodies.pelvis.translation().y > 0.6, 'upright while walking');
check(auditBodies('post-walk'), 'no NaN while walking');

if (failures) { console.error(`GATE A: FAIL (${failures})`); process.exit(1); }
console.log('GATE A: PASS');
