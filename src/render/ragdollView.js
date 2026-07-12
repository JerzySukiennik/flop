// Visual layer for one ragdoll: primitive meshes mirroring the physics
// bodies. Deliberately separate from the sim (§5.5) — a skinned mesh can be
// swapped in here without touching game logic.
import * as THREE from 'three';
import { PARTS } from '../game/ragdoll.js';

export const PLAYER_COLORS = [0xff6b4a, 0x4a9dff, 0x6bdb6b, 0xffd24a];

export class RagdollView {
  constructor(scene, playerIndex, customization = {}) {
    this.group = new THREE.Group();
    this.meshes = [];
    const color = customization.color ?? PLAYER_COLORS[playerIndex % 4];
    const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.8,
    });

    for (const part of PARTS) {
      let geo;
      if (part.shape === 'capsule') geo = new THREE.CapsuleGeometry(part.dims[1], part.dims[0] * 2, 4, 12);
      else if (part.shape === 'ball') geo = new THREE.SphereGeometry(part.dims[0], 16, 12);
      else geo = new THREE.BoxGeometry(part.dims[0] * 2, part.dims[1] * 2, part.dims[2] * 2);
      const isLimb = /forearm|shin|foot/.test(part.name);
      const mesh = new THREE.Mesh(geo, isLimb ? dark : skin);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }

    // Face: two googly eyes on the head so you can tell where he's looking.
    const headIdx = PARTS.findIndex((p) => p.name === 'head');
    const eyeGeo = new THREE.SphereGeometry(0.025, 8, 6);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    for (const dx of [-0.045, 0.045]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx, 0.02, 0.095);
      this.meshes[headIdx].add(eye);
    }

    scene.add(this.group);
  }

  /** Update from live rigid bodies (host) . */
  updateFromBodies(partList) {
    for (let i = 0; i < partList.length; i++) {
      const p = partList[i].translation();
      const q = partList[i].rotation();
      this.meshes[i].position.set(p.x, p.y, p.z);
      this.meshes[i].quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  /** Update from interpolated snapshot transforms (client). */
  updateFromTransforms(transforms) {
    for (let i = 0; i < transforms.length && i < this.meshes.length; i++) {
      const t = transforms[i];
      this.meshes[i].position.set(t.px, t.py, t.pz);
      this.meshes[i].quaternion.set(t.qx, t.qy, t.qz, t.qw);
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    for (const m of this.meshes) m.geometry.dispose();
  }
}
