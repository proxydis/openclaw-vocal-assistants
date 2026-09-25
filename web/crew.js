// Crew rail: one node per agent + a scrolling "pulse lane" that draws what the agent has been
// doing for the last 45 s. No text beyond a two-word label — the shape of the line tells the story:
//   flat dim = idle · dashed = busy in another channel · wavy glow = thinking
//   bright spikes = tool calls · dense bars = speaking
import { sigilSvg } from "./sigil.js";

const WINDOW_MS = 45000;
const STATE_LABEL = { idle: "", thinking: "réflexion", tool: "", speaking: "parle" };

export class Crew {
  constructor(root, onSelect) {
    this.root = root; this.onSelect = onSelect; this.nodes = new Map();
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setAgents(agents) {
    this.root.replaceChildren();
    this.nodes.clear();
    for (const a of agents) {
      const el = document.createElement("button");
      el.className = "crew-node"; el.dataset.id = a.id; el.style.setProperty("--c", a.color);
      el.innerHTML = `<span class="ring">${a.avatar ? `<img src="${a.avatar}" alt="">` : sigilSvg(a.name, a.color)}<i class="badge"></i></span>
        <span class="meta"><b>${a.name}</b><em></em></span><canvas class="lane" width="300" height="56"></canvas>`;
      el.addEventListener("click", () => this.onSelect(a.id));
      this.root.append(el);
      const node = { a, el, label: el.querySelector("em"), canvas: el.querySelector("canvas"), segments: [], ticks: [], status: "idle", elsewhere: false, since: performance.now() };
      node.ctx = node.canvas.getContext("2d");
      this.nodes.set(a.id, node);
      this.update(a.id, a);
    }
  }

  update(id, { status, tool, busyElsewhere }) {
    const n = this.nodes.get(id); if (!n) return;
    const now = performance.now();
    if (status !== n.status || busyElsewhere !== n.elsewhere) {
      n.segments.push({ from: n.since, to: now, status: n.status, elsewhere: n.elsewhere });
      n.since = now; n.status = status; n.elsewhere = Boolean(busyElsewhere);
    }
    n.el.dataset.status = status;
    n.el.classList.toggle("elsewhere", n.elsewhere && status === "idle");
    n.label.textContent = status === "tool" ? tool?.label ?? "outil" : STATE_LABEL[status] || (n.elsewhere ? "occupé ailleurs" : "");
  }

  pulse(id, tool) {
    const n = this.nodes.get(id); if (!n) return;
    n.ticks.push({ t: performance.now(), icon: tool?.icon });
    n.el.classList.remove("ping"); void n.el.offsetWidth; n.el.classList.add("ping");
  }

  setActive(id) { for (const [k, n] of this.nodes) n.el.classList.toggle("active", k === id); }

  setAvatar(id, url) {
    const n = this.nodes.get(id); if (!n) return;
    n.a.avatar = url;
    n.el.querySelector(".ring img, .ring .sigil")?.remove();
    n.el.querySelector(".ring").insertAdjacentHTML("afterbegin", url ? `<img src="${url}" alt="">` : sigilSvg(n.a.name, n.a.color));
  }

  draw() {
    if (document.hidden) return;
    const now = performance.now();
    for (const n of this.nodes.values()) {
      if (!n.canvas.offsetParent) continue; // lanes hidden on small screens
      const c = n.ctx, W = n.canvas.width, H = n.canvas.height, mid = H / 2;
      const x = (t) => W - ((now - t) / WINDOW_MS) * W;
      n.segments = n.segments.filter((s) => s.to > now - WINDOW_MS);
      n.ticks = n.ticks.filter((k) => k.t > now - WINDOW_MS);
      c.clearRect(0, 0, W, H);
      const color = n.a.color;
      const fade = c.createLinearGradient(0, 0, W, 0);
      fade.addColorStop(0, "transparent"); fade.addColorStop(0.35, color); fade.addColorStop(1, color);
      c.strokeStyle = fade; c.lineCap = "round";
      for (const s of [...n.segments, { from: n.since, to: now, status: n.status, elsewhere: n.elsewhere }]) {
        const x0 = Math.max(0, x(s.from)), x1 = x(s.to);
        if (x1 <= x0) continue;
        c.beginPath(); c.setLineDash([]); c.shadowBlur = 0; c.globalAlpha = 1;
        if (s.status === "idle") {
          c.globalAlpha = s.elsewhere ? 0.55 : 0.28; c.lineWidth = 2;
          if (s.elsewhere) c.setLineDash([3, 9]);
          c.moveTo(x0, mid); c.lineTo(x1, mid);
        } else if (s.status === "speaking") {
          c.lineWidth = 3; c.shadowColor = color; c.shadowBlur = 10;
          for (let px = x0; px < x1; px += 7) {
            const h = 5 + 15 * Math.abs(Math.sin(px * 0.35 + s.from) * Math.sin(px * 0.11 + now / 300));
            c.moveTo(px, mid - h); c.lineTo(px, mid + h);
          }
        } else {
          c.lineWidth = 2.5; c.shadowColor = color; c.shadowBlur = 12;
          for (let px = x0; px <= x1; px += 3) {
            const y = mid + Math.sin(px * 0.09 + now / 260) * 6 * Math.sin((px - x0) * 0.02 + 1);
            px === x0 ? c.moveTo(px, y) : c.lineTo(px, y);
          }
        }
        c.stroke();
      }
      c.setLineDash([]); c.globalAlpha = 1;
      for (const k of n.ticks) {
        const px = x(k.t), age = (now - k.t) / 1000, pop = Math.max(0, 1 - age * 1.5);
        c.beginPath(); c.strokeStyle = "#fff"; c.shadowColor = color; c.shadowBlur = 14 + pop * 14; c.lineWidth = 2.5;
        c.globalAlpha = Math.min(1, px / (W * 0.3));
        c.moveTo(px, mid - 12 - pop * 8); c.lineTo(px, mid + 12 + pop * 8); c.stroke();
        c.beginPath(); c.fillStyle = color; c.arc(px, mid - 16 - pop * 8, 3, 0, 7); c.fill();
      }
      c.globalAlpha = 1; c.shadowBlur = 0;
    }
  }
}
