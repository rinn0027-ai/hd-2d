// main.js — HD-2D (Octopath風) デモ本体
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as P from './procedural.js';
import * as M from './models.js';
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
renderer.domElement.style.touchAction = 'none';

// iOSのダブルタップ/ピンチによるページ拡大を抑止（ゲーム操作と分離）
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
  addEventListener(ev, e => e.preventDefault(), { passive: false }));
addEventListener('dblclick', e => e.preventDefault(), { passive: false });
let _lastTapT = 0;
addEventListener('touchend', e => {
  const now = Date.now();
  // 同要素以外（ゲーム画面）での素早い2連タップ=ダブルタップ拡大を防ぐ
  if (now - _lastTapT < 320 && !(e.target.closest && e.target.closest('#bMenu, #btnA, #panel'))) e.preventDefault();
  _lastTapT = now;
}, { passive: false });

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a2238, 0.012);

// 黒い輪郭線（反転ハル: 各メッシュの裏面を少し膨らませて描く。肢体アニメに追従）
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x0a0a12, side: THREE.BackSide });
const COL_BLACK = new THREE.Color(0, 0, 0);
function addOutline(group, k = 1.08) {
  const meshes = [];
  group.traverse(o => { if (o.isMesh && !o.userData.outline) meshes.push(o); });
  for (const o of meshes) { const ol = new THREE.Mesh(o.geometry, OUTLINE_MAT); ol.scale.setScalar(k); ol.castShadow = false; ol.receiveShadow = false; ol.userData.outline = true; o.add(ol); }
}

// ============================================================ camera（低FOVで箱庭パース）
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.5, 400);
let camPitch = 0.92, camDist = 26;
let camRot = 0;                                   // タッチ/キーからの視点回転量（このフレーム分）
const viewFwd = new THREE.Vector3(0, 0, 1);       // 平行移動で運ぶ前方向タンジェント

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
// プレイヤー追従ライト（夜でも主役が見えるように）
const playerLight = new THREE.PointLight(0xfff0d0, 0.0, 16, 2);
scene.add(playerLight);

// ============================================================ 空ドーム（グラデ + 太陽 + 流雲）
const skyUniforms = {
  uTop: { value: new THREE.Color(0x2a4a8a) },
  uMid: { value: new THREE.Color(0x9bb6e0) },
  uBottom: { value: new THREE.Color(0xcfe0f0) },
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.4) },
  uSunColor: { value: new THREE.Color(0xffe8c2) },
  uClouds: { value: P.cloudTexture(256) },
  uCloudTint: { value: new THREE.Color(0xffffff) },
  uTime: { value: 0 },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(280, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir; uniform vec3 uTop,uMid,uBottom,uSunDir,uSunColor,uCloudTint;
      uniform sampler2D uClouds; uniform float uTime;
      void main(){
        float h = clamp(vDir.y*0.5+0.5, 0.0, 1.0);
        vec3 col = mix(uBottom, uMid, smoothstep(0.45,0.62,h));
        col = mix(col, uTop, smoothstep(0.62,0.95,h));
        // 太陽
        float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        col += uSunColor * pow(sd, 600.0) * 2.5;            // ディスク
        col += uSunColor * pow(sd, 8.0) * 0.35;             // ハロー
        // 雲（方向を平面に投影してスクロール）
        if (vDir.y > 0.02) {
          vec2 uv = vDir.xz / (vDir.y + 0.25) * 0.5;
          float c = texture2D(uClouds, uv * 0.6 + vec2(uTime*0.006, uTime*0.003)).a;
          c = c * smoothstep(0.05, 0.4, vDir.y);
          col = mix(col, uCloudTint, c * 0.7);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
sky.renderOrder = -1;
scene.add(sky);

// ============================================================ テクスチャ生成
const grassTex = P.grassTexture(); grassTex.repeat.set(1, 1);
const dirtTex = P.dirtTexture();
const stoneTex = P.stoneTexture();
const stoneNrm = P.normalFromHeight(128, 0.05, 2.6);

// ============================================================ 小惑星（プラネット）
const PLANET_R = 16;
const worldGroup = new THREE.Group();
scene.add(worldGroup);

const UPVEC = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);
const _z = new THREE.Vector3(), _x = new THREE.Vector3(), _m = new THREE.Matrix4();
function randDir() {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
}
function surfPos(dir, extra = 0) { return dir.clone().multiplyScalar(PLANET_R + extra); }
function alignUp(obj, dir) { obj.quaternion.setFromUnitVectors(UPVEC, dir); }
// 地表に立つビルボード（up=法線, 正面=カメラ方向）
function surfaceBillboard(obj, dir) {
  _z.copy(camera.position).sub(obj.position);
  _z.addScaledVector(dir, -_z.dot(dir));            // 法線成分を除去
  if (_z.lengthSq() < 1e-5) _z.set(dir.z, dir.x, -dir.y);
  _z.normalize();
  _x.crossVectors(dir, _z).normalize();
  _m.makeBasis(_x, dir, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 });
grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(8, 5);

// 惑星本体（軽い起伏つき）
const planetGeo = new THREE.SphereGeometry(PLANET_R, 96, 64);
{
  const pos = planetGeo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const bump = Math.sin(n.x * 5) * Math.cos(n.y * 4) * 0.22 + Math.sin(n.z * 7 + 1.3) * 0.16;
    v.addScaledVector(n, bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  planetGeo.computeVertexNormals();
}
const planet = new THREE.Mesh(planetGeo, grassMat);
planet.receiveShadow = true; planet.castShadow = true;
scene.add(planet);

// ============================================================ 惑星テーマ（多惑星ワープ）
const THEMES = [
  { name: '草原の星', en: 'GREEN PLANET', ground: 0xffffff, fog: 0x1a2238, enemyTint: null,     emissive: 0x000000, emI: 0,    snow: false, grav: 1,   hazard: 'heal', pool: ['slime', 'bat', 'mushroom', 'splitter'], bossKind: 'slime', bossName: 'スライム王 KING SLIME' },
  { name: '雪の星',   en: 'SNOW PLANET',  ground: 0xeaf4ff, fog: 0x2a3a52, enemyTint: 0x9fd0ff, emissive: 0x223344, emI: 0.12, snow: true,  grav: 1,   hazard: 'ice',  pool: ['crystal', 'bat', 'splitter', 'crystal'], bossKind: 'frost', bossName: 'フロストキング FROST KING' },
  { name: '溶岩の星', en: 'LAVA PLANET',  ground: 0xff6a3a, fog: 0x3a1208, enemyTint: 0xff6a40, emissive: 0xff2200, emI: 0.55, snow: false, grav: 1.1, hazard: 'lava', pool: ['golem', 'mushroom', 'bat', 'golem'], bossKind: 'magma', bossName: 'マグマロード MAGMA LORD' },
  { name: '異界の星', en: 'ALIEN PLANET', ground: 0xc090ff, fog: 0x2a1840, enemyTint: 0x9a6aff, emissive: 0x6a1aff, emI: 0.32, snow: false, grav: 0.5, hazard: 'none', pool: ['eye', 'caster', 'splitter', 'eye'], bossKind: 'void', bossName: 'ヴォイドアイ VOID EYE' },
];
let themeIndex = 0, planetMul = 1;
const fogTheme = new THREE.Color(0x1a2238);
function applyTheme(i) {
  const th = THEMES[i];
  grassMat.color.set(th.ground);
  grassMat.emissive.set(th.emissive); grassMat.emissiveIntensity = th.emI;
  fogTheme.set(th.fog);
  gravMul = th.grav; hazardTimer = 3;
  if (typeof snow !== 'undefined' && snow) snow.visible = th.snow;
}
// 空に浮かぶ他の惑星（装飾）
for (let i = 0; i < 5; i++) {
  const r = 4 + Math.random() * 7;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: THEMES[(i + 1) % THEMES.length].ground === 0xffffff ? 0x6fae5e : THEMES[(i + 1) % THEMES.length].ground, fog: false }));
  const d = randDirSeeded(i); m.position.copy(d).multiplyScalar(150 + Math.random() * 80);
  scene.add(m);
}
function randDirSeeded(i) { const a = i * 2.4, b = i * 1.7; return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)); }

// 大気シェル（"薄霧"トグルで表示）
const mistUniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xdfe8f5) }, uStrength: { value: 0.55 } };
const mist = new THREE.Mesh(
  new THREE.SphereGeometry(PLANET_R * 1.18, 48, 32),
  new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: mistUniforms,
    vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vN; uniform vec3 uColor; uniform float uStrength;
      void main(){ float rim = pow(1.0 - abs(vN.z), 2.2); gl_FragColor = vec4(uColor, rim*uStrength); }`,
  })
);
scene.add(mist);

// 角度ベースの障害物 {dir, ang}
const obstacles = [];
function addObstacleDir(dir, ang) { obstacles.push({ dir: dir.clone().normalize(), ang }); }
function nearObstacle(dir, pad = 0.04) { for (const o of obstacles) if (dir.dot(o.dir) > Math.cos(o.ang + pad)) return true; return false; }


// ============================================================ 木（3Dローポリ）
function placeOnSurface(obj, dir, up0 = UPVEC) {
  obj.position.copy(surfPos(dir, 0));
  obj.quaternion.setFromUnitVectors(up0, dir);
}
function addTree(dir, s = 1) {
  const g = M.makeTree(s);
  placeOnSurface(g, dir);
  worldGroup.add(g);
  addObstacleDir(dir, 0.05);
}
for (let i = 0; i < 16; i++) addTree(randDir(), 0.85 + Math.random() * 0.5);

// ============================================================ 草むら（法線に沿って生やす）
const grassBladeTex = P.grassBladeSprite();
const COUNT = 1800;
const bladeGeo = new THREE.PlaneGeometry(1, 1);
bladeGeo.translate(0, 0.5, 0); // 根本を原点に
const aPhase = new Float32Array(COUNT);
bladeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
const grassU = { uTime: { value: 0 }, uMap: { value: grassBladeTex } };
const grassMatI = new THREE.ShaderMaterial({
  uniforms: grassU, transparent: true, depthWrite: true,
  vertexShader: /* glsl */`
    attribute float aPhase; varying vec2 vUv; varying float vY;
    uniform float uTime;
    void main(){
      vUv = uv; vY = position.y;
      vec3 p = position;
      p.x += sin(uTime*1.8 + aPhase) * 0.16 * position.y;   // 風で揺れ
      vec4 wp = modelMatrix * instanceMatrix * vec4(p,1.0);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; varying float vY; uniform sampler2D uMap;
    void main(){
      vec4 t = texture2D(uMap, vUv);
      if(t.a < 0.5) discard;
      gl_FragColor = vec4(t.rgb * (0.6 + vY*0.5), 1.0);
    }`
});
const grassInst = new THREE.InstancedMesh(bladeGeo, grassMatI, COUNT);
const dummy = new THREE.Object3D();
for (let i = 0; i < COUNT; i++) {
  const d = randDir();
  dummy.position.copy(surfPos(d, 0));
  dummy.quaternion.setFromUnitVectors(UPVEC, d);
  dummy.rotateY(Math.random() * Math.PI * 2);
  const sc = 0.8 + Math.random() * 0.8; dummy.scale.set(sc, sc * 1.7, sc);
  dummy.updateMatrix();
  grassInst.setMatrixAt(i, dummy.matrix);
  aPhase[i] = Math.random() * Math.PI * 2;
}
grassInst.instanceMatrix.needsUpdate = true;
grassInst.frustumCulled = false;
worldGroup.add(grassInst);

// ============================================================ ランタン（3D + 点光源, 先端がbloomで光る）
const glowTex = P.glowSprite();
const lampLights = [];
for (let i = 0; i < 5; i++) {
  const d = randDir();
  const { root } = M.makeLampPost();
  placeOnSurface(root, d); worldGroup.add(root);
  const light = new THREE.PointLight(0xffb45a, 6, 10, 2);
  light.position.copy(surfPos(d, 2.5)); worldGroup.add(light); lampLights.push(light);
  addObstacleDir(d, 0.03);
}

// ============================================================ ホタル（惑星まわりを漂う）
const FF = 150;
const ffGeo = new THREE.BufferGeometry();
const ffPos = new Float32Array(FF * 3);
const ffSeed = new Float32Array(FF);
for (let i = 0; i < FF; i++) {
  const d = randDir().multiplyScalar(PLANET_R + 0.6 + Math.random() * 3);
  ffPos[i * 3] = d.x; ffPos[i * 3 + 1] = d.y; ffPos[i * 3 + 2] = d.z;
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
fireflies.frustumCulled = false;
worldGroup.add(fireflies);

// ============================================================ 天候（花びら / 雨）
function makeWeather(tex, count, opts) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 30;
    pos[i * 3 + 1] = Math.random() * 18;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    seed[i] = Math.random() * 100;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uMap: { value: tex }, uSize: { value: opts.size * renderer.getPixelRatio() }, uFall: { value: opts.fall }, uSway: { value: opts.sway } },
    vertexShader: /* glsl */`
      attribute float aSeed; uniform float uTime,uSize,uFall,uSway; varying float vR;
      void main(){
        vec3 p = position;
        float life = mod(uTime*uFall + aSeed*7.0, 18.0);
        p.y = 18.0 - life;                                   // 落下
        p.x += sin(uTime*0.8 + aSeed)*uSway + uTime*uSway*0.3;
        p.z += cos(uTime*0.6 + aSeed*1.7)*uSway;
        p.x = mod(p.x + 15.0, 30.0) - 15.0;
        p.z = mod(p.z + 15.0, 30.0) - 15.0;
        vR = aSeed + uTime*2.0;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_PointSize = uSize / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; varying float vR;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float s = sin(vR), c = cos(vR);
        uv = mat2(c,-s,s,c) * uv + 0.5;                       // 回転
        vec4 t = texture2D(uMap, uv);
        if (t.a < 0.05) discard;
        gl_FragColor = t;
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.visible = false;
  scene.add(pts);
  return pts;
}
const petals = makeWeather(P.petalSprite(), 320, { size: 26, fall: 1.3, sway: 1.1 });
const rain = makeWeather(P.rainSprite(), 600, { size: 34, fall: 7.0, sway: 0.05 });
const snow = makeWeather(P.snowSprite(), 460, { size: 16, fall: 2.4, sway: 0.7 }); // 雪の星で自動表示
let weather = 'none'; // 'none' | 'petals' | 'rain'

// ============================================================ プレイヤー（3Dローポリ人型）
const playerModel = M.makeHumanoid({ skin: 0xe8b88c, cloth: 0x3b86a8, pants: 0x2f4f6a, hat: 0xcaa45a });
const player = playerModel.root;
player.scale.setScalar(1.12);            // 少し大きく
// 主役を自発光させて、どんな光でも視認できるように
player.traverse(o => { if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.copy(o.material.color).multiplyScalar(0.6); o.material.emissiveIntensity = 0.28; } });
addOutline(player, 1.1);                  // 黒い輪郭線
scene.add(player);
// 足元の光リング（位置をいつも把握できる目印）
const markerMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
const marker = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.32, 28), markerMat);
marker.renderOrder = 3;
scene.add(marker);
// プレイヤーは惑星上の方向ベクトルで管理（北極からスタート）
const pDir = new THREE.Vector3(0, 1, 0);
const PLAYER_LIFT = 0.0;                 // 足元が地表に接地
const heading = new THREE.Vector3(0, 0, 1); // 向いている接線方向
const _MZ = new THREE.Vector3(0, 0, 1);

// ============================================================ 建物（小屋）— 惑星表面に立てる
function buildHouse(dir) {
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
  const winMat = new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffb84a, emissiveIntensity: 0, roughness: 0.5 });
  for (const wx of [-1.3, 1.3]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.15), winMat);
    w.position.set(wx, 2.2, 1.85); grp.add(w);
  }
  emissiveWindows.push(winMat);
  grp.position.copy(surfPos(dir, 0)); alignUp(grp, dir);
  worldGroup.add(grp);
  addObstacleDir(dir, 0.085);
  return grp;
}
const emissiveWindows = [];
buildHouse(new THREE.Vector3(0.4, 0.7, 0.3).normalize());

