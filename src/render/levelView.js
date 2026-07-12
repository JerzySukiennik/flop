// Builds meshes for a level JSON and mirrors dynamic bodies each frame.
// Textures come from the vendored asset library (materials.js); until the
// asset pass lands, materials fall back to flat colors.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { getMaterial } from './materials.js';

const BASE = import.meta.env.BASE_URL ?? '/';
const HDRI_BY_SKY = { day: 'hdri-day', sunset: 'hdri-sunset', dusk: 'hdri-dusk' };
const hdriCache = new Map();

const SKY = {
  day: { bg: 0x87a8c8, fog: [40, 140], sun: 0xfff2dd, sunI: 2.6 },
  sunset: { bg: 0xe8a87c, fog: [35, 120], sun: 0xffc48a, sunI: 2.2 },
  dusk: { bg: 0x5a6488, fog: [30, 110], sun: 0xb8c4ff, sunI: 1.6 },
};

export class LevelView {
  constructor(scene, level, sim) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.dynamicPairs = []; // {entityIndex, mesh}
    this.level = level;

    const sky = SKY[level.sky] ?? SKY.day;
    scene.background = new THREE.Color(sky.bg);
    scene.fog = new THREE.Fog(sky.bg, sky.fog[0], sky.fog[1]);

    // HDRI image-based lighting (Poly Haven, vendored). Async — flat lights
    // carry the frame until it lands; background stays fog-colored.
    const hdriId = HDRI_BY_SKY[level.sky] ?? 'hdri-day';
    if (hdriCache.has(hdriId)) {
      scene.environment = hdriCache.get(hdriId);
    } else {
      new RGBELoader().load(`${BASE}assets/${hdriId}/sky.hdr`, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        hdriCache.set(hdriId, tex);
        scene.environment = tex;
      }, undefined, () => { /* IBL is a bonus, not a dependency */ });
    }

    const makeMesh = (def) => {
      let geo;
      if (def.shape === 'ball') geo = new THREE.SphereGeometry(def.size[0], 18, 14);
      else if (def.shape === 'cylinder') geo = new THREE.CylinderGeometry(def.size[1], def.size[1], def.size[0] * 2, 18);
      else if (def.shape === 'capsule') geo = new THREE.CapsuleGeometry(def.size[1], def.size[0] * 2, 4, 10);
      else geo = new THREE.BoxGeometry(def.size[0] * 2, def.size[1] * 2, def.size[2] * 2);
      const mesh = new THREE.Mesh(geo, getMaterial(def.tex, def.color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    const DEG = Math.PI / 180;
    for (const def of level.statics ?? []) {
      const mesh = makeMesh(def);
      mesh.position.set(...def.pos);
      if (def.rot) mesh.rotation.set(def.rot[0] * DEG, def.rot[1] * DEG, def.rot[2] * DEG);
      this.group.add(mesh);
    }

    // dynamics + rope segments mirror entity registry order
    for (const [entityIndex, e] of sim.entities.entries()) {
      if (e.type !== 'prop') continue;
      const id = e.id;
      let def = null;
      if (id.startsWith('d:')) def = (level.dynamics ?? []).find((d) => `d:${d.id}` === id);
      let mesh;
      if (def) {
        mesh = makeMesh(def);
      } else if (id.startsWith('r:')) {
        // rope link: read its collider dims from the level def
        const ropeId = id.split(':')[1];
        const rdef = (level.ropes ?? []).find((r) => r.id === ropeId);
        const segLen = rdef.length / rdef.segments;
        mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(rdef.radius ?? 0.045, segLen - 0.04, 3, 8),
          getMaterial('rope'),
        );
        mesh.castShadow = true;
      } else {
        continue;
      }
      this.group.add(mesh);
      this.dynamicPairs.push({ entityIndex, mesh });
    }

    // water plane
    if (level.water) {
      const w = level.water;
      const plane = new THREE.Mesh(
        new THREE.BoxGeometry(w.max[0] - w.min[0], 0.08, w.max[1] - w.min[1]),
        new THREE.MeshStandardMaterial({
          color: 0x2a6a8a, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.1,
        }),
      );
      plane.position.set((w.min[0] + w.max[0]) / 2, w.y - 0.04, (w.min[1] + w.max[1]) / 2);
      plane.receiveShadow = true;
      this.group.add(plane);
      this.water = plane;
    }

    // portal glows + labels
    for (const portal of level.portals ?? []) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.0, 0.09, 10, 32),
        new THREE.MeshStandardMaterial({ color: 0x9be7ff, emissive: 0x4ac8ff, emissiveIntensity: 1.6 }),
      );
      ring.position.set(portal.pos[0], portal.pos[1] + 0.4, portal.pos[2]);
      this.group.add(ring);
      const label = makeTextSprite(portal.label ?? portal.target);
      label.position.set(portal.pos[0], portal.pos[1] + 2.0, portal.pos[2]);
      this.group.add(label);
    }

    // checkpoint flags
    for (const [i, cp] of (level.checkpoints ?? []).entries()) {
      if (i === 0) continue;
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.55, 8),
        new THREE.MeshStandardMaterial({ color: 0x6bdb6b, emissive: 0x2a7a2a, emissiveIntensity: 0.7 }),
      );
      flag.position.set(cp.pos[0], cp.pos[1] + cp.size[1] + 0.4, cp.pos[2]);
      this.group.add(flag);
    }

    scene.add(this.group);
  }

  /** Host path: mirror live bodies. */
  updateFromSim(sim) {
    for (const pair of this.dynamicPairs) {
      const body = sim.entities[pair.entityIndex].body;
      const p = body.translation(), q = body.rotation();
      pair.mesh.position.set(p.x, p.y, p.z);
      pair.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  /** Client path: apply interpolated prop transforms by entity index. */
  updateFromProps(props) {
    if (!this._byIndex) {
      this._byIndex = new Map(this.dynamicPairs.map((p) => [p.entityIndex, p.mesh]));
    }
    for (const prop of props) {
      const mesh = this._byIndex.get(prop.index);
      if (!mesh) continue;
      mesh.position.set(prop.px, prop.py, prop.pz);
      mesh.quaternion.set(prop.qx, prop.qy, prop.qz, prop.qw);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

function makeTextSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 10;
  ctx.strokeText(text, 256, 84);
  ctx.fillText(text, 256, 84);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(4, 1, 1);
  return sprite;
}
