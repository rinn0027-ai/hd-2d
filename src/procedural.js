// procedural.js — Canvasで全テクスチャ/ドット絵スプライトをその場生成（外部アセット不要）
import * as THREE from 'three';

// --- 小さな決定論的ノイズ（value noise） ---
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const tl = hash(xi, yi), tr = hash(xi + 1, yi);
  const bl = hash(xi, yi + 1), br = hash(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(tl, tr, u), THREE.MathUtils.lerp(bl, br, u), v);
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * valueNoise(x * f, y * f); f *= 2; a *= 0.5; }
  return s;
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, { nearest = false, repeat = 1, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (nearest) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapLinearFilter; }
  tex.anisotropy = 4;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---- 草地タイル（ディザリングでドットらしさ） ----
export function grassTexture(size = 128) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const pal = [[58, 92, 48], [70, 110, 56], [86, 130, 66], [104, 150, 78], [120, 168, 92]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * 0.06, y * 0.06, 5);
      const blade = (Math.sin(x * 0.9) * 0.5 + 0.5) * 0.15;
      let t = THREE.MathUtils.clamp(n * 1.15 + blade - 0.1, 0, 0.999);
      const ci = Math.floor(t * pal.length);
      let [r, gg, b] = pal[ci];
      // 軽いディザ
      const d = ((x & 1) ^ (y & 1)) ? 6 : -6;
      const i = (y * size + x) * 4;
      img.data[i] = r + d; img.data[i + 1] = gg + d; img.data[i + 2] = b + d; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: 1 });
}

// ---- 土／小道 ----
export function dirtTexture(size = 128) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const pal = [[78, 58, 42], [98, 72, 50], [120, 92, 64], [140, 110, 78]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(x * 0.08, y * 0.08, 4);
    const ci = Math.min(pal.length - 1, Math.floor(n * pal.length));
    const [r, gg, b] = pal[ci];
    const i = (y * size + x) * 4;
    const grit = hash(x, y) > 0.92 ? 20 : 0;
    img.data[i] = r + grit; img.data[i + 1] = gg + grit; img.data[i + 2] = b + grit; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c);
}

// ---- 石（崖／土台の側面） ----
export function stoneTexture(size = 128) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(x * 0.05, y * 0.05, 5);
    const crack = Math.abs(Math.sin(x * 0.12 + n * 6)) < 0.06 ? -28 : 0;
    let v = 70 + n * 70 + crack;
    const i = (y * size + x) * 4;
    img.data[i] = v * 0.95; img.data[i + 1] = v * 0.92; img.data[i + 2] = v * 0.85; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat: 1 });
}