// ============================================================ NPC（3Dローポリ + 対話）
const NPC_COLORS = {
  villager: { skin: 0xe8b88c, cloth: 0x7a8c3a, pants: 0x4c5a26, hat: 0xb06b3a },
  merchant: { skin: 0xe8b88c, cloth: 0x8a3b7a, pants: 0x54234c, hat: 0xcaa45a },
  guard: { skin: 0xe8b88c, cloth: 0x3a5a8c, pants: 0x233a54, hat: 0x9aa3ad },
  elder: { skin: 0xead2b4, cloth: 0x6a5a8c, pants: 0x3f3454, hat: 0xd8d0c0 },
};
const npcs = [];
function addNPC(dir, paletteName, name, lines) {
  const model = M.makeHumanoid(NPC_COLORS[paletteName]);
  placeOnSurface(model.root, dir);
  addOutline(model.root, 1.08);
  scene.add(model.root);
  const npc = { model, name, lines, dir: dir.clone().normalize(), wanderT: Math.random() * 5, shop: paletteName === 'merchant' };
  npcs.push(npc); addObstacleDir(dir, 0.045);
  return npc;
}
addNPC(new THREE.Vector3(0.2, 0.9, 0.3).normalize(), 'villager', '村人', ['やあ、旅の人。', 'この星、ぐるっと一周\nできるらしいぜ。', '草むらは まもの だらけだ。気をつけな。']);
addNPC(new THREE.Vector3(-0.5, 0.6, 0.6).normalize(), 'merchant', '行商人', ['丸い大地…\nどこまで歩いても落ちないとはね。', '右上のつまみで時間も変わる。']);
addNPC(new THREE.Vector3(0.6, 0.2, -0.5).normalize(), 'guard', '衛兵', ['星の裏側にも まもの がいる。', '草むらを駆け抜けると\nよく出くわすぞ。']);
addNPC(new THREE.Vector3(-0.3, -0.7, 0.4).normalize(), 'elder', '長老', ['ようこそ、小さな星へ。', '2Dの絵が3Dになって\n球の上を歩く…', 'これぞ ディオラマの魔法じゃ。']);

// ============================================================ 宝箱（3D + 交互作用）
const chests = [];
function addChest(dir, reward) {
  const { root, lidPivot } = M.makeChest();
  placeOnSurface(root, dir); worldGroup.add(root);
  const chest = { grp: root, lidPivot, dir: dir.clone().normalize(), opened: false, reward };
  chests.push(chest); addObstacleDir(dir, 0.035);
  return chest;
}
addChest(new THREE.Vector3(-0.6, -0.3, -0.6).normalize(), { potions: 2 });
addChest(new THREE.Vector3(0.7, -0.5, 0.4).normalize(), { potions: 1 });

// ============================================================ ワープゲート（次の惑星へ）
const WARP_DIR = new THREE.Vector3(0.85, 0.15, -0.3).normalize();
const warpGate = new THREE.Group();
const warpTorus = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.22, 10, 26), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x33b0ff, emissiveIntensity: 1.5, roughness: 0.3 }));
warpTorus.position.y = 1.9; warpGate.add(warpTorus);
const warpBase = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.55, 0.3, 18), new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.7 }));
warpBase.position.y = 0.15; warpGate.add(warpBase);
warpGate.position.copy(surfPos(WARP_DIR, 0)); alignUp(warpGate, WARP_DIR);
worldGroup.add(warpGate);
let warping = false, warpCamDist = 0;     // warpCamDist>0 のあいだカメラ距離を上書き
const tunnelEl = document.getElementById('tunnel');
const easeIn = x => x * x, easeOut = x => 1 - (1 - x) * (1 - x);
function tween(fn, ms, ease = x => x) {
  return new Promise(res => {
    const t0 = performance.now();
    (function step() { const k = Math.min(1, (performance.now() - t0) / ms); fn(ease(k)); if (k < 1) requestAnimationFrame(step); else res(); })();
  });
}
async function warpTo() {
  if (warping) return; warping = true; gameState = 'warp'; resetTouch();
  const baseDist = camDist;
  Audio.sfx('encounter'); shakeT = Math.max(shakeT, 0.3);
  jumpV = JUMP_V * 1.5; grounded = false;             // 打ち上げ
  // ① カメラを宇宙へ引く（惑星が小さくなる）
  await tween(v => { warpCamDist = THREE.MathUtils.lerp(baseDist, 150, v); }, 650, easeIn);
  // ② 曲速トンネル
  tunnelEl.classList.add('on'); Audio.sfx('skill');
  await new Promise(r => setTimeout(r, 250));
  // ③ トンネル中に惑星を入れ替え
  themeIndex = (themeIndex + 1) % THEMES.length; planetMul *= 1.3;
  applyTheme(themeIndex);
  for (const e of enemies) scene.remove(e.model.root); enemies.length = 0;
  bossRef = null; bossbarEl.style.display = 'none';
  for (const p of pickups) scene.remove(p.obj); pickups.length = 0;
  for (const pr of projectiles) scene.remove(pr.mesh); projectiles.length = 0;
  for (const ar of arrows) scene.remove(ar.mesh); arrows.length = 0;
  for (const a of aoes) scene.remove(a.grp); aoes.length = 0;
  pDir.set(0, 1, 0); hero.hp = Math.min(hero.maxHp, hero.hp + 30);
  jumpH = 22; jumpV = 0; grounded = false; pendingLand = true; // 空から降下
  wave = 0; startWave(1); updateHUD();
  await new Promise(r => setTimeout(r, 450));
  tunnelEl.classList.remove('on');
  // ④ 新しい惑星へ寄る
  await tween(v => { warpCamDist = THREE.MathUtils.lerp(150, baseDist, v); }, 750, easeOut);
  warpCamDist = 0; gameState = 'field'; warping = false;
  showArea(THEMES[themeIndex].name, THEMES[themeIndex].en);
}

// ============================================================ 花・岩（3D）
const flowerColors = [0xffd23a, 0xff7a9c, 0xc08aff, 0xff9a4a, 0xffffff];
for (let i = 0, tries = 0; i < 34 && tries < 500; tries++) {
  const d = randDir();
  if (nearObstacle(d, 0.04)) continue;
  const f = M.makeFlower(flowerColors[Math.floor(Math.random() * flowerColors.length)]);
  placeOnSurface(f, d); worldGroup.add(f); i++;
}
for (let i = 0, tries = 0; i < 16 && tries < 200; tries++) {
  const d = randDir();
  if (nearObstacle(d, 0.04)) continue;
  const r = M.makeRock(0.9 + Math.random() * 0.8);
  placeOnSurface(r, d); worldGroup.add(r); i++;
  addObstacleDir(d, 0.035);
}

// ============================================================ ポストプロセス
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bokeh = new BokehPass(scene, camera, { focus: camDist, aperture: 0.0014, maxblur: 0.01 });
composer.addPass(bokeh);

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.65, 0.5, 0.82);
composer.addPass(bloom);

