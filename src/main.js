// FLOP — boot. Currently: local sandbox (sim + render + input).
// Lobby/netcode bootstrap slots in here (Gate D).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sim, GROUP_WORLD } from './game/sim.js';
import { TUNING } from './game/tuning.js';
import { createScene } from './render/scene.js';
import { RagdollView } from './render/ragdollView.js';
import { InputManager } from './ui/input.js';

async function boot() {
  await RAPIER.init();

  const container = document.getElementById('app');
  const { renderer, scene, camera } = createScene(container);
  const input = new InputManager(renderer.domElement);

  if (new URLSearchParams(location.search).get('debug')) {
    const { mountDebugPanel } = await import('./ui/debugPanel.js');
    mountDebugPanel();
  }

  // --- sandbox world (placeholder until levels land) ---
  const sim = new Sim(RAPIER);
  sim.addGround(60);

  const groundMesh = new THREE.Mesh(
    new THREE.BoxGeometry(120, 1, 120),
    new THREE.MeshStandardMaterial({ color: 0x7a9a6a, roughness: 1 }),
  );
  groundMesh.position.y = -0.5;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const propMeshes = [];
  function addBox(pos, half, massKg, color = 0xb08968, fixed = false) {
    const desc = fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    desc.setTranslation(pos.x, pos.y, pos.z);
    const body = sim.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setFriction(0.8).setCollisionGroups(GROUP_WORLD);
    if (!fixed) col.setMass(massKg);
    sim.world.createCollider(col, body);
    body.userData = { kind: 'prop', grabbable: true };
    sim.register(body, `box${propMeshes.length}`, fixed ? 'static' : 'prop');
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    propMeshes.push({ body, mesh });
    return body;
  }

  addBox({ x: 2, y: 0.3, z: 3 }, { x: 0.3, y: 0.3, z: 0.3 }, 6);
  addBox({ x: -2, y: 0.3, z: 3 }, { x: 0.3, y: 0.3, z: 0.3 }, 6);
  addBox({ x: 0, y: 0.5, z: 5 }, { x: 0.5, y: 0.5, z: 0.5 }, 480, 0x8a8a94); // too heavy to hold
  addBox({ x: 4, y: 1.0, z: 6 }, { x: 1.2, y: 1.0, z: 0.4 }, 0, 0x999999, true); // climb wall

  const player = sim.addPlayer(0, { x: 0, y: 0.05, z: 0 });
  const view = new RagdollView(scene, 0);

  // --- loop: fixed-step sim, interpolation-free local render ---
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const elapsed = Math.min(clock.getDelta(), 0.1);
    sim.setInput(0, input.sample());
    sim.advance(elapsed);

    view.updateFromBodies(player.ragdoll.partList);
    for (const p of propMeshes) {
      const t = p.body.translation(), q = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }

    // third-person camera
    const pelvis = player.ragdoll.bodies.pelvis.translation();
    const cy = Math.cos(input.pitch), sy = Math.sin(input.pitch);
    const dist = 3.4;
    camera.position.set(
      pelvis.x - Math.sin(input.yaw) * cy * dist,
      pelvis.y + 0.9 + sy * dist,
      pelvis.z - Math.cos(input.yaw) * cy * dist,
    );
    camera.lookAt(pelvis.x, pelvis.y + 0.7, pelvis.z);

    renderer.render(scene, camera);
  });

  console.log('[flop] boot ok');
}

boot();
