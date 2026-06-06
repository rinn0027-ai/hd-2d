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

  // ---- 右手の武器（剣 / 杖 / 弓を仕込み、職業で出し分け）----
  const hand = new THREE.Group(); hand.position.set(0, -0.62, 0); armR.add(hand);
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xcdd3dc, roughness: 0.35, metalness: 0.6, emissive: 0x6a7480, emissiveIntensity: 0.3 });
  const woodMat = mat(0x6b4a2a, 0.8);
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.04), steelMat); blade.position.y = 0.62;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.1), mat(0xb38b3a)); guard.position.y = 0.1;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.08), mat(0x3a2a18)); grip.position.y = -0.05;
  sword.add(blade, guard, grip);
  const staff = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 8), woodMat); shaft.position.y = 0.5; staff.add(shaft);
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x2a7aff, emissiveIntensity: 1.5, roughness: 0.25 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), orbMat); orb.position.y = 1.18; staff.add(orb);
  const bow = new THREE.Group();
  const bowArc = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 14, Math.PI * 1.25), woodMat);
  bowArc.rotation.z = Math.PI / 2; bow.add(bowArc);
  bow.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.56, 0), new THREE.Vector3(0, -0.56, 0)]), new THREE.LineBasicMaterial({ color: 0xeeeeee })));
  bow.position.y = 0.2; bow.rotation.x = 0.1;
  hand.add(sword, staff, bow);
  const tip = new THREE.Object3D(); tip.position.set(0, 1.05, 0); hand.add(tip);  // トレイル用の刃先

  // ---- 職業アクセサリ ----
  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.17, 0.5), mat(0x80828c)); shoulderL.position.set(-0.45, 1.64, 0); root.add(shoulderL);
  const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.45; root.add(shoulderR);
  const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.62, 8), mat(0x5a3a22)); quiver.position.set(-0.18, 1.3, -0.3); quiver.rotation.x = 0.35; root.add(quiver);
  const capeRoot = new THREE.Group(); capeRoot.position.set(0, 1.5, -0.22); root.add(capeRoot);
  const capeMat = mat(0x6a2020);
  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.9, 0.05), capeMat); cape.position.y = -0.45; capeRoot.add(cape);

  const CLASS_PAL = {
    warrior: { cloth: 0x8a2f2f, pants: 0x3a2a18, hat: 0x70727b, cape: 0x5a1f1f },
    archer:  { cloth: 0x2f6a3b, pants: 0x274a30, hat: 0x356a3b, cape: null },
    mage:    { cloth: 0x432f7a, pants: 0x2a2050, hat: 0x5a3aa0, cape: 0x2a2060 },
  };
  let meleeKind = 'sword', curWeapon = 'sword';
  function setWeapon(type) {
    curWeapon = type; const bowOn = type === 'bow';
    bow.visible = bowOn; sword.visible = !bowOn && meleeKind === 'sword'; staff.visible = !bowOn && meleeKind === 'staff';
  }
  function setClass(cls) {
    const P = CLASS_PAL[cls] || CLASS_PAL.warrior;
    mCloth.color.set(P.cloth); mPants.color.set(P.pants); mHat.color.set(P.hat);
    meleeKind = cls === 'mage' ? 'staff' : 'sword';
    shoulderL.visible = shoulderR.visible = cls === 'warrior';
    quiver.visible = cls === 'archer';
    capeRoot.visible = P.cape !== null; if (P.cape !== null) capeMat.color.set(P.cape);
    brim.visible = cls !== 'warrior';
    cap.scale.set(cls === 'mage' ? 0.8 : 1, cls === 'mage' ? 2.0 : 1, cls === 'mage' ? 0.8 : 1);
    cap.position.y = cls === 'mage' ? 2.42 : 2.2;
    setWeapon(curWeapon);
  }
  setClass('warrior');

  shadowAll(root);
  let phase = 0;
  function update(dt, moving, speed = 1, attackP = 0) {
    if (moving) {
      phase += dt * speed * 8;
      const s = Math.sin(phase) * 0.5;
      legL.rotation.x = s; legR.rotation.x = -s;
      if (attackP <= 0) { armL.rotation.x = -s; armR.rotation.x = s; }
      body.position.y = 1.12 + Math.abs(Math.sin(phase)) * 0.03;
      capeRoot.rotation.x = 0.28 + Math.sin(phase) * 0.1;
    } else {
      legL.rotation.x = legR.rotation.x = 0;
      body.position.y = 1.12;
      if (attackP <= 0) { armL.rotation.x = armR.rotation.x = 0; }
      capeRoot.rotation.x = 0.12;
    }
    orb.material.emissiveIntensity = 1.2 + Math.sin(phase * 0.6 + dt) * 0.3 + Math.abs(Math.sin(phase)) * 0.4;
    if (attackP > 0) {                       // 攻撃の振り
      const sw = Math.sin(Math.min(1, attackP) * Math.PI);
      armR.rotation.x = -2.4 * sw;
      armR.rotation.z = -0.4 * sw;
      armL.rotation.x = 0.5 * sw;
    } else {
      armR.rotation.z = 0;
    }
  }
  return { root, update, setClass, setWeapon, tip, height: 2.4 };
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
  } else if (type === 'crystal') {            // 氷の結晶（雪）
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x2a6a9a, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.2 }));
    core.position.y = 0.9; g.add(core);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 5), mat(0xdff4ff, 0.2)); sp.position.set(Math.cos(a) * 0.5, 0.9 + (i % 2 ? 0.3 : -0.2), Math.sin(a) * 0.5); sp.rotation.z = Math.cos(a) * 1.2; sp.rotation.x = Math.sin(a) * 1.2; g.add(sp); }
    for (const ex of [-0.18, 0.18]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat(0x123a55, 0.3)); eye.position.set(ex, 0.95, 0.5); g.add(eye); }
    height = 1.6;
  } else if (type === 'golem') {              // 岩ゴーレム（溶岩）
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.9), mat(0x6b5048, 0.95)); body.position.y = 1.0; g.add(body);
    const headG = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.6), mat(0x5a443c, 0.95)); headG.position.y = 1.8; g.add(headG);
    for (const sgn of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.9, 0.32), mat(0x5a443c, 0.95)); arm.position.set(sgn * 0.78, 1.0, 0); g.add(arm); }
    for (let i = 0; i < 4; i++) { const cr = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshStandardMaterial({ color: 0xff5a20, emissive: 0xff3a00, emissiveIntensity: 1.3, roughness: 0.5 })); cr.position.set((Math.random() - 0.5) * 0.9, 0.7 + Math.random() * 0.8, 0.48); g.add(cr); }
    for (const ex of [-0.16, 0.16]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xff8a00, emissiveIntensity: 1.4 })); eye.position.set(ex, 1.85, 0.32); g.add(eye); }
    height = 2.4;
  } else if (type === 'eye') {                // 浮遊する眼（異界）
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), mat(0xe8e0ff, 0.3)); ball.position.y = 1.2; g.add(ball);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshStandardMaterial({ color: 0x9a3aff, emissive: 0x6a1aff, emissiveIntensity: 0.9, roughness: 0.3 })); iris.position.set(0, 1.2, 0.46); g.add(iris);
    const pup = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0x100018, 0.2)); pup.position.set(0, 1.2, 0.62); g.add(pup);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const t = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 5), mat(0x6a2aaa, 0.5)); t.position.set(Math.cos(a) * 0.4, 0.7, Math.sin(a) * 0.4); t.rotation.x = Math.PI; g.add(t); }
    height = 1.8;
  }
  shadowAll(g);
  return { root: g, height, type };
}

