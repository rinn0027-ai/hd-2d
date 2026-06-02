// main.js — HD-2D (Octopath風) デモ本体
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as P from './procedural.js';
import { createBattle, ENEMY_TYPES } from './battle.js';
import * as Audio from './audio.js';

// ============================================================ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a2238, 0.018);

// ============================================================ camera（低FOVで箱庭パース）
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.5, 400);
let camYaw = Math.PI * 0.25, camPitch = 0.92, camDist = 34;
const camTarget = new THREE.Vector3(0, 1.2, 0);

// ============================================================ ライト
const hemi = new THREE.HemisphereLight(0x9fb8ff, 0x44351f, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe8c2, 2.1);
sun.position.set(18, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);
const ambient = new THREE.AmbientLight(0x405070, 0.3);
scene.add(ambient);

// ============================================================ テクスチャ生成
const grassTex = P.grassTexture(); grassTex.repeat.set(1, 1);
const dirtTex = P.dirtTexture();
const stoneTex = P.stoneTexture();
const stoneNrm = P.normalFromHeight(128, 0.05, 2.6);

// ============================================================ 地形ジオラマ（ブロックを積む）
// 高さマップ: 中央は平地(0)、外周を一段高くして"切り取られたジオラマ"風に。
const GRID = 28, TILE = 2.0;
const worldGroup = new THREE.Group();
scene.add(worldGroup);

function tileHeight(gx, gz) {
  const cx = gx - GRID / 2, cz = gz - GRID / 2;
  const r = Math.hypot(cx, cz);
  if (r > 11.5) return -1;            // 範囲外（虚空）
  if (r > 9.5) return 2;              // 外周の高台
  return 0;                          // 中央の平地
}

const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 });
const sideMat = new THREE.MeshStandardMaterial({ map: stoneTex, normalMap: stoneNrm, roughness: 0.95 });
const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 });

const topGeo = new THREE.BoxGeometry(TILE, 0.4, TILE);
const blockGeoCache = {};
function blockGeo(h) {
  if (!blockGeoCache[h]) blockGeoCache[h] = new THREE.BoxGeometry(TILE, h, TILE);
  return blockGeoCache[h];
}

// 小道（中央を横切る土の帯）
function isPath(gx, gz) {
  const cz = gz - GRID / 2;
  return Math.abs(cz) < 1.5;
}

const flatTiles = []; // 歩ける平地座標
for (let gx = 0; gx < GRID; gx++) {
  for (let gz = 0; gz < GRID; gz++) {
    const h = tileHeight(gx, gz);
    if (h < 0) continue;
    const wx = (gx - GRID / 2) * TILE;
    const wz = (gz - GRID / 2) * TILE;
    const baseH = 4 + h; // 地中の厚み
    // 土台ブロック（側面=石）
    const block = new THREE.Mesh(blockGeo(baseH), sideMat);
    block.position.set(wx, h - baseH / 2, wz);
    block.castShadow = true; block.receiveShadow = true;
    worldGroup.add(block);
    // 天面（草 or 土）
    const path = h === 0 && isPath(gx, gz);
    const top = new THREE.Mesh(topGeo, path ? dirtMat : grassMat);
    top.position.set(wx, h + 0.2, wz);
    top.receiveShadow = true; top.castShadow = true;
    worldGroup.add(top);
    if (h === 0) flatTiles.push(new THREE.Vector3(wx, h + 0.4, wz));
  }
}

// ============================================================ 水（中央付近の池）— カスタムシェーダー
const waterUniforms = {
  uTime: { value: 0 },
  uShallow: { value: new THREE.Color(0x4fd6e0) },
  uDeep: { value: new THREE.Color(0x123a66) },
  uSky: { value: new THREE.Color(0x8fb8ff) },
};
const waterMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: waterUniforms,
  vertexShader: /* glsl */`
    varying vec2 vUv; varying vec3 vWorld;
    uniform float uTime;
    void main(){
      vUv = uv;
      vec3 p = position;
      p.z += sin(p.x*1.5 + uTime*1.6)*0.06 + cos(p.y*1.8 + uTime*1.1)*0.05;
      vec4 wp = modelMatrix * vec4(p,1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; varying vec3 vWorld;
    uniform float uTime; uniform vec3 uShallow, uDeep, uSky;
    float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){
      vec2 uv = vUv*6.0;
      float n = noise(uv + uTime*0.25) * 0.6 + noise(uv*2.3 - uTime*0.4)*0.4;
      vec3 col = mix(uDeep, uShallow, smoothstep(0.3,0.85,n));
      // きらめき（specular風）
      float spark = pow(noise(uv*5.0 + uTime*0.9), 22.0) * 3.0;
      col += vec3(1.0,0.95,0.8) * spark;
      col = mix(col, uSky, 0.18);
      gl_FragColor = vec4(col, 0.82);
    }`
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(11, 7, 40, 28), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.set(-7, 0.28, -7);
worldGroup.add(water);

