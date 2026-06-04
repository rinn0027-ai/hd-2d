// models.js — 低ポリの3Dモデル（プリミティブ組み立て、外部アセット不要）
import * as THREE from 'three';

function mat(color, rough = 0.85) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }); }
function shadowAll(root) { root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }

// ============================================================ 人型（プレイヤー/NPC）
// ローカル: 足元 y=0, 上=+Y, 正面=+Z
export function makeHumanoid(opts = {}) {
  const skin = opts.skin ?? 0xe8b88c;
  const cloth = opts.cloth ?? 0x3b86a8;
  const pants = opts.pants ?? 0x4b3520;
  const hat = opts.hat ?? 0xcaa45a;
  const root = new THREE.Group();
  const mCloth = mat(cloth), mPants = mat(pants), mSkin = mat(skin, 0.7), mHat = mat(hat);

  const legGeo = new THREE.BoxGeometry(0.26, 0.72, 0.26);
  function limb(geo, m, x, y, len) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(geo, m); mesh.position.y = -len / 2; g.add(mesh);
    g.position.set(x, y, 0); root.add(g); return g;
  }
  const legL = limb(legGeo, mPants, -0.16, 0.72, 0.72);
  const legR = limb(legGeo, mPants, 0.16, 0.72, 0.72);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.78, 0.4), mCloth);
  body.position.y = 1.12; root.add(body);
  // 帯
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.44), mat(0x9c3b3b));
  belt.position.y = 0.82; root.add(belt);

  const armGeo = new THREE.BoxGeometry(0.18, 0.66, 0.18);
  const armL = limb(armGeo, mCloth, -0.43, 1.45, 0.66);
  const armR = limb(armGeo, mCloth, 0.43, 1.45, 0.66);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.48), mSkin);
  head.position.y = 1.78; root.add(head);
  // 目
  const eyeMat = mat(0x26303a, 0.4);
  for (const ex of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.06), eyeMat);
    eye.position.set(ex, 1.8, 0.25); root.add(eye);
  }
  // 帽子（つば広）
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.07, 12), mHat);
  brim.position.y = 2.02; root.add(brim);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.34, 12), mHat);
  cap.position.y = 2.2; root.add(cap);

  shadowAll(root);
  let phase = 0;
  function update(dt, moving, speed = 1, attackP = 0) {
    if (moving) {
      phase += dt * speed * 8;
      const s = Math.sin(phase) * 0.5;
      legL.rotation.x = s; legR.rotation.x = -s;
      if (attackP <= 0) { armL.rotation.x = -s; armR.rotation.x = s; }
      body.position.y = 1.12 + Math.abs(Math.sin(phase)) * 0.03;
    } else {
      legL.rotation.x = legR.rotation.x = 0;
      body.position.y = 1.12;
      if (attackP <= 0) { armL.rotation.x = armR.rotation.x = 0; }
    }
    if (attackP > 0) {                       // 攻撃の振り
      const sw = Math.sin(Math.min(1, attackP) * Math.PI);
      armR.rotation.x = -2.4 * sw;
      armR.rotation.z = -0.4 * sw;
      armL.rotation.x = 0.5 * sw;
    } else {
      armR.rotation.z = 0;
    }
  }
  return { root, update, height: 2.4 };
}

// ============================================================ 木
export function makeTree(s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 1.5 * s, 7), mat(0x5a3d24, 0.9));
  trunk.position.y = 0.75 * s; g.add(trunk);
  const leaf = mat(0x356a3b, 1);
  const cone1 = new THREE.Mesh(new THREE.ConeGeometry(1.25 * s, 1.7 * s, 8), leaf);
  cone1.position.y = 1.8 * s; g.add(cone1);
  const cone2 = new THREE.Mesh(new THREE.ConeGeometry(1.0 * s, 1.4 * s, 8), mat(0x3c7a44, 1));
  cone2.position.y = 2.6 * s; g.add(cone2);
  const cone3 = new THREE.Mesh(new THREE.ConeGeometry(0.72 * s, 1.1 * s, 8), mat(0x46905a, 1));
  cone3.position.y = 3.35 * s; g.add(cone3);
  shadowAll(g);
  return g;
}

// ============================================================ 岩
export function makeRock(s = 1) {
  const geo = new THREE.IcosahedronGeometry(0.7 * s, 0);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); v.multiplyScalar(0.85 + Math.random() * 0.4); pos.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(0x7a7e86, 0.95));
  m.position.y = 0.5 * s; m.scale.y = 0.8;
  m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m); return g;
}

// ============================================================ 花
export function makeFlower(color = 0xffd23a) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), mat(0x3f7a3a, 1));
  stem.position.y = 0.25; g.add(stem);
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(0xfff4c0, 0.7));
  center.position.y = 0.52; g.add(center);
  const petMat = mat(color, 0.7);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const pet = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), petMat);
    pet.scale.set(1, 0.5, 1.4);
    pet.position.set(Math.cos(a) * 0.13, 0.52, Math.sin(a) * 0.13);
    g.add(pet);
  }
  shadowAll(g);
  return g;
}

