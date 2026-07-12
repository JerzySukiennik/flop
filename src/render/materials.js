// Material library. PBR textures load from vendored assets when present
// (asset pass, §5 of the plan); flat-color fallbacks keep the game rendering
// without them. getMaterial caches by tex+color.
import * as THREE from 'three';

const BASE = import.meta.env.BASE_URL ?? '/';

const FALLBACK_COLORS = {
  grass: 0x7a9a6a,
  wood: 0xb08968,
  concrete: 0x9a9a94,
  metal: 0x8a8f96,
  stone: 0x8d8578,
  plate: 0xa7adb5,
  rope: 0xc4a875,
};

// texture folder → file prefix inside public/assets/<id>/
const TEXTURE_SETS = {
  grass: { id: 'tex-grass', repeat: 8 },
  wood: { id: 'tex-wood', repeat: 2 },
  concrete: { id: 'tex-concrete', repeat: 4 },
  metal: { id: 'tex-metal', repeat: 2 },
  stone: { id: 'tex-stone', repeat: 4 },
  plate: { id: 'tex-plate', repeat: 2 },
  rope: { id: 'tex-rope', repeat: 1 },
};

const cache = new Map();
const loader = new THREE.TextureLoader();
let manifest = null;

/** Call once at boot: marks which texture sets were actually vendored. */
export async function initMaterials() {
  try {
    const res = await fetch(`${BASE}assets/index.json`);
    manifest = res.ok ? await res.json() : { textures: [] };
  } catch {
    manifest = { textures: [] };
  }
}

function loadTex(id, file, repeat, srgb) {
  const tex = loader.load(`${BASE}assets/${id}/${file}`);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function getMaterial(texName, colorOverride) {
  const key = `${texName ?? 'none'}:${colorOverride ?? ''}`;
  if (cache.has(key)) return cache.get(key);

  let mat;
  const set = TEXTURE_SETS[texName];
  const vendored = set && manifest?.textures?.includes(set.id);
  if (vendored) {
    mat = new THREE.MeshStandardMaterial({
      map: loadTex(set.id, 'color.jpg', set.repeat, true),
      normalMap: loadTex(set.id, 'normal.jpg', set.repeat, false),
      roughnessMap: loadTex(set.id, 'rough.jpg', set.repeat, false),
      roughness: 1.0,
    });
    if (colorOverride) mat.color = new THREE.Color(colorOverride);
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: colorOverride ?? FALLBACK_COLORS[texName] ?? 0xb0a08c,
      roughness: 0.9,
    });
  }
  cache.set(key, mat);
  return mat;
}