// ============================================================ 木（ビルボード）
const treeTex = P.treeSprite();
const treeMat = new THREE.MeshBasicMaterial({ map: treeTex, transparent: true, alphaTest: 0.5, fog: true });
function addTree(x, z, s = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8 * s, 8 * s), treeMat.clone());
  m.position.set(x, 4 * s + 0.2, z);
  m.userData.billboard = true;
  worldGroup.add(m);
  return m;
}
const trees = [];
for (let i = 0; i < 10; i++) {
  const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 3.5;
  trees.push(addTree(Math.cos(a) * r, Math.sin(a) * r, 0.8 + Math.random() * 0.5));
}

// ============================================================ 草むら（揺れる instanced billboard）
const grassBladeTex = P.grassBladeSprite();
const COUNT = 1400;
const bladeGeo = new THREE.PlaneGeometry(1, 1);
bladeGeo.translate(0, 0.5, 0); // 根本を原点に
const aPhase = new Float32Array(COUNT);
const aScale = new Float32Array(COUNT);
bladeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
bladeGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 1));
const grassU = { uTime: { value: 0 }, uMap: { value: grassBladeTex } };
const grassMatI = new THREE.ShaderMaterial({
  uniforms: grassU, transparent: true, depthWrite: true,
  vertexShader: /* glsl */`
    attribute float aPhase; attribute float aScale;
    varying vec2 vUv; varying float vY;
    uniform float uTime;
    void main(){
      vUv = uv; vY = position.y;
      vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      vec3 toCam = normalize(vec3(cameraPosition.x - center.x, 0.0, cameraPosition.z - center.z));
      vec3 right = normalize(cross(vec3(0,1,0), toCam));
      float sway = sin(uTime*1.8 + aPhase)*0.18 * position.y;
      vec3 world = center
        + right * (position.x*aScale + sway*aScale)
        + vec3(0,1,0) * (position.y*aScale*1.6);
      gl_Position = projectionMatrix * viewMatrix * vec4(world,1.0);
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; varying float vY;
    uniform sampler2D uMap;
    void main(){
      vec4 t = texture2D(uMap, vUv);
      if(t.a < 0.5) discard;
      // 上ほど明るく
      gl_FragColor = vec4(t.rgb * (0.65 + vY*0.5), 1.0);
    }`
});
const grassInst = new THREE.InstancedMesh(bladeGeo, grassMatI, COUNT);
const dummy = new THREE.Object3D();
let placed = 0;
for (let i = 0; i < COUNT * 3 && placed < COUNT; i++) {
  const x = (Math.random() - 0.5) * 36, z = (Math.random() - 0.5) * 36;
  const r = Math.hypot(x, z);
  if (r > 9.2) continue;
  if (Math.abs(z) < 1.6) continue; // 小道は避ける
  if (x > -12.5 && x < -1.5 && z > -10.5 && z < -3.5) continue; // 池
  dummy.position.set(x, 0.4, z);
  dummy.updateMatrix();
  grassInst.setMatrixAt(placed, dummy.matrix);
  aPhase[placed] = Math.random() * Math.PI * 2;
  aScale[placed] = 0.7 + Math.random() * 0.7;
  placed++;
}
grassInst.count = placed;
grassInst.instanceMatrix.needsUpdate = true;
grassInst.frustumCulled = false; // 頂点をシェーダーで動かすため
worldGroup.add(grassInst);

// ============================================================ ランタン（点光源 + glowでbloom）
const glowTex = P.glowSprite();
const lampGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffd88a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const lampPositions = [[3, 0, 3], [-3, 0, 2.5], [4.5, 0, -3.5], [0, 0, 6]];
const lampLights = [];
for (const [x, , z] of lampPositions) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.8 }));
  post.position.set(x, 1.4, z); post.castShadow = true; worldGroup.add(post);
  const light = new THREE.PointLight(0xffb45a, 6, 9, 2);
  light.position.set(x, 2.7, z);
  worldGroup.add(light); lampLights.push(light);
  const glow = new THREE.Sprite(lampGlowMat);
  glow.scale.set(1.8, 1.8, 1.8); glow.position.set(x, 2.7, z);
  worldGroup.add(glow);
}

