// audio.js — Web Audioで全効果音/BGMを合成（音源ファイル不要）
let ctx = null, master = null, bgmGain = null, sfxGain = null;
let bgmTimer = null, step = 0, mood = 'day';
let enabled = true, vol = 1;

export function audioReady() { return !!ctx; }
export function setEnabled(v) {
  enabled = v;
  if (master) master.gain.value = v ? 0.32 * vol : 0.0;
}
export function setVolume(v) {
  vol = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = enabled ? 0.32 * vol : 0.0;
}

// 最初のユーザー操作で初期化/再開（自動再生制限対策）
export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = enabled ? 0.32 * vol : 0; master.connect(ctx.destination);
  bgmGain = ctx.createGain(); bgmGain.gain.value = 0.55; bgmGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
  startBGM();
}

// ---- 効果音 ----
function blip(freq, dur, type = 'square', vol = 0.3, slideTo = null) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + dur + 0.02);
}
function noiseHit(dur = 0.18, vol = 0.4) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
  const g = ctx.createGain(); g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f); f.connect(g); g.connect(sfxGain); n.start(t);
}

export function sfx(name) {
  if (!ctx) return;
  switch (name) {
    case 'step':    blip(180 + Math.random() * 40, 0.06, 'triangle', 0.12); break;
    case 'confirm': blip(660, 0.08, 'square', 0.25); blip(990, 0.1, 'square', 0.2); break;
    case 'cancel':  blip(400, 0.1, 'square', 0.22, 220); break;
    case 'cursor':  blip(880, 0.04, 'square', 0.15); break;
    case 'encounter': blip(140, 0.5, 'sawtooth', 0.35, 1200); noiseHit(0.5, 0.25); break;
    case 'attack':  blip(300, 0.08, 'square', 0.25, 120); noiseHit(0.12, 0.35); break;
    case 'hit':     noiseHit(0.16, 0.4); blip(200, 0.12, 'square', 0.2, 80); break;
    case 'skill':   blip(500, 0.25, 'sawtooth', 0.25, 1400); break;
    case 'heal':    blip(520, 0.12, 'sine', 0.25); blip(780, 0.15, 'sine', 0.22); blip(1040, 0.2, 'sine', 0.2); break;
    case 'victory': [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'square', 0.25), i * 110)); break;
    case 'defeat':  [392, 330, 262, 196].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sawtooth', 0.22), i * 180)); break;
    case 'chest':   [659, 880, 1175].forEach((f, i) => setTimeout(() => blip(f, 0.14, 'square', 0.22), i * 90)); break;
  }
}

// ---- BGM（簡易シーケンサ） ----
// 16ステップ(8分音符)の旋律パターン + 4コードのベース進行 + ドラム
// 0 = 休符
const SONGS = {
  day:   { tempo: 215, wave: 'triangle', drums: true,
    mel:  [392, 0, 330, 392, 440, 0, 392, 330, 349, 0, 294, 349, 392, 0, 440, 392],
    bass: [131, 196, 220, 175] },                                 // C G Am F
  night: { tempo: 300, wave: 'sine', drums: false,
    mel:  [330, 0, 294, 0, 262, 0, 294, 330, 247, 0, 220, 0, 262, 0, 0, 0],
    bass: [110, 98, 131, 110] },                                  // Am G C Am
  snow:  { tempo: 200, wave: 'sine', drums: true,
    mel:  [523, 494, 587, 0, 659, 587, 494, 0, 440, 494, 587, 0, 523, 0, 659, 0],
    bass: [131, 175, 196, 147] },                                 // C F G Dm(明るい)
  lava:  { tempo: 190, wave: 'sawtooth', drums: true,
    mel:  [175, 0, 175, 208, 196, 0, 175, 0, 147, 0, 175, 208, 233, 0, 196, 0],
    bass: [87, 87, 116, 98], lp: 900 },                           // 低く重い
  alien: { tempo: 205, wave: 'square', drums: true,
    mel:  [311, 0, 370, 415, 0, 370, 311, 0, 277, 415, 0, 466, 415, 0, 370, 0],
    bass: [104, 139, 117, 156], lp: 1100 },                       // 不協和
  battle:{ tempo: 170, wave: 'sawtooth', drums: true,
    mel:  [294, 349, 440, 349, 587, 440, 349, 294, 330, 392, 494, 392, 294, 0, 587, 0],
    bass: [147, 147, 175, 196] },
};
function bgmNote(freq, dur, wave, vol, lp = 1500) {
  if (!ctx || !freq) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = lp;
  o.type = wave; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(bgmGain); o.start(t); o.stop(t + dur + 0.05);
}
function drum(kind) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (kind === 'kick') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(bgmGain); o.start(t); o.stop(t + 0.18);
  } else {
    const dur = kind === 'snare' ? 0.16 : 0.04;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const n = ctx.createBufferSource(); n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = kind === 'snare' ? 1100 : 6500;
    const g = ctx.createGain(); g.gain.setValueAtTime(kind === 'snare' ? 0.22 : 0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(bgmGain); n.start(t);
  }
}
function startBGM() {
  if (bgmTimer) clearTimeout(bgmTimer);
  const tick = () => {
    const s = SONGS[mood] || SONGS.day;
    const i = step % 16, beat = s.tempo / 1000;
    const mel = s.mel[i];
    if (mel) { bgmNote(mel, beat * 1.7, s.wave, 0.15, s.lp || 1500); if (i % 8 === 0) bgmNote(mel * 2, beat * 1.4, s.wave, 0.05); }
    if (i % 4 === 0) bgmNote(s.bass[(i / 4) % 4], beat * 3.6, 'triangle', 0.2, 700);   // ベース（コード根音）
    if (s.drums) { if (i % 4 === 0) drum('kick'); if (i === 4 || i === 12) drum('snare'); if (i % 2 === 1) drum('hat'); }
    step++;
    bgmTimer = setTimeout(tick, s.tempo);
  };
  tick();
}
export function setMood(m) { if (m !== mood) { mood = m; step = 0; } }