// ---- 法線テクスチャ（簡易・凹凸感） ----
export function normalFromHeight(size = 128, scale = 0.07, strength = 2.2) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const h = (x, y) => fbm(x * scale, y * scale, 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
    const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const nz = 1.0;
    const len = Math.hypot(dx, dy, nz);
    const i = (y * size + x) * 4;
    img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// =========================================================
//  ドット絵キャラ（手続き生成のスプライトシート）
//  front/back 各3フレーム（歩行）。左右は描画時にフリップ。
// =========================================================
const TW = 32, TH = 40; // 1フレームの解像度

function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

const DEFAULT_PAL = { cloak: '#3b86a8', cloakBack: '#2f6f8f', cloakSh: '#235468', hat: '#caa45a', hatSh: '#9c7b3c', hatTop: '#e0bd72', tunic: '#caa15a', belt: '#9c3b3b' };

function drawTraveler(g, ox, frame, back, pal = DEFAULT_PAL) {
  // frame: 0 静止, 1 左足, 2 右足
  const bob = frame === 0 ? 0 : (frame === 1 ? -1 : -1);
  const legL = frame === 1 ? 2 : 0;
  const legR = frame === 2 ? 2 : 0;
  const skin = '#e8b88c', skinSh = '#c99268';
  const cloak = back ? pal.cloakBack : pal.cloak, cloakSh = pal.cloakSh;
  const hat = pal.hat, hatSh = pal.hatSh;
  const boot = '#4b3520', tunic = pal.tunic;
  const cx = ox + TW / 2;
  const y0 = 6 + bob;

  // 影
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath(); g.ellipse(cx, 37, 9, 3.2, 0, 0, Math.PI * 2); g.fill();

  // 脚／ブーツ
  px(g, cx - 5, 28 - legL, 4, 8 + legL, boot);
  px(g, cx + 1, 28 - legR, 4, 8 + legR, boot);

  // 胴（マント）
  px(g, cx - 7, y0 + 10, 14, 13, cloak);
  px(g, cx - 7, y0 + 10, 3, 13, cloakSh);
  px(g, cx - 6, y0 + 11, 12, 3, tunic); // 肩当て

  if (!back) {
    // 顔
    px(g, cx - 4, y0 + 3, 8, 8, skin);
    px(g, cx - 4, y0 + 3, 2, 8, skinSh);
    // 目
    px(g, cx - 2, y0 + 6, 2, 2, '#26303a');
    px(g, cx + 1, y0 + 6, 2, 2, '#26303a');
  } else {
    // 後頭部
    px(g, cx - 4, y0 + 3, 8, 8, '#6b4a2c');
  }
  // 帽子（つば広）
  px(g, cx - 7, y0 + 1, 14, 3, hat);
  px(g, cx - 7, y0 + 3, 14, 1, hatSh);
  px(g, cx - 4, y0 - 3, 8, 5, hat);
  px(g, cx - 4, y0 - 3, 8, 2, pal.hatTop);

  // 腰の帯
  px(g, cx - 7, y0 + 20, 14, 2, pal.belt);
}

export function characterSpriteSheet(pal = DEFAULT_PAL) {
  const cols = 3, rows = 2; // [front x3][back x3]
  const c = makeCanvas(256); // 余裕を持たせて後でrepeat設定
  c.width = TW * cols; c.height = TH * rows;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  for (let f = 0; f < cols; f++) {
    drawTraveler(g, f * TW, f, false, pal);          // 上段: front
    g.save();
    g.translate(0, TH);
    drawTraveler(g, f * TW, f, true, pal);           // 下段: back
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, cols, rows, frameW: TW, frameH: TH };
}

// ---- 木（ビルボード用） ----
export function treeSprite(size = 128) {
  const c = makeCanvas(size), g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  // 幹
  px(g, cx - 6, size - 46, 12, 46, '#5a3d24');
  px(g, cx - 6, size - 46, 4, 46, '#43301c');
  // 葉（数層の塊）
  const blobs = [[cx, 44, 40, '#2f5d34'], [cx - 22, 60, 30, '#274e2c'], [cx + 22, 58, 30, '#356a3b'],
                 [cx, 30, 30, '#3c7a44'], [cx - 10, 50, 26, '#46905073'.slice(0, 7)]];
  for (const [x, y, r, col] of blobs) {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // ハイライト
  g.fillStyle = '#6fae5e';
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * 34;
    g.fillRect(cx + Math.cos(a) * rr, 36 + Math.sin(a) * rr, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---- 草むら（揺れる instanced billboard 用） ----
export function grassBladeSprite(size = 64) {
  const c = makeCanvas(size), g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.imageSmoothingEnabled = false;
  const cols = ['#3f7a3a', '#4f9248', '#5fa552'];
  for (let b = 0; b < 7; b++) {
    const x = 10 + b * 6 + (Math.random() * 3 | 0);
    const h = 26 + (Math.random() * 18 | 0);
    g.fillStyle = cols[b % cols.length];
    g.beginPath();
    g.moveTo(x, size);
    g.quadraticCurveTo(x - 3 + (b - 3), size - h, x + (b - 3), size - h);
    g.quadraticCurveTo(x + 3 + (b - 3), size - h, x + 3, size);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---- 光の粒（ホタル／glow） ----
export function glowSprite(size = 64) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,250,210,1)');
  grd.addColorStop(0.25, 'rgba(255,225,140,0.8)');
  grd.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  return tex;
}

// ---- 花びら（天候） ----
export function petalSprite(size = 16) {
  const c = makeCanvas(size), g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#ffc6dd';
  g.beginPath(); g.ellipse(size / 2, size / 2, size * 0.42, size * 0.26, Math.PI / 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff9fc4';
  g.beginPath(); g.ellipse(size / 2, size * 0.6, size * 0.22, size * 0.13, Math.PI / 5, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; return tex;
}

// ---- 雨だれ ----
export function rainSprite(size = 16) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, size);
  grd.addColorStop(0, 'rgba(200,225,255,0)'); grd.addColorStop(0.5, 'rgba(200,225,255,.7)'); grd.addColorStop(1, 'rgba(220,240,255,0)');
  g.fillStyle = grd; g.fillRect(size / 2 - 1, 0, 2, size);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; return tex;
}

// ---- 花（地面ビルボード） ----
export function flowerSprite(size = 48, color = '#ffd23a') {
  const c = makeCanvas(size), g = c.getContext('2d');
  g.imageSmoothingEnabled = false; g.clearRect(0, 0, size, size);
  const cx = size / 2;
  // 茎
  px(g, cx - 1, size * 0.4, 2, size * 0.6, '#3f7a3a');
  // 花弁
  g.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    g.beginPath(); g.ellipse(cx + Math.cos(a) * 7, size * 0.32 + Math.sin(a) * 7, 4, 5, a, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#fff4c0'; g.beginPath(); g.arc(cx, size * 0.32, 3.5, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; return tex;
}

// ---- 岩 ----
export function rockSprite(size = 64) {
  const c = makeCanvas(size), g = c.getContext('2d');
  g.imageSmoothingEnabled = false; g.clearRect(0, 0, size, size);
  const cx = size / 2, base = size - 8;
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(cx, base, 22, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7a7e86';
  g.beginPath(); g.moveTo(cx - 20, base); g.lineTo(cx - 14, base - 18); g.lineTo(cx + 2, base - 24); g.lineTo(cx + 18, base - 14); g.lineTo(cx + 22, base); g.closePath(); g.fill();
  g.fillStyle = '#9aa0a8'; g.beginPath(); g.moveTo(cx - 14, base - 18); g.lineTo(cx + 2, base - 24); g.lineTo(cx - 2, base - 12); g.closePath(); g.fill();
  g.fillStyle = '#5e6168'; px(g, cx + 8, base - 12, 8, 12, '#5e6168');
  const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; return tex;
}

// ---- 雲（空ドーム用のタイル可能ノイズ） ----
export function cloudTexture(size = 256) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // タイル可能なfbm（周期境界で繋ぐ）
    const n = fbm(x * 0.02, y * 0.02, 5);
    const a = THREE.MathUtils.clamp((n - 0.52) * 3.2, 0, 1);
    const i = (y * size + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; return tex;
}

// ---- NPCの配色バリエーション ----
export const NPC_PALETTES = {
  villager: { cloak: '#7a8c3a', cloakBack: '#637030', cloakSh: '#4c5a26', hat: '#b06b3a', hatSh: '#854f2a', hatTop: '#c98a52', tunic: '#cdb27a', belt: '#5a3b22' },
  merchant: { cloak: '#8a3b7a', cloakBack: '#6f2f63', cloakSh: '#54234c', hat: '#caa45a', hatSh: '#9c7b3c', hatTop: '#e0bd72', tunic: '#d8c070', belt: '#3b2a5a' },
  guard:    { cloak: '#3a5a8c', cloakBack: '#2f4870', cloakSh: '#233a54', hat: '#9aa3ad', hatSh: '#6f7782', hatTop: '#c0c8d0', tunic: '#8a909a', belt: '#2a2f38' },
  elder:    { cloak: '#6a5a8c', cloakBack: '#564870', cloakSh: '#3f3454', hat: '#d8d0c0', hatSh: '#a89f8c', hatTop: '#efe8d8', tunic: '#b8aa90', belt: '#4a3b5a' },
};

// ---- 敵スプライト（ビルボード） ----
function spriteCanvas(size) {
  const c = makeCanvas(size); const g = c.getContext('2d');
  g.imageSmoothingEnabled = false; g.clearRect(0, 0, size, size);
  // 接地影
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath(); g.ellipse(size / 2, size - 8, size * 0.26, size * 0.06, 0, 0, Math.PI * 2); g.fill();
  return { c, g };
}
function finishSprite(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true; return tex;
}

export function enemySprite(type = 'slime', size = 96) {
  const { c, g } = spriteCanvas(size);
  const cx = size / 2, base = size - 12;
  if (type === 'slime') {
    g.fillStyle = '#3ba24e';
    g.beginPath();
    g.moveTo(cx - 28, base);
    g.quadraticCurveTo(cx - 30, base - 38, cx, base - 40);
    g.quadraticCurveTo(cx + 30, base - 38, cx + 28, base);
    g.closePath(); g.fill();
    g.fillStyle = '#5fd06f'; g.beginPath(); g.ellipse(cx - 8, base - 26, 8, 6, 0, 0, Math.PI * 2); g.fill(); // ハイライト
    g.fillStyle = '#fff'; px(g, cx - 12, base - 22, 7, 8, '#fff'); px(g, cx + 5, base - 22, 7, 8, '#fff');
    g.fillStyle = '#16301c'; px(g, cx - 10, base - 18, 3, 4, '#16301c'); px(g, cx + 7, base - 18, 3, 4, '#16301c');
    px(g, cx - 6, base - 10, 12, 2, '#1c5a2a'); // 口
  } else if (type === 'bat') {
    g.fillStyle = '#6a4a8c'; // 翼
    g.beginPath(); g.moveTo(cx, base - 30); g.lineTo(cx - 34, base - 44); g.lineTo(cx - 26, base - 24); g.lineTo(cx - 34, base - 18); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx, base - 30); g.lineTo(cx + 34, base - 44); g.lineTo(cx + 26, base - 24); g.lineTo(cx + 34, base - 18); g.closePath(); g.fill();
    g.fillStyle = '#46315e'; g.beginPath(); g.ellipse(cx, base - 26, 12, 14, 0, 0, Math.PI * 2); g.fill(); // 胴
    px(g, cx - 6, base - 32, 4, 5, '#ffd23a'); px(g, cx + 2, base - 32, 4, 5, '#ffd23a'); // 目
    px(g, cx - 6, base - 27, 4, 2, '#1a1020'); px(g, cx + 2, base - 27, 4, 2, '#1a1020');
    px(g, cx - 4, base - 40, 3, 5, '#46315e'); px(g, cx + 1, base - 40, 3, 5, '#46315e'); // 耳
  } else if (type === 'mushroom') {
    px(g, cx - 6, base - 22, 12, 22, '#e8d8b8'); // 軸
    g.fillStyle = '#c0392b'; g.beginPath(); g.ellipse(cx, base - 24, 26, 18, 0, Math.PI, 0); g.fill(); // 傘
    g.fillStyle = '#f0e6d2';
    for (const [dx, dy, r] of [[-12, -26, 4], [8, -30, 5], [16, -22, 3], [-2, -34, 4]]) { g.beginPath(); g.arc(cx + dx, base + dy, r, 0, Math.PI * 2); g.fill(); }
    px(g, cx - 8, base - 14, 3, 4, '#5a4a2a'); px(g, cx + 5, base - 14, 3, 4, '#5a4a2a'); // 目
    px(g, cx - 4, base - 7, 8, 2, '#5a4a2a');
  }
  return finishSprite(c);
}
