// Synthesize all sound effects + an ambient pad bed as 16-bit PCM WAV files.
import { writeFileSync } from "fs";

const SR = 44100;

function toWav(samples) {
  // samples: Float32 array in [-1,1], mono
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

const T = (d) => Math.floor(d * SR);
const env = (i, n, atk, rel) => {
  const a = Math.min(1, i / (atk * SR));
  const r = Math.min(1, (n - i) / (rel * SR));
  return Math.max(0, Math.min(a, r));
};

// soft clip / tanh
const sat = (x) => Math.tanh(x);

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

function write(name, samples) {
  writeFileSync(`public/audio/${name}.wav`, toWav(samples));
  console.log(name, (samples.length / SR).toFixed(2) + "s");
}

// ---------- POP (UI element appears) ----------
{
  const d = 0.2, n = T(d), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 520 + 300 * Math.exp(-30 * t); // tiny upward chirp
    const e = Math.exp(-22 * t);
    out[i] = 0.5 * Math.sin(2 * Math.PI * f * t) * e;
  }
  write("pop", out);
}

// ---------- TICK (bullet / checklist) ----------
{
  const d = 0.08, n = T(d), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = Math.exp(-70 * t);
    out[i] = (0.5 * Math.sin(2 * Math.PI * 1600 * t) + 0.2 * Math.sin(2 * Math.PI * 2400 * t)) * e;
  }
  write("tick", out);
}

// ---------- WHOOSH (3D transition) ----------
{
  const d = 0.55, n = T(d), out = new Float32Array(n);
  const rnd = rng(7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t / d;
    const noise = rnd();
    // band emphasis that sweeps up then down
    const sweep = Math.sin(2 * Math.PI * (300 + 1500 * p) * t) * 0.25;
    const e = Math.sin(Math.PI * p); // swell
    out[i] = sat((noise * 0.5 + sweep) * e) * 0.5;
  }
  write("whoosh", out);
}

// ---------- RISER (tension before phone reveal) ----------
{
  const d = 1.0, n = T(d), out = new Float32Array(n);
  const rnd = rng(21);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = t / d;
    const f = 160 + 900 * p * p;
    const tone = Math.sin(2 * Math.PI * f * t);
    const noise = rnd() * 0.3 * p;
    const e = p * p; // ramp up
    out[i] = sat((tone * 0.5 + noise) * e) * 0.5;
  }
  // hard-ish cut at end
  write("riser", out);
}

// ---------- IMPACT (logo / outro hit) ----------
{
  const d = 0.5, n = T(d), out = new Float32Array(n);
  const rnd = rng(99);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const sub = Math.sin(2 * Math.PI * (90 - 30 * t) * t) * Math.exp(-7 * t);
    const click = rnd() * Math.exp(-60 * t) * 0.5;
    out[i] = sat(sub * 0.9 + click) * 0.7;
  }
  write("impact", out);
}

// ---------- DING (success / 92% reveal) ----------
{
  const d = 1.3, n = T(d), out = new Float32Array(n);
  const partials = [
    [880, 1.0], [1320, 0.6], [1760, 0.4], [2640, 0.18],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const [f, a] of partials) s += a * Math.sin(2 * Math.PI * f * t);
    const e = Math.exp(-3.2 * t);
    out[i] = sat(s * 0.18) * e;
  }
  write("ding", out);
}

// ---------- PAD BED (ambient music, loops under everything) ----------
{
  const d = 13.0, n = T(d), out = new Float32Array(n);
  // warm minor-ish chord that gently evolves: A2 chord stack
  const chord = [110, 164.81, 220, 329.63, 440]; // A, E, A, E, A — open, airy
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < chord.length; k++) {
      const detune = 1 + 0.0015 * Math.sin(2 * Math.PI * 0.07 * t + k);
      const vib = Math.sin(2 * Math.PI * chord[k] * detune * t);
      const amp = (k === 0 ? 0.5 : 0.3) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.05 * t + k * 1.7));
      s += vib * amp;
    }
    // slow tremolo + warmth
    const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.25 * t);
    const e = env(i, n, 1.5, 1.5);
    out[i] = sat(s * 0.06) * trem * e;
  }
  write("pad", out);
}

console.log("done");
