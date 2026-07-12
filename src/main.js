// FLOP — browser bootstrap: menu → solo/host/join → game loop.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './render/scene.js';
import { initMaterials } from './render/materials.js';
import { InputManager } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { Menu, loadCustomization } from './ui/menu.js';
import { EmoteWheel } from './ui/emoteWheel.js';
import { AudioManager } from './render/audio.js';
import { Game } from './game.js';

async function boot() {
  await RAPIER.init();
  await initMaterials();

  const container = document.getElementById('app');
  const { renderer, scene, camera } = createScene(container);
  const input = new InputManager(renderer.domElement);
  const hud = new Hud();
  const customization = loadCustomization();
  const audio = new AudioManager();
  document.addEventListener('pointerdown', () => audio.unlock(), { once: false });
  const game = new Game({ scene, camera, input, hud, customization, audio });
  window.__flop = game; // debug/E2E hook
  new EmoteWheel((emoji) => game.sendEmote(emoji));

  if (new URLSearchParams(location.search).get('debug')) {
    const { mountDebugPanel } = await import('./ui/debugPanel.js');
    mountDebugPanel();
  }

  let sig = null;
  async function getSignalling() {
    if (!sig) {
      const { Signalling } = await import('./net/signalling.js');
      sig = new Signalling();
      await sig.signIn();
    }
    return sig;
  }

  const menu = new Menu({
    onSolo: () => {
      game.customization = loadCustomization();
      game.startSolo(new URLSearchParams(location.search).get('level') ?? 'hub');
      menu.hide(); hud.show();
      Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {});
    },
    onHost: async () => {
      try {
        menu.status('creating room…');
        game.customization = loadCustomization();
        await game.startHost(await getSignalling(), 'hub');
        menu.hide(); hud.show();
        Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {});
      } catch (err) {
        console.error(err);
        menu.status(`host failed: ${err.message}`);
      }
    },
    onJoin: async (code) => {
      try {
        menu.status(`joining ${code}…`);
        game.customization = loadCustomization();
        await game.startClient(await getSignalling(), code);
        menu.hide(); hud.show();
        Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {});
      } catch (err) {
        console.error(err);
        menu.status(`join failed: ${err.message}`);
      }
    },
    listLobbies: async () => (await getSignalling()).listLobbies(),
  });
  menu.refreshLobbies().catch(() => {});

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const elapsed = Math.min(clock.getDelta(), 0.1);
    if (game.mode === 'dead') {
      game.mode = null;
      game._teardownWorld();
      hud.hide(); menu.show();
      document.exitPointerLock?.();
      return;
    }
    game.update(elapsed);
    renderer.render(scene, camera);
  });

  console.log('[flop] boot ok');
}

boot();