// 色収差 + 分離色調 + ビネット + フィルムグレイン + 彩度
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 },
    uVignette: { value: 1.15 }, uSat: { value: 1.16 },
    uAberr: { value: 1.0 },     // 色収差量(0で無効)
    uSplit: { value: 1.0 },     // 分離色調量
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime,uVignette,uSat,uAberr,uSplit;
    void main(){
      vec2 d = vUv-0.5;
      float r2 = dot(d,d);
      // 色収差（周辺ほどRGBをずらす）
      vec2 off = d * r2 * 0.012 * uAberr;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      // 彩度
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, uSat);
      // 分離色調（影=寒色 / ハイライト=暖色）
      vec3 shadowT = vec3(0.86, 0.95, 1.10);
      vec3 highT   = vec3(1.10, 1.02, 0.88);
      vec3 toned = c * mix(shadowT, highT, smoothstep(0.15, 0.85, l));
      c = mix(c, toned, uSplit);
      // ビネット
      float v = smoothstep(0.85, 0.2, r2*uVignette);
      c *= mix(0.5, 1.0, v);
      // グレイン
      float g = fract(sin(dot(vUv*uTime, vec2(12.99,78.23)))*43758.5);
      c += (g-0.5)*0.025;
      gl_FragColor = vec4(c,1.0);
    }`
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

// ============================================================ ゲーム状態 / ステータス
let gameState = 'field';                 // 'field' | 'dialogue'
const hero = { hp: 100, maxHp: 100, exp: 0, level: 1, potions: 1 };
function expToNext(lv) { return 20 + lv * 18; }

// ============================================================ 対話システム（タイプライタ）
const dlgEl = document.getElementById('dialogue');
const dlgName = document.getElementById('dlgName');
const dlgText = document.getElementById('dlgText');
let dlg = null; // { lines, idx, full, shown, done }

function startDialogue(name, lines) {
  gameState = 'dialogue'; resetTouch();
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
function planetMood() { return themeIndex === 0 ? dayNightMood() : ['', 'snow', 'lava', 'alien'][themeIndex]; }

// ============================================================ 即時戦闘（ウェーブ制）
const ENEMY_DEF = {
  slime:    { model: 'slime',    hp: 16, atk: 7,  exp: 8,  scale: 1.3, speed: 1.9, hover: 0,   atkRange: 2.2, aggro: 10, behavior: 'chase',  score: 10 },
  mushroom: { model: 'mushroom', hp: 30, atk: 12, exp: 16, scale: 1.4, speed: 1.3, hover: 0,   atkRange: 2.5, aggro: 9,  behavior: 'chase',  score: 15 },
  bat:      { model: 'bat',      hp: 12, atk: 8,  exp: 12, scale: 1.2, speed: 3.0, hover: 1.4, atkRange: 2.0, aggro: 13, behavior: 'charge', score: 12 },
  caster:   { model: 'mushroom', hp: 22, atk: 9,  exp: 18, scale: 1.4, speed: 1.0, hover: 0,   atkRange: 9.5, aggro: 16, behavior: 'caster', score: 20, tint: 0x8a4ad0 },
  splitter: { model: 'slime',    hp: 28, atk: 8,  exp: 14, scale: 1.7, speed: 1.6, hover: 0,   atkRange: 2.4, aggro: 10, behavior: 'split',  score: 16, tint: 0x3a86c0 },
  crystal:  { model: 'crystal',  hp: 24, atk: 9,  exp: 18, scale: 1.4, speed: 1.0, hover: 0,   atkRange: 9.0, aggro: 15, behavior: 'caster', score: 20, noTint: true },
  golem:    { model: 'golem',    hp: 58, atk: 15, exp: 26, scale: 1.4, speed: 1.1, hover: 0,   atkRange: 2.8, aggro: 9,  behavior: 'chase',  score: 28, noTint: true },
  eye:      { model: 'eye',      hp: 18, atk: 9,  exp: 22, scale: 1.3, speed: 1.7, hover: 1.6, atkRange: 10,  aggro: 17, behavior: 'caster', score: 24, noTint: true },
};
const BOSS_DEF = { hp: 220, atk: 20, exp: 120, scale: 3.2, speed: 1.6, hover: 0, atkRange: 4.4, aggro: 999, behavior: 'boss', score: 300 };
const enemies = [];
let bossRef = null;
let wave = 0, waveBreak = 0, score = 0, coins = 0;
let hitStop = 0, slowMo = 0;

function collectMats(root) { const a = []; root.traverse(o => { if (o.isMesh && o.material && o.material.emissive) a.push(o.material); }); return a; }
function freeDir(awayFromPlayer = true) {
  let d = randDir();
  for (let k = 0; k < 24; k++) { d = randDir(); if ((!awayFromPlayer || pDir.dot(d) < 0.5) && !nearObstacle(d, 0.05)) break; }
  return d;
}
const ELITE_AFFIX = ['tough', 'enrage', 'split'];
function spawnEnemyDef(key, dir, hpScale = 1, childScale = 1, isChild = false) {
  const def = ENEMY_DEF[key];
  const elite = !isChild && (forceElite > 0 || (wave >= 2 && Math.random() < 0.14));   // 精英怪（ノード強制含む）
  if (elite && forceElite > 0) forceElite--;
  const e = M.makeEnemy(def.model);
  const escale = def.scale * childScale * (elite ? 1.45 : 1);
  e.root.scale.setScalar(escale);
  const tint = def.tint || (def.noTint ? null : THEMES[themeIndex].enemyTint);
  if (tint) e.root.traverse(o => { if (o.isMesh && o.material && o.material.color) o.material.color.set(tint); });
  const mats = collectMats(e.root);
  for (const m of mats) { m.emissive.copy(m.color).multiplyScalar(elite ? 0.7 : 0.45); m.emissiveIntensity = elite ? 1.0 : 0.7; m.userData.be = m.emissive.clone(); }
  addOutline(e.root, 1.07);
  scene.add(e.root);
  const hp = def.hp * hpScale * planetMul * (elite ? 2.6 : 1);
  const en = { model: e, kind: key, def, dir: dir.clone().normalize(), hp, maxHp: hp, atk: def.atk * planetMul * (elite ? 1.5 : 1), alive: true, atkCD: 1 + Math.random() * 1.5, bobT: Math.random() * 9, hitFlash: 0, dead: 0, chargeT: 0, mats, childScale, escale, elite, affix: elite ? ELITE_AFFIX[Math.floor(Math.random() * ELITE_AFFIX.length)] : null, burn: 0, poison: 0, freeze: 0 };
  if (elite) { const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 })); aura.scale.setScalar(3.2); aura.position.y = e.height ? e.height * 0.5 : 1; e.root.add(aura); }
  enemies.push(en); return en;
}
function spawnBoss(n) {
  const e = M.makeBoss(THEMES[themeIndex].bossKind);
  const hp = (BOSS_DEF.hp + (n - 5) * 60) * planetMul;
  e.root.scale.setScalar(BOSS_DEF.scale * 0.9);
  const mats = collectMats(e.root);
  for (const m of mats) { m.userData.be = m.emissive.clone(); }
  addOutline(e.root, 1.05);
  scene.add(e.root);
  bossRef = { model: e, kind: 'boss', def: BOSS_DEF, theme: themeIndex, dir: freeDir().clone(), hp, maxHp: hp, atk: BOSS_DEF.atk * planetMul, alive: true, atkCD: 2, castCD: 3, bobT: 0, hitFlash: 0, dead: 0, isBoss: true, slamT: 0, escale: BOSS_DEF.scale * 0.9, burn: 0, poison: 0, freeze: 0, mats, phase: 1, enrageMul: 1, invT: 0, addCD: 7 };
  enemies.push(bossRef);
  Audio.sfx('encounter');
  document.getElementById('bossName').textContent = '◆ ' + THEMES[themeIndex].bossName + ' ◆';
  bossbarEl.style.display = 'block';
  showArea('ボスが あらわれた！', THEMES[themeIndex].bossName);
}
function startWave(n) {
  wave = n;
  if (n % 5 === 0) { spawnBoss(n); updateHUD(); return; }
  const count = Math.min(11, 3 + Math.floor(n * 0.9));
  const hpScale = 1 + (n - 1) * 0.16;
  const pool = THEMES[themeIndex].pool.slice(0, n >= 3 ? undefined : 2);  // 序盤は前2種、進むと全種
  for (let i = 0; i < count; i++) spawnEnemyDef(pool[Math.floor(Math.random() * pool.length)], freeDir(), hpScale);
  showArea('WAVE ' + n, count + ' 体');
  updateHUD();
}
const bossbarEl = document.getElementById('bossbar'), bossHpEl = document.getElementById('bossHp');

// ヒット火花エフェクト（追加合成スプライトのプール）
const fxList = [];
function spawnImpact(pos, color = 0xfff2c0, n = 6) {
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).normalize().multiplyScalar(4 + Math.random() * 4);
    sp.scale.setScalar(0.8 + Math.random());
    scene.add(sp); fxList.push({ sp, v, life: 0.3, max: 0.3 });
  }
}
function updateEffects(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i]; f.life -= dt;
    if (f.life <= 0) { scene.remove(f.sp); f.sp.material.dispose(); fxList.splice(i, 1); continue; }
    f.sp.position.addScaledVector(f.v, dt); f.v.multiplyScalar(0.88);
    const k = f.life / f.max; f.sp.material.opacity = k; f.sp.scale.setScalar((0.4 + (1 - k) * 1.6));
  }
  for (let i = shocks.length - 1; i >= 0; i--) {
    const s = shocks[i]; s.t -= dt; const k = 1 - s.t / s.max;
    if (s.t <= 0) { scene.remove(s.grp); s.grp.children[0].material.dispose(); shocks.splice(i, 1); continue; }
    s.grp.scale.setScalar(0.4 + s.r * k); s.grp.children[0].material.opacity = (1 - k) * 0.8;
  }
}
// スキル等の攻撃範囲を示す拡散リング
const shocks = [];
const shockRingGeo = new THREE.RingGeometry(0.86, 1.0, 40);
function spawnShock(dir, r, color = 0xbf8aff) {
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(shockRingGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })));
  grp.position.copy(surfPos(dir, 0.2));
  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  scene.add(grp);
  shocks.push({ grp, r, t: 0.4, max: 0.4 });
}

// ============================================================ 掉落物（コイン/ハート/ジェム）
const pickups = [];
function makePickup(type) {
  if (type === 'coin') return new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.09, 12), new THREE.MeshStandardMaterial({ color: 0xffd23a, metalness: 0.7, roughness: 0.3, emissive: 0x553300, emissiveIntensity: 0.5 }));
  if (type === 'heart') {
    const g = new THREE.Group(), mt = new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0x551020, emissiveIntensity: 0.5, roughness: 0.5 });
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mt); a.position.set(-0.11, 0.08, 0);
    const b = a.clone(); b.position.x = 0.11;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.34, 8), mt); c.rotation.x = Math.PI; c.position.y = -0.16;
    g.add(a, b, c); return g;
  }
  if (type === 'gear') { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshStandardMaterial({ color: 0xffe07a, emissive: 0xff8a00, emissiveIntensity: 1.0, metalness: 0.6, roughness: 0.3 })); return m; }
  return new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), new THREE.MeshStandardMaterial({ color: 0x6ad0ff, emissive: 0x113a55, emissiveIntensity: 0.6, roughness: 0.3 }));
}
function dropPickup(type, dir, data) {
  const obj = new THREE.Group(); obj.add(makePickup(type));
  obj.position.copy(surfPos(dir, 0.8)); alignUp(obj, dir);
  scene.add(obj);
  pickups.push({ obj, type, data, dir: dir.clone().normalize(), t: Math.random() * 9, life: type === 'gear' ? 26 : 16 });
}
function collectPickup(type, data) {
  if (type === 'coin') { coins += 1 + coinBonus; score += 5; Audio.sfx('cursor'); }
  else if (type === 'heart') { hero.hp = Math.min(hero.maxHp, hero.hp + 18); Audio.sfx('heal'); showDmg(player.position.clone().addScaledVector(_up, 2.6), 18, 'heal'); }
  else if (type === 'gear') { gotGear(data); }
  else { gainExp(6); score += 3; Audio.sfx('cursor'); }
  updateHUD();
}

// ============================================================ 装備 / 词条
const AFFIX = [
  { k: 'atk', f: r => 3 + Math.floor(Math.random() * 4 * r), fmt: v => '攻撃 +' + v },
  { k: 'crit', f: r => 0.04 + Math.random() * 0.05 * r, fmt: v => '会心 +' + Math.round(v * 100) + '%' },
  { k: 'move', f: r => 0.04 + Math.random() * 0.05 * r, fmt: v => '移動 +' + Math.round(v * 100) + '%' },
  { k: 'lifesteal', f: r => 0.03 + Math.random() * 0.04 * r, fmt: v => '吸血 +' + Math.round(v * 100) + '%' },
  { k: 'skillCd', f: r => 0.05 + Math.random() * 0.05 * r, fmt: v => 'スキルCD -' + Math.round(v * 100) + '%' },
];
function rollGear(rarity) {
  const pool = AFFIX.slice(), n = Math.min(pool.length, 1 + rarity), affixes = [];
  for (let i = 0; i < n; i++) { const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; affixes.push({ k: a.k, v: a.f(rarity), s: '' }); affixes[i].s = a.fmt(affixes[i].v); }
  const names = ['古びた', '上等な', '輝く'];
  const power = affixes.reduce((s, a) => s + (a.k === 'atk' ? a.v * 0.8 : a.v * 45), 0);
  return { rarity, affixes, name: (names[rarity - 1] || '') + '武具', power };
}
function recomputeGear() {
  gearBonus.atk = 0; gearBonus.crit = 0; gearBonus.move = 0; gearBonus.lifesteal = 0; gearBonus.skillCd = 1;
  if (equippedGear) for (const a of equippedGear.affixes) { if (a.k === 'skillCd') gearBonus.skillCd *= (1 - a.v); else gearBonus[a.k] += a.v; }
}
function gotGear(g) {
  if (!equippedGear || g.power > equippedGear.power) { equippedGear = g; recomputeGear(); Audio.sfx('victory'); showArea('装備獲得: ' + g.name, g.affixes.map(a => a.s).join(' / ')); }
  else { coins += 4; score += 12; Audio.sfx('cursor'); showArea('武具を換金 +4◆', g.name); }
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.life -= dt; p.t += dt;
    const d = THREE.MathUtils.clamp(pDir.dot(p.dir), -1, 1);
    const ang = Math.acos(d) * PLANET_R;
    if (ang < 3.0) { _axis.crossVectors(p.dir, pDir).normalize(); p.dir.applyAxisAngle(_axis, Math.min(9 * dt / PLANET_R, ang / PLANET_R)).normalize(); }
    p.obj.position.copy(surfPos(p.dir, 0.85 + Math.sin(p.t * 3) * 0.12));
    alignUp(p.obj, p.dir); p.obj.children[0].rotation.y += dt * 3;
    if (ang < 1.0 && p.life > 0) { collectPickup(p.type, p.data); scene.remove(p.obj); pickups.splice(i, 1); }
    else if (p.life <= 0) { scene.remove(p.obj); pickups.splice(i, 1); }
  }
}

// ============================================================ 敵の弾（caster）
const projectiles = [];
function spawnProjectile(fromDir, toDir, dmg) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc78aff, emissive: 0x7a2aff, emissiveIntensity: 1.3, roughness: 0.4 }));
  scene.add(m);
  const axis = new THREE.Vector3().crossVectors(fromDir, toDir);
  if (axis.lengthSq() < 1e-6) axis.crossVectors(fromDir, XAXIS);
  axis.normalize();
  projectiles.push({ mesh: m, dir: fromDir.clone(), axis, life: 4.5, speed: 6, dmg });
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]; p.life -= dt;
    p.dir.applyAxisAngle(p.axis, p.speed * dt / PLANET_R).normalize();
    p.mesh.position.copy(surfPos(p.dir, 1.5)); p.mesh.rotation.y += dt * 6;
    const ang = Math.acos(THREE.MathUtils.clamp(pDir.dot(p.dir), -1, 1)) * PLANET_R;
    if (ang < 1.4) { hurtPlayer(p.dmg, p.dir); spawnImpact(p.mesh.position.clone(), 0xc78aff, 6); scene.remove(p.mesh); projectiles.splice(i, 1); }
    else if (p.life <= 0) { scene.remove(p.mesh); projectiles.splice(i, 1); }
  }
}

// プレイヤーの矢（弓）
const arrows = [];
const _ARROW_FWD = new THREE.Vector3(0, 0, 1), _atan = new THREE.Vector3();
function makeArrow() {                          // +Z を進行方向とする矢
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.6 }));
  shaft.rotation.x = Math.PI / 2; g.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 6), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0x556070, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.4 }));
  tip.rotation.x = Math.PI / 2; tip.position.z = 0.56; g.add(tip);
  for (const sgn of [-1, 1]) { const fl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.18), new THREE.MeshStandardMaterial({ color: 0xff5a5a, roughness: 0.6 })); fl.position.set(sgn * 0.04, 0, -0.42); g.add(fl); }
  return g;
}
function spawnArrow() {
  const m = makeArrow();
  scene.add(m);
  const axis = new THREE.Vector3().crossVectors(pDir, heading);
  if (axis.lengthSq() < 1e-6) axis.crossVectors(pDir, XAXIS);
  axis.normalize();
  arrows.push({ mesh: m, dir: pDir.clone(), axis, life: 2.2, speed: 17, dmg: 12 + hero.level * 2 + atkBonus + gearBonus.atk + bowPower * 6 });
}
function updateArrowsP(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const p = arrows[i]; p.life -= dt;
    p.dir.applyAxisAngle(p.axis, p.speed * dt / PLANET_R).normalize();
    p.mesh.position.copy(surfPos(p.dir, 1.4));
    _atan.crossVectors(p.axis, p.dir).normalize();           // 進行方向(接線)
    p.mesh.quaternion.setFromUnitVectors(_ARROW_FWD, _atan);  // 矢を進行方向へ向ける
    let hit = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const ang = Math.acos(THREE.MathUtils.clamp(p.dir.dot(e.dir), -1, 1)) * PLANET_R;
      if (ang < e.def.scale * 0.9 + 0.7) {
        if (bossBarrier(e)) { hit = true; break; }
        const crit = Math.random() < critTotal(); let tot = crit ? p.dmg * 2 : p.dmg;
        if (e.affix === 'tough') tot = Math.round(tot * 0.6);
        e.hp -= tot; e.hitFlash = 0.18; registerHit(); if (crit) critFlash();
        if (Math.random() < 0.4) addStatus(e, 'poison', 4);   // 弓で毒
        if (relicCount('fire')) addStatus(e, 'burn', 3);
        if (relicCount('frost') && Math.random() < 0.35) addStatus(e, 'freeze', 1.5);
        if (syn('fire', 'frost') && e.burn > 0 && e.freeze > 0) { const sd = 12 + hero.level * 2; e.hp -= sd; spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.4), 0x9fd0ff, 8); } // 相転移
        let ls = lifestealTotal(); if (crit && syn('crit', 'vamp')) ls *= 2;  // 処刑
        if (ls > 0) hero.hp = Math.min(hero.maxHp, hero.hp + tot * ls);
        showDmg(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 3 : 1.8), tot, crit ? 'crit' : '');
        spawnImpact(p.mesh.position.clone(), 0xffe6a0, 5); Audio.sfx('hit');
        if (e.hp <= 0) killEnemy(e);
        hit = true; break;
      }
    }
    if (hit || p.life <= 0) { scene.remove(p.mesh); arrows.splice(i, 1); }
  }
}

// ============================================================ 敵HPバー（頭上, DOMプール）
const ebarWrap = document.getElementById('ebars'), ebarPool = [], _ev = new THREE.Vector3();
function updateEnemyBars() {
  let idx = 0;
  for (const e of enemies) {
    if (!e.alive || e.isBoss || e.hp >= e.maxHp) continue;
    let bar = ebarPool[idx];
    if (!bar) { const d = document.createElement('div'); d.className = 'ebar'; const f = document.createElement('i'); d.appendChild(f); ebarWrap.appendChild(d); bar = { d, f }; ebarPool[idx] = bar; }
    _ev.copy(e.model.root.position).addScaledVector(e.dir, e.def.scale * (e.def.model === 'bat' ? 2.2 : 1.8) + 0.4).project(camera);
    if (_ev.z > 1 || _ev.z < -1) { bar.d.style.display = 'none'; }
    else {
      bar.d.style.display = 'block';
      bar.d.style.left = (_ev.x * 0.5 + 0.5) * innerWidth + 'px';
      bar.d.style.top = (-_ev.y * 0.5 + 0.5) * innerHeight + 'px';
      bar.f.style.width = Math.max(0, e.hp / e.maxHp * 100) + '%';
    }
    idx++;
  }
  for (let i = idx; i < ebarPool.length; i++) ebarPool[i].d.style.display = 'none';
}

// ナビ矢印: 対象の方向を画面端で指す
const _av = new THREE.Vector3();
function updateArrow(el, worldPos) {
  _av.copy(worldPos).project(camera);
  let sx = _av.x, sy = _av.y; const behind = _av.z > 1;
  if (behind) { sx = -sx; sy = -sy; }
  const onScreen = !behind && Math.abs(_av.x) < 0.9 && Math.abs(_av.y) < 0.9;
  const cx = innerWidth / 2, cy = innerHeight / 2;
  let scrX, scrY;
  if (onScreen) { scrX = (_av.x * 0.5 + 0.5) * innerWidth; scrY = (-_av.y * 0.5 + 0.5) * innerHeight; el.style.opacity = '0.35'; }
  else { const a = Math.atan2(-sy, sx); const rx = innerWidth * 0.42, ry = innerHeight * 0.40; scrX = cx + Math.cos(a) * rx; scrY = cy + Math.sin(a) * ry; el.style.opacity = '1'; }
  const dx = scrX - cx, dy = scrY - cy;
  el.style.display = 'block';
  el.style.left = scrX + 'px'; el.style.top = scrY + 'px';
  el.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(dy, dx)}rad)`;
}
function updateArrows() {
  if (gameState !== 'field') { warpArrowEl.style.display = 'none'; bossArrowEl.style.display = 'none'; return; }
  updateArrow(warpArrowEl, _tmpW.copy(WARP_DIR).multiplyScalar(PLANET_R + 2));
  if (bossRef && bossRef.alive) updateArrow(bossArrowEl, bossRef.model.root.position);
  else bossArrowEl.style.display = 'none';
}
const warpArrowEl = document.getElementById('warpArrow'), bossArrowEl = document.getElementById('bossArrow'), _tmpW = new THREE.Vector3();

// 浮遊ダメージ表示
function showDmg(worldPos, val, cls = '') {
  const v = worldPos.clone().project(camera);
  if (v.z > 1) return;
  const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
  const el = document.createElement('div');
  el.className = 'dmgNum ' + cls; el.textContent = (cls === 'heal' ? '+' : '') + val;
  el.style.left = (x - 12) + 'px'; el.style.top = (y - 12) + 'px';
  el.style.animation = 'floatUp .8s ease forwards';
  document.body.appendChild(el); setTimeout(() => el.remove(), 820);
}

// HUD
const hudHp = document.getElementById('hudHp'), hudHpTxt = document.getElementById('hudHpTxt'), hudLv = document.getElementById('hudLv'), hudExp = document.getElementById('hudExp');
const hudWave = document.getElementById('hudWave'), hudScore = document.getElementById('hudScore'), hudCoins = document.getElementById('hudCoins'), hudCd = document.getElementById('hudCd');
function updateCooldownUI() {
  if (btnSkill) { btnSkill.classList.toggle('cool', skillCD > 0); btnSkill.textContent = skillCD > 0 ? skillCD.toFixed(1) : '旋'; }
  if (btnSkill2) { btnSkill2.classList.toggle('cool', skill2CD > 0); btnSkill2.textContent = skill2CD > 0 ? skill2CD.toFixed(1) : (skillSlot2 === 'heal' ? '癒' : '波'); }
  if (btnDash) { btnDash.classList.toggle('cool', dashCD > 0); btnDash.textContent = dashCD > 0 ? dashCD.toFixed(1) : 'DASH'; }
  hudCd.textContent = `旋斬 ${skillCD > 0 ? skillCD.toFixed(1) : '✓'} ・ ${skillSlot2 === 'heal' ? '治癒' : '衝撃'} ${skill2CD > 0 ? skill2CD.toFixed(1) : '✓'} ・ 回避 ${dashCD > 0 ? dashCD.toFixed(1) : '✓'}`;
}
function updateHUD() {
  hudHp.style.width = Math.max(0, hero.hp / hero.maxHp * 100) + '%';
  hudHpTxt.textContent = `HP ${Math.max(0, Math.ceil(hero.hp))}/${hero.maxHp}`;
  hudLv.textContent = 'Lv ' + hero.level + (skillPoints > 0 ? ' ・SP' + skillPoints : '') + ' ・' + (weapon === 'bow' ? '🏹弓' : '⚔剣');
  hudExp.textContent = `EXP ${hero.exp}/${expToNext(hero.level)}`;
  hudWave.textContent = 'WAVE ' + wave;
  hudScore.textContent = 'SCORE ' + score + ' (BEST W' + best.wave + ')';
  hudCoins.textContent = '◆ ' + coins;
}
function gainExp(n) {
  hero.exp += n;
  while (hero.exp >= expToNext(hero.level)) {
    hero.exp -= expToNext(hero.level); hero.level++; skillPoints++;
    hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.3);
    Audio.sfx('victory'); showArea('Lv ' + hero.level + '！ スキルP +1', 'LEVEL UP (T / 🌳)');
  }
  updateHUD();
}

// アクション状態 / 強化
let dashT = 0, dashCD = 0, jumpH = 0, jumpV = 0, grounded = true;
let attackT = 0, attackCD = 0, attackHit = false, invulnT = 0, hurtFlash = 0, shakeT = 0;
let comboCount = 0, comboTimer = 0, comboHeavy = false, pendingLand = false;
let skillT = 0, skillCD = 0;
let atkBonus = 0, moveMul = 1, atkCdMul = 1, dashCdMul = 1, skillCdMul = 1;
let skillPoints = 0, weapon = 'sword', bowUnlocked = false, bowPower = 0;
let skill2CD = 0, skillSlot2 = 'shock', healUnlocked = false;
let airSlam = false, dashAttack = false;                 // 連段派生
let gravMul = 1, hazardTimer = 0, regenT = 0;            // 各星の機構
let equippedGear = null;                                  // 装備
const gearBonus = { atk: 0, crit: 0, move: 0, lifesteal: 0, skillCd: 1 };
let pendingLevels = 0;
const ATTACK_DUR = 0.32, ATTACK_RANGE = 3.6, JUMP_V = 7.5, GRAVITY = 20, DASH_T = 0.22, DASH_SPEED = 22, DASH_CD = 0.55;
const SKILL_DUR = 0.5, SKILL_CD = 3.5, SKILL_RANGE = 6.0;
const hurtEl = document.getElementById('hurt');

