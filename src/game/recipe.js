// THE world recipe (§5.3). Every peer — host, client, test — builds its sim
// through this one function so structure and creation order are identical.
import { Sim } from './sim.js';
import { instantiateLevel } from './levels.js';

import hub from '../levels/hub.js';
import construction from '../levels/construction.js';
import docks from '../levels/docks.js';
import castle from '../levels/castle.js';

export const LEVELS = { hub, construction, docks, castle };

export function buildGameSim(RAPIER, levelName) {
  const level = LEVELS[levelName];
  if (!level) throw new Error(`unknown level: ${levelName}`);
  const sim = new Sim(RAPIER);
  const runtime = instantiateLevel(RAPIER, sim, level);
  for (let slot = 0; slot < 4; slot++) {
    sim.addPlayer(slot, { x: slot * 4 - 6, y: 0.3, z: -120 }); // parked
  }
  sim.levelRuntime = runtime;
  return { sim, runtime, level };
}
