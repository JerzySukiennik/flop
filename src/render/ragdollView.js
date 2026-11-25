// Visual layer for one bean ragdoll: primitive meshes mirroring the physics
// bodies. The head is welded to the torso body, so its sphere renders as a
// child of the torso mesh (eyes, hat and emote bubble ride on it).
import * as THREE from 'three';
import { PARTS, HEAD_LOCAL } from '../game/ragdoll.js';

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
      const geo = new THREE.CapsuleGeometry(part.dims[1], part.dims[0] * 2, 6, 16);
      const isLimb = /arm|leg/.test(part.name);
      const mesh = new THREE.Mesh(geo, isLimb ? dark : skin);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }

    // Visual head: sphere child of the torso mesh (same rigid body).
    const torsoMesh = this.meshes[0];
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_LOCAL.r, 20, 16), skin);
    head.position.set(HEAD_LOCAL.x, HEAD_LOCAL.y, HEAD_LOCAL.z);
    head.castShadow = true;
    torsoMesh.add(head);
    this.headMesh = head;
    this.skinMat = skin;
    this.darkMat = dark;

    // Face: two googly eyes so you can tell where he's looking.
    const eyeGeo = new THREE.SphereGeometry(0.035, 8, 6);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    for (const dx of [-0.075, 0.075]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(dx, 0.03, HEAD_LOCAL.r * 0.87);
      head.add(eye);
    }

    this._hat = null;
    this.setHat(customization.hat ?? 'none');

    // Emote bubble (hidden until an emote fires).
    this.emoteSprite = makeEmoteSprite();
    this.emoteSprite.visible = false;
    head.add(this.emoteSprite);
    this._emoteTimer = 0;

    scene.add(this.group);
  }

  setColor(color) {
    this.skinMat.color = new THREE.Color(color);
    this.darkMat.color = new THREE.Color(color).multiplyScalar(0.55);
  }

  setHat(hat) {
    if (this._hat) { this.headMesh.remove(this._hat); }
    this._hat = null;
    let mesh = null;
    if (hat === 'cone') {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.32, 12),
        new THREE.MeshStandardMaterial({ color: 0xff8a3a }),
      );
      mesh.position.y = HEAD_LOCAL.r + 0.1;
    } else if (hat === 'tophat') {
      mesh = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.5 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16), mat);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 16), mat);
      top.position.y = 0.14;
      mesh.add(brim, top);
      mesh.position.y = HEAD_LOCAL.r * 0.8;
    } else if (hat === 'crown') {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.13, 0.14, 8, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xf0c040, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }),
      );
      mesh.position.y = HEAD_LOCAL.r * 0.95;
    }
    if (mesh) { this._hat = mesh; this.headMesh.add(mesh); }
  }

  showEmote(emoji, seconds = 2.5) {
    drawEmote(this.emoteSprite, emoji);
    this.emoteSprite.visible = true;
    this._emoteTimer = seconds;
  }

  tickEmote(dt) {
    if (this._emoteTimer > 0) {
      this._emoteTimer -= dt;
      if (this._emoteTimer <= 0) this.emoteSprite.visible = false;
    }
  }

  /** Update from live rigid bodies (host). */
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

  setVisible(v) { this.group.visible = v; }

  dispose(scene) {
    scene.remove(this.group);
    for (const m of this.meshes) m.geometry.dispose();
  }
}

function makeEmoteSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(0.5, 0.5, 1);
  sprite.position.y = HEAD_LOCAL.r + 0.35;
  sprite.userData.canvas = canvas;
  sprite.userData.tex = tex;
  return sprite;
}

function drawEmote(sprite, emoji) {
  const ctx = sprite.userData.canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.font = '64px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  sprite.userData.tex.needsUpdate = true;
}
