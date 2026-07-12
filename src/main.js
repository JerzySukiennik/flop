// FLOP — boot. Pipeline-proof stage: spinning cube + Rapier init check.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

async function boot() {
  await RAPIER.init();
  console.log('[flop] rapier initialized');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1c20);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 1, 4);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff6b4a })
  );
  scene.add(cube);
  scene.add(new THREE.DirectionalLight(0xffffff, 2));
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop((t) => {
    cube.rotation.x = t / 1000;
    cube.rotation.y = t / 1400;
    renderer.render(scene, camera);
  });

  console.log('[flop] boot ok');
}

boot();
