// Procedural sound design for the activation sequence: everything is synthesised with Web Audio at run
// time (oscillators, filtered noise, a generated reverb), so no audio file ships with the app.
// Timeline (seconds after the click): power-up swell from 0 · fast keyboard typing that follows the text
// on screen (key() per character) · IGNITION impact + pad · READY robotic "online" signature.
// Everything goes through a limiter at a modest level.

export const IGNITION = 2.3;    // s: impact, synced with the orb flash and the shockwave (see app.js)
export const READY = 3.3;       // s: robotic "systems online" signature, with the last line on screen

function noiseBuffer(ctx, seconds) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Small synthetic hall: exponentially decaying stereo noise. */
function reverb(ctx, seconds = 2.2) {
  const len = Math.ceil(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  const c = ctx.createConvolver(); c.buffer = b; return c;
}

const env = (g, t, a, peak, hold, rel) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
};

/** Starts the soundtrack on `ctx` (already resumed) and returns the cues driven by the visual sequence:
 * key(char) for each typed character, ignite() at the orb flash, ready() for the final line. Each cue
 * takes an optional start time (seconds on the ctx clock) so the whole thing can be rendered offline. */
export function bootSfx(ctx, volume = 0.5) {
  const t0 = ctx.currentTime + 0.02;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.25;
  const master = ctx.createGain(); master.gain.value = volume;
  master.connect(limiter).connect(ctx.destination);
  const hall = reverb(ctx), wet = ctx.createGain(); wet.gain.value = 0.35;
  hall.connect(wet).connect(master);
  /** Entry point for a sound: dry to the master, plus `send` of it into the reverb. */
  const bus = (level = 1, send = 0.3) => {
    const g = ctx.createGain(); g.gain.value = level; g.connect(master);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(hall); }
    return g;
  };
  const noise = noiseBuffer(ctx, 1.5);

  // Power-up under the typing: a sub swell rising in pitch and a band-passed "air" sweep, peaking at ignition.
  {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(32, t0); o.frequency.exponentialRampToValueAtTime(58, t0 + IGNITION);
    env(g, t0, IGNITION * 0.95, 0.45, 0.02, 0.2);
    o.connect(g).connect(bus(1, 0)); o.start(t0); o.stop(t0 + IGNITION + 0.3);
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
    n.buffer = noiseBuffer(ctx, IGNITION + 0.3); f.type = "bandpass"; f.Q.value = 6;
    f.frequency.setValueAtTime(180, t0); f.frequency.exponentialRampToValueAtTime(5200, t0 + IGNITION);
    env(gn, t0, IGNITION * 0.97, 0.16, 0, 0.1);
    n.connect(f).connect(gn).connect(bus(1, 0.4)); n.start(t0);
  }

  // Keyboard: each key = a short band-passed noise click (the keycap) over a tiny low "thock" (the switch
  // bottoming out); a space is the wider, lower space bar. Rate-limited so a burst stays a fast typist.
  const keyBus = bus(1, 0.12);
  let lastKey = 0;
  const key = (ch = "a", at) => {
    const t = at ?? ctx.currentTime;
    if (t - lastKey < 0.022) return;
    lastKey = t;
    const space = ch === " ", n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise; f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.value = space ? 1300 : 2400 + Math.random() * 2200;
    env(g, t, 0.001, (space ? 0.28 : 0.2) + Math.random() * 0.12, 0.004, space ? 0.05 : 0.028);
    n.connect(f).connect(g).connect(keyBus); n.start(t, Math.random() * 1.2, 0.08);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(space ? 150 : 210 + Math.random() * 60, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.03);
    env(og, t, 0.001, space ? 0.22 : 0.12, 0, 0.03);
    o.connect(og).connect(keyBus); o.start(t); o.stop(t + 0.05);
  };

  // Ignition: pitched-down thump, bright noise crack and a pad (detuned saws, A minor add9) that opens.
  const ignite = (at) => {
    const t = at ?? ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.45);
    env(g, t, 0.005, 1.0, 0.02, 0.6);
    o.connect(g).connect(bus(1, 0.25)); o.start(t); o.stop(t + 0.8);
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), gn = ctx.createGain();
    n.buffer = noise; hp.type = "highpass"; hp.frequency.value = 2500;
    env(gn, t, 0.003, 0.3, 0, 0.8);
    n.connect(hp).connect(gn).connect(bus(1, 0.8)); n.start(t);
    const lp = ctx.createBiquadFilter(), pg = ctx.createGain(), tp = t + 0.05;
    lp.type = "lowpass"; lp.Q.value = 4; lp.frequency.setValueAtTime(300, tp); lp.frequency.exponentialRampToValueAtTime(3800, tp + 1.2);
    lp.frequency.exponentialRampToValueAtTime(900, tp + 2.6);
    env(pg, tp, 0.35, 0.11, 0.8, 1.5);
    lp.connect(pg).connect(bus(1, 0.9));
    for (const f of [110, 220, 329.63, 440, 493.88, 659.25]) for (const det of [-7, 7]) {
      const s = ctx.createOscillator(); s.type = "sawtooth"; s.frequency.value = f; s.detune.value = det;
      s.connect(lp); s.start(tp); s.stop(tp + 3.0);
    }
  };

  // Ready: robotic signature — a servo whir (wobbling sawtooth sweeping up), a ring-modulated square
  // arpeggio (metallic, vocoder-like), then a mechanical "lock" (low square pulse + noise tick).
  const ready = (at) => {
    const t = at ?? ctx.currentTime;
    { // servo
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(330, t + 0.32);
      lfo.frequency.value = 22; depth.gain.value = 18; lfo.connect(depth).connect(o.frequency);
      f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 2.5;
      env(g, t, 0.02, 0.16, 0.22, 0.1);
      o.connect(f).connect(g).connect(bus(1, 0.3)); o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
    }
    // ring-modulated arpeggio: carrier notes multiplied by a 70 Hz sine -> inharmonic, "robot voice" timbre
    [[523.25, 0.34], [659.25, 0.42], [783.99, 0.5], [1046.5, 0.58]].forEach(([freq, dt]) => {
      const ts = t + dt, o = ctx.createOscillator(), ring = ctx.createGain(), mod = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = freq; mod.frequency.value = 70;
      ring.gain.value = 0; mod.connect(ring.gain); o.connect(ring);
      lp.type = "lowpass"; lp.frequency.value = 3200;
      env(g, ts, 0.004, 0.2, 0.045, 0.05);
      ring.connect(lp).connect(g).connect(bus(1, 0.4)); o.start(ts); mod.start(ts); o.stop(ts + 0.12); mod.stop(ts + 0.12);
    });
    { // lock
      const tl = t + 0.7, o = ctx.createOscillator(), g = ctx.createGain(), n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), gn = ctx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(90, tl); o.frequency.exponentialRampToValueAtTime(55, tl + 0.08);
      env(g, tl, 0.002, 0.25, 0.03, 0.08);
      o.connect(g).connect(bus(1, 0.35)); o.start(tl); o.stop(tl + 0.15);
      n.buffer = noise; hp.type = "highpass"; hp.frequency.value = 4000;
      env(gn, tl, 0.001, 0.25, 0, 0.03);
      n.connect(hp).connect(gn).connect(bus(1, 0.2)); n.start(tl, 0.3, 0.05);
    }
  };
  return { key, ignite, ready };
}
