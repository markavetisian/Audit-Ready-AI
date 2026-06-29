// Premium sound design: a real musical bed (chord progression + arp + bass +
// soft drums) and reverb-tailed SFX, synthesized to stereo 16-bit WAV.
import { writeFileSync } from "fs";

const SR = 44100;
const clamp = (x) => Math.max(-1, Math.min(1, x));
const tanh = Math.tanh;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- WAV (stereo) ----------
function writeStereo(name, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE((clamp(L[i]) * 32767) | 0, o); o += 2;
    buf.writeInt16LE((clamp(R[i]) * 32767) | 0, o); o += 2;
  }
  writeFileSync(`public/audio/${name}.wav`, buf);
  console.log(name.padEnd(10), (n / SR).toFixed(2) + "s");
}

// ---------- DSP helpers ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }

function lowpass(buf, fc) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
  return buf;
}
function highpass(buf, fc) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = buf[i] - y; }
  return buf;
}
function adsr(buf, a, d, s, r, totalDur) {
  const n = buf.length, A = a * SR, D = d * SR, R = r * SR;
  const relStart = totalDur * SR - R;
  for (let i = 0; i < n; i++) {
    let e;
    if (i < A) e = i / A;
    else if (i < A + D) e = 1 - (1 - s) * ((i - A) / D);
    else if (i < relStart) e = s;
    else e = s * Math.max(0, 1 - (i - relStart) / R);
    buf[i] *= e;
  }
  return buf;
}

// oscillators
function osc(type, freq, n, detune = 0) {
  const out = new Float32Array(n);
  const f = freq * Math.pow(2, detune / 1200);
  for (let i = 0; i < n; i++) {
    const t = i / SR, ph = 2 * Math.PI * f * t;
    if (type === "sine") out[i] = Math.sin(ph);
    else if (type === "tri") {
      let s = 0; for (let k = 1; k <= 9; k += 2) s += (Math.pow(-1, (k - 1) / 2) / (k * k)) * Math.sin(k * ph);
      out[i] = s * (8 / (Math.PI * Math.PI));
    } else if (type === "saw") {
      let s = 0; for (let k = 1; k <= 12; k++) s += Math.sin(k * ph) / k;
      out[i] = s * (2 / Math.PI);
    }
  }
  return out;
}

// stereo Schroeder reverb
function reverb(inL, inR, mix = 0.3, decay = 0.8) {
  const n = inL.length;
  const wetL = new Float32Array(n), wetR = new Float32Array(n);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491];
  const fbk = decay;
  const make = (len) => ({ buf: new Float32Array(len), idx: 0 });
  const cl = combs.map((c) => make(c));
  const cr = combs.map((c) => make(c + 23));
  const apDelays = [556, 441, 341];
  const al = apDelays.map((c) => make(c));
  const ar = apDelays.map((c) => make(c + 11));
  const comb = (st, x) => { const y = st.buf[st.idx]; st.buf[st.idx] = x + y * fbk; st.idx = (st.idx + 1) % st.buf.length; return y; };
  const allpass = (st, x) => { const bufout = st.buf[st.idx]; const y = -x + bufout; st.buf[st.idx] = x + bufout * 0.5; st.idx = (st.idx + 1) % st.buf.length; return y; };
  for (let i = 0; i < n; i++) {
    let yl = 0, yr = 0;
    for (const c of cl) yl += comb(c, inL[i]);
    for (const c of cr) yr += comb(c, inR[i]);
    yl /= cl.length; yr /= cr.length;
    for (const a of al) yl = allpass(a, yl);
    for (const a of ar) yr = allpass(a, yr);
    wetL[i] = inL[i] * (1 - mix) + yl * mix;
    wetR[i] = inR[i] * (1 - mix) + yr * mix;
  }
  return [wetL, wetR];
}

// add mono voice into stereo track at sample offset with equal-power pan
function place(L, R, voice, offset, pan = 0, gain = 1) {
  const gl = Math.cos((pan + 1) * Math.PI / 4) * gain;
  const gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
  for (let i = 0; i < voice.length; i++) {
    const j = offset + i; if (j < 0 || j >= L.length) continue;
    L[j] += voice[i] * gl; R[j] += voice[i] * gr;
  }
}

