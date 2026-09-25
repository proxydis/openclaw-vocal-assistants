// Ambient backdrop: slow drifting motes + a faint polar grid, tinted by the active agent.
// 2D canvas at ~30 fps and half resolution: visible depth for almost no GPU/CPU cost.
export class Backdrop {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.color = "#38bdf8";
    this.motes = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random() * 0.8, p: Math.random() * 6.28 }));
    new ResizeObserver(() => this.resize()).observe(canvas); this.resize();
    let last = 0;
    const loop = (now) => { if (now - last > 33 && !document.hidden) { last = now; this.draw(now / 1000); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  setColor(c) { this.color = c; }
  resize() { const r = this.c.getBoundingClientRect(); this.c.width = Math.round(r.width / 2); this.c.height = Math.round(r.height / 2); }
  draw(t) {
    const { ctx, c } = this, W = c.width, H = c.height, cx = W / 2, cy = H * 0.44;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = this.color; ctx.lineWidth = 1;
    const R = Math.hypot(W, H) / 2;
    for (let i = 1; i <= 6; i++) {
      ctx.globalAlpha = 0.05 * (1 - i / 8);
      ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 6 + Math.sin(t * 0.2 + i) * 3, 0, 6.2832); ctx.stroke();
    }
    ctx.globalAlpha = 0.035;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.2832 + t * 0.01;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.22, cy + Math.sin(a) * R * 0.22); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
    }
    ctx.fillStyle = this.color;
    for (const m of this.motes) {
      m.y -= 0.00035 * m.z; m.x += Math.sin(t * 0.3 + m.p) * 0.00015;
      if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      ctx.globalAlpha = (0.12 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.8 + m.p))) * m.z;
      ctx.beginPath(); ctx.arc(m.x * W, m.y * H, 0.6 + m.z * 1.1, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
