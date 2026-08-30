/* ==========================================================================
   sound.js — 翻页纸声 / 开书声（Web Audio 合成，不联网）
   ========================================================================== */

let ctx = null;
let enabled = true;

export function setSoundEnabled(v) { enabled = v; }

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** 纸张沙沙声（翻页） */
export function flipSound() {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  try {
    const t = c.currentTime;
    const dur = 0.22;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.4);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.75;
    bp.frequency.setValueAtTime(1900, t);
    bp.frequency.exponentialRampToValueAtTime(430, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
  } catch { /* 忽略音频错误 */ }
}

/** 开书/合书的低沉"扑"声 */
export function thudSound() {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  try {
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(g); g.connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  } catch { }
}

/** 写字的"沙沙"短音（保存成功提示，很轻） */
export function penTap() {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  try {
    const t = c.currentTime;
    const dur = 0.08;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(g); g.connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  } catch { }
}