// ============================================================ ボス（惑星別の専属外形）
export function makeBoss(kind = 'slime') {
  if (kind === 'frost') return makeFrostBoss();
  if (kind === 'magma') return makeMagmaBoss();
  if (kind === 'void') return makeVoidBoss();
  return makeSlimeBoss();
}

// ============================================================ ボス（巨大スライム王・草原）
function makeSlimeBoss() {
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
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.34, 5),
    new THREE.MeshStandardMaterial({ color: 0xffd23a, metalness: 0.6, roughness: 0.3, emissive: 0x553300, emissiveIntensity: 0.5 }));
  crown.position.y = 1.75; g.add(crown);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const sp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat(0xff5a5a, 0.3)); sp.position.set(Math.cos(a) * 0.52, 1.95, Math.sin(a) * 0.52); g.add(sp); }
  shadowAll(g);
  return { root: g, height: 2.4 };
}

// フロストキング（雪）— 巨大な氷塊＋スパイク
function makeFrostBoss() {
  const g = new THREE.Group();
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xcdeeff, emissive: 0x2a6a9a, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.25 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), iceMat); core.position.y = 1.2; g.add(core);
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 5), iceMat); sp.position.set(Math.cos(a) * 1.0, 1.2 + (i % 3 - 1) * 0.6, Math.sin(a) * 1.0); sp.rotation.z = Math.cos(a) * 1.3; sp.rotation.x = -Math.sin(a) * 1.3; g.add(sp); }
  for (const ex of [-0.34, 0.34]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6fd0ff, emissive: 0x2aa0ff, emissiveIntensity: 1.2 })); eye.position.set(ex, 1.35, 1.0); g.add(eye); }
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x3a8acc, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.2 }));
  crown.position.y = 2.3; g.add(crown);
  shadowAll(g);
  return { root: g, height: 2.6 };
}