// ============================================================
// MUSIC BED — D major, vi–IV–I–V, ~84 BPM, 9 bars + tail
// ============================================================
{
  const bpm = 84, beat = 60 / bpm, bar = beat * 4;
  const bars = 9, dur = bar * bars + 1.2;
  const n = Math.floor(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  // dry buses we will reverb
  const padL = new Float32Array(n), padR = new Float32Array(n);
  const arpL = new Float32Array(n), arpR = new Float32Array(n);

  // chords (midi) + bass root, per bar
  const C = {
    Bm: { t: [59, 62, 66], b: 35 },
    G: { t: [55, 59, 62], b: 31 },
    D: { t: [62, 66, 69], b: 38 },
    A: { t: [57, 61, 64], b: 33 },
  };
  const prog = [C.Bm, C.G, C.D, C.A, C.Bm, C.G, C.D, C.A, C.D];

  for (let bi = 0; bi < bars; bi++) {
    const ch = prog[bi];
    const off = Math.floor(bi * bar * SR);

    // PAD: warm sustained triad, soft saw+tri, heavy lowpass, slow swell
    for (let k = 0; k < ch.t.length; k++) {
      const f = midi(ch.t[k]);
      const len = Math.floor((bar + 0.7) * SR);
      const a = osc("saw", f, len, -7);
      const b = osc("tri", f, len, +7);
      const v = new Float32Array(len);
      for (let i = 0; i < len; i++) v[i] = (a[i] * 0.38 + b[i] * 0.82) * 0.5;
      lowpass(v, 1120);
      adsr(v, 0.55, 0.6, 0.9, 0.8, bar + 0.7);
      place(padL, padR, v, off, k === 0 ? -0.45 : k === 2 ? 0.45 : 0, 0.17);
    }

    // SUB BASS: smooth root, one long note per bar
    {
      const f = midi(ch.b);
      const len = Math.floor((bar + 0.2) * SR);
      const v = osc("sine", f, len);
      const v2 = osc("tri", f * 2, len);
      for (let i = 0; i < len; i++) v[i] = v[i] * 0.9 + v2[i] * 0.08;
      lowpass(v, 250);
      adsr(v, 0.08, 0.4, 0.7, 0.5, bar + 0.2);
      place(L, R, v, off, 0, 0.4);
    }

    // BELL PLUCK: sparse & tasteful — top chord tone on beat 1, fifth on beat 3
    const bells = [[0, ch.t[2] + 12], [2, ch.t[1] + 12]];
    for (const [bt, note] of bells) {
      const f = midi(note);
      const len = Math.floor(beat * 2.4 * SR);
      const s1 = osc("sine", f, len);
      const s2 = osc("sine", f * 2.01, len);
      const v = new Float32Array(len);
      for (let i = 0; i < len; i++) v[i] = (s1[i] * 0.7 + s2[i] * 0.22) * Math.exp(-2.5 * (i / SR));
      adsr(v, 0.004, 0.3, 0.0, 0.45, beat * 2.4);
      place(arpL, arpR, v, off + Math.floor(bt * beat * SR), bt === 0 ? -0.25 : 0.3, 0.08);
    }
  }

  // reverb pad and bell buses generously for a spacious, premium feel
  const [pRL, pRR] = reverb(padL, padR, 0.4, 0.86);
  const [aRL, aRR] = reverb(arpL, arpR, 0.52, 0.85);
  for (let i = 0; i < n; i++) {
    L[i] += pRL[i] + aRL[i];
    R[i] += pRR[i] + aRR[i];
  }
  // master: gentle fade in/out + soft limit
  const fin = 1.0 * SR, fout = 1.8 * SR;
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < fin) g = i / fin;
    if (i > n - fout) g = Math.max(0, (n - i) / fout);
    L[i] = tanh(L[i] * 1.05) * g * 0.85;
    R[i] = tanh(R[i] * 1.05) * g * 0.85;
  }
  writeStereo("music", L, R);
}