// ============================================================ ホタル（Points + additive bloom）
const FF = 120;
const ffGeo = new THREE.BufferGeometry();
const ffPos = new Float32Array(FF * 3);
const ffSeed = new Float32Array(FF);
for (let i = 0; i < FF; i++) {
  const a = Math.random() * Math.PI * 2, r = Math.random() * 9;
  ffPos[i * 3] = Math.cos(a) * r; ffPos[i * 3 + 1] = 0.6 + Math.random() * 3; ffPos[i * 3 + 2] = Math.sin(a) * r;
  ffSeed[i] = Math.random() * 100;
}
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
ffGeo.setAttribute('aSeed', new THREE.BufferAttribute(ffSeed, 1));
const ffMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uMap: { value: glowTex }, uSize: { value: 90 * renderer.getPixelRatio() } },
  vertexShader: /* glsl */`
    attribute float aSeed; uniform float uTime, uSize; varying float vTw;
    void main(){
      vec3 p = position;
      p.x += sin(uTime*0.6 + aSeed)*0.8;
      p.y += sin(uTime*0.9 + aSeed*1.7)*0.5;
      p.z += cos(uTime*0.5 + aSeed*2.3)*0.8;
      vTw = 0.5 + 0.5*sin(uTime*2.5 + aSeed*3.0);
      vec4 mv = modelViewMatrix * vec4(p,1.0);
      gl_PointSize = uSize / -mv.z * (0.5+vTw*0.8);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap; varying float vTw;
    void main(){
      vec4 t = texture2D(uMap, gl_PointCoord);
      gl_FragColor = vec4(t.rgb, t.a*vTw*0.9);
    }`
});
const fireflies = new THREE.Points(ffGeo, ffMat);
fireflies.position.y = 0.4;
fireflies.frustumCulled = false;
worldGroup.add(fireflies);

// ============================================================ プレイヤー（ドット絵ビルボード）
const sheet = P.characterSpriteSheet();
const charMat = new THREE.MeshBasicMaterial({ map: sheet.texture.clone(), transparent: true, alphaTest: 0.4, fog: true });
charMat.map.magFilter = THREE.NearestFilter; charMat.map.minFilter = THREE.NearestFilter;
charMat.map.repeat.set(1 / sheet.cols, 1 / sheet.rows);
const player = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.0), charMat);
player.position.set(0, 2.4, 4);
scene.add(player);
// 接地シャドウ（簡易ブロブ）
const blobMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const playerBlob = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), blobMat);
playerBlob.rotation.x = -Math.PI / 2;
scene.add(playerBlob);

function setFrame(col, back, flip) {
  const m = charMat.map;
  m.offset.y = back ? 0 : 0.5;
  if (flip) { m.repeat.x = -1 / sheet.cols; m.offset.x = (col + 1) / sheet.cols; }
  else { m.repeat.x = 1 / sheet.cols; m.offset.x = col / sheet.cols; }
}
setFrame(0, false, false);

// ============================================================ 障害物（円形コリジョン）
// 木・池・建物などを円で近似。プレイヤーはこれらを通り抜けられない。
const obstacles = [];
function addObstacle(x, z, r) { obstacles.push({ x, z, r }); }
// 木をコリジョン化
for (const tr of trees) addObstacle(tr.position.x, tr.position.z, 1.0);
// 池
addObstacle(-7, -7, 4.2);

// ============================================================ 建物（小屋）
function buildHouse(x, z, rot = 0) {
  const grp = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb9a07a, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3b3b, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3, 3.6), wallMat);
  body.position.y = 1.9; body.castShadow = body.receiveShadow = true; grp.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.2, 4), roofMat);
  roof.position.y = 4.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; grp.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.2), woodMat);
  door.position.set(0, 1.3, 1.85); grp.add(door);
  grp.position.set(x, 0.4, z); grp.rotation.y = rot;
  worldGroup.add(grp);
  addObstacle(x, z, 2.6);
  return grp;
}
buildHouse(5.5, 5.0, -0.4);

// ============================================================ NPC（ビルボード + 対話）
const npcs = [];
function addNPC(x, z, paletteName, name, lines) {
  const sh = P.characterSpriteSheet(P.NPC_PALETTES[paletteName]);
  const mat = new THREE.MeshBasicMaterial({ map: sh.texture, transparent: true, alphaTest: 0.4, fog: true });
  mat.map.repeat.set(1 / sh.cols, 1 / sh.rows); mat.map.offset.set(0, 0.5); // front idle
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.8), mat);
  m.position.set(x, 2.3, z);
  scene.add(m);
  const npc = { mesh: m, name, lines, x, z, home: new THREE.Vector2(x, z), wanderT: Math.random() * 5, sheet: sh };
  npcs.push(npc); addObstacle(x, z, 0.8);
  return npc;
}
addNPC(2.5, 3.0, 'villager', '村人', ['やあ、旅の人。', 'この先の草むらには\nまものが出るから気をつけな。', 'ダッシュで駆け抜けるのも手だよ。']);
addNPC(-2.0, 4.5, 'merchant', '行商人', ['いい天気… いや、もう夜かい？', '右上のつまみで時間を\n変えられるそうだ。不思議だね。']);
addNPC(4.5, 2.0, 'guard', '衛兵', ['この街は平和そのものさ。', '草むらのまものを\n退治してくれると助かる。']);
addNPC(-4.5, -2.0, 'elder', '長老', ['ようこそ、HD-2Dの世界へ。', '2Dの絵が3Dの光と影をまとう…', 'これぞ ディオラマの魔法じゃ。']);

