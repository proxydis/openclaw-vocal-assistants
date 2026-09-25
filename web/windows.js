// Floating windows opened by agents: detail panels (markdown) and browser windows (pages rendered by a
// headless Chrome on the server and streamed as JPEG frames; input is forwarded back).
// Each window carries the badge of the agent that opened it, can be dragged, resized, raised, closed.
import { renderMarkdown } from "./md.js";
import { sigilSvg } from "./sigil.js";

export class WindowManager {
  constructor(root, agents, send) { this.root = root; this.agents = agents; this.send = send ?? (() => {}); this.wins = new Map(); this.z = 10; this.n = 0; }

  /** spec: { key, agentId, kind: "detail"|"browser"|"history", title, markdown?, url?, node? } — same key = update in place. */
  open(spec) {
    let w = this.wins.get(spec.key);
    if (!w) { w = this.create(spec); this.wins.set(spec.key, w); }
    this.fill(w, spec);
    this.raise(w);
    return w;
  }

  /** Colour and badge of the agent a window belongs to (a history window switches agent in place). */
  setAgent(el, agentId) {
    const a = this.agents.get(agentId);
    el.dataset.agent = agentId; el.style.setProperty("--c", a?.color ?? "#38bdf8");
    const badge = el.querySelector(".badge");
    badge.title = a?.name ?? "";
    badge.innerHTML = a?.avatar ? `<img src="${a.avatar}" alt="">` : sigilSvg(a?.name ?? "?", a?.color ?? "#38bdf8");
  }

  create(spec) {
    const el = document.createElement("section");
    el.className = `win win-${spec.kind}`;
    el.innerHTML = `<header><span class="badge"></span>
      <span class="title"></span><span class="tools"><button class="back" title="Précédent" hidden>‹</button><button class="reload" title="Recharger" hidden>↻</button><button class="ext" title="Ouvrir dans un onglet" hidden>↗</button><button class="close" aria-label="Fermer">×</button></span></header><div class="body"></div>`;
    const k = this.n++ % 6;
    el.style.right = `${18 + k * 26}px`; el.style.top = `${70 + k * 30}px`;
    el.querySelector(".close").onclick = () => { if (spec.kind === "browser") this.send({ t: "win.close", key: spec.key }); this.close(spec.key); };
    el.addEventListener("pointerdown", () => this.raise(el), { capture: true });
    this.drag(el, el.querySelector("header"));
    el.classList.add("pop");
    this.setAgent(el, spec.agentId);
    this.root.append(el);
    return el;
  }

  fill(el, spec) {
    if (el.dataset.agent !== spec.agentId) this.setAgent(el, spec.agentId);
    el.querySelector(".title").textContent = spec.title ?? (spec.kind === "browser" ? spec.url : "");
    const body = el.querySelector(".body"), ext = el.querySelector(".ext");
    if (spec.kind === "browser") {
      el.url = spec.url; el.pageW = spec.w ?? 1024; el.pageH = spec.h ?? 680;
      ext.hidden = false; ext.onclick = () => window.open(el.url, "_blank", "noopener");
      const back = el.querySelector(".back"), reload = el.querySelector(".reload");
      back.hidden = reload.hidden = false;
      back.onclick = () => this.send({ t: "win.input", key: spec.key, kind: "back" });
      reload.onclick = () => this.send({ t: "win.input", key: spec.key, kind: "reload" });
      if (!body.querySelector(".view")) {
        body.innerHTML = `<div class="view" tabindex="0"><img alt="" draggable="false"><div class="wait"><i></i>chargement…</div></div><div class="urlbar"></div>`;
        const view = body.querySelector(".view"), img = view.querySelector("img");
        // Pointer coordinates are mapped from the displayed image to the remote viewport.
        const at = (e) => { const r = img.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) / r.width * el.pageW), y: Math.round((e.clientY - r.top) / r.height * el.pageH) }; };
        img.addEventListener("click", (e) => { view.focus(); this.send({ t: "win.input", key: spec.key, kind: "click", ...at(e) }); });
        view.addEventListener("wheel", (e) => { e.preventDefault(); this.send({ t: "win.input", key: spec.key, kind: "scroll", dy: e.deltaY, ...at(e) }); }, { passive: false });
        view.addEventListener("keydown", (e) => { if (e.key.length === 1 || ["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Delete"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); this.send({ t: "win.input", key: spec.key, kind: "key", key2: e.key === " " ? "Space" : e.key }); } });
        let touchY = null;
        view.addEventListener("touchstart", (e) => { touchY = e.touches[0].clientY; }, { passive: true });
        view.addEventListener("touchmove", (e) => { if (touchY != null) { const dy = touchY - e.touches[0].clientY; if (Math.abs(dy) > 12) { this.send({ t: "win.input", key: spec.key, kind: "scroll", dy: dy * 2 }); touchY = e.touches[0].clientY; } } }, { passive: true });
      }
      body.querySelector(".urlbar").textContent = spec.url;
    } else if (spec.kind === "history") {
      body.replaceChildren(spec.node);
    } else {
      body.innerHTML = `<article>${renderMarkdown(spec.markdown ?? "")}</article>`;
    }
  }

  raise(el) { el.style.zIndex = ++this.z; }

  /** New JPEG frame of a remote-rendered page. */
  frame(h, bytes) {
    const w = this.wins.get(h.key); if (!w) return;
    const img = w.querySelector(".view img"); if (!img) return; // not the avatar in the header
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    const old = img.src; img.src = url; if (old.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(old), 1000);
    w.querySelector(".wait")?.remove();
    if (h.url) { w.url = h.url; w.querySelector(".urlbar").textContent = h.url; }
    if (h.title) w.querySelector(".title").textContent = h.title;
  }
  close(key) { const w = this.wins.get(key); if (!w) return; this.wins.delete(key); w.classList.add("bye"); setTimeout(() => w.remove(), 220); }
  closeAgent(agentId, kind) { for (const [k, w] of this.wins) if (w.dataset.agent === agentId && (!kind || w.classList.contains("win-" + kind))) this.close(k); }

  drag(el, handle) {
    let sx, sy, ox, oy;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || matchMedia("(max-width: 999px)").matches) return;
      const r = el.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      el.style.right = "auto"; el.style.left = `${ox}px`; el.style.top = `${oy}px`;
      handle.setPointerCapture(e.pointerId); el.classList.add("dragging");
      const move = (ev) => { el.style.left = `${Math.max(0, Math.min(innerWidth - 80, ox + ev.clientX - sx))}px`; el.style.top = `${Math.max(0, Math.min(innerHeight - 40, oy + ev.clientY - sy))}px`; };
      const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); el.classList.remove("dragging"); };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
    });
  }
}
