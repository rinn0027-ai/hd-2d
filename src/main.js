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
  { name: '草原の星', en: 'GREEN PLANET', ground: 0xffffff, fog: 0x1a2238, enemyTint: null,     emissive: 0x000000, emI: 0,    snow: false },
  { name: '雪の星',   en: 'SNOW PLANET',  ground: 0xeaf4ff, fog: 0x2a3a52, enemyTint: 0x9fd0ff, emissive: 0x223344, emI: 0.12, snow: true },
  { name: '溶岩の星', en: 'LAVA PLANET',  ground: 0xff6a3a, fog: 0x3a1208, enemyTint: 0xff6a40, emissive: 0xff2200, emI: 0.55, snow: false },
  { name: '異界の星', en: 'ALIEN PLANET', ground: 0xc090ff, fog: 0x2a1840, enemyTint: 0x9a6aff, emissive: 0x6a1aff, emI: 0.32, snow: false },
];
let themeIndex = 0, planetMul = 1;
const fogTheme = new THREE.Color(0x1a2238);
function applyTheme(i) {
  const th = THEMES[i];
  grassMat.color.set(th.ground);
  grassMat.emissive.set(th.emissive); grassMat.emissiveIntensity = th.emI;
  fogTheme.set(th.fog);
  if (snow) snow.visible = th.snow;
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
  for (const a of aoes) scene.remove(a.grp); aoes.length = 0;
  pDir.set(0, 1, 0); hero.hp = Math.min(hero.maxHp, hero.hp + 30); jumpH = 0; jumpV = 0; grounded = true;
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

// ============================================================ 即時戦闘（ウェーブ制）
const ENEMY_DEF = {
  slime:    { model: 'slime',    hp: 16, atk: 7,  exp: 8,  scale: 1.3, speed: 1.9, hover: 0,   atkRange: 2.2, aggro: 10, behavior: 'chase',  score: 10 },
  mushroom: { model: 'mushroom', hp: 30, atk: 12, exp: 16, scale: 1.4, speed: 1.3, hover: 0,   atkRange: 2.5, aggro: 9,  behavior: 'chase',  score: 15 },
  bat:      { model: 'bat',      hp: 12, atk: 8,  exp: 12, scale: 1.2, speed: 3.0, hover: 1.4, atkRange: 2.0, aggro: 13, behavior: 'charge', score: 12 },
  caster:   { model: 'mushroom', hp: 22, atk: 9,  exp: 18, scale: 1.4, speed: 1.0, hover: 0,   atkRange: 9.5, aggro: 16, behavior: 'caster', score: 20, tint: 0x8a4ad0 },
  splitter: { model: 'slime',    hp: 28, atk: 8,  exp: 14, scale: 1.7, speed: 1.6, hover: 0,   atkRange: 2.4, aggro: 10, behavior: 'split',  score: 16, tint: 0x3a86c0 },
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
function spawnEnemyDef(key, dir, hpScale = 1, childScale = 1) {
  const def = ENEMY_DEF[key];
  const e = M.makeEnemy(def.model);
  e.root.scale.setScalar(def.scale * childScale);
  const tint = def.tint || THEMES[themeIndex].enemyTint;   // 種類色 or 惑星色
  if (tint) e.root.traverse(o => { if (o.isMesh && o.material && o.material.color) o.material.color.set(tint); });
  const mats = collectMats(e.root);
  for (const m of mats) { m.emissive.copy(m.color).multiplyScalar(0.45); m.emissiveIntensity = 0.7; m.userData.be = m.emissive.clone(); } // 夜でも見える自発光
  addOutline(e.root, 1.07);
  scene.add(e.root);
  const hp = def.hp * hpScale * planetMul;
  const en = { model: e, kind: key, def, dir: dir.clone().normalize(), hp, maxHp: hp, atk: def.atk * planetMul, alive: true, atkCD: 1 + Math.random() * 1.5, bobT: Math.random() * 9, hitFlash: 0, dead: 0, chargeT: 0, mats, childScale };
  enemies.push(en); return en;
}
function spawnBoss(n) {
  const e = M.makeBoss();
  const hp = (BOSS_DEF.hp + (n - 5) * 60) * planetMul;
  e.root.scale.setScalar(BOSS_DEF.scale);
  if (THEMES[themeIndex].enemyTint) e.root.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.emissiveIntensity !== 1.4) o.material.color.lerp(new THREE.Color(THEMES[themeIndex].enemyTint), 0.5); });
  const mats = collectMats(e.root);
  for (const m of mats) { m.userData.be = m.emissive.clone(); }
  addOutline(e.root, 1.05);
  scene.add(e.root);
  bossRef = { model: e, kind: 'boss', def: BOSS_DEF, dir: freeDir().clone(), hp, maxHp: hp, atk: BOSS_DEF.atk * planetMul, alive: true, atkCD: 2, bobT: 0, hitFlash: 0, dead: 0, isBoss: true, slamT: 0, mats };
  enemies.push(bossRef);
  Audio.sfx('encounter');
  document.getElementById('bossName').textContent = '◆ スライム王 KING SLIME ◆';
  bossbarEl.style.display = 'block';
  showArea('ボスが あらわれた！', 'BOSS WAVE ' + n);
}
function startWave(n) {
  wave = n;
  if (n % 5 === 0) { spawnBoss(n); updateHUD(); return; }
  const count = Math.min(11, 3 + Math.floor(n * 0.9));
  const hpScale = 1 + (n - 1) * 0.16;
  const pool = ['slime', 'bat'];
  if (n >= 2) pool.push('mushroom');
  if (n >= 3) pool.push('splitter');
  if (n >= 4) pool.push('caster', 'bat');
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
  return new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), new THREE.MeshStandardMaterial({ color: 0x6ad0ff, emissive: 0x113a55, emissiveIntensity: 0.6, roughness: 0.3 }));
}
function dropPickup(type, dir) {
  const obj = new THREE.Group(); obj.add(makePickup(type));
  obj.position.copy(surfPos(dir, 0.8)); alignUp(obj, dir);
  scene.add(obj);
  pickups.push({ obj, type, dir: dir.clone().normalize(), t: Math.random() * 9, life: 16 });
}
function collectPickup(type) {
  if (type === 'coin') { coins++; score += 5; Audio.sfx('cursor'); }
  else if (type === 'heart') { hero.hp = Math.min(hero.maxHp, hero.hp + 18); Audio.sfx('heal'); showDmg(player.position.clone().addScaledVector(_up, 2.6), 18, 'heal'); }
  else { gainExp(6); score += 3; Audio.sfx('cursor'); }
  updateHUD();
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.life -= dt; p.t += dt;
    const d = THREE.MathUtils.clamp(pDir.dot(p.dir), -1, 1);
    const ang = Math.acos(d) * PLANET_R;
    if (ang < 3.0) { _axis.crossVectors(p.dir, pDir).normalize(); p.dir.applyAxisAngle(_axis, Math.min(9 * dt / PLANET_R, ang / PLANET_R)).normalize(); }
    p.obj.position.copy(surfPos(p.dir, 0.85 + Math.sin(p.t * 3) * 0.12));
    alignUp(p.obj, p.dir); p.obj.children[0].rotation.y += dt * 3;
    if (ang < 1.0 && p.life > 0) { collectPickup(p.type); scene.remove(p.obj); pickups.splice(i, 1); }
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
const hudWave = document.getElementById('hudWave'), hudScore = document.getElementById('hudScore'), hudCoins = document.getElementById('hudCoins');
function updateHUD() {
  hudHp.style.width = Math.max(0, hero.hp / hero.maxHp * 100) + '%';
  hudHpTxt.textContent = `HP ${Math.max(0, Math.ceil(hero.hp))}/${hero.maxHp}`;
  hudLv.textContent = 'Lv ' + hero.level;
  hudExp.textContent = `EXP ${hero.exp}/${expToNext(hero.level)}`;
  hudWave.textContent = 'WAVE ' + wave;
  hudScore.textContent = 'SCORE ' + score + ' (BEST W' + best.wave + ')';
  hudCoins.textContent = '◆ ' + coins;
}
function gainExp(n) {
  hero.exp += n;
  while (hero.exp >= expToNext(hero.level)) {
    hero.exp -= expToNext(hero.level); hero.level++; pendingLevels++;
    hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * 0.3);
    Audio.sfx('victory');
  }
  updateHUD();
  if (pendingLevels > 0 && gameState !== 'levelup') openLevelUp();
}