function doAttack() {
  if (gameState !== 'field' || attackCD > 0 || skillT > 0) return;
  if (weapon === 'bow' && bowUnlocked) {        // 弓: 遠距離の矢
    attackT = 0.2; attackCD = 0.34 * atkCdMul; comboHeavy = false;
    spawnArrow(); Audio.sfx('attack'); return;
  }
  if (!grounded && jumpH > 0.3) {               // 空中攻撃 → 着地スラム
    if (airSlam) return; airSlam = true; attackT = 0.3; attackCD = 0.45; jumpV = Math.min(jumpV, -4);
    Audio.sfx('attack'); return;
  }
  if (dashT > 0) {                              // ダッシュ斬り（強・広範囲・前進）
    dashAttack = true; comboHeavy = true; comboCount = 3; comboTimer = 0.7;
    attackT = ATTACK_DUR; attackCD = 0.45 * atkCdMul; attackHit = false; dashT = Math.max(dashT, 0.14);
    Audio.sfx('skill'); shakeT = Math.max(shakeT, 0.12); return;
  }
  comboCount = (comboTimer > 0) ? (comboCount % 3) + 1 : 1;  // 1→2→3 の連舞
  comboTimer = 0.7; comboHeavy = comboCount >= 3;
  attackT = ATTACK_DUR; attackCD = (comboHeavy ? 0.5 : 0.32) * atkCdMul; attackHit = false;
  Audio.sfx(comboHeavy ? 'skill' : 'attack');
}
function switchWeapon() {
  if (!bowUnlocked) { showArea('弓は スキルツリーで習得', 'LOCKED'); return; }
  weapon = weapon === 'sword' ? 'bow' : 'sword'; Audio.sfx('cursor');
  showArea(weapon === 'bow' ? '弓に持ち替えた' : '剣に持ち替えた', weapon.toUpperCase());
}
function ringDamage(r, dmg, color, knock, applyStatus) {
  spawnShock(pDir.clone(), r, color);
  const co = Math.cos(r / PLANET_R);
  for (const e of enemies) {
    if (!e.alive) continue;
    if (pDir.dot(e.dir) < co) continue;
    if (bossBarrier(e)) continue;
    e.hp -= e.affix === 'tough' ? Math.round(dmg * 0.6) : dmg; e.hitFlash = 0.2; registerHit();
    if (applyStatus) addStatus(e, applyStatus, 3);
    if (relicCount('fire')) addStatus(e, 'burn', 3);
    showDmg(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 3 : 1.8), dmg, 'crit');
    spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.2), color, 5);
    if (!e.isBoss) { _axis.crossVectors(e.dir, pDir).normalize(); e.dir.applyAxisAngle(_axis, -knock).normalize(); }
    if (e.hp <= 0) killEnemy(e);
  }
}
function castSpin() {   // 旋回斬り: 中範囲・高火力・灼熱
  skillT = SKILL_DUR; invulnT = Math.max(invulnT, 0.35); Audio.sfx('skill'); shakeT = Math.max(shakeT, 0.25);
  spawnImpact(player.position.clone().addScaledVector(pDir, 1.0), 0xbf8aff, 14);
  ringDamage(SKILL_RANGE, Math.round((22 + hero.level * 3 + atkBonus * 2 + gearBonus.atk * 2) * skillDmgMul()), 0xbf8aff, 0.12, 'burn');
}
function castShock() {  // 衝撃波: 広範囲・低火力・大ノックバック
  Audio.sfx('skill'); shakeT = Math.max(shakeT, 0.25);
  ringDamage(7.5, Math.round((14 + hero.level * 2 + atkBonus + gearBonus.atk) * skillDmgMul()), 0x7fd8ff, 0.3, 'freeze');
}
function castHeal() {   // 治癒: 大回復＋短い無敵
  Audio.sfx('heal'); const h = Math.round(hero.maxHp * 0.35);
  hero.hp = Math.min(hero.maxHp, hero.hp + h); invulnT = Math.max(invulnT, 1.0);
  spawnShock(pDir.clone(), 3, 0x7ef0a0); showDmg(player.position.clone().addScaledVector(_up, 2.6), h, 'heal'); updateHUD();
}
function doSkill(n = 1) {
  if (gameState !== 'field') return;
  if (n === 1) { if (skillCD > 0) return; skillCD = SKILL_CD * skillCdMul * gearBonus.skillCd; castSpin(); }
  else { if (skill2CD > 0) return; skill2CD = (skillSlot2 === 'heal' ? 8 : 4) * skillCdMul * gearBonus.skillCd; (skillSlot2 === 'heal' ? castHeal : castShock)(); }
}
// ---- 状態異常 ----
const STATUS_COL = { burn: 0xff6a20, poison: 0x7ad04a, freeze: 0x7fd8ff };
function addStatus(e, type, dur) { if (!e || !e.alive) return; e[type] = Math.max(e[type] || 0, dur); }
function statusTint(e) { return e.burn > 0 ? STATUS_COL.burn : e.poison > 0 ? STATUS_COL.poison : e.freeze > 0 ? STATUS_COL.freeze : null; }
function tickStatus(e, dt) {
  if (e.burn > 0) { e.burn -= dt; e.hp -= (6 + hero.level) * dt; if (Math.random() < dt * 3) showDmg(e.model.root.position.clone().addScaledVector(e.dir, 1.6), Math.round(6 + hero.level), ''); }
  if (e.poison > 0) { e.poison -= dt; e.hp -= (4 + hero.level * 0.6) * dt; }
  if (e.burn > 0 && e.poison > 0 && syn('fire', 'venom')) e.hp -= (5 + hero.level * 0.5) * dt;  // 劇毒シナジー
  if (e.freeze > 0) e.freeze -= dt;
  if (e.hp <= 0) { killEnemy(e); return false; }
  return true;
}
function doJump() {
  if (gameState === 'field' && grounded) { jumpV = JUMP_V; grounded = false; Audio.sfx('cursor'); }
}
function doDash() {
  if (gameState === 'field' && dashCD <= 0) { dashT = DASH_T; dashCD = DASH_CD * dashCdMul; invulnT = Math.max(invulnT, DASH_T + 0.05); Audio.sfx('skill'); }
}
function hurtPlayer(dmg, fromDir) {
  if (invulnT > 0 || dashT > 0) return;
  hero.hp -= dmg; invulnT = 0.7; hurtFlash = 0.4; shakeT = Math.max(shakeT, 0.25); Audio.sfx('hit');
  showDmg(player.position.clone().addScaledVector(pDir, 2.6), Math.round(dmg));
  hitCombo = 0; comboEl.style.opacity = '0'; addUlt(6);       // 被弾でコンボ途切れ／ゲージは溜まる
  if (relicCount('thorn')) {                                   // 茨の鎧: 周囲反撃
    spawnShock(pDir.clone(), 6, 0xffd27a); const tco = Math.cos(6 / PLANET_R), td = 20 + hero.level * 3;
    for (const o of enemies) if (o.alive && pDir.dot(o.dir) > tco) { o.hp -= td; o.hitFlash = 0.2; spawnImpact(o.model.root.position.clone().addScaledVector(o.dir, 1), 0xffd27a, 4); if (o.hp <= 0) killEnemy(o); }
  }
  if (fromDir) { _axis.crossVectors(pDir, fromDir).normalize(); pDir.applyAxisAngle(_axis, -0.05).normalize(); }
  updateHUD();
  if (hero.hp <= 0) {
    if (reviveTokens > 0) { reviveTokens--; hero.hp = hero.maxHp; invulnT = 2.5; shakeT = 0.4; spawnImpact(surfPos(pDir, 0.6), 0x7ef0a0, 16); showArea('復活の翼！ 残り' + reviveTokens, 'REVIVE'); updateHUD(); }
    else gameOver(false);
  }
}
function respawnPlayer() {
  saveBest();
  hero.hp = hero.maxHp; pDir.set(0, 1, 0); invulnT = 1.4; jumpH = 0; jumpV = 0; grounded = true;
  for (const e of enemies) if (e.alive && pDir.dot(e.dir) > 0.3) e.dir.copy(randDir());
  showArea('やられた… 復活', 'RESPAWN');
}
function killEnemy(e) {
  if (!e.alive) return;
  const em = e.elite ? 2.5 : 1;
  e.alive = false; e.dead = 0.5; gainExp(Math.round(e.def.exp * planetMul * em));
  if (relicCount('chain')) {                                   // 連鎖爆発（過負荷シナジーで強化）
    const over = syn('chain', 'amp'), rr = over ? 7 : 5, cd = Math.round((18 + hero.level * 2) * (over ? 1.8 : 1));
    spawnImpact(e.model.root.position.clone(), over ? 0xff6a3a : 0xffae3a, over ? 18 : 12); spawnShock(e.dir.clone(), rr, over ? 0xff6a3a : 0xffae3a);
    const cco = Math.cos(rr / PLANET_R);
    for (const o of enemies) if (o !== e && o.alive && !(o.isBoss && o.invT > 0) && e.dir.dot(o.dir) > cco) { o.hp -= cd; o.hitFlash = 0.2; if (o.hp <= 0) killEnemy(o); }
  }
  score += Math.round((e.def.score || 10) * planetMul * em);
  spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.0), e.elite ? 0xffd27a : 0xffd27a, e.elite ? 18 : 10);
  // 掉落
  dropPickup('coin', e.dir);
  if (e.elite) for (let i = 0; i < 3; i++) dropPickup('coin', e.dir);
  if (Math.random() < (e.elite ? 0.6 : 0.26)) dropPickup('heart', e.dir);
  if (Math.random() < 0.5) dropPickup('gem', e.dir);
  if (e.elite) dropPickup('gear', e.dir, rollGear(2));        // 精英は確定で装備
  else if (Math.random() < 0.05) dropPickup('gear', e.dir, rollGear(1 + (Math.random() < 0.3 ? 1 : 0)));
  // 分裂（種別 or 精英词缀）
  if ((e.def.behavior === 'split' || e.affix === 'split') && !e.isChild) {
    for (let i = 0; i < 2; i++) {
      _axis.crossVectors(e.dir, randDir()).normalize();
      const cd = e.dir.clone().applyAxisAngle(_axis, 0.08).normalize();
      spawnEnemyDef('slime', cd, 0.5, 0.75, true);
    }
  }
  if (e.isBoss) {
    bossRef = null; bossbarEl.style.display = 'none'; slowMo = 1.0;
    dropPickup('gear', e.dir, rollGear(2 + (Math.random() < 0.4 ? 1 : 0)));   // ボスは確定で良装備
    for (let i = 0; i < 8; i++) dropPickup('coin', randDir().lerp(e.dir, 0.5).normalize());
    hero.hp = hero.maxHp; Audio.sfx('victory');
    showArea(THEMES[e.theme].bossName + ' 撃破！', 'BOSS DEFEATED');
    if (e.theme === 3) { setTimeout(() => gameOver(true), 1600); }   // 異界ボス＝通关
    else setTimeout(() => { if (gameState === 'field') offerRelics(); }, 1300); // ボス報酬: 遺物選択
  } else {
    Audio.sfx('chest');
  }
  updateHUD();
}

// ============================================================ レベルアップの祝福
const UPGRADES = [
  { ic: '⚔️', nm: '剛力', ds: '攻撃力 +6', ap: () => { atkBonus += 6; } },
  { ic: '❤️', nm: '生命', ds: '最大HP +25・全回復', ap: () => { hero.maxHp += 25; hero.hp = hero.maxHp; } },
  { ic: '🏃', nm: '俊足', ds: '移動速度 +12%', ap: () => { moveMul *= 1.12; } },
  { ic: '🌀', nm: '連撃', ds: '攻撃速度 +15%', ap: () => { atkCdMul *= 0.85; } },
  { ic: '✨', nm: '術理', ds: 'スキルCD -20%', ap: () => { skillCdMul *= 0.8; } },
  { ic: '💨', nm: '回避', ds: 'ダッシュCD -25%', ap: () => { dashCdMul *= 0.75; } },
];
const levelupEl = document.getElementById('levelup'), luOptsEl = document.getElementById('luOpts');
let luChoices = [];
function openLevelUp() {
  gameState = 'levelup'; if (typeof resetTouch === 'function') resetTouch();
  const pool = UPGRADES.slice(); luChoices = [];
  for (let i = 0; i < 3 && pool.length; i++) luChoices.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  luOptsEl.innerHTML = '';
  luChoices.forEach((u, i) => {
    const c = document.createElement('div'); c.className = 'luCard';
    c.innerHTML = `<div class="ic">${u.ic}</div><div class="nm">${i + 1}. ${u.nm}</div><div class="ds">${u.ds}</div>`;
    c.addEventListener('click', () => pickUpgrade(i));
    c.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); pickUpgrade(i); }, { passive: false });
    luOptsEl.appendChild(c);
  });
  levelupEl.style.display = 'flex';
}
function pickUpgrade(i) {
  if (gameState !== 'levelup' || !luChoices[i]) return;
  luChoices[i].ap(); Audio.sfx('confirm'); pendingLevels--;
  updateHUD();
  if (pendingLevels > 0) openLevelUp();
  else { levelupEl.style.display = 'none'; luChoices = []; gameState = 'field'; showArea('Lv ' + hero.level + ' になった！', 'LEVEL UP'); }
}

// ============================================================ 商店（行商人）
const SHOP_ITEMS = [
  { ic: '🍶', nm: '全回復', ds: 'HPを全回復', cost: 6, ap: () => { hero.hp = hero.maxHp; } },
  { ic: '⚔️', nm: '攻撃の薬', ds: '攻撃力 +5', cost: 14, ap: () => { atkBonus += 5; } },
  { ic: '❤️', nm: '命の薬', ds: '最大HP +30・全回復', cost: 14, ap: () => { hero.maxHp += 30; hero.hp = hero.maxHp; } },
  { ic: '👟', nm: '俊足の靴', ds: '移動速度 +10%', cost: 20, ap: () => { moveMul *= 1.1; } },
];
const shopEl = document.getElementById('shop'), shopItemsEl = document.getElementById('shopItems'), shopCoinsEl = document.getElementById('shopCoins'), shopCloseEl = document.getElementById('shopClose');
function openShop() {
  gameState = 'shop'; resetTouch(); renderShop(); shopEl.style.display = 'flex';
}
function renderShop() {
  shopCoinsEl.textContent = '◆ ' + coins;
  shopItemsEl.innerHTML = '';
  SHOP_ITEMS.forEach((it, i) => {
    const c = document.createElement('div'); c.className = 'luCard' + (coins < it.cost ? ' dis' : '');
    c.innerHTML = `<div class="ic">${it.ic}</div><div class="nm">${i + 1}. ${it.nm}</div><div class="ds">${it.ds}</div><div class="pr">◆ ${it.cost}</div>`;
    c.addEventListener('click', () => buyItem(i));
    c.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); buyItem(i); }, { passive: false });
    shopItemsEl.appendChild(c);
  });
}
function buyItem(i) {
  if (gameState !== 'shop') return;
  const it = SHOP_ITEMS[i];
  if (coins < it.cost) { Audio.sfx('cancel'); return; }
  coins -= it.cost; it.ap(); Audio.sfx('confirm'); updateHUD(); renderShop();
}
function closeShop() { shopEl.style.display = 'none'; gameState = 'field'; if (pendingAfterShop) { pendingAfterShop = false; startWave(wave + 1); } }
shopCloseEl.addEventListener('click', closeShop);
shopCloseEl.addEventListener('touchstart', e => { e.preventDefault(); closeShop(); }, { passive: false });