// ============================================================ 宝箱（交互作用）
const chests = [];
function addChest(x, z, reward) {
  const grp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.8), new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.7 }));
  base.position.y = 0.35; base.castShadow = true; grp.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.35, 0.85), new THREE.MeshStandardMaterial({ color: 0x9c6a34, roughness: 0.6 }));
  lid.position.y = 0.78; grp.add(lid);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.2), new THREE.MeshStandardMaterial({ color: 0xd9c06a, metalness: 0.6, roughness: 0.4 }));
  band.position.set(0, 0.5, 0); grp.add(band);
  grp.position.set(x, 0.6, z); worldGroup.add(grp);
  const chest = { grp, lid, x, z, opened: false, reward };
  chests.push(chest); addObstacle(x, z, 0.7);
  return chest;
}
addChest(6.5, -5.0, { potions: 2 });
addChest(-6.0, 6.0, { potions: 1 });

// ============================================================ 遭遇ゾーン（草むら円）
const encounterZones = [
  { x: 5, z: -6, r: 3.5 }, { x: -6, z: 4, r: 3.2 }, { x: 6, z: 6, r: 3.0 }, { x: -5, z: -5, r: 3.2 },
];

// ============================================================ ポストプロセス
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bokeh = new BokehPass(scene, camera, { focus: camDist, aperture: 0.0014, maxblur: 0.01 });
composer.addPass(bokeh);

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.5, 0.82);
composer.addPass(bloom);

