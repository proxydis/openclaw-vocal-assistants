// Small visual effects: holographic parallax, activation boot sequence, spectrum banding.

/** Layers follow the pointer (desktop) or the device tilt (mobile): [element, amplitude px]. */
export class Parallax {
  constructor(layers) {
    this.layers = layers.filter(([el]) => el); this.tx = 0; this.ty = 0; this.x = 0; this.y = 0;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { this.tx = (e.clientX / innerWidth - 0.5) * 2; this.ty = (e.clientY / innerHeight - 0.5) * 2; } }, { passive: true });
    addEventListener("deviceorientation", (e) => { if (e.gamma != null) { this.tx = Math.max(-1, Math.min(1, e.gamma / 25)); this.ty = Math.max(-1, Math.min(1, (e.beta - 40) / 25)); } }, { passive: true });
    const loop = () => { this.x += (this.tx - this.x) * 0.06; this.y += (this.ty - this.y) * 0.06;
      for (const [el, amp] of this.layers) el.style.transform = `translate3d(${(this.x * amp).toFixed(2)}px, ${(this.y * amp).toFixed(2)}px, 0)`;
      requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

/** Activation sequence: status lines typed out like a terminal (a blinking cursor, one `onKey(char)` per
 * character so the keyboard sound follows the text), a progress bar, then a final ready line. Only things
 * the app itself owns — never machine facts. Resolves once the overlay is gone (readyAt + 1 s). */
export function bootSequence(root, agentNames, linkUp, { onKey = () => {}, typeUntil = 2100, readyAt = 3300 } = {}) {
  const lines = [["Interface vocale", "en ligne"], ["Liaison Gateway OpenClaw", linkUp ? "établie" : "en attente"],
    ["Reconnaissance vocale", "locale · GPU"], ["Synthèse vocale", "locale"], [`${agentNames.length} agents`, agentNames.join(" · ")]];
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.replaceChildren(); root.hidden = false; root.classList.remove("fade");
  const bar = document.createElement("i"); bar.className = "bar"; root.append(bar);
  // One flat stream of characters: [line, field (0 = label, 1 = value), char].
  const stream = lines.flatMap(([k, v], li) => [...[...k].map((c) => [li, 0, c]), ...[...v].map((c) => [li, 1, c])]);
  const rows = [];
  const row = (li) => rows[li] ?? (rows[li] = (() => {
    const p = document.createElement("p"); p.className = lines[li][1] === "en attente" ? "wait" : "ok";
    p.innerHTML = "<span></span><b></b>"; root.append(p); return p;
  })());
  const start = 150, per = Math.max(4, (typeUntil - start) / stream.length);
  let shown = 0, t0 = performance.now(), cursor = null;
  const tick = (now) => {
    const want = calm ? stream.length : Math.min(stream.length, Math.floor((now - t0 - start) / per));
    for (; shown < want; shown++) {
      const [li, field, ch] = stream[shown], el = row(li).children[field];
      el.textContent += ch;
      if (cursor !== el) { cursor?.classList.remove("typing"); el.classList.add("typing"); cursor = el; }
      onKey(ch);
    }
    bar.style.setProperty("--p", (shown / stream.length).toFixed(3));
    if (shown < stream.length) requestAnimationFrame(tick);
    else cursor?.classList.remove("typing");
  };
  requestAnimationFrame(tick);
  setTimeout(() => {
    const p = document.createElement("p"); p.className = "ready"; p.textContent = "Systèmes en ligne"; root.append(p);
  }, readyAt);
  setTimeout(() => root.classList.add("fade"), readyAt + 700);
  return new Promise((done) => setTimeout(() => { root.hidden = true; done(); }, readyAt + 1000));
}

/** 256 FFT bins (bytes) → 64 bands, log-spaced, with a noise floor cut. */
const bandBins = Array.from({ length: 64 }, (_, i) => Math.min(200, Math.floor(Math.pow(i / 64, 1.7) * 200) + 1));
const out = new Uint8Array(64);
export function spectrumBands(freq, floor = 0) {
  for (let i = 0; i < 64; i++) {
    const a = bandBins[i], b = Math.max(a + 1, bandBins[i + 1] ?? a + 2);
    let m = 0; for (let k = a; k < b; k++) m = Math.max(m, freq[k]);
    out[i] = Math.max(0, Math.min(255, (m - floor) * (255 / (255 - floor))));
  }
  return out;
}