// ============================================================ スキルツリー
const TREE_NODES = [
  { ic: '⚔️', nm: '剛力', ds: '攻撃力 +5', max: 6, lv: 0, ap: () => { atkBonus += 5; } },
  { ic: '🛡️', nm: '鉄壁', ds: '最大HP +25', max: 6, lv: 0, ap: () => { hero.maxHp += 25; hero.hp = hero.maxHp; } },
  { ic: '🏹', nm: '弓術', ds: '弓を習得 / 威力UP', max: 4, lv: 0, ap: () => { bowUnlocked = true; bowPower++; } },
  { ic: '🏃', nm: '俊足', ds: '移動速度 +8%', max: 4, lv: 0, ap: () => { moveMul *= 1.08; } },
  { ic: '🌀', nm: '連撃', ds: '攻撃速度 +12%', max: 4, lv: 0, ap: () => { atkCdMul *= 0.88; } },
  { ic: '✨', nm: '術理', ds: 'スキルCD -15%', max: 4, lv: 0, ap: () => { skillCdMul *= 0.85; } },
  { ic: '💨', nm: '回避', ds: 'ダッシュCD -15%', max: 4, lv: 0, ap: () => { dashCdMul *= 0.85; } },
  { ic: '💚', nm: '治癒術', ds: 'スキル2を回復に', max: 1, lv: 0, ap: () => { healUnlocked = true; skillSlot2 = 'heal'; } },
];
const treeEl = document.getElementById('skilltree'), treeNodesEl = document.getElementById('treeNodes'), treeSPEl = document.getElementById('treeSP'), treeCloseEl = document.getElementById('treeClose');
function openTree() { if (gameState !== 'field') return; gameState = 'skilltree'; resetTouch(); renderTree(); treeEl.style.display = 'flex'; }
function renderTree() {
  treeSPEl.textContent = 'SP: ' + skillPoints;
  treeNodesEl.innerHTML = '';
  TREE_NODES.forEach((nd, i) => {
    const maxed = nd.lv >= nd.max, can = skillPoints > 0 && !maxed;
    const c = document.createElement('div'); c.className = 'luCard' + (can ? '' : ' dis');
    c.innerHTML = `<div class="ic">${nd.ic}</div><div class="nm">${i + 1}. ${nd.nm}</div><div class="ds">${nd.ds}</div><div class="pr">Lv ${nd.lv}/${nd.max}</div>`;
    c.addEventListener('click', () => buyNode(i));
    c.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); buyNode(i); }, { passive: false });
    treeNodesEl.appendChild(c);
  });
}
function buyNode(i) {
  if (gameState !== 'skilltree') return;
  const nd = TREE_NODES[i];
  if (skillPoints <= 0 || nd.lv >= nd.max) { Audio.sfx('cancel'); return; }
  skillPoints--; nd.lv++; nd.ap(); Audio.sfx('confirm'); updateHUD(); renderTree();
}
function closeTree() { treeEl.style.display = 'none'; gameState = 'field'; }
treeCloseEl.addEventListener('click', closeTree);
treeCloseEl.addEventListener('touchstart', e => { e.preventDefault(); closeTree(); }, { passive: false });

// ============================================================ 永久養成（メタ）
const META_UPG = [
  { k: 'atk', ic: '⚔️', nm: '初期攻撃', ds: '+3 / Lv', max: 6 },
  { k: 'hp', ic: '❤️', nm: '初期HP', ds: '+20 / Lv', max: 6 },
  { k: 'move', ic: '🏃', nm: '移動速度', ds: '+5% / Lv', max: 4 },
  { k: 'bow', ic: '🏹', nm: '弓を解放', ds: '最初から弓', max: 1 },
  { k: 'coin', ic: '💰', nm: '金運', ds: 'コイン +1 / Lv', max: 5 },
  { k: 'revive', ic: '🪽', nm: '復活の翼', ds: '復活 +1回 / Lv', max: 3 },
];
let meta = { gems: 0, atk: 0, hp: 0, move: 0, bow: 0, coin: 0, revive: 0 };
try { const s = JSON.parse(localStorage.getItem('hd2d_meta')); if (s) meta = Object.assign(meta, s); } catch (e) { }
function saveMeta() { try { localStorage.setItem('hd2d_meta', JSON.stringify(meta)); } catch (e) { } }
function metaCost(nd) { return (meta[nd.k] + 1) * 8; }
let reviveTokens = 0, coinBonus = 0;
function applyMeta() {
  hero.maxHp = 100 + meta.hp * 20; hero.hp = hero.maxHp;
  atkBonus = meta.atk * 3; moveMul = 1 + meta.move * 0.05;
  bowUnlocked = meta.bow > 0; weapon = 'sword';
  coinBonus = meta.coin; reviveTokens = meta.revive;
}
const metaEl = document.getElementById('metashop'), metaItemsEl = document.getElementById('metaItems'), metaGemsEl = document.getElementById('metaGems'), metaCloseEl = document.getElementById('metaClose');
let metaReturn = 'title';
function openMeta(from) { metaReturn = from || 'title'; gameState = 'meta'; resetTouch(); renderMeta(); metaEl.style.display = 'flex'; }
function renderMeta() {
  metaGemsEl.textContent = '💎 ' + meta.gems;
  metaItemsEl.innerHTML = '';
  META_UPG.forEach((nd, i) => {
    const maxed = meta[nd.k] >= nd.max, cost = metaCost(nd), can = !maxed && meta.gems >= cost;
    const c = document.createElement('div'); c.className = 'luCard' + (can ? '' : ' dis');
    c.innerHTML = `<div class="ic">${nd.ic}</div><div class="nm">${nd.nm}</div><div class="ds">${nd.ds}</div><div class="pr">Lv ${meta[nd.k]}/${nd.max}${maxed ? '' : ' ・💎' + cost}</div>`;
    c.addEventListener('click', () => buyMeta(i));
    c.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); buyMeta(i); }, { passive: false });
    metaItemsEl.appendChild(c);
  });
}
function buyMeta(i) {
  if (gameState !== 'meta') return;
  const nd = META_UPG[i], cost = metaCost(nd);
  if (meta[nd.k] >= nd.max || meta.gems < cost) { Audio.sfx('cancel'); return; }
  meta.gems -= cost; meta[nd.k]++; saveMeta(); Audio.sfx('confirm'); renderMeta();
}
function closeMeta() { metaEl.style.display = 'none'; if (metaReturn === 'gameover') { gameState = 'gameover'; goEl.style.display = 'flex'; } else if (metaReturn === 'pause') { gameState = 'field'; } else { showTitle(); } }
metaCloseEl.addEventListener('click', closeMeta);
metaCloseEl.addEventListener('touchstart', e => { e.preventDefault(); closeMeta(); }, { passive: false });

// ============================================================ 職業 / 遺物 / コンボ
meta.cls = meta.cls || {}; meta.lastClass = meta.lastClass || 'warrior';
const CLASSES = {
  warrior: { nm: '戦士', ic: '⚔️', ds: '高HP・剣・近接', hp: 1.2, atk: 4, weapon: 'sword', bow: false, crit: 0, cdMul: 1, slot2: 'shock', move: 1, cost: 0 },
  archer:  { nm: '弓手', ic: '🏹', ds: '弓・高暴撃・低HP', hp: 0.85, atk: 2, weapon: 'bow', bow: true, crit: 0.13, cdMul: 1, slot2: 'shock', move: 1.08, cost: 80 },
  mage:    { nm: '法師', ic: '🔮', ds: 'スキル特化・治癒', hp: 0.8, atk: 1, weapon: 'sword', bow: false, crit: 0, cdMul: 0.6, slot2: 'heal', move: 1, cost: 160 },
};
let currentClass = meta.lastClass in CLASSES ? meta.lastClass : 'warrior';
let classCrit = 0;
function classUnlocked(k) { return CLASSES[k].cost === 0 || meta.cls[k]; }
function applyClass() {
  const c = CLASSES[currentClass];
  hero.maxHp = Math.round((100 + meta.hp * 20) * c.hp); hero.hp = hero.maxHp;
  atkBonus = meta.atk * 3 + c.atk;
  weapon = c.weapon; bowUnlocked = c.bow || meta.bow > 0;
  classCrit = c.crit; skillCdMul = c.cdMul; skillSlot2 = c.slot2;
}

// ---- 遺物（局内・永続パッシブ、重ね掛け可） ----
const RELIC_DEFS = [
  { k: 'fire',  ic: '🔥', nm: '火の刻印', ds: '近接に灼熱付与' },
  { k: 'venom', ic: '🐍', nm: '毒牙', ds: '近接に毒付与' },
  { k: 'frost', ic: '❄️', nm: '氷塊', ds: '攻撃35%で凍結' },
  { k: 'vamp',  ic: '🩸', nm: '吸血の護符', ds: '与ダメ10%回復' },
  { k: 'crit',  ic: '🎯', nm: '狙撃眼', ds: '暴撃率+15%' },
  { k: 'chain', ic: '⚡', nm: '連鎖爆発', ds: '击杀で周囲に爆発' },
  { k: 'swift', ic: '💨', nm: '疾風の靴', ds: '移動速度+12%' },
  { k: 'gold',  ic: '💰', nm: '黄金の手', ds: 'コイン+1' },
  { k: 'amp',   ic: '🔮', nm: '魔力増幅', ds: 'スキル威力+35%' },
  { k: 'thorn', ic: '🛡️', nm: '茨の鎧', ds: '被弾時に周囲反撃' },
];
const RELIC_MAP = {}; for (const r of RELIC_DEFS) RELIC_MAP[r.k] = r;
let relics = [];
function relicCount(k) { let n = 0; for (const r of relics) if (r === k) n++; return n; }
function skillDmgMul() { return 1 + relicCount('amp') * 0.35; }
function critTotal() { return 0.2 + gearBonus.crit + classCrit + relicCount('crit') * 0.15; }
function lifestealTotal() { return gearBonus.lifesteal + relicCount('vamp') * 0.10; }
function recomputeStats() {
  const c = CLASSES[currentClass];
  moveMul = (1 + meta.move * 0.05) * c.move * Math.pow(1.12, relicCount('swift'));
  coinBonus = meta.coin + relicCount('gold');
}
const relicBarEl = document.getElementById('relicBar'), synBarEl = document.getElementById('synBar');
// 遺物シナジー（2種同時所持で発動）
const SYNERGIES = [
  { a: 'fire', b: 'frost', nm: '❄🔥 相転移', ds: '燃焼かつ凍結の敵に追撃' },
  { a: 'fire', b: 'venom', nm: '☠️ 劇毒', ds: '燃焼＋毒の継続増' },
  { a: 'chain', b: 'amp', nm: '⚡ 過負荷', ds: '連鎖爆発が増幅' },
  { a: 'crit', b: 'vamp', nm: '🩸 処刑', ds: '暴撃時の吸血倍化' },
];
function syn(a, b) { return relicCount(a) > 0 && relicCount(b) > 0; }
function activeSyns() { return SYNERGIES.filter(s => syn(s.a, s.b)); }
function renderRelicBar() {
  const seen = {}; relicBarEl.innerHTML = '';
  for (const k of relics) { seen[k] = (seen[k] || 0) + 1; }
  for (const k in seen) { const s = document.createElement('span'); s.textContent = RELIC_MAP[k].ic + (seen[k] > 1 ? seen[k] : ''); s.title = RELIC_MAP[k].nm; relicBarEl.appendChild(s); }
  synBarEl.innerHTML = '';
  for (const s of activeSyns()) { const el = document.createElement('span'); el.textContent = s.nm; el.title = s.ds; synBarEl.appendChild(el); }
}
function addRelic(k) {
  const before = activeSyns(); relics.push(k); recomputeStats(); renderRelicBar();
  Audio.sfx('chest'); showArea(RELIC_MAP[k].nm + ' を獲得', RELIC_MAP[k].ds);
  const fresh = activeSyns().filter(s => !before.includes(s));
  if (fresh.length) setTimeout(() => showArea('シナジー: ' + fresh[0].nm, fresh[0].ds), 1000);
}

// ---- 必殺ゲージ（オーバードライブ） ----
let ult = 0;
const ultBarEl = document.getElementById('ultBar'), ultFillEl = ultBarEl.querySelector('i'), btnUltEl = document.getElementById('btnUlt');
function addUlt(n) { if (ult >= 100) return; ult = Math.min(100, ult + n); updateUltUI(); }
function updateUltUI() {
  ultFillEl.style.width = ult + '%'; ultBarEl.classList.toggle('full', ult >= 100);
  if (btnUltEl) { btnUltEl.classList.toggle('ready', ult >= 100); btnUltEl.classList.toggle('cool', ult < 100); }
}
function doUlt() {
  if (gameState !== 'field' || ult < 100) return;
  ult = 0; updateUltUI();
  slowMo = Math.max(slowMo, 1.2); invulnT = Math.max(invulnT, 1.4); shakeT = Math.max(shakeT, 0.6); critFlash();
  Audio.sfx('victory'); spawnShock(pDir.clone(), 30, 0xffd23a);
  const dmg = Math.round((60 + hero.level * 8 + atkBonus * 3) * (1 + Math.min(hitCombo, 50) * 0.02) * skillDmgMul());
  for (const e of enemies) {
    if (!e.alive) continue; if (e.isBoss && e.invT > 0) continue;
    e.hp -= dmg; e.hitFlash = 0.25; registerHit(); addStatus(e, 'burn', 4);
    showDmg(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 3.2 : 1.8), dmg, 'crit');
    spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.2), 0xffd23a, 8);
    if (e.hp <= 0) killEnemy(e);
  }
  hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.15); updateHUD();
  showArea('OVERDRIVE!!', '必殺解放');
}
updateUltUI();

// ---- コンボ表示 ----
const comboEl = document.getElementById('combo'), comboNumEl = comboEl.querySelector('.cn'), comboRankEl = comboEl.querySelector('.cr');
let hitCombo = 0, hitComboT = 0;
function comboRank(n) { return n >= 50 ? '神業!!' : n >= 30 ? 'COOL!' : n >= 15 ? 'GREAT!' : n >= 6 ? 'GOOD!' : ''; }
function registerHit() {
  hitCombo++; hitComboT = 2.2; addUlt(2);
  if (hitCombo >= 6) { score += 1; }
  comboNumEl.innerHTML = hitCombo + '<small> HIT</small>';
  comboRankEl.textContent = comboRank(hitCombo);
  comboEl.style.opacity = '1';
  const sc = 1 + Math.min(hitCombo, 40) * 0.01;
  comboNumEl.style.transform = `scale(${sc})`;
}
function comboTick(dt) {
  if (hitComboT > 0) { hitComboT -= dt; if (hitComboT <= 0) { hitCombo = 0; comboEl.style.opacity = '0'; } }
}
// 暴撃/重撃のヒットフラッシュ（既存hurtFlashを白で使い回し）
function critFlash() { hurtFlash = Math.max(hurtFlash, 0.12); }

// ---- 汎用3択チューザー（遺物・分岐ノードで共用） ----
const chooserEl = document.getElementById('chooser'), chooserTitleEl = document.getElementById('chooserTitle'), chooserOptsEl = document.getElementById('chooserOpts');
let chooserCb = null;
function showChooser(title, items) {
  chooserTitleEl.textContent = title; chooserOptsEl.innerHTML = '';
  gameState = 'chooser'; resetTouch();
  items.forEach(it => {
    const c = document.createElement('div'); c.className = 'luCard';
    c.innerHTML = `<div class="ic">${it.ic}</div><div class="nm">${it.nm}</div><div class="ds">${it.ds}</div>`;
    const pick = () => { if (gameState !== 'chooser') return; chooserEl.style.display = 'none'; Audio.sfx('confirm'); it.pick(); };
    c.addEventListener('click', pick);
    c.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); pick(); }, { passive: false });
    chooserOptsEl.appendChild(c);
  });
  chooserEl.style.display = 'flex';
}
function offerRelics(after) {
  after = after || (() => { gameState = 'field'; });
  const pool = RELIC_DEFS.slice(); const items = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const d = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    items.push({ ic: d.ic, nm: d.nm, ds: d.ds, pick: () => { addRelic(d.k); after(); } });
  }
  showChooser('遺物を選べ', items);
}
// ---- タイトルの職業選択 ----
const classRowEl = document.getElementById('classRow');
function renderClassRow() {
  classRowEl.innerHTML = '';
  for (const k in CLASSES) {
    const c = CLASSES[k], unlocked = classUnlocked(k), sel = currentClass === k;
    const el = document.createElement('div'); el.className = 'cls' + (sel ? ' sel' : '') + (unlocked ? '' : ' lock');
    el.innerHTML = `<div class="cic">${c.ic}</div><div class="cnm">${c.nm}</div><div class="cds">${c.ds}</div>` + (unlocked ? '' : `<div class="ccost">💎${c.cost}</div>`);
    const act = () => {
      if (classUnlocked(k)) { currentClass = k; Audio.sfx('cursor'); }
      else if (meta.gems >= c.cost) { meta.gems -= c.cost; meta.cls[k] = 1; currentClass = k; saveMeta(); Audio.sfx('confirm'); }
      else { Audio.sfx('cancel'); }
      renderClassRow(); showTitle();
    };
    el.addEventListener('click', act);
    el.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); act(); }, { passive: false });
    classRowEl.appendChild(el);
  }
}