// ============================================================ ランタン柱（先端に光源を別途付ける）
export function makeLampPost() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.4, 6), mat(0x2a2118, 0.8));
  post.position.y = 1.2; g.add(post);
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshStandardMaterial({ color: 0xffd88a, emissive: 0xffb45a, emissiveIntensity: 1.4, roughness: 0.4 }));
  cage.position.y = 2.5; g.add(cage);
  shadowAll(g);
  return { root: g, lamp: cage };
}

// ============================================================ 宝箱
export function makeChest() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.7), mat(0x7a4a24, 0.7));
  base.position.y = 0.3; g.add(base);
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.6, -0.35); g.add(lidPivot);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.3, 0.75), mat(0x9c6a34, 0.6));
  lid.position.set(0, 0.12, 0.35); lidPivot.add(lid);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.85, 0.16), new THREE.MeshStandardMaterial({ color: 0xd9c06a, metalness: 0.6, roughness: 0.4 }));
  band.position.set(0, 0.45, 0); g.add(band);
  shadowAll(g);
  return { root: g, lidPivot };
}

// ============================================================ 敵（3D）
export function makeEnemy(type = 'slime') {
  const g = new THREE.Group();
  let height = 1.5;
  if (type === 'slime') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat(0x3ba24e, 0.6));
    body.scale.set(1, 0.7, 1); body.position.y = 0.7; g.add(body);
    for (const ex of [-0.3, 0.3]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(0xffffff, 0.4)); eye.position.set(ex, 0.85, 0.78); g.add(eye);
      const pup = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat(0x16301c, 0.3)); pup.position.set(ex, 0.85, 0.92); g.add(pup);
    }
    height = 1.4;
  } else if (type === 'mushroom') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.45, 1.0, 10), mat(0xe8d8b8, 0.8)); stem.position.y = 0.5; g.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc0392b, 0.6)); cap.position.y = 1.0; cap.scale.y = 0.8; g.add(cap);
    for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mat(0xf0e6d2, 0.5)); const a = Math.random() * Math.PI * 2, r = Math.random() * 0.6; sp.position.set(Math.cos(a) * r, 1.0 + Math.random() * 0.4, Math.sin(a) * r); g.add(sp); }
    for (const ex of [-0.18, 0.18]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.06), mat(0x5a4a2a, 0.4)); eye.position.set(ex, 0.55, 0.42); g.add(eye); }
    height = 1.8;
  } else if (type === 'bat') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), mat(0x46315e, 0.7)); body.position.y = 1.0; body.scale.set(1, 1.2, 1); g.add(body);
    const wingMat = mat(0x6a4a8c, 0.8);
    for (const sgn of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), wingMat);
      wing.position.set(sgn * 0.7, 1.05, 0); wing.rotation.z = sgn * 0.3; g.add(wing);
    }
    for (const ex of [-0.16, 0.16]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mat(0xffd23a, 0.4)); eye.position.set(ex, 1.05, 0.42); g.add(eye); }
    for (const ex of [-0.18, 0.18]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 5), mat(0x46315e, 0.7)); ear.position.set(ex, 1.5, 0); g.add(ear); }
    height = 2.0;
  }
  shadowAll(g);
  return { root: g, height, type };
}

// ============================================================ ボス（巨大スライム王）
export function makeBoss() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), mat(0x6a3aa2, 0.5));
  body.scale.set(1.25, 0.9, 1.25); body.position.y = 0.95; g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), mat(0x8a5ac2, 0.5));
  belly.scale.set(1.2, 0.8, 1.0); belly.position.set(0, 0.7, 0.7); g.add(belly);
  for (const ex of [-0.42, 0.42]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat(0xfff2c0, 0.4)); eye.position.set(ex, 1.15, 0.92); g.add(eye);
    const pup = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(0x301030, 0.3)); pup.position.set(ex, 1.1, 1.1); g.add(pup);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.1), mat(0x2a1040, 0.5)); brow.position.set(ex, 1.38, 1.0); brow.rotation.z = ex < 0 ? -0.4 : 0.4; g.add(brow);
  }
  // 王冠
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.34, 5),
    new THREE.MeshStandardMaterial({ color: 0xffd23a, metalness: 0.6, roughness: 0.3, emissive: 0x553300, emissiveIntensity: 0.5 }));
  crown.position.y = 1.75; g.add(crown);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const sp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat(0xff5a5a, 0.3)); sp.position.set(Math.cos(a) * 0.52, 1.95, Math.sin(a) * 0.52); g.add(sp); }
  shadowAll(g);
  return { root: g, height: 2.4 };
}
