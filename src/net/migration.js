// Host migration: promote a client's structural-twin sim to authoritative
// host using the last full world snapshot (§5.4).
//
// Precondition (§5.3): every peer built its Sim with the SAME deterministic
// recipe, so rigid-body and joint handles are identical across peers. That
// lets us re-link controller references by handle after restoreSnapshot.
//
// Grab joints made on the old host exist in the snapshot but were never in
// the twin's recipe — they're orphaned references we can't attribute, so we
// remove them; players simply re-grab (≤2 s rewind already applies).
// Logged in DECISIONS.md.

/**
 * @param RAPIER rapier module
 * @param sim structural-twin Sim (same recipe as the dead host's)
 * @param snapshotBytes last full world snapshot (raw, already inflated)
 * @returns sim, now authoritative around the restored world
 */
export function promoteToHost(RAPIER, sim, snapshotBytes) {
  const restored = RAPIER.World.restoreSnapshot(snapshotBytes);
  restored.timestep = sim.world.timestep;

  // Collect the handle set the twin recipe knows about.
  const knownJointHandles = new Set();
  for (const p of sim.players) {
    if (!p) continue;
    for (const j of Object.values(p.ragdoll.joints)) knownJointHandles.add(j.joint.handle);
  }

  // Re-link entity registry bodies by handle; restore userData (not serialized).
  for (const e of sim.entities) {
    const oldBody = e.body;
    const newBody = restored.getRigidBody(oldBody.handle);
    if (!newBody) throw new Error(`migration: body handle ${oldBody.handle} missing in snapshot (structural mismatch?)`);
    newBody.userData = oldBody.userData;
    e.body = newBody;
  }

  // Re-link player ragdolls (bodies + joints) by handle.
  for (const p of sim.players) {
    if (!p) continue;
    for (const name of Object.keys(p.ragdoll.bodies)) {
      const oldBody = p.ragdoll.bodies[name];
      const newBody = restored.getRigidBody(oldBody.handle);
      newBody.userData = oldBody.userData;
      p.ragdoll.bodies[name] = newBody;
    }
    p.ragdoll.partList = p.ragdoll.partList.map((b) => restored.getRigidBody(b.handle));
    for (const name of Object.keys(p.ragdoll.joints)) {
      const j = p.ragdoll.joints[name];
      j.joint = restored.getImpulseJoint(j.joint.handle);
    }
    // Old-host grab joints can't be re-linked to controller state — drop them.
    p.arms.grabs = { L: null, R: null };
  }

  // Remove orphaned joints (old host's grabs).
  const orphans = [];
  restored.impulseJoints.forEach((joint) => {
    if (!knownJointHandles.has(joint.handle)) orphans.push(joint);
  });
  for (const j of orphans) restored.removeImpulseJoint(j, true);

  sim.world.free();
  sim.world = restored;
  return sim;
}