// ---- 分岐ノード（ウェーブ間の選択） ----
let forceElite = 0, pendingAfterShop = false;
function advanceWave() { chooserEl.style.display = 'none'; gameState = 'field'; startWave(wave + 1); }
function openNodePick() {
  const extras = ['elite', 'rest', 'shop', 'treasure'];
  for (let i = extras.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [extras[i], extras[j]] = [extras[j], extras[i]]; }
  const NODES = {
    battle:   { ic: '⚔️', nm: '通常戦', ds: '次のウェーブへ', pick: () => advanceWave() },
    elite:    { ic: '👑', nm: '精英戦', ds: '強敵＋良報酬', pick: () => { forceElite = 2; advanceWave(); } },
    rest:     { ic: '🏕️', nm: '休息地', ds: 'HP40%回復', pick: () => { hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.4); updateHUD(); advanceWave(); } },
    shop:     { ic: '🛒', nm: '行商人', ds: '買い物して進む', pick: () => { pendingAfterShop = true; chooserEl.style.display = 'none'; openShop(); } },
    treasure: { ic: '🎁', nm: '宝箱', ds: '遺物を獲得', pick: () => { offerRelics(() => advanceWave()); } },
  };
  const items = [NODES.battle, NODES[extras[0]], NODES[extras[1]]];
  showChooser('星図：次の地を選べ', items);
}

// ============================================================ ゲームオーバー / 結果 / 排行榜
const goEl = document.getElementById('gameover'), goResEl = document.getElementById('goRes'), goBoardEl = document.getElementById('goBoard'), goTitleEl = document.getElementById('goTitle'), goRestartEl = document.getElementById('goRestart'), goMetaEl = document.getElementById('goMeta'), goMetaBtn = document.getElementById('goMetaBtn'), goTitleBtn = document.getElementById('goTitleBtn');
let board = [];
try { const s = JSON.parse(localStorage.getItem('hd2d_board')); if (Array.isArray(s)) board = s; } catch (e) { }
function pushBoard(sc, wv) {
  board.push({ s: sc, w: wv, t: Date.now() });
  board.sort((a, b) => b.s - a.s); board = board.slice(0, 5);
  try { localStorage.setItem('hd2d_board', JSON.stringify(board)); } catch (e) { }
}
function gameOver(cleared) {
  saveBest(); pushBoard(score, wave);
  const earned = Math.floor(coins * 0.5 + wave * 3 + (cleared ? 80 : 0));
  meta.gems += earned; saveMeta();
  gameState = 'gameover'; resetTouch();
  goTitleEl.textContent = cleared ? '★ STAGE CLEAR ★' : 'GAME OVER';
  goTitleEl.style.color = cleared ? '#7ef0a0' : '#ff7e6a';
  goResEl.innerHTML = `星: ${THEMES[themeIndex].en}<br>WAVE ${wave} ・ Lv ${hero.level}<br>SCORE <b style="color:#ffd27a">${score}</b> ・ ◆${coins}`;
  goBoardEl.innerHTML = '— RANKING —<br>' + board.map((b, i) => `${i + 1}. <b>${b.s}</b> (W${b.w})`).join('<br>');
  goMetaEl.innerHTML = `💎 +${earned} 獲得！（所持 ${meta.gems}）`;
  goEl.style.display = 'flex';
}
function clearRun() {
  for (const e of enemies) scene.remove(e.model.root); enemies.length = 0; bossRef = null; bossbarEl.style.display = 'none';
  for (const p of pickups) scene.remove(p.obj); pickups.length = 0;
  for (const pr of projectiles) scene.remove(pr.mesh); projectiles.length = 0;
  for (const ar of arrows) scene.remove(ar.mesh); arrows.length = 0;
  for (const a of aoes) scene.remove(a.grp); aoes.length = 0;
}
function beginRun() {
  goEl.style.display = 'none'; titleEl.style.display = 'none';
  clearRun();
  hero.exp = 0; hero.level = 1;
  atkCdMul = 1; dashCdMul = 1; skillCdMul = 1; skillPoints = 0;
  bowPower = 0; for (const nd of TREE_NODES) nd.lv = 0;
  equippedGear = null; recomputeGear(); airSlam = false; dashAttack = false; gravMul = 1;
  skillSlot2 = 'shock'; healUnlocked = false;
  score = 0; coins = 0; planetMul = 1; themeIndex = 0; applyTheme(0);
  relics = []; forceElite = 0; pendingAfterShop = false; hitCombo = 0; hitComboT = 0; comboEl.style.opacity = '0';
  ult = 0; updateUltUI();
  applyMeta();                          // メタ強化を反映（HP/攻撃/移動/弓/復活/金運）
  applyClass();                         // 職業を反映（HP/攻撃/弓/暴撃/CD/スキル2）
  recomputeStats(); renderRelicBar();   // 遺物（最初は空）込みで再計算
  meta.lastClass = currentClass; saveMeta();
  pDir.set(0, 1, 0); jumpH = 0; jumpV = 0; grounded = true; invulnT = 1.5;
  wave = 0; gameState = 'field'; startWave(1); updateHUD();
}
function restartRun() { beginRun(); showArea('リスタート', 'RESTART'); }
function startGame() { beginRun(); showArea('はじまり', THEMES[0].en); }
function backToTitle() { goEl.style.display = 'none'; gameState = 'title'; clearRun(); resetTouch(); titleEl.style.display = 'flex'; }
goRestartEl.addEventListener('click', restartRun);
goRestartEl.addEventListener('touchstart', e => { e.preventDefault(); restartRun(); }, { passive: false });
goMetaBtn.addEventListener('click', () => { goEl.style.display = 'none'; openMeta('gameover'); });
goMetaBtn.addEventListener('touchstart', e => { e.preventDefault(); goEl.style.display = 'none'; openMeta('gameover'); }, { passive: false });
goTitleBtn.addEventListener('click', backToTitle);
goTitleBtn.addEventListener('touchstart', e => { e.preventDefault(); backToTitle(); }, { passive: false });

// ============================================================ タイトル / ポーズ
const titleEl = document.getElementById('title'), titleInfoEl = document.getElementById('titleInfo');
const pauseEl = document.getElementById('pause');
function showTitle() {
  gameState = 'title'; titleEl.style.display = 'flex'; renderClassRow();
  titleInfoEl.textContent = `職業: ${CLASSES[currentClass].nm}（カードで変更）\n自己ベスト WAVE ${best.wave} / SCORE ${best.score} ・ 💎 ${meta.gems}`;
}
document.getElementById('tStart').addEventListener('click', () => { kickAudio(); startGame(); });
document.getElementById('tStart').addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); startGame(); }, { passive: false });
document.getElementById('tMeta').addEventListener('click', () => { titleEl.style.display = 'none'; openMeta('title'); });
document.getElementById('tMeta').addEventListener('touchstart', e => { e.preventDefault(); titleEl.style.display = 'none'; openMeta('title'); }, { passive: false });
document.getElementById('tHelp').addEventListener('click', () => { titleInfoEl.textContent = '移動WASD/スティック ・ 攻撃J/タップ ・ ジャンプSpace\nダッシュK ・ スキルL/U ・ 弓R ・ 技能T ・ 会話F\nワープゲートで次の星へ。死んでも💎は貯まる。'; });
function togglePause() {
  if (gameState === 'field') { gameState = 'paused'; resetTouch(); pauseEl.style.display = 'flex'; }
  else if (gameState === 'paused') { gameState = 'field'; pauseEl.style.display = 'none'; }
}
document.getElementById('pauseResume').addEventListener('click', togglePause);
document.getElementById('pauseResume').addEventListener('touchstart', e => { e.preventDefault(); togglePause(); }, { passive: false });
document.getElementById('pauseMeta').addEventListener('click', () => { pauseEl.style.display = 'none'; gameState = 'paused'; openMeta('pause'); });
document.getElementById('pauseTitle').addEventListener('click', () => { pauseEl.style.display = 'none'; clearRun(); showTitle(); });
const volSlider = document.getElementById('volSlider');
volSlider.value = (() => { try { return localStorage.getItem('hd2d_vol') || '1'; } catch (e) { return '1'; } })();
Audio.setVolume(+volSlider.value);
volSlider.addEventListener('input', e => { Audio.setVolume(+e.target.value); try { localStorage.setItem('hd2d_vol', e.target.value); } catch (er) { } });

// ============================================================ ボスの範囲攻撃（地面の赤円→爆発）
const aoes = [];
const aoeRingGeo = new THREE.RingGeometry(0.82, 1.0, 36);
const aoeFillGeo = new THREE.CircleGeometry(1.0, 36);
function spawnAoe(dir, r, dmg, color = 0xff3a3a) {
  const grp = new THREE.Group();
  const ring = new THREE.Mesh(aoeRingGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  const fill = new THREE.Mesh(aoeFillGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  grp.add(ring, fill); grp.scale.setScalar(r);
  grp.position.copy(surfPos(dir, 0.15));
  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  scene.add(grp);
  aoes.push({ grp, ring, fill, dir: dir.clone().normalize(), r, t: 1.1, max: 1.1, dmg });
}
// プレイヤー中心の即時AoEダメージ（スラム/ダッシュ斬りなど）
function aoeDamage(r, dmg, color = 0xfff2c0) {
  spawnImpact(surfPos(pDir, 0.4), color, 16); shakeT = Math.max(shakeT, 0.28);
  spawnShock(pDir.clone(), r, color);
  const co = Math.cos(r / PLANET_R);
  for (const e of enemies) {
    if (!e.alive) continue;
    if (pDir.dot(e.dir) < co) continue;
    e.hp -= e.affix === 'tough' ? Math.round(dmg * 0.6) : dmg; e.hitFlash = 0.18;
    showDmg(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 3 : 1.8), dmg, 'crit');
    _axis.crossVectors(e.dir, pDir).normalize(); e.dir.applyAxisAngle(_axis, -0.1).normalize();
    if (e.hp <= 0) killEnemy(e);
  }
}
// 各星の専属機構（環境ハザード/重力/回復）
function planetHazard(dt, t) {
  const th = THEMES[themeIndex];
  if (th.hazard === 'lava') {
    hazardTimer -= dt;
    if (hazardTimer <= 0) { hazardTimer = 2.6; for (let i = 0; i < 2; i++) { const d = pDir.clone().applyAxisAngle(randDir(), 0.1 + Math.random() * 0.3).normalize(); spawnAoe(d, 4.2, Math.round(10 * planetMul), 0xff5a20); } }
  } else if (th.hazard === 'ice') {
    hazardTimer -= dt;
    if (hazardTimer <= 0) { hazardTimer = 3.2; const d = pDir.clone().applyAxisAngle(randDir(), 0.15 + Math.random() * 0.3).normalize(); spawnAoe(d, 4.0, Math.round(9 * planetMul), 0x9fe0ff); }
  } else if (th.hazard === 'heal') {        // 草原: ゆっくり回復
    regenT -= dt; if (regenT <= 0 && hurtFlash <= 0) { regenT = 1; hero.hp = Math.min(hero.maxHp, hero.hp + 1); updateHUD(); }
  }
}
function updateAoes(dt) {
  for (let i = aoes.length - 1; i >= 0; i--) {
    const a = aoes[i]; a.t -= dt;
    const pulse = 0.4 + 0.5 * Math.abs(Math.sin(a.t * 14));
    a.ring.material.opacity = pulse; a.fill.material.opacity = 0.12 + (1 - a.t / a.max) * 0.25;
    if (a.t <= 0) {
      spawnImpact(surfPos(a.dir, 0.6), 0xff5a3a, 16); shakeT = Math.max(shakeT, 0.32);
      const ang = Math.acos(THREE.MathUtils.clamp(pDir.dot(a.dir), -1, 1)) * PLANET_R;
      if (ang < a.r) hurtPlayer(a.dmg, a.dir);
      scene.remove(a.grp); a.ring.material.dispose(); a.fill.material.dispose(); aoes.splice(i, 1);
    }
  }
}
// 惑星ごとのボス必殺技（フェーズで強化）
function bossCast(e) {
  const ph = e.phase || 1, dmg = Math.round(e.atk * (1 + 0.15 * (ph - 1)));
  if (e.theme === 1) {            // 雪: 氷弾（P2で5方向）
    Audio.sfx('skill');
    const offs = ph >= 2 ? [-0.6, -0.3, 0, 0.3, 0.6] : [-0.4, 0, 0.4];
    for (const off of offs) spawnProjectile(e.dir.clone(), pDir.clone().applyAxisAngle(e.dir, off).normalize(), dmg);
  } else if (e.theme === 2) {     // 溶岩: 地割れAOE（P2で追加）
    spawnAoe(pDir.clone(), 5.4, Math.round(dmg * 1.2));
    spawnAoe(freeDir(false), 4.4, dmg);
    if (ph >= 2) spawnAoe(freeDir(false), 4.4, dmg);
  } else if (e.theme === 3) {     // 異界: 放射弾幕（P2で密度↑）
    Audio.sfx('skill');
    const cnt = ph >= 2 ? 12 : 8;
    for (let i = 0; i < cnt; i++) spawnProjectile(e.dir.clone(), pDir.clone().applyAxisAngle(e.dir, i / cnt * Math.PI * 2).normalize(), dmg);
  } else {                        // 草原: 単発AOE（P2で追加）
    spawnAoe(pDir.clone(), 5.0, Math.round(dmg * 1.1));
    if (ph >= 2) spawnAoe(freeDir(false), 4.0, dmg);
  }
  if (ph >= 3) {                  // フェーズ3共通: 全方位の追撃弾幕
    for (let i = 0; i < 10; i++) spawnProjectile(e.dir.clone(), pDir.clone().applyAxisAngle(e.dir, i / 10 * Math.PI * 2 + 0.3).normalize(), Math.round(dmg * 0.8));
  }
}
// ボスの雑魚召喚
function summonAdds(e, n) {
  const pool = THEMES[e.theme].pool;
  for (let i = 0; i < n; i++) {
    _axis.crossVectors(e.dir, randDir()).normalize();
    const d = e.dir.clone().applyAxisAngle(_axis, 0.18 + Math.random() * 0.12).normalize();
    spawnEnemyDef(pool[Math.floor(Math.random() * pool.length)], d, 0.6, 0.8, true);
  }
  spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1), 0x9a6aff, 12);
}
// ボスのフェーズ移行（怒り・無敵バリア・召喚・バースト）
function enterBossPhase(e, p) {
  e.phase = p; e.enrageMul = p >= 3 ? 1.7 : 1.3; e.invT = 1.0; e.castCD = 0.5;
  shakeT = Math.max(shakeT, 0.6); slowMo = Math.max(slowMo, 0.5); hurtFlash = Math.max(hurtFlash, 0.15);
  spawnShock(e.dir.clone(), 7, 0xff5a3a); spawnImpact(e.model.root.position.clone(), 0xff5a3a, 24); Audio.sfx('encounter');
  showArea('PHASE ' + p + ' — 怒り', THEMES[e.theme].bossName);
  summonAdds(e, p >= 3 ? 3 : 2); bossCast(e);
}
// フェーズ移行中の無敵バリア（ダメージ無効＋演出）
function bossBarrier(e) {
  if (e.isBoss && e.invT > 0) { e.hitFlash = 0.1; spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.6), 0xff5a3a, 4); showDmg(e.model.root.position.clone().addScaledVector(e.dir, 3.2), 'GUARD'); return true; }
  return false;
}

// ============================================================ セーブ（最高記録）
let best = { wave: 1, score: 0 };
try { const s = JSON.parse(localStorage.getItem('hd2d_best')); if (s) best = s; } catch (e) { }
function saveBest() {
  let ch = false;
  if (wave > best.wave) { best.wave = wave; ch = true; }
  if (score > best.score) { best.score = score; ch = true; }
  if (ch) try { localStorage.setItem('hd2d_best', JSON.stringify(best)); } catch (e) { }
}

// ============================================================ 交互作用（最寄りのNPC/宝箱）
let nearTarget = null;
function findInteract() {
  let best = null, bestDot = Math.cos(0.18); // 角度しきい値
  for (const n of npcs) { const dt = pDir.dot(n.dir); if (dt > bestDot) { bestDot = dt; best = { type: 'npc', ref: n }; } }
  for (const c of chests) { if (c.opened) continue; const dt = pDir.dot(c.dir); if (dt > bestDot) { bestDot = dt; best = { type: 'chest', ref: c }; } }
  { const dt = pDir.dot(WARP_DIR); if (dt > bestDot) { bestDot = dt; best = { type: 'warp' }; } }
  return best;
}
function interactTarget() {
  if (nearTarget.type === 'npc') { Audio.sfx('confirm'); if (nearTarget.ref.shop) openShop(); else startDialogue(nearTarget.ref.name, nearTarget.ref.lines); }
  else if (nearTarget.type === 'warp') { warpTo(); }
  else if (nearTarget.type === 'chest') {
    const c = nearTarget.ref; c.opened = true; c.lidPivot.rotation.x = -1.2;
    Audio.sfx('chest');
    const got = c.reward.potions || 0; hero.potions += got;
    startDialogue('たからばこ', [`やくそうを ${got}個 みつけた！`]);
  }
}
// F/Enter: 会話送り or 近くの対象と交互作用
function interact() {
  if (gameState === 'dialogue') { Audio.sfx('cursor'); advanceDialogue(); return; }
  if (gameState === 'field' && nearTarget) interactTarget();
}
// Aボタン: 会話中=送り / 対象が近い=交互作用 / それ以外=攻撃
function actionA() {
  if (gameState === 'dialogue') { Audio.sfx('cursor'); advanceDialogue(); return; }
  if (gameState !== 'field') return;
  if (nearTarget) interactTarget(); else doAttack();
}

