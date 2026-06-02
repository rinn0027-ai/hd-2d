// audio.js — Web Audioで全効果音/BGMを合成（音源ファイル不要）
let ctx = null, master = null, bgmGain = null, sfxGain = null;
let bgmTimer = null, step = 0, mood = 'day';
let enabled = true;

export function audioReady() { return !!ctx; }
export function setEnabled(v) {
  enabled = v;
  if (master) master.gain.value = v ? 0.32 : 0.0;
}

// 最初のユーザー操作で初期化/再開（自動再生制限対策）
export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = enabled ? 0.32 : 0; master.connect(ctx.destination);
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
// 昼=明るい長調アルペジオ / 夜=穏やかな短調
const SONGS = {
  day:   { tempo: 300, scale: [262, 330, 392, 523, 392, 330], bass: [131, 131, 196, 196], wave: 'triangle' },
  night: { tempo: 420, scale: [220, 262, 330, 262, 196, 262], bass: [110, 110, 147, 98], wave: 'sine' },
  battle:{ tempo: 200, scale: [294, 349, 440, 587, 440, 349], bass: [147, 147, 175, 196], wave: 'sawtooth' },
};
function bgmNote(freq, dur, wave, vol) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1400;
  o.type = wave; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(bgmGain); o.start(t); o.stop(t + dur + 0.05);
}
function startBGM() {
  if (bgmTimer) clearInterval(bgmTimer);
  const tick = () => {
    const s = SONGS[mood] || SONGS.day;
    const mel = s.scale[step % s.scale.length];
    bgmNote(mel, s.tempo / 1000 * 1.4, s.wave, 0.18);
    if (step % 2 === 0) bgmNote(s.bass[(step / 2) % s.bass.length | 0], s.tempo / 1000 * 2, 'triangle', 0.16);
    if (step % 4 === 2) bgmNote(mel * 2, s.tempo / 1000, s.wave, 0.08); // 上のハモり
    step++;
    bgmTimer = setTimeout(tick, (SONGS[mood] || SONGS.day).tempo);
  };
  tick();
}
export function setMood(m) { if (m !== mood) { mood = m; step = 0; } }
