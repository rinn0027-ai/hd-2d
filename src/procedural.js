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

function drawTraveler(g, ox, frame, back) {
  // frame: 0 静止, 1 左足, 2 右足
  const bob = frame === 0 ? 0 : (frame === 1 ? -1 : -1);
  const legL = frame === 1 ? 2 : 0;
  const legR = frame === 2 ? 2 : 0;
  const skin = '#e8b88c', skinSh = '#c99268';
  const cloak = back ? '#2f6f8f' : '#3b86a8', cloakSh = '#235468';
  const hat = '#caa45a', hatSh = '#9c7b3c';
  const boot = '#4b3520', tunic = '#caa15a';
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
  px(g, cx - 4, y0 - 3, 8, 2, '#e0bd72');

  // 腰の帯
  px(g, cx - 7, y0 + 20, 14, 2, '#9c3b3b');
}

export function characterSpriteSheet() {
  const cols = 3, rows = 2; // [front x3][back x3]
  const c = makeCanvas(256); // 余裕を持たせて後でrepeat設定
  c.width = TW * cols; c.height = TH * rows;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  for (let f = 0; f < cols; f++) {
    drawTraveler(g, f * TW, f, false);              // 上段: front
    g.save();
    g.translate(0, TH);
    drawTraveler(g, f * TW, f, true);               // 下段: back
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