// ============================================================ 入力
const keys = {};
function kickAudio() { Audio.ensureAudio(); }
addEventListener('keydown', kickAudio, { once: true });
addEventListener('pointerdown', kickAudio, { once: true });
addEventListener('touchstart', kickAudio, { once: true });

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (gameState === 'levelup') { if (k === '1' || k === '2' || k === '3') pickUpgrade(+k - 1); return; }
  if (gameState === 'shop') { if (k >= '1' && k <= '4') buyItem(+k - 1); else if (k === 'escape' || k === 'f' || k === 'enter') closeShop(); return; }
  if (gameState === 'skilltree') { if (k >= '1' && k <= '8') buyNode(+k - 1); else if (k === 'escape' || k === 't' || k === 'f') closeTree(); return; }
  if (gameState === 'meta') { if (k === 'escape' || k === 'f') closeMeta(); return; }
  if (gameState === 'chooser') { if (k >= '1' && k <= '3') { const cs = chooserOptsEl.children; if (cs[+k - 1]) cs[+k - 1].click(); } return; }
  if (gameState === 'gameover') { if (k === 'enter' || k === ' ' || k === 'r') restartRun(); return; }
  if (gameState === 'title') { if (k === 'enter' || k === ' ') startGame(); return; }
  if (gameState === 'paused') { if (k === 'escape' || k === 'p' || k === 'enter') togglePause(); return; }
  if (k === 'escape' || k === 'p') { togglePause(); return; }
  if (k === 'j') { doAttack(); }
  else if (k === ' ') { doJump(); e.preventDefault(); }
  else if (k === 'k') { doDash(); }
  else if (k === 'l') { doSkill(1); }
  else if (k === 'u') { doSkill(2); }
  else if (k === 'q') { doUlt(); }
  else if (k === 'r') { switchWeapon(); }
  else if (k === 't') { openTree(); }
  else if (k === 'f' || k === 'enter') { interact(); e.preventDefault(); }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('wheel', e => { camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 3, 12, 95); }, { passive: true });

// アクションボタン
const btnA = document.getElementById('btnA');
const btnJump = document.getElementById('btnJump');
const btnDash = document.getElementById('btnDash');
const btnSkill = document.getElementById('btnSkill');
const btnSkill2 = document.getElementById('btnSkill2');
const btnWep = document.getElementById('btnWep');
const btnTree = document.getElementById('btnTree');
const btnPause = document.getElementById('btnPause');
function bindBtn(btn, fn) {
  btn.addEventListener('click', e => { e.preventDefault(); fn(); });
  btn.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); fn(); }, { passive: false });
}
bindBtn(btnA, actionA); bindBtn(btnJump, doJump); bindBtn(btnDash, doDash);
bindBtn(btnWep, switchWeapon); bindBtn(btnTree, openTree);
bindBtn(btnSkill, () => doSkill(1)); bindBtn(btnSkill2, () => doSkill(2)); bindBtn(btnPause, togglePause);
bindBtn(document.getElementById('btnUlt'), doUlt);

// デスクトップ: クリックで 会話送り or 攻撃
addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse') return;
  if (e.target.closest('#panel, #ui, #hud, #btnA, #btnJump, #btnDash')) return;
  if (gameState === 'dialogue') advanceDialogue();
  else if (gameState === 'field') doAttack();
});

// ============================================================ タッチ操作（スマホ）
// 1本指 左半分=フローティング仮想スティック / 右半分=視点ドラッグ / 2本指=ピンチでズーム（位置不問）
const joyVec = { x: 0, y: 0, mag: 0 };       // x:右, y:前(上倒し), mag:0..1
const isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
if (isTouch) document.body.classList.add('touch');

const joyBase = document.getElementById('joyBase');
const joyKnob = document.getElementById('joyKnob');
const JOY_R = 56;
const touchMap = new Map();                  // id -> {x,y}
let joyId = null, camId = null, joyOx = 0, joyOy = 0, camLastX = 0, pinchDist = null;

function showJoy(x, y) {
  joyOx = x; joyOy = y;
  joyBase.style.left = x + 'px'; joyBase.style.top = y + 'px';
  joyBase.style.display = 'block';
  joyKnob.style.transform = 'translate(-50%, -50%)';
}
function moveJoy(x, y) {
  let dx = x - joyOx, dy = y - joyOy;
  const len = Math.hypot(dx, dy);
  if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
  joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  joyVec.x = dx / JOY_R; joyVec.y = -dy / JOY_R; joyVec.mag = Math.min(1, len / JOY_R);
}
function endJoy() {
  joyBase.style.display = 'none';
  joyKnob.style.transform = 'translate(-50%, -50%)';
  joyVec.x = joyVec.y = joyVec.mag = 0;
}
function onUI(target) { return !!(target && target.closest && target.closest('#panel, #ui, #hud, #btnA, #btnJump, #btnDash, #btnSkill, #btnSkill2, #btnWep, #btnTree, #btnPause, #levelup, #shop, #skilltree, #gameover, #metashop, #pause, #title, #chooser')); }

// タッチ数に応じて役割を割り当てる（2本以上=ピンチ優先）
function assignRoles() {
  const ids = [...touchMap.keys()];
  if (ids.length >= 2) {
    if (joyId !== null) { joyId = null; endJoy(); }   // スティック解除
    camId = null;
    const a = touchMap.get(ids[0]), b = touchMap.get(ids[1]);
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  } else if (ids.length === 1) {
    pinchDist = null;
    const id = ids[0], p = touchMap.get(id);
    if (joyId === null && camId === null) {
      if (p.x < innerWidth * 0.5) { joyId = id; showJoy(p.x, p.y); moveJoy(p.x, p.y); }
      else { camId = id; camLastX = p.x; }
    } else if (camId === id) { camLastX = p.x; }
  } else { pinchDist = null; joyId = null; camId = null; endJoy(); }
}

addEventListener('touchstart', e => {
  if (onUI(e.target)) return;                    // スライダー/メニュー等はそのまま操作
  if (gameState === 'dialogue') { e.preventDefault(); interact(); return; } // タップで送り
  if (gameState !== 'field') { e.preventDefault(); return; }                  // メニュー中は移動・視点なし
  for (const t of e.changedTouches) touchMap.set(t.identifier, { x: t.clientX, y: t.clientY });
  assignRoles();
  e.preventDefault();
}, { passive: false });

addEventListener('touchmove', e => {
  if (onUI(e.target)) return;
  for (const t of e.changedTouches) if (touchMap.has(t.identifier)) touchMap.set(t.identifier, { x: t.clientX, y: t.clientY });
  const ids = [...touchMap.keys()];
  if (ids.length >= 2) {                          // ピンチズーム（どの位置の2本でも）
    const a = touchMap.get(ids[0]), b = touchMap.get(ids[1]);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist !== null) camDist = THREE.MathUtils.clamp(camDist - (d - pinchDist) * 0.09, 12, 95);
    pinchDist = d;
  } else if (ids.length === 1) {
    const id = ids[0], p = touchMap.get(id);
    if (id === joyId) moveJoy(p.x, p.y);
    else if (id === camId) { camRot -= (p.x - camLastX) * 0.008; camLastX = p.x; }
  }
  e.preventDefault();
}, { passive: false });

function resetTouch() { touchMap.clear(); joyId = null; camId = null; pinchDist = null; endJoy(); }
function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    touchMap.delete(t.identifier);
    if (t.identifier === joyId) { joyId = null; endJoy(); }
    if (t.identifier === camId) camId = null;
  }
  if (e.touches.length === 0) resetTouch();   // 指が全部離れたら状態を完全リセット（取り残し防止）
  else assignRoles();
}
addEventListener('touchend', onTouchEnd);
addEventListener('touchcancel', onTouchEnd);

// ============================================================ UI
const $ = id => document.getElementById(id);
let bloomOn = true, dofOn = true, pixelOn = false, mistOn = true, aberrOn = true;
const WEATHERS = ['none', 'petals', 'rain'];
const WEATHER_LABEL = { none: 'OFF', petals: '花びら', rain: '雨' };
function syncUI() {
  $('bloomV').textContent = bloomOn ? 'ON' : 'OFF';
  $('dofV').textContent = dofOn ? 'ON' : 'OFF';
  $('pxV').textContent = pixelOn ? 'ON' : 'OFF';
  $('mistV').textContent = mistOn ? 'ON' : 'OFF';
  $('aberrV').textContent = aberrOn ? 'ON' : 'OFF';
  $('weatherV').textContent = WEATHER_LABEL[weather];
  $('bloomTog').style.opacity = bloomOn ? 1 : 0.4;
  $('dofTog').style.opacity = dofOn ? 1 : 0.4;
  $('pxTog').style.opacity = pixelOn ? 1 : 0.4;
  $('mistTog').style.opacity = mistOn ? 1 : 0.4;
  $('aberrTog').style.opacity = aberrOn ? 1 : 0.4;
  $('weatherTog').style.opacity = weather === 'none' ? 0.4 : 1;
}
$('bloomStr').value = bloom.strength;
$('dofAp').value = 1.4;
$('timeOfDay').value = 0.5;
$('bloomTog').onclick = () => { bloomOn = !bloomOn; bloom.enabled = bloomOn; syncUI(); };
$('dofTog').onclick = () => { dofOn = !dofOn; bokeh.enabled = dofOn; syncUI(); };
$('pxTog').onclick = () => { pixelOn = !pixelOn; renderer.domElement.style.imageRendering = pixelOn ? 'pixelated' : 'auto'; onResize(); syncUI(); };
$('mistTog').onclick = () => { mistOn = !mistOn; mist.visible = mistOn; syncUI(); };
$('aberrTog').onclick = () => { aberrOn = !aberrOn; gradePass.uniforms.uAberr.value = aberrOn ? 1 : 0; syncUI(); };
$('weatherTog').onclick = () => {
  weather = WEATHERS[(WEATHERS.indexOf(weather) + 1) % WEATHERS.length];
  petals.visible = weather === 'petals';
  rain.visible = weather === 'rain';
  syncUI();
};
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
  { t: 0.0, sky: 0x0b1026, sun: 0x36406a, sunI: 0.35, fog: 0x141a30, amb: 0.32, hemiI: 0.44 }, // 夜
  { t: 0.22, sky: 0x2a2a4a, sun: 0xff9a5a, sunI: 1.3, fog: 0x33304a, amb: 0.25, hemiI: 0.4 },  // 夜明け
  { t: 0.5, sky: 0x7fa8e8, sun: 0xffe8c2, sunI: 2.2, fog: 0x9bb6e0, amb: 0.32, hemiI: 0.6 },   // 昼
  { t: 0.78, sky: 0xe8804a, sun: 0xff7038, sunI: 1.6, fog: 0xc06848, amb: 0.28, hemiI: 0.45 }, // 夕暮れ
  { t: 1.0, sky: 0x0b1026, sun: 0x36406a, sunI: 0.35, fog: 0x141a30, amb: 0.32, hemiI: 0.44 },  // 夜
];
const cA = new THREE.Color(), cB = new THREE.Color();
function applyTimeOfDay(t) {
  let i = 0; while (i < dayKeys.length - 2 && t > dayKeys[i + 1].t) i++;
  const a = dayKeys[i], b = dayKeys[i + 1];
  const k = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
  const lerpC = (ca, cb) => cA.set(ca).lerp(cB.set(cb), k);
  scene.background = lerpC(a.sky, b.sky).clone();
  scene.fog.color.copy(lerpC(a.fog, b.fog)).lerp(fogTheme, 0.45);
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

  // --- 空ドーム ---
  const sCol = lerpC(a.sky, b.sky);                 // cA を返す
  skyUniforms.uMid.value.copy(sCol);
  skyUniforms.uTop.value.copy(sCol).multiplyScalar(0.5);
  skyUniforms.uBottom.value.copy(scene.fog.color);
  skyUniforms.uSunColor.value.copy(sun.color);
  skyUniforms.uSunDir.value.copy(sun.position).normalize();
  skyUniforms.uCloudTint.value.set(0xffffff).lerp(sun.color, 0.5).multiplyScalar(0.45 + 0.55 * THREE.MathUtils.clamp(dayAmt, 0, 1));
  // --- 薄雾の色 ---
  mistUniforms.uColor.value.copy(scene.fog.color).lerp(cB.set(0xffffff), 0.5);
  // --- 夜の窓あかり ---
  const night = THREE.MathUtils.clamp(1 - dayAmt * 1.6, 0, 1);
  for (const w of emissiveWindows) w.emissiveIntensity = night * 1.8;
}

// ============================================================ リサイズ
let aspectFit = 1; // 縦長(ポートレート)ほどカメラを引いて全景を見せる
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
  const aspect = W / H;
  camera.aspect = aspect;
  // ポートレート補正: 画角を少し広げ + 距離を少し伸ばし(霧で曇りすぎない配分)
  if (aspect < 1) {
    const p = THREE.MathUtils.clamp(1 / aspect - 1, 0, 1.3);
    camera.fov = 28 + p * 10;     // ~28〜41°
    aspectFit = 1 + p * 0.42;     // ~1〜1.55
  } else {
    camera.fov = 28; aspectFit = 1;
  }
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 150));
onResize();

// ============================================================ ループ
const clock = new THREE.Clock();
let facingFlip = false, lastBack = false, walkAnim = 0, stepTimer = 0;

// アクションプロンプト（Aボタンは攻撃/交互作用の文脈表示）
const hintEl = document.getElementById('hint');
function updatePrompt() {
  const verb = gameState === 'dialogue' ? '送る' : (nearTarget ? (nearTarget.type === 'chest' ? '調べる' : nearTarget.type === 'warp' ? 'ワープ' : (nearTarget.ref && nearTarget.ref.shop) ? 'みせ' : '話す') : '攻撃');
  if (isTouch) {
    btnA.classList.add('show');
    btnA.textContent = gameState === 'dialogue' ? '▼' : verb;
  } else {
    const show = gameState === 'dialogue' || (gameState === 'field' && !!nearTarget);
    hintEl.style.opacity = show ? '1' : '0';
    hintEl.textContent = gameState === 'dialogue' ? '［F / クリック］ 送る' : '［F］ ' + verb;
  }
}