// マグマロード（溶岩）— 岩塊ゴーレム＋発光する亀裂
function makeMagmaBoss() {
  const g = new THREE.Group();
  const rock = mat(0x4a3630, 0.95);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.9, 1.5), rock); body.position.y = 1.3; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.9), mat(0x3e2c26, 0.95)); head.position.y = 2.6; g.add(head);
  for (const sgn of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), rock); arm.position.set(sgn * 1.3, 1.3, 0); g.add(arm); }
  const lava = new THREE.MeshStandardMaterial({ color: 0xff5a20, emissive: 0xff3000, emissiveIntensity: 1.5, roughness: 0.5 });
  for (let i = 0; i < 10; i++) { const cr = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), lava); cr.position.set((Math.random() - 0.5) * 1.7, 0.6 + Math.random() * 1.6, 0.78); g.add(cr); }
  for (const ex of [-0.26, 0.26]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xff8a00, emissiveIntensity: 1.6 })); eye.position.set(ex, 2.65, 0.48); g.add(eye); }
  shadowAll(g);
  return { root: g, height: 3.0 };
}

// ヴォイドアイ（異界）— 巨大な浮遊する眼
function makeVoidBoss() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 18), mat(0xe8e0ff, 0.25)); ball.position.y = 1.6; g.add(ball);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9a3aff, emissive: 0x6a1aff, emissiveIntensity: 1.0, roughness: 0.3 })); iris.position.set(0, 1.6, 1.0); g.add(iris);
  const pup = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mat(0x0a0014, 0.2)); pup.position.set(0, 1.6, 1.32); g.add(pup);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.1, 8, 28), new THREE.MeshStandardMaterial({ color: 0xb98aff, emissive: 0x7a2aff, emissiveIntensity: 0.9, roughness: 0.4 })); ring.position.y = 1.6; ring.rotation.x = Math.PI / 2.3; g.add(ring);
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const t = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 5), mat(0x5a2a9a, 0.5)); t.position.set(Math.cos(a) * 0.9, 0.6, Math.sin(a) * 0.9); t.rotation.x = Math.PI; g.add(t); }
  shadowAll(g);
  return { root: g, height: 2.8 };
}
