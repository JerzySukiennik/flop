// Level sanity: every level instantiates deterministically (hash ×2 match),
// steps 10 s with 4 players parked+active without NaN, and contraptions hold.
import RAPIER from '@dimforge/rapier3d-compat';
import { buildGameSim, LEVELS } from '../src/game/recipe.js';

await RAPIER.init();

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
  else console.log(`  ✓ ${msg}`);
};

for (const name of Object.keys(LEVELS)) {
  console.log(`— ${name} —`);
  const a = buildGameSim(RAPIER, name);
  const b = buildGameSim(RAPIER, name);
  check(a.sim.manifestHash() === b.sim.manifestHash(), `deterministic build (${a.sim.manifestHash()})`);

  const { sim, runtime } = a;
  const events = [];
  runtime.onEvent = (ev) => events.push(ev);
  // two humans join
  sim.activatePlayer(0, runtime.spawnPoint(0));
  sim.activatePlayer(1, runtime.spawnPoint(1));

  let nan = false;
  for (let i = 0; i < 600; i++) {
    sim.step(); // levelRuntime.update runs inside the fixed step
    if (i % 120 === 0) {
      sim.world.forEachRigidBody((body) => {
        const p = body.translation();
        if (!Number.isFinite(p.x + p.y + p.z)) nan = true;
      });
    }
  }
  check(!nan, 'no NaN across 10 s with players + contraptions');
  const p0 = sim.players[0].ragdoll.bodies.pelvis.translation();
  check(p0.y > 0 && Number.isFinite(p0.y), `player 0 alive at spawn (pelvis y=${p0.y.toFixed(2)})`);
  const spuriousRespawns = events.filter((e) => e.t === 'respawn').length;
  check(spuriousRespawns === 0, `no spurious respawns (${spuriousRespawns})`);
  const spuriousLevers = events.filter((e) => e.t === 'lever' && e.active).length;
  check(spuriousLevers === 0, `levers stay off untouched (${spuriousLevers})`);
}

if (failures) { console.error(`LEVELS: FAIL (${failures})`); process.exit(1); }
console.log('LEVELS: PASS');