// アクション状態 / 強化
let dashT = 0, dashCD = 0, jumpH = 0, jumpV = 0, grounded = true;
let attackT = 0, attackCD = 0, attackHit = false, invulnT = 0, hurtFlash = 0, shakeT = 0;
let comboCount = 0, comboTimer = 0, comboHeavy = false;
let skillT = 0, skillCD = 0;
let atkBonus = 0, moveMul = 1, atkCdMul = 1, dashCdMul = 1, skillCdMul = 1; // 祝福による強化
let pendingLevels = 0;
const ATTACK_DUR = 0.32, ATTACK_RANGE = 3.6, JUMP_V = 7.5, GRAVITY = 20, DASH_T = 0.22, DASH_SPEED = 22, DASH_CD = 0.55;
const SKILL_DUR = 0.5, SKILL_CD = 3.5, SKILL_RANGE = 6.0;
const hurtEl = document.getElementById('hurt');

function doAttack() {
  if (gameState !== 'field' || attackCD > 0 || skillT > 0) return;
  comboCount = (comboTimer > 0) ? (comboCount % 3) + 1 : 1;  // 1→2→3 の連舞
  comboTimer = 0.7; comboHeavy = comboCount >= 3;
  attackT = ATTACK_DUR; attackCD = (comboHeavy ? 0.5 : 0.32) * atkCdMul; attackHit = false;
  Audio.sfx(comboHeavy ? 'skill' : 'attack');
}
function doSkill() {
  if (gameState !== 'field' || skillCD > 0) return;
  skillT = SKILL_DUR; skillCD = SKILL_CD * skillCdMul; invulnT = Math.max(invulnT, 0.35);
  Audio.sfx('skill'); shakeT = Math.max(shakeT, 0.25);
  spawnImpact(player.position.clone().addScaledVector(pDir, 1.0), 0xbf8aff, 14);
  // 周囲360°に大ダメージ
  const co = Math.cos(SKILL_RANGE / PLANET_R);
  for (const e of enemies) {
    if (!e.alive) continue;
    if (pDir.dot(e.dir) < co) continue;
    const dmg = 22 + hero.level * 3 + atkBonus * 2;
    e.hp -= dmg; e.hitFlash = 0.2;
    showDmg(e.model.root.position.clone().addScaledVector(e.dir, 1.8), dmg, 'crit');
    spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.2), 0xbf8aff, 5);
    _axis.crossVectors(e.dir, pDir).normalize(); e.dir.applyAxisAngle(_axis, -0.12).normalize();
    if (e.hp <= 0) killEnemy(e);
  }
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
  if (fromDir) { _axis.crossVectors(pDir, fromDir).normalize(); pDir.applyAxisAngle(_axis, -0.05).normalize(); }
  updateHUD();
  if (hero.hp <= 0) respawnPlayer();
}
function respawnPlayer() {
  saveBest();
  hero.hp = hero.maxHp; pDir.set(0, 1, 0); invulnT = 1.4; jumpH = 0; jumpV = 0; grounded = true;
  for (const e of enemies) if (e.alive && pDir.dot(e.dir) > 0.3) e.dir.copy(randDir());
  showArea('やられた… 復活', 'RESPAWN');
}
function killEnemy(e) {
  if (!e.alive) return;
  e.alive = false; e.dead = 0.5; gainExp(Math.round(e.def.exp * planetMul));
  score += Math.round((e.def.score || 10) * planetMul);
  spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.0), 0xffd27a, 10);
  // 掉落
  dropPickup('coin', e.dir);
  if (Math.random() < 0.26) dropPickup('heart', e.dir);
  if (Math.random() < 0.5) dropPickup('gem', e.dir);
  if (e.isBoss) {
    bossRef = null; bossbarEl.style.display = 'none'; slowMo = 1.0;
    for (let i = 0; i < 5; i++) dropPickup('coin', randDir().lerp(e.dir, 0.5).normalize());
    hero.hp = hero.maxHp; Audio.sfx('victory'); showArea('スライム王を たおした！', 'BOSS DEFEATED');
  } else {
    Audio.sfx('chest');
    // 分裂
    if (e.def.behavior === 'split' && !e.isChild) {
      for (let i = 0; i < 2; i++) {
        _axis.crossVectors(e.dir, randDir()).normalize();
        const cd = e.dir.clone().applyAxisAngle(_axis, 0.08).normalize();
        const c = spawnEnemyDef('slime', cd, 0.5, 0.75); c.isChild = true;
      }
    }
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
function closeShop() { shopEl.style.display = 'none'; gameState = 'field'; }
shopCloseEl.addEventListener('click', closeShop);
shopCloseEl.addEventListener('touchstart', e => { e.preventDefault(); closeShop(); }, { passive: false });

// ============================================================ ボスの範囲攻撃（地面の赤円→爆発）
const aoes = [];
const aoeRingGeo = new THREE.RingGeometry(0.82, 1.0, 36);
const aoeFillGeo = new THREE.CircleGeometry(1.0, 36);
function spawnAoe(dir, r, dmg) {
  const grp = new THREE.Group();
  const ring = new THREE.Mesh(aoeRingGeo, new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  const fill = new THREE.Mesh(aoeFillGeo, new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  grp.add(ring, fill); grp.scale.setScalar(r);
  grp.position.copy(surfPos(dir, 0.15));
  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  scene.add(grp);
  aoes.push({ grp, ring, fill, dir: dir.clone().normalize(), r, t: 1.1, max: 1.1, dmg });
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
  if (k === 'j') { doAttack(); }
  else if (k === ' ') { doJump(); e.preventDefault(); }
  else if (k === 'k') { doDash(); }
  else if (k === 'l') { doSkill(); }
  else if (k === 'f' || k === 'enter') { interact(); e.preventDefault(); }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('wheel', e => { camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 3, 12, 95); }, { passive: true });

// アクションボタン
const btnA = document.getElementById('btnA');
const btnJump = document.getElementById('btnJump');
const btnDash = document.getElementById('btnDash');
const btnSkill = document.getElementById('btnSkill');
function bindBtn(btn, fn) {
  btn.addEventListener('click', e => { e.preventDefault(); fn(); });
  btn.addEventListener('touchstart', e => { e.preventDefault(); kickAudio(); fn(); }, { passive: false });
}
bindBtn(btnA, actionA); bindBtn(btnJump, doJump); bindBtn(btnDash, doDash); bindBtn(btnSkill, doSkill);

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
function onUI(target) { return !!(target && target.closest && target.closest('#panel, #ui, #hud, #btnA, #btnJump, #btnDash, #btnSkill, #levelup, #shop')); }

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
      let dmg = 8 + hero.level * 2 + atkBonus + Math.floor(Math.random() * 5);
      if (comboHeavy) dmg = Math.floor(dmg * 1.8);
      const crit = Math.random() < 0.2; const tot = crit ? dmg * 2 : dmg;
      e.hp -= tot; e.hitFlash = 0.18;
      if (crit || comboHeavy) hitStop = Math.max(hitStop, 0.05); // 顿帧
      showDmg(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 3.2 : 1.8), tot, crit ? 'crit' : '');
      spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, e.isBoss ? 2.2 : 1.2), 0xfff2c0, crit ? 8 : 5);
      Audio.sfx('hit');
      if (!e.isBoss) { _axis.crossVectors(e.dir, pDir).normalize(); e.dir.applyAxisAngle(_axis, -0.07).normalize(); }
      if (e.hp <= 0) killEnemy(e);
    }
  }
  // 敵の挙動
  for (const e of enemies) {
    // 発光フラッシュ（ベース自発光＋白フラッシュ）
    if (e.hitFlash > 0) { e.hitFlash -= dt; const f = Math.max(0, e.hitFlash / 0.18); for (const m of e.mats) m.emissive.copy(m.userData.be || COL_BLACK).addScalar(f * 0.9); }
    if (!e.alive) {
      if (e.dead > 0) { e.dead -= dt; e.model.root.scale.setScalar(Math.max(0.001, e.def.scale * e.dead * 2)); if (e.dead <= 0) e.model.root.visible = false; }
      continue;
    }
    if (e.atkCD > 0) e.atkCD -= dt; if (e.chargeT > 0) e.chargeT -= dt; e.bobT += dt;
    const d = THREE.MathUtils.clamp(pDir.dot(e.dir), -1, 1);
    const angDist = Math.acos(d) * PLANET_R;
    const bh = e.def.behavior;
    if (e.isBoss) { e.castCD = (e.castCD || 3) - dt; if (e.castCD <= 0 && angDist < 20) { e.castCD = 4.5; spawnAoe(pDir.clone(), 4.8, Math.round(e.atk * 1.1)); } }
    if (angDist < e.def.aggro) {
      if (bh === 'caster') {                              // 詠唱: 距離を取りつつ弾を撃つ
        const want = e.def.atkRange * 0.55;
        const move = (angDist < want ? -1 : 0.6) * e.def.speed * dt / PLANET_R; // 近いと後退
        _axis.crossVectors(e.dir, pDir).normalize(); e.dir.applyAxisAngle(_axis, move).normalize();
        if (e.atkCD <= 0) { e.atkCD = 2.0; spawnProjectile(e.dir.clone(), pDir.clone(), e.atk); spawnImpact(e.model.root.position.clone().addScaledVector(e.dir, 1.4), 0xc78aff, 4); }
      } else if (angDist > e.def.atkRange) {              // 追尾（突進敵は接近時バースト）
        if (bh === 'charge' && e.atkCD <= 0 && angDist < e.def.aggro * 0.7) { e.chargeT = 0.5; e.atkCD = 2.4; }
        const sp = e.def.speed * (e.chargeT > 0 ? 2.6 : 1);
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
  if (skillT > 0) skillT -= dt; if (skillCD > 0) skillCD -= dt; if (shakeT > 0) shakeT -= dt;
  if (comboTimer > 0) comboTimer -= dt; else comboHeavy = false;
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
    const speed = (dash ? 11 : 6) * moveMul;
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
    updateAoes(dt);
    updatePickups(dt);
    // ウェーブ進行：全滅したら少し待って次のウェーブ
    if (waveBreak > 0) { waveBreak -= dt; if (waveBreak <= 0) startWave(wave + 1); }
    else if (enemies.length === 0) { waveBreak = 2.4; score += 50; saveBest(); showArea('WAVE ' + wave + ' クリア！', '+50'); updateHUD(); }
  } else {
    camRot = 0;
  }

  // --- ジャンプ物理（法線方向）---
  if (!grounded || jumpV !== 0) {
    jumpV -= GRAVITY * dt; jumpH += jumpV * dt;
    if (jumpH <= 0) { jumpH = 0; jumpV = 0; grounded = true; }
  }

  // --- 基底とプレイヤー配置 ---
  planetBasis();
  player.position.copy(pDir).multiplyScalar(PLANET_R + PLAYER_LIFT + jumpH + Math.sin(t * 2.2) * 0.04);
  orientStanding(player, _up, heading);
  if (skillT > 0) player.rotateOnAxis(UPVEC, (1 - skillT / SKILL_DUR) * Math.PI * 5); // スキル中はスピン
  const attackP = attackT > 0 ? (1 - attackT / ATTACK_DUR) : 0;
  playerModel.update(dt, playerMoving && jumpH < 0.1, dash ? 1.4 : 1.0, attackP);
  player.visible = !(invulnT > 0 && Math.floor(t * 20) % 2 === 0); // 無敵中は点滅

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
  nearTarget = findInteract();
  updatePrompt();

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
  if (Audio.audioReady()) Audio.setMood(dayNightMood());
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

// 起動時にエリア名 + 自己ベスト
setTimeout(() => showArea('まるい大地', best.wave > 1 ? 'BEST WAVE ' + best.wave : 'TINY PLANET'), 600);

// 起動
startWave(1);
updateHUD();
applyTimeOfDay(timeOfDay);
animate();
const loading = document.getElementById('loading');
loading.style.opacity = '0';
setTimeout(() => loading.remove(), 700);
