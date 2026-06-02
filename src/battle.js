// battle.js — 簡易な回合制バトル（独自シーン + コマンドUI + ダメージ表示）
import * as THREE from 'three';
import * as P from './procedural.js';
import { sfx, setMood } from './audio.js';

const ENEMIES = {
  slime:    { name: 'スライム',     hp: 34, atk: 6,  exp: 8,  sprite: 'slime',    scale: 5.0, y: 2.4 },
  mushroom: { name: 'マッシュロア', hp: 50, atk: 9,  exp: 16, sprite: 'mushroom', scale: 5.4, y: 2.6 },
  bat:      { name: 'ナイトバット', hp: 30, atk: 8,  exp: 12, sprite: 'bat',      scale: 4.6, y: 3.2 },
};
export const ENEMY_TYPES = Object.keys(ENEMIES);

const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const delay = ms => new Promise(r => setTimeout(r, ms));

export function createBattle({ renderPass, bokeh, heroPal }) {
  // ---- シーン ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141b2a);
  scene.fog = new THREE.FogExp2(0x141b2a, 0.02);
  const cam = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.5, 200);
  cam.position.set(0, 4.2, 13);
  cam.lookAt(0, 2.2, 0);

  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x33260f, 0.7));
  const key = new THREE.DirectionalLight(0xffe8c2, 1.6); key.position.set(6, 12, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a8cff, 0.8); rim.position.set(-8, 5, -6); scene.add(rim);

  // 地面
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(22, 40),
    new THREE.MeshStandardMaterial({ map: P.grassTexture(128), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  ground.material.map.repeat.set(6, 6);

  // 背景のシルエット木
  const treeTex = P.treeSprite();
  const treeMat = new THREE.MeshBasicMaterial({ map: treeTex, transparent: true, alphaTest: 0.5, color: 0x223044, fog: true });
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), treeMat);
    m.position.set(-18 + i * 6 + (Math.random() - 0.5) * 2, 4.5, -12 - Math.random() * 4);
    scene.add(m);
  }

  // ホタル風の浮遊光（雰囲気）
  const glowTex = P.glowSprite();

  // ---- ヒーロー（後ろ姿） ----
  const heroSheet = P.characterSpriteSheet(heroPal);
  const heroMat = new THREE.MeshBasicMaterial({ map: heroSheet.texture, transparent: true, alphaTest: 0.4, fog: true });
  heroMat.map.repeat.set(1 / heroSheet.cols, 1 / heroSheet.rows);
  heroMat.map.offset.set(0, 0); // 背面・静止
  const hero = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.2), heroMat);
  hero.position.set(-4.5, 2.4, 2.5);
  scene.add(hero);

  // ---- 敵 ----
  const enemyMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.4, fog: true });
  const enemy = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), enemyMat);
  enemy.position.set(4.0, 2.6, -1.0);
  scene.add(enemy);

  // ---- DOM ----
  const $ = id => document.getElementById(id);
  const battleUI = $('battle'), menu = $('bMenu'), msgEl = $('bMsg');
  const enemyNameEl = $('bEnemyName'), enemyHpBar = $('bEnemyHp');
  const hpBar = $('bHpBar'), spBar = $('bSpBar'), hpTxt = $('bHpTxt'), spTxt = $('bSpTxt');

  let edata = null, eHP = 0, eMax = 0, stats = null;
  let shakeT = 0;

  // ---- カメラ操作（ドラッグで旋回 / ピンチでズーム、PCもタッチも） ----
  let bYaw = 0, bDist = 13;
  const BHEIGHT = 4.2;
  const pointers = new Map();
  let bPinch = null;
  const inMenu = el => !!(el && el.closest && el.closest('#bMenu, #btnA'));
  function pDown(e) { if (!active || inMenu(e.target)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); }
  function pMove(e) {
    if (!active || !pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    const dx = e.clientX - p.x; p.x = e.clientX; p.y = e.clientY;
    if (pointers.size >= 2) {
      const a = [...pointers.values()];
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (bPinch != null) bDist = THREE.MathUtils.clamp(bDist - (d - bPinch) * 0.04, 8, 20);
      bPinch = d;
    } else {
      bYaw = THREE.MathUtils.clamp(bYaw - dx * 0.006, -0.85, 0.85);
    }
  }
  function pUp(e) { pointers.delete(e.pointerId); if (pointers.size < 2) bPinch = null; }
  addEventListener('pointerdown', pDown);
  addEventListener('pointermove', pMove);
  addEventListener('pointerup', pUp);
  addEventListener('pointercancel', pUp);

  function updateBars() {
    enemyHpBar.style.width = Math.max(0, eHP / eMax * 100) + '%';
    hpBar.style.width = Math.max(0, stats.hp / stats.maxHp * 100) + '%';
    spBar.style.width = Math.max(0, stats.sp / stats.maxSp * 100) + '%';
    hpTxt.textContent = `${Math.max(0, stats.hp)}/${stats.maxHp}`;
    spTxt.textContent = `${Math.max(0, stats.sp)}/${stats.maxSp}`;
  }
  async function message(t, hold = 750) { msgEl.textContent = t; msgEl.style.opacity = '1'; await delay(hold); }
  function clearMsg() { msgEl.style.opacity = '0'; }

  function setMenu(on) {
    menu.querySelectorAll('button').forEach(b => {
      let dis = !on;
      if (on && b.dataset.act === 'skill' && stats.sp < 5) dis = true;
      if (on && b.dataset.act === 'item' && stats.potions <= 0) dis = true;
      b.disabled = dis;
    });
  }
  function waitCommand() {
    return new Promise(res => {
      const onClick = e => { const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return; sfx('confirm'); cleanup(); res(b.dataset.act); };
      const onKey = e => { const m = { '1': 'attack', '2': 'skill', '3': 'item', '4': 'flee' }; const a = m[e.key]; const b = menu.querySelector(`[data-act="${a}"]`); if (a && b && !b.disabled) { sfx('confirm'); cleanup(); res(a); } };
      function cleanup() { menu.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); }
      menu.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
    });
  }

  function showDamage(mesh, val, cls = '') {
    const v = new THREE.Vector3(); mesh.getWorldPosition(v); v.y += 2.4; v.project(cam);
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    const el = document.createElement('div');
    el.className = 'dmgNum ' + cls;
    el.textContent = (cls === 'heal' ? '+' : '') + val;
    el.style.left = (x - 14) + 'px'; el.style.top = (y - 14) + 'px';
    el.style.animation = 'floatUp .8s ease forwards';
    document.body.appendChild(el); setTimeout(() => el.remove(), 820);
  }

  async function lunge(mesh, dir) {
    const x0 = mesh.position.x;
    mesh.position.x += dir * 1.3; await delay(100);
    mesh.position.x = x0 + dir * 0.3; await delay(60);
    mesh.position.x = x0;
  }

  async function heroAttack() {
    await lunge(hero, 1); sfx('attack');
    const crit = Math.random() < 0.15;
    let dmg = rand(8, 13) * (crit ? 2 : 1);
    eHP -= dmg; sfx('hit'); shakeT = 0.25;
    showDamage(enemy, dmg, crit ? 'crit' : ''); updateBars();
    if (crit) await message('会心の一撃！', 600);
    await delay(380);
  }
  async function heroSkill() {
    sfx('skill'); await lunge(hero, 1);
    const dmg = rand(16, 24);
    eHP -= dmg; sfx('hit'); shakeT = 0.35;
    showDamage(enemy, dmg, 'crit'); updateBars();
    await message('斬撃スキル！', 600); await delay(300);
  }
  async function useItem() {
    sfx('heal');
    const heal = 30;
    stats.hp = Math.min(stats.maxHp, stats.hp + heal);
    showDamage(hero, heal, 'heal'); updateBars();
    await message('やくそうで回復した', 600);
  }
  async function enemyTurn() {
    await message(edata.name + 'の こうげき！', 600);
    sfx('attack'); await lunge(enemy, -1);
    const dmg = rand(edata.atk - 2, edata.atk + 3);
    stats.hp -= dmg; sfx('hit'); shakeT = 0.3;
    showDamage(hero, dmg); updateBars();
    await delay(420);
  }

  let active = false;
  // 毎フレーム呼ばれる（メインループから）
  function update(dt, t) {
    const sway = Math.sin(t * 2) * 0.05;
    hero.position.y = 2.4 + sway; hero.rotation.y = bYaw;        // 常にカメラを向く
    if (edata) enemy.position.y = edata.y + Math.sin(t * 1.6) * (edata.sprite === 'bat' ? 0.35 : 0.12);
    enemy.rotation.y = bYaw;
    // ヒットの揺れ
    let shx = 0;
    if (shakeT > 0) { shakeT -= dt; shx = Math.sin(shakeT * 80) * shakeT * 1.2; }
    // 旋回カメラ（ドラッグ/ピンチで bYaw, bDist が変わる）
    const h = Math.cos(0.32);
    cam.position.set(Math.sin(bYaw) * bDist * h + shx, BHEIGHT, Math.cos(bYaw) * bDist * h);
    cam.lookAt(0, 2.2, 0);
    bokeh.uniforms['focus'].value = bDist;
  }

  async function start(enemyType, heroStats) {
    edata = ENEMIES[enemyType] || ENEMIES.slime;
    eMax = eHP = edata.hp; stats = heroStats;
    enemyMat.map = P.enemySprite(edata.sprite);
    enemyMat.needsUpdate = true;
    enemy.scale.set(edata.scale, edata.scale, 1);
    enemyNameEl.textContent = edata.name;
    bYaw = 0; bDist = 13; pointers.clear(); bPinch = null;
    updateBars(); setMenu(false); clearMsg();

    // パスをバトルシーンへ
    const prevScene = renderPass.scene, prevCam = renderPass.camera;
    renderPass.scene = scene; renderPass.camera = cam;
    bokeh.scene = scene; bokeh.camera = cam;
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    battleUI.style.display = 'block';
    setMood('battle'); active = true;

    await message(edata.name + 'が あらわれた！', 900); clearMsg(); await delay(150);

    let result = null;
    while (!result) {
      setMenu(true);
      const act = await waitCommand();
      setMenu(false);
      if (act === 'attack') await heroAttack();
      else if (act === 'skill') {
        if (stats.sp >= 5) { stats.sp -= 5; updateBars(); await heroSkill(); }
        else { await message('SPが たりない！', 600); continue; }
      } else if (act === 'item') {
        if (stats.potions > 0) { stats.potions--; await useItem(); }
        else { await message('やくそうが ない！', 600); continue; }
      } else if (act === 'flee') {
        sfx('cancel'); await message('にげだした…', 600);
        if (Math.random() < 0.6) { result = 'flee'; break; }
        await message('まわりこまれた！', 600);
      }
      clearMsg();
      if (eHP <= 0) { result = 'win'; break; }
      await enemyTurn();
      clearMsg();
      if (stats.hp <= 0) { result = 'lose'; break; }
    }

    if (result === 'win') {
      sfx('victory');
      await message(edata.name + 'を たおした！', 1100);
      await message(`経験値 ${edata.exp} を得た！`, 1100);
    } else if (result === 'lose') {
      sfx('defeat');
      await message('旅人は たおれてしまった…', 1400);
    }
    clearMsg();

    // パス復帰
    renderPass.scene = prevScene; renderPass.camera = prevCam;
    bokeh.scene = prevScene; bokeh.camera = prevCam;
    battleUI.style.display = 'none';
    active = false;
    return result;
  }

  return { scene, cam, start, update, isActive: () => active };
}