// ビネット + 軽いフィルムグレイン + 彩度
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 },
    uVignette: { value: 1.15 }, uSat: { value: 1.12 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime,uVignette,uSat;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // 彩度
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, uSat);
      // ビネット
      vec2 d = vUv-0.5;
      float v = smoothstep(0.85, 0.2, dot(d,d)*uVignette);
      c *= mix(0.55, 1.0, v);
      // グレイン
      float g = fract(sin(dot(vUv*uTime, vec2(12.99,78.23)))*43758.5);
      c += (g-0.5)*0.025;
      gl_FragColor = vec4(c,1.0);
    }`
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

// ============================================================ ゲーム状態 / ステータス
let gameState = 'field';                 // 'field' | 'dialogue' | 'battle'
const hero = { hp: 60, maxHp: 60, sp: 12, maxSp: 12, potions: 1, exp: 0 };
const battle = createBattle({ renderPass, bokeh, heroPal: undefined });
let stepsSinceBattle = 0;                // 遭遇クールダウン用

// ============================================================ 対話システム（タイプライタ）
const dlgEl = document.getElementById('dialogue');
const dlgName = document.getElementById('dlgName');
const dlgText = document.getElementById('dlgText');
let dlg = null; // { lines, idx, full, shown, done }

function startDialogue(name, lines) {
  gameState = 'dialogue';
  dlg = { name, lines, idx: 0 };
  dlgEl.style.display = 'block';
  showDlgLine();
}
function showDlgLine() {
  dlgName.textContent = dlg.name;
  dlg.full = dlg.lines[dlg.idx];
  dlg.shown = 0; dlg.done = false; dlgText.textContent = '';
}
function advanceDialogue() {
  if (!dlg) return;
  if (!dlg.done) { dlgText.textContent = dlg.full; dlg.shown = dlg.full.length; dlg.done = true; return; }
  dlg.idx++;
  if (dlg.idx >= dlg.lines.length) { endDialogue(); }
  else { Audio.sfx('cursor'); showDlgLine(); }
}
function endDialogue() {
  dlgEl.style.display = 'none'; dlg = null; gameState = 'field';
}
function updateDialogue(dt) {
  if (!dlg || dlg.done) return;
  dlg.shown += dt * 38; // 文字/秒
  const n = Math.floor(dlg.shown);
  if (n >= dlg.full.length) { dlgText.textContent = dlg.full; dlg.done = true; }
  else dlgText.textContent = dlg.full.slice(0, n);
}

// ============================================================ エリア名トースト
const areaToastEl = document.getElementById('areaToast');
let areaToastTimer = null;
function showArea(jp, en) {
  areaToastEl.innerHTML = jp + '<span class="small">' + en + '</span>';
  areaToastEl.style.opacity = '1';
  clearTimeout(areaToastTimer);
  areaToastTimer = setTimeout(() => { areaToastEl.style.opacity = '0'; }, 2200);
}

// ============================================================ トランジション（フラッシュ）
const flashEl = document.getElementById('flash');
function flash(color = '#fff', peak = 0.9) {
  return new Promise(res => {
    flashEl.style.background = color;
    flashEl.style.opacity = String(peak);
    setTimeout(() => { flashEl.style.opacity = '0'; res(); }, 200);
  });
}

// 昼夜でBGMの雰囲気を切替
function dayNightMood() { return (Math.abs(timeOfDay - 0.5) * 2 > 0.55) ? 'night' : 'day'; }

// ============================================================ バトル起動
async function triggerBattle() {
  if (gameState !== 'field') return;
  gameState = 'battle';
  document.getElementById('btnA').classList.remove('show');
  document.getElementById('hint').style.opacity = '0';
  Audio.sfx('encounter');
  await flash('#fff', 0.95);
  await flash('#fff', 0.7);
  const type = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
  const result = await battle.start(type, hero);
  await flash('#000', 0.85);
  if (result === 'win') { hero.exp += 10; hero.sp = Math.min(hero.maxSp, hero.sp + 4); }
  else if (result === 'lose') {
    // 全回復して街へ戻す
    hero.hp = hero.maxHp; hero.sp = hero.maxSp;
    player.position.set(0, 2.4, 4);
    showArea('街の広場', 'TOWN SQUARE');
  }
  stepsSinceBattle = 0;
  // フィールドBGMに戻す
  Audio.setMood(dayNightMood());
  gameState = 'field';
}

// ============================================================ 交互作用（最寄りのNPC/宝箱）
let nearTarget = null;
function findInteract() {
  let best = null, bestD = 2.6 * 2.6;
  const px2 = player.position.x, pz2 = player.position.z;
  for (const n of npcs) { const d = (n.mesh.position.x - px2) ** 2 + (n.mesh.position.z - pz2) ** 2; if (d < bestD) { bestD = d; best = { type: 'npc', ref: n }; } }
  for (const c of chests) { if (c.opened) continue; const d = (c.x - px2) ** 2 + (c.z - pz2) ** 2; if (d < bestD) { bestD = d; best = { type: 'chest', ref: c }; } }
  return best;
}
function interact() {
  if (gameState === 'dialogue') { Audio.sfx('cursor'); advanceDialogue(); return; }
  if (gameState !== 'field') return;
  if (!nearTarget) return;
  if (nearTarget.type === 'npc') { Audio.sfx('confirm'); startDialogue(nearTarget.ref.name, nearTarget.ref.lines); }
  else if (nearTarget.type === 'chest') {
    const c = nearTarget.ref; c.opened = true; c.lid.rotation.x = -1.1; c.lid.position.z = -0.3;
    Audio.sfx('chest');
    const got = c.reward.potions || 0; hero.potions += got;
    startDialogue('たからばこ', [`やくそうを ${got}個 みつけた！`]);
  }
}

// ============================================================ 入力
const keys = {};
// 最初の操作でオーディオ起動（自動再生制限対策）
function kickAudio() { Audio.ensureAudio(); }
addEventListener('keydown', kickAudio, { once: true });
addEventListener('pointerdown', kickAudio, { once: true });
addEventListener('touchstart', kickAudio, { once: true });

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === ' ' || k === 'enter' || k === 'f') { interact(); e.preventDefault(); } // 決定（QとEはカメラ回転に使用）
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('wheel', e => { camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 2, 16, 60); }, { passive: true });

// モバイル決定ボタン
const btnA = document.getElementById('btnA');
btnA.addEventListener('click', e => { e.preventDefault(); interact(); });
btnA.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); interact(); }, { passive: false });

// デスクトップ: 会話中はクリックで送り
addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && gameState === 'dialogue' && !e.target.closest('#panel, #ui')) interact();
});

// ============================================================ タッチ操作（スマホ）
// 左半分=フローティング仮想スティック（移動・強く倒すとダッシュ） / 右半分=視点ドラッグ / 2本指=ズーム
const joyVec = { x: 0, y: 0, mag: 0 };       // x:右, y:前(上倒し), mag:0..1
const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
if (isTouch) document.body.classList.add('touch');

const joyBase = document.getElementById('joyBase');
const joyKnob = document.getElementById('joyKnob');
const JOY_R = 56;
let joyId = null, joyOx = 0, joyOy = 0;        // スティック中心
const camSet = new Set();                       // 視点操作中のタッチID
let camLastX = 0, pinchDist = null;

function showJoy(x, y) {
  joyOx = x; joyOy = y;
  joyBase.style.left = x + 'px'; joyBase.style.top = y + 'px';
  joyBase.style.display = 'block';
}
function moveJoy(x, y) {
  let dx = x - joyOx, dy = y - joyOy;
  const len = Math.hypot(dx, dy);
  if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
  joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  joyVec.x = dx / JOY_R;
  joyVec.y = -dy / JOY_R;                        // 画面上方向 = 前進
  joyVec.mag = Math.min(1, len / JOY_R);
}
function endJoy() {
  joyBase.style.display = 'none';
  joyKnob.style.transform = 'translate(-50%, -50%)';
  joyVec.x = joyVec.y = joyVec.mag = 0;
}
// 現在画面に触れている「視点用」タッチを取得
function camTouches(touchList) {
  const arr = [];
  for (const t of touchList) if (camSet.has(t.identifier)) arr.push(t);
  return arr;
}
// UI要素（パネル/ヘッダ）の上で始まったタッチは操作対象外
function onUI(target) { return !!(target && target.closest && target.closest('#panel, #ui, #bMenu, #btnA')); }

addEventListener('touchstart', e => {
  if (onUI(e.target)) return;                    // スライダー/メニュー等はそのまま操作
  if (gameState === 'dialogue') { e.preventDefault(); interact(); return; } // タップで送り
  if (gameState === 'battle') { e.preventDefault(); return; }              // 移動/視点は無効
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth * 0.5 && joyId === null) {
      joyId = t.identifier; showJoy(t.clientX, t.clientY); moveJoy(t.clientX, t.clientY);
    } else {
      camSet.add(t.identifier);
    }
  }
  const cams = camTouches(e.touches);
  if (cams.length >= 2) pinchDist = Math.hypot(cams[0].clientX - cams[1].clientX, cams[0].clientY - cams[1].clientY);
  else if (cams.length === 1) camLastX = cams[0].clientX;
  e.preventDefault();
}, { passive: false });

addEventListener('touchmove', e => {
  if (onUI(e.target)) return;
  for (const t of e.changedTouches) if (t.identifier === joyId) moveJoy(t.clientX, t.clientY);
  const cams = camTouches(e.touches);
  if (cams.length >= 2) {                         // ピンチズーム
    const d = Math.hypot(cams[0].clientX - cams[1].clientX, cams[0].clientY - cams[1].clientY);
    if (pinchDist !== null) camDist = THREE.MathUtils.clamp(camDist - (d - pinchDist) * 0.05, 16, 60);
    pinchDist = d;
  } else if (cams.length === 1) {                 // 視点回転
    camYaw -= (cams[0].clientX - camLastX) * 0.008;
    camLastX = cams[0].clientX;
  }
  e.preventDefault();
}, { passive: false });

function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) { joyId = null; endJoy(); }
    camSet.delete(t.identifier);
  }
  const cams = camTouches(e.touches);
  pinchDist = cams.length >= 2 ? Math.hypot(cams[0].clientX - cams[1].clientX, cams[0].clientY - cams[1].clientY) : null;
  if (cams.length === 1) camLastX = cams[0].clientX;
}
addEventListener('touchend', onTouchEnd);
addEventListener('touchcancel', onTouchEnd);

// ============================================================ UI
const $ = id => document.getElementById(id);
let bloomOn = true, dofOn = true, pixelOn = false;
function syncUI() {
  $('bloomV').textContent = bloomOn ? 'ON' : 'OFF';
  $('dofV').textContent = dofOn ? 'ON' : 'OFF';
  $('pxV').textContent = pixelOn ? 'ON' : 'OFF';
  $('bloomTog').style.opacity = bloomOn ? 1 : 0.4;
  $('dofTog').style.opacity = dofOn ? 1 : 0.4;
  $('pxTog').style.opacity = pixelOn ? 1 : 0.4;
}
$('bloomStr').value = bloom.strength;
$('dofAp').value = 1.4;
$('timeOfDay').value = 0.5;
$('bloomTog').onclick = () => { bloomOn = !bloomOn; bloom.enabled = bloomOn; syncUI(); };
$('dofTog').onclick = () => { dofOn = !dofOn; bokeh.enabled = dofOn; syncUI(); };
$('pxTog').onclick = () => { pixelOn = !pixelOn; renderer.domElement.style.imageRendering = pixelOn ? 'pixelated' : 'auto'; onResize(); syncUI(); };
$('bloomStr').oninput = e => bloom.strength = +e.target.value;
$('dofAp').oninput = e => { bokeh.uniforms['aperture'].value = +e.target.value * 0.001; };
let timeOfDay = 0.5;
$('timeOfDay').oninput = e => { timeOfDay = +e.target.value; };
// パネル折りたたみ（タイトルをタップ/クリック）。スマホでは初期折りたたみ。
const panelEl = document.getElementById('panel');
const panelTitle = panelEl.querySelector('.title');
if (isTouch) panelEl.classList.add('collapsed');
panelTitle.addEventListener('click', () => panelEl.classList.toggle('collapsed'));
syncUI();

// 時刻 → ライト/空のグラデーション
const dayKeys = [
  { t: 0.0, sky: 0x0b1026, sun: 0x36406a, sunI: 0.2, fog: 0x0b1026, amb: 0.18, hemiI: 0.25 }, // 夜
  { t: 0.22, sky: 0x2a2a4a, sun: 0xff9a5a, sunI: 1.3, fog: 0x33304a, amb: 0.25, hemiI: 0.4 },  // 夜明け
  { t: 0.5, sky: 0x7fa8e8, sun: 0xffe8c2, sunI: 2.2, fog: 0x9bb6e0, amb: 0.32, hemiI: 0.6 },   // 昼
  { t: 0.78, sky: 0xe8804a, sun: 0xff7038, sunI: 1.6, fog: 0xc06848, amb: 0.28, hemiI: 0.45 }, // 夕暮れ
  { t: 1.0, sky: 0x0b1026, sun: 0x36406a, sunI: 0.2, fog: 0x0b1026, amb: 0.18, hemiI: 0.25 },  // 夜
];
const cA = new THREE.Color(), cB = new THREE.Color();
function applyTimeOfDay(t) {
  let i = 0; while (i < dayKeys.length - 2 && t > dayKeys[i + 1].t) i++;
  const a = dayKeys[i], b = dayKeys[i + 1];
  const k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  const lerpC = (ca, cb) => cA.set(ca).lerp(cB.set(cb), k);
  scene.background = lerpC(a.sky, b.sky).clone();
  scene.fog.color.copy(lerpC(a.fog, b.fog));
  sun.color.copy(lerpC(a.sun, b.sun));
  sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, k);
  ambient.intensity = THREE.MathUtils.lerp(a.amb, b.amb, k);
  hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, k);
  // 太陽の高度（時刻で弧を描く）
  const ang = (t - 0.25) * Math.PI * 2;
  sun.position.set(Math.cos(ang) * 30, Math.max(4, Math.sin(ang) * 34 + 6), 14);
  // 昼夜量（0=夜, 1=真昼）でランタン強度・ホタル表示を制御
  const dayAmt = 1 - Math.abs(t - 0.5) * 2;
  for (const L of lampLights) L.intensity = THREE.MathUtils.lerp(8, 2.5, THREE.MathUtils.clamp(dayAmt, 0, 1));
  fireflies.visible = dayAmt < 0.55;
  // キャラとビルボードの環境トーン
  charMat.color.copy(cA.set(a.sky).lerp(cB.set(b.sky), k)).multiplyScalar(0.4).addScalar(0.62);
}

// ============================================================ リサイズ
function onResize() {
  const W = innerWidth, H = innerHeight;
  const scale = pixelOn ? 0.34 : 1;
  renderer.setSize(W, H, false);
  const iw = Math.floor(W * scale), ih = Math.floor(H * scale);
  renderer.setSize(iw, ih, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  composer.setSize(iw, ih);
  bloom.setSize(iw, ih);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);
onResize();

// ============================================================ ループ
const clock = new THREE.Clock();
const vel = new THREE.Vector3();
let facingFlip = false, lastBack = false, walkAnim = 0, stepTimer = 0;
const tmp = new THREE.Vector3();

// 草むらでの遭遇判定
function checkEncounter(dt, x, z, dash) {
  let inZone = false;
  for (const z2 of encounterZones) { if ((x - z2.x) ** 2 + (z - z2.z) ** 2 < z2.r * z2.r) { inZone = true; break; } }
  if (!inZone) { stepsSinceBattle = Math.max(0, stepsSinceBattle - dt); return; }
  stepsSinceBattle += dt * (dash ? 1.7 : 1.0);
  if (stepsSinceBattle > 1.0 && Math.random() < dt * 0.6) triggerBattle();
}

// 交互作用プロンプト（モバイル=決定ボタン / デスクトップ=テキストヒント）
const hintEl = document.getElementById('hint');
function updatePrompt() {
  const show = gameState === 'dialogue' || (gameState === 'field' && !!nearTarget);
  const verb = gameState === 'dialogue' ? '送る' : (nearTarget && nearTarget.type === 'chest' ? '調べる' : '話す');
  if (isTouch) {
    btnA.classList.toggle('show', show);
    btnA.textContent = gameState === 'dialogue' ? '▼' : verb;
  } else {
    hintEl.style.opacity = show ? '1' : '0';
    hintEl.textContent = (gameState === 'dialogue' ? '［Space / クリック］ ' : '［Space / F］ ') + verb;
  }
}

function update(dt, t) {
 if (gameState === 'field') {
  // --- カメラ回転入力 ---
  if (keys['q']) camYaw -= dt * 1.4;
  if (keys['e']) camYaw += dt * 1.4;

  // --- 移動（カメラ基準）: キーボード(デジタル) + 仮想スティック(アナログ) ---
  const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const rightV = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
  let ix = 0, iy = 0; // ix:右, iy:前
  if (keys['w'] || keys['arrowup']) iy += 1;
  if (keys['s'] || keys['arrowdown']) iy -= 1;
  if (keys['d'] || keys['arrowright']) ix += 1;
  if (keys['a'] || keys['arrowleft']) ix -= 1;
  ix += joyVec.x; iy += joyVec.y;
  const inMag = Math.hypot(ix, iy);
  if (inMag > 1) { ix /= inMag; iy /= inMag; } // 斜め・併用でも最大1に
  const dash = keys['shift'] || joyVec.mag > 0.9;
  const speed = dash ? 11 : 6;
  vel.copy(forward).multiplyScalar(iy).addScaledVector(rightV, ix).multiplyScalar(speed * dt);
  const moving = (inMag > 0.05);
  if (moving) {
    let nx = player.position.x + vel.x, nz = player.position.z + vel.z;
    // マップ境界（円）
    const rr = Math.hypot(nx, nz);
    if (rr > 9.0) { nx = nx / rr * 9.0; nz = nz / rr * 9.0; }
    // 障害物から押し出し（円コリジョン）
    const PR = 0.55;
    for (const o of obstacles) {
      const dx = nx - o.x, dz = nz - o.z, d = Math.hypot(dx, dz), min = o.r + PR;
      if (d < min && d > 1e-4) { nx = o.x + dx / d * min; nz = o.z + dz / d * min; }
    }
    player.position.x = nx; player.position.z = nz;
    // 向き：画面上での左右と前後
    if (Math.abs(ix) > 0.0005) facingFlip = ix < 0;
    lastBack = iy > Math.abs(ix) * 0.6; // 奥向き=背面
    walkAnim += dt * (dash ? 13 : 9);
    setFrame(1 + (Math.floor(walkAnim) % 2), lastBack, facingFlip);
    // 足音
    stepTimer -= dt;
    if (stepTimer <= 0) { Audio.sfx('step'); stepTimer = dash ? 0.22 : 0.34; }
    // 遭遇判定（草むらゾーン内）
    checkEncounter(dt, nx, nz, dash);
  } else {
    walkAnim = 0;
    setFrame(0, lastBack, facingFlip);
  }
 } // フィールド時のみ入力/移動
  player.position.y = 2.4 + Math.sin(t * 2.2) * 0.04; // 待機の浮遊
  player.rotation.y = camYaw; // 常にカメラを向くビルボード
  playerBlob.position.set(player.position.x, 0.42, player.position.z);

  // --- NPCのビルボード/待機 + 交互作用ターゲット ---
  for (const n of npcs) { n.mesh.rotation.y = camYaw; n.mesh.position.y = 2.3 + Math.sin(t * 1.8 + n.wanderT) * 0.05; }
  nearTarget = findInteract();
  updatePrompt();

  // --- カメラ追従 ---
  camTarget.lerp(tmp.set(player.position.x, 1.4, player.position.z), 1 - Math.pow(0.001, dt));
  const cp = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch)
  ).multiplyScalar(camDist);
  camera.position.copy(camTarget).add(cp);
  camera.lookAt(camTarget);

  // --- ビルボード（木をカメラに向ける：Y軸のみ） ---
  for (const tr of trees) tr.rotation.y = camYaw;

  // --- DOFのピントをプレイヤー距離に ---
  bokeh.uniforms['focus'].value = camera.position.distanceTo(player.position);

  // --- シェーダー時間 ---
  waterUniforms.uTime.value = t;
  grassU.uTime.value = t;
  ffMat.uniforms.uTime.value = t;
  gradePass.uniforms.uTime.value = (t * 9) % 100 + 1;

  // 太陽ターゲットをプレイヤー付近に
  sun.target.position.set(player.position.x, 0, player.position.z);
  applyTimeOfDay(timeOfDay);
  if (Audio.audioReady()) Audio.setMood(dayNightMood());
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (gameState === 'battle') { if (battle.isActive()) battle.update(dt, t); }
  else update(dt, t);
  updateDialogue(dt);
  gradePass.uniforms.uTime.value = (t * 9) % 100 + 1; // グレインは常時更新
  composer.render();
}

// 起動時にエリア名を表示
setTimeout(() => showArea('街の広場', 'TOWN SQUARE'), 600);

// 起動
applyTimeOfDay(timeOfDay);
animate();
const loading = document.getElementById('loading');
loading.style.opacity = '0';
setTimeout(() => loading.remove(), 700);