// ============================================================
// SFX (stereo, with reverb tails)
// ============================================================
function sfx(name, dur, fn, { rev = 0.18, decay = 0.7, gain = 1 } = {}) {
  const n = Math.floor(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  fn(L, R, n);
  const [rl, rr] = reverb(L, R, rev, decay);
  for (let i = 0; i < n; i++) { rl[i] = tanh(rl[i] * gain); rr[i] = tanh(rr[i] * gain); }
  writeStereo(name, rl, rr);
}

// POP — round soft blip with pitch drop
sfx("pop", 0.35, (L, R, n) => {
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 380 + 360 * Math.exp(-26 * t);
    const e = Math.exp(-16 * t);
    const s = (Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(4 * Math.PI * f * t) * 0.15) * e;
    L[i] = s; R[i] = s;
  }
  lowpass(L, 2600); lowpass(R, 2600);
}, { rev: 0.16, gain: 0.5 });

// TICK — soft short click
sfx("tick", 0.12, (L, R, n) => {
  const rnd = rng(5);
  for (let i = 0; i < n; i++) {
    const t = i / SR, e = Math.exp(-55 * t);
    const s = (Math.sin(2 * Math.PI * 900 * t) * 0.5 + rnd() * 0.3) * e;
    L[i] = s; R[i] = s;
  }
  lowpass(L, 4000); lowpass(R, 4000);
}, { rev: 0.12, gain: 0.4 });

// WHOOSH — filtered noise swoosh, stereo pan sweep
sfx("whoosh", 0.7, (L, R, n) => {
  const rnd = rng(13);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const env = Math.sin(Math.PI * p);
    const nz = rnd() * env;
    const pan = -1 + 2 * p; // L -> R
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    L[i] = nz * gl; R[i] = nz * gr;
  }
  // sweeping band: highpass rising
  highpass(L, 500); highpass(R, 500); lowpass(L, 5500); lowpass(R, 5500);
}, { rev: 0.25, decay: 0.75, gain: 0.5 });

// RISER — rising tone + noise, smooth build
sfx("riser", 1.1, (L, R, n) => {
  const rnd = rng(21);
  for (let i = 0; i < n; i++) {
    const t = i / SR, p = i / n;
    const f = 180 + 1000 * p * p;
    const tone = Math.sin(2 * Math.PI * f * t);
    const nz = rnd() * 0.35;
    const e = p * p;
    const s = (tone * 0.5 + nz) * e;
    L[i] = s; R[i] = s;
  }
  lowpass(L, 5000); lowpass(R, 5000);
}, { rev: 0.3, decay: 0.82, gain: 0.5 });

// IMPACT — deep soft boom with body + tail
sfx("impact", 0.9, (L, R, n) => {
  const rnd = rng(99);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const sub = Math.sin(2 * Math.PI * (120 * Math.exp(-9 * t) + 42) * t) * Math.exp(-5 * t);
    const body = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-14 * t) * 0.4;
    const click = rnd() * Math.exp(-50 * t) * 0.25;
    const s = sub * 0.95 + body + click;
    L[i] = s; R[i] = s;
  }
  lowpass(L, 1400); lowpass(R, 1400);
}, { rev: 0.26, decay: 0.84, gain: 0.7 });

// DING — pleasant inharmonic bell with long reverb tail
sfx("ding", 1.8, (L, R, n) => {
  const partials = [[1, 1.0], [2.01, 0.55], [3.03, 0.33], [4.21, 0.2], [5.43, 0.12]];
  const base = 880;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const [r, a] of partials) s += a * Math.sin(2 * Math.PI * base * r * t) * Math.exp(-2.4 * r * 0.5 * t);
    s *= 0.22;
    L[i] = s; R[i] = s;
  }
}, { rev: 0.4, decay: 0.86, gain: 0.5 });

// SPARKLE — quick ascending bell pings (for logo reveal)
sfx("sparkle", 1.0, (L, R, n) => {
  const notes = [88, 90, 93, 95, 100]; // midi, ascending
  for (let k = 0; k < notes.length; k++) {
    const f = midi(notes[k]);
    const start = Math.floor(k * 0.06 * SR);
    for (let i = 0; i + start < n; i++) {
      const t = i / SR, e = Math.exp(-9 * t);
      const s = Math.sin(2 * Math.PI * f * t) * e * 0.18;
      L[i + start] += s; R[i + start] += s;
    }
  }
}, { rev: 0.45, decay: 0.85, gain: 0.6 });

console.log("audio done");