// 惑星上のタンジェント基底（up=法線 / 前方向は平行移動で運ぶ→極でも連続）
const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _axis = new THREE.Vector3(), _foot = new THREE.Vector3(), _off = new THREE.Vector3();
const _md = new THREE.Vector3(), _cand = new THREE.Vector3();
function planetBasis() {
  _up.copy(pDir).normalize();
  viewFwd.addScaledVector(_up, -viewFwd.dot(_up));            // 法線成分を除去（平行移動）
  if (viewFwd.lengthSq() < 1e-6) { viewFwd.crossVectors(_up, XAXIS); if (viewFwd.lengthSq() < 1e-6) viewFwd.crossVectors(_up, UPVEC); }
  viewFwd.normalize();
  _fwd.copy(viewFwd);
  _right.crossVectors(_fwd, _up).normalize();
}
// moveDir(タンジェント単位)へ arc だけ球面回転。障害物には「外から侵入」する時だけ阻まれる
function tryMove(moveDir, arc) {
  _axis.crossVectors(_up, moveDir).normalize();
  _cand.copy(pDir).applyAxisAngle(_axis, arc).normalize();
  for (const o of obstacles) {
    const co = Math.cos(o.ang);
    if (_cand.dot(o.dir) > co && pDir.dot(o.dir) <= co) return false; // 外側→内側のみブロック
  }
  pDir.copy(_cand); return true;
}
// 地表に立つ3D物体を向ける（up=法線, +Z=fwd方向）
function orientStanding(obj, up, fwd) {
  _z.copy(fwd).addScaledVector(up, -fwd.dot(up));
  if (_z.lengthSq() < 1e-6) { _z.crossVectors(up, XAXIS); if (_z.lengthSq() < 1e-6) _z.crossVectors(up, UPVEC); }
  _z.normalize();
  _x.crossVectors(up, _z).normalize();
  _m.makeBasis(_x, up, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

// 敵AI + 攻撃判定（フィールド）
function combatUpdate(dt, t) {
  // プレイヤー通常攻撃のヒット判定（振りの中盤で1回）
  if (attackT > 0 && !attackHit && attackT < ATTACK_DUR * 0.66) {
    attackHit = true;
    const range = comboHeavy ? ATTACK_RANGE + 0.8 : ATTACK_RANGE;
    const cone = comboHeavy ? -0.1 : 0.2;       // 3段目は広範囲
    const co = Math.cos(range / PLANET_R);
    if (comboHeavy) shakeT = Math.max(shakeT, 0.15);
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = pDir.dot(e.dir); if (d < co) continue;
      _md.copy(e.dir).addScaledVector(pDir, -d);
      if (_md.lengthSq() < 1e-6 || _md.normalize().dot(heading) < cone) continue;
      if (bossBarrier(e)) continue;
      let dmg = 8 + hero.level * 2 + atkBonus + gearBonus.atk + Math.floor(Math.random() * 5);
      if (comboHeavy) dmg = Math.floor(dmg * 1.8);
      if (dashAttack) dmg = Math.floor(dmg * 1.4);
      const crit = Math.random() < critTotal(); let tot = crit ? dmg * 2 : dmg;
      if (e.affix === 'tough') tot = Math.round(tot * 0.6);
      e.hp -= tot; e.hitFlash = 0.18; registerHit();
      if (comboHeavy) addStatus(e, 'freeze', 1.5);            // 3段で凍結
      if (relicCount('fire')) addStatus(e, 'burn', 3);
      if (relicCount('venom')) addStatus(e, 'poison', 4);
      if (relicCount('frost') && Math.random() < 0.35) addStatus(e, 'freeze', 1.5);
      if (syn('fire', 'frost') && e.burn > 0 && e.freeze > 0) { const sd = 12 + hero.level * 2; e.hp -= sd; spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.4), 0x9fd0ff, 8); showDmg(e.model.root.position.clone().addScaledVector(e.dir, 2.4), sd, 'crit'); } // 相転移
      let ls = lifestealTotal(); if (crit && syn('crit', 'vamp')) ls *= 2;  // 処刑: 暴撃吸血倍化
      if (ls > 0) hero.hp = Math.min(hero.maxHp, hero.hp + tot * ls);
      if (crit || comboHeavy) { hitStop = Math.max(hitStop, crit ? 0.07 : 0.05); critFlash(); } // 顿帧+闪光
      showDmg(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 3.2 : 1.8), tot, crit ? 'crit' : '');
      spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 2.2 : 1.2), 0xfff2c0, crit ? 8 : 5);
      Audio.sfx('hit');
      if (!e.isBoss) { _axis.crossVectors(e.dir, pDir).normalize(); e.dir.applyAxisAngle(_axis, -0.07).normalize(); }
      if (e.hp <= 0) killEnemy(e);
    }
    dashAttack = false;
  }
  // 敵の挙動
  for (const e of enemies) {
    if (e.hitFlash > 0) e.hitFlash -= dt;
    // 発光: 被弾の白 > 状態異常の色 > ベース自発光
    const f = Math.max(0, e.hitFlash / 0.18), tnt = e.alive ? statusTint(e) : null;
    for (const m of e.mats) { if (f > 0) m.emissive.copy(m.userData.be || COL_BLACK).addScalar(f * 0.9); else if (tnt) m.emissive.set(tnt).multiplyScalar(0.55); else m.emissive.copy(m.userData.be || COL_BLACK); }
    if (!e.alive) {
      if (e.dead > 0) { e.dead -= dt; e.model.root.scale.setScalar(Math.max(0.001, (e.escale || e.def.scale) * e.dead * 2)); if (e.dead <= 0) e.model.root.visible = false; }
      continue;
    }
    if (!tickStatus(e, dt)) continue;                        // DoTで死亡
    if (e.atkCD > 0) e.atkCD -= dt; if (e.chargeT > 0) e.chargeT -= dt; e.bobT += dt;
    const d = THREE.MathUtils.clamp(pDir.dot(e.dir), -1, 1);
    const angDist = Math.acos(d) * PLANET_R;
    const bh = e.def.behavior;
    const frz = (e.freeze > 0 ? 0.4 : 1) * ((e.affix === 'enrage' && e.hp < e.maxHp * 0.4) ? 1.7 : 1) * (e.enrageMul || 1); // 凍結減速 / 狂暴・怒り加速
    if (e.isBoss) {
      if (e.invT > 0) e.invT -= dt;
      if (e.phase < 2 && e.hp <= e.maxHp * 0.66) enterBossPhase(e, 2);        // フェーズ移行
      else if (e.phase < 3 && e.hp <= e.maxHp * 0.33) enterBossPhase(e, 3);
      e.castCD = (e.castCD || 3) - dt; if (e.castCD <= 0 && angDist < 24) { e.castCD = 4.2 / e.enrageMul; bossCast(e); }
      if (e.phase >= 3) { e.addCD -= dt; if (e.addCD <= 0) { e.addCD = 7; summonAdds(e, 2); } } // 終盤は雑魚召喚
    }
    if (angDist < e.def.aggro) {
      if (bh === 'caster') {                              // 詠唱: 距離を取りつつ弾を撃つ
        const want = e.def.atkRange * 0.55;
        const move = (angDist < want ? -1 : 0.6) * e.def.speed * frz * dt / PLANET_R; // 近いと後退
        _axis.crossVectors(e.dir, pDir).normalize(); e.dir.applyAxisAngle(_axis, move).normalize();
        if (e.atkCD <= 0) { e.atkCD = 2.0; spawnProjectile(e.dir.clone(), pDir.clone(), e.atk); spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.4), 0xc78aff, 4); }
      } else if (angDist > e.def.atkRange) {              // 追尾（突進敵は接近時バースト）
        if (bh === 'charge' && e.atkCD <= 0 && angDist < e.def.aggro * 0.7) { e.chargeT = 0.5; e.atkCD = 2.4; }
        const sp = e.def.speed * frz * (e.chargeT > 0 ? 2.6 : 1);
        _axis.crossVectors(e.dir, pDir).normalize();
        e.dir.applyAxisAngle(_axis, Math.min(sp * dt / PLANET_R, angDist / PLANET_R)).normalize();
      } else if (e.atkCD <= 0) {                          // 近接攻撃
        if (e.isBoss) { e.atkCD = 2.2; e.slamT = 0.5; shakeT = Math.max(shakeT, 0.4); spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 0.5), 0xff7e6a, 16); }
        else e.atkCD = 1.3;
        hurtPlayer(e.atk, e.dir);
      }
    } else if (!e.isBoss) {                                // 徘徊
      if (!e.wander || e.wanderCD <= 0) { e.wander = randDir(); e.wanderCD = 2 + Math.random() * 2; }
      e.wanderCD -= dt;
      _axis.crossVectors(e.dir, e.wander).normalize();
      e.dir.applyAxisAngle(_axis, e.def.speed * 0.4 * dt / PLANET_R).normalize();
    }
    let bob = (e.def.hover ? 0.3 : 0.12) * Math.sin(e.bobT * 2.2);
    if (e.isBoss && e.slamT > 0) { e.slamT -= dt; bob += Math.sin((1 - e.slamT / 0.5) * Math.PI) * 1.2; }
    e.model.root.position.copy(surfPos(e.dir, e.def.hover + bob));
    _md.copy(pDir).addScaledVector(e.dir, -d);
    orientStanding(e.model.root, e.dir, _md.lengthSq() > 1e-6 ? _md : heading);
  }
  // 死亡済みを配列から除去
  for (let i = enemies.length - 1; i >= 0; i--) { const e = enemies[i]; if (!e.alive && e.dead <= 0) { scene.remove(e.model.root); enemies.splice(i, 1); } }
  if (bossRef) bossHpEl.style.width = Math.max(0, bossRef.hp / bossRef.maxHp * 100) + '%';
}

function update(dt, t) {
  // タイマー
  if (dashT > 0) dashT -= dt; if (dashCD > 0) dashCD -= dt;
  if (attackT > 0) attackT -= dt; if (attackCD > 0) attackCD -= dt;
  if (invulnT > 0) invulnT -= dt; if (hurtFlash > 0) hurtFlash -= dt;
  if (skillT > 0) skillT -= dt; if (skillCD > 0) skillCD -= dt; if (skill2CD > 0) skill2CD -= dt; if (shakeT > 0) shakeT -= dt;
  if (comboTimer > 0) comboTimer -= dt; else comboHeavy = false;
  comboTick(dt);
  updateEffects(dt);
  hurtEl.style.opacity = Math.max(0, hurtFlash / 0.4 * 0.9);

  let ix = 0, iy = 0, dash = false, playerMoving = false;
  if (gameState === 'field') {
    if (keys['q']) camRot += dt * 1.4;
    if (keys['e']) camRot -= dt * 1.4;
    _up.copy(pDir).normalize();
    if (camRot) { viewFwd.applyAxisAngle(_up, camRot); camRot = 0; }
    planetBasis();
    if (keys['w'] || keys['arrowup']) iy += 1;
    if (keys['s'] || keys['arrowdown']) iy -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    ix += joyVec.x; iy += joyVec.y;
    const inMag = Math.hypot(ix, iy);
    if (inMag > 1) { ix /= inMag; iy /= inMag; }
    dash = keys['shift'] || joyVec.mag > 0.9;
    const speed = (dash ? 11 : 6) * moveMul * (1 + gearBonus.move);
    playerMoving = inMag > 0.05 || dashT > 0;
    if (playerMoving) {
      let dir3, arc;
      if (dashT > 0) { dir3 = heading; arc = DASH_SPEED * dt / PLANET_R; }
      else {
        _md.copy(_fwd).multiplyScalar(iy).addScaledVector(_right, ix).normalize();
        heading.copy(_md); dir3 = _md; arc = speed * dt * Math.min(1, inMag) / PLANET_R;
      }
      if (!tryMove(dir3, arc)) {                           // 直進が塞がれたら滑って回り込む
        const slid = dir3.clone();
        if (!tryMove(slid.copy(dir3).applyAxisAngle(_up, 0.6), arc))
          tryMove(slid.copy(dir3).applyAxisAngle(_up, -0.6), arc);
      }
      if (dashT <= 0) { stepTimer -= dt; if (stepTimer <= 0) { Audio.sfx('step'); stepTimer = dash ? 0.22 : 0.34; } }
    }
    combatUpdate(dt, t);
    updateProjectiles(dt);
    updateArrowsP(dt);
    updateAoes(dt);
    updatePickups(dt);
    planetHazard(dt, t);
    // ウェーブ進行：全滅したら少し待って次のウェーブ
    if (waveBreak > 0) { waveBreak -= dt; if (waveBreak <= 0) { if ((wave + 1) % 5 === 0) startWave(wave + 1); else openNodePick(); } }
    else if (enemies.length === 0) { waveBreak = 1.6; score += 50; saveBest(); showArea('WAVE ' + wave + ' クリア！', '+50'); updateHUD(); }
  } else {
    camRot = 0;
  }

  // --- ジャンプ物理（法線方向・重力は星で変化）---
  if (!grounded || jumpV !== 0) {
    jumpV -= GRAVITY * gravMul * dt; jumpH += jumpV * dt;
    if (jumpH <= 0) {
      jumpH = 0; jumpV = 0; grounded = true;
      if (pendingLand) { pendingLand = false; shakeT = Math.max(shakeT, 0.35); spawnImpact(surfPos(pDir, 0.4), 0xffffff, 16); Audio.sfx('hit'); }
      if (airSlam) { airSlam = false; aoeDamage(4.6, 16 + hero.level * 2 + atkBonus + gearBonus.atk, 0xfff2c0); Audio.sfx('skill'); }
    }
  }

  // --- 基底とプレイヤー配置 ---
  planetBasis();
  player.position.copy(pDir).multiplyScalar(PLANET_R + PLAYER_LIFT + jumpH + Math.sin(t * 2.2) * 0.04);
  orientStanding(player, _up, heading);
  if (skillT > 0) player.rotateOnAxis(UPVEC, (1 - skillT / SKILL_DUR) * Math.PI * 5); // スキル中はスピン
  const attackP = attackT > 0 ? (1 - attackT / ATTACK_DUR) : 0;
  playerModel.update(dt, playerMoving && jumpH < 0.1, dash ? 1.4 : 1.0, attackP);
  player.visible = !(hurtFlash > 0 && Math.floor(t * 22) % 2 === 0); // 受傷時だけ点滅（ダッシュでは点滅しない）
  if (dashT > 0 && Math.floor(t * 60) % 2 === 0) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x7fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.position.copy(player.position).addScaledVector(_up, 1.0); sp.scale.setScalar(2.2); scene.add(sp); fxList.push({ sp, v: new THREE.Vector3(), life: 0.26, max: 0.26 }); } // ダッシュの残像トレイル

  // 足元マーカー（位置の目印・脈動）
  marker.position.copy(pDir).multiplyScalar(PLANET_R + 0.12);
  marker.quaternion.setFromUnitVectors(_MZ, pDir);
  marker.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
  markerMat.opacity = 0.55 + Math.sin(t * 4) * 0.18;
  marker.visible = player.visible;

  // 追従ライト（常時すこし + 夜は強め）
  const dayAmt = 1 - Math.abs(timeOfDay - 0.5) * 2;
  playerLight.intensity = THREE.MathUtils.lerp(1.9, 0.6, THREE.MathUtils.clamp(dayAmt, 0, 1));
  playerLight.position.copy(player.position).addScaledVector(_up, 1.8);

  // --- カメラ（惑星の上を周回する三人称）---
  _foot.copy(pDir).multiplyScalar(PLANET_R + 1.4);
  _off.copy(_up).multiplyScalar(Math.sin(camPitch)).addScaledVector(_fwd, -Math.cos(camPitch));
  camera.position.copy(_foot).addScaledVector(_off, (warpCamDist > 0 ? warpCamDist : camDist) * aspectFit);
  camera.up.copy(_up);
  camera.lookAt(_foot);
  if (shakeT > 0) { const s = shakeT * 1.4; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; }

  // --- NPC（待機モーション）---
  for (const n of npcs) { n.model.root.position.copy(surfPos(n.dir, Math.sin(t * 1.8 + n.wanderT) * 0.04)); n.model.update(dt, false); }
  warpTorus.rotation.z += dt * 1.6;       // ワープゲート回転
  updateEnemyBars();
  updateArrows();
  nearTarget = findInteract();
  updatePrompt();
  updateCooldownUI();

  // --- DOFのピント ---
  bokeh.uniforms['focus'].value = camera.position.distanceTo(player.position);

  // --- シェーダー時間 ---
  grassU.uTime.value = t;
  ffMat.uniforms.uTime.value = t;
  skyUniforms.uTime.value = t;
  mistUniforms.uTime.value = t;
  petals.material.uniforms.uTime.value = t;
  rain.material.uniforms.uTime.value = t;
  snow.material.uniforms.uTime.value = t;
  // 天候はプレイヤーの真上から降らせる
  petals.position.copy(player.position); rain.position.copy(player.position); snow.position.copy(player.position);
  petals.quaternion.setFromUnitVectors(UPVEC, pDir); rain.quaternion.copy(petals.quaternion); snow.quaternion.copy(petals.quaternion);
  // 溶岩/異界の地面の発光を脈動させる
  const th = THEMES[themeIndex];
  if (th.emI > 0) grassMat.emissiveIntensity = th.emI * (0.78 + 0.22 * Math.sin(t * 2.5));

  // 太陽は惑星中心を照らす（歩くと昼/夜の境界を越えられる）
  sun.target.position.set(0, 0, 0);
  applyTimeOfDay(timeOfDay);
  if (Audio.audioReady()) Audio.setMood(planetMood());
}

function animate() {
  requestAnimationFrame(animate);
  const real = Math.min(clock.getDelta(), 0.05);
  if (hitStop > 0) hitStop -= real; if (slowMo > 0) slowMo -= real;
  const factor = hitStop > 0 ? 0.05 : (slowMo > 0 ? 0.4 : 1); // 顿帧 / 慢动作
  const dt = real * factor;
  const t = clock.elapsedTime;
  update(dt, t);
  updateDialogue(real);
  gradePass.uniforms.uTime.value = (t * 9) % 100 + 1; // グレインは常時更新
  composer.render();
}

// 起動：タイトル画面から
applyMeta();
updateHUD();
showTitle();
applyTimeOfDay(timeOfDay);
animate();
const loading = document.getElementById('loading');
loading.style.opacity = '0';
setTimeout(() => loading.remove(), 700);
