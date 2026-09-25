// Avatar manager: a grid with every agent (and you). Click a face — or drop an image on it — to
// replace it; ↺ restores the default. The image is centre-cropped to a square and resized in the
// browser, so any photo or screenshot works and the upload stays small.
import { sigilSvg } from "./sigil.js";

const SIZE = 768;

async function toSquareJpeg(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#05070d"; ctx.fillRect(0, 0, SIZE, SIZE); // transparent PNGs get the app's dark backdrop
  // Portraits keep the top of the picture (faces sit high), landscapes keep the centre.
  const sx = (bmp.width - side) / 2, sy = bmp.height > bmp.width ? (bmp.height - side) * 0.2 : 0;
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, SIZE, SIZE);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

export class AvatarManager {
  constructor(root, notify) {
    this.root = root; this.notify = notify; this.entries = [];
    this.input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
    document.body.append(this.input);
    this.input.addEventListener("change", () => { const f = this.input.files[0]; this.input.value = ""; if (f && this.pending) this.upload(this.pending, f); });
    root.addEventListener("click", (e) => { if (e.target === root || e.target.closest(".am-close")) this.close(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) { e.stopPropagation(); this.close(); } }, true);
  }

  setEntries(entries) { this.entries = entries; if (!this.root.hidden) this.render(); }
  open() { this.render(); this.root.hidden = false; }
  close() { this.root.hidden = true; }

  render() {
    this.root.innerHTML = `<div class="am-panel"><header><span>Avatars</span><button class="am-close" aria-label="Fermer">×</button></header>
      <p class="am-hint">Touchez un avatar pour le remplacer, ou déposez une image dessus.</p><div class="am-grid"></div></div>`;
    const grid = this.root.querySelector(".am-grid");
    for (const e of this.entries) {
      const tile = document.createElement("div");
      tile.className = "am-tile"; tile.style.setProperty("--c", e.color);
      tile.innerHTML = `<button class="am-face" title="Changer l'avatar de ${e.name}">${e.avatar ? `<img src="${e.avatar}" alt="">` : sigilSvg(e.name, e.color)}<i>changer</i></button>
        <b>${e.name}</b>${e.hasDefault ? `<button class="am-reset" title="Revenir à l'avatar par défaut">↺ défaut</button>` : ""}`;
      tile.querySelector(".am-face").addEventListener("click", () => { this.pending = e.id; this.input.click(); });
      tile.querySelector(".am-reset")?.addEventListener("click", () => this.reset(e.id));
      tile.addEventListener("dragover", (ev) => { ev.preventDefault(); tile.classList.add("drop"); });
      tile.addEventListener("dragleave", () => tile.classList.remove("drop"));
      tile.addEventListener("drop", (ev) => { ev.preventDefault(); tile.classList.remove("drop"); const f = [...ev.dataTransfer.files].find((x) => x.type.startsWith("image/")); if (f) this.upload(e.id, f); });
      grid.append(tile);
    }
  }

  async upload(id, file) {
    try {
      const blob = await toSquareJpeg(file);
      const res = await fetch(`/api/avatar?id=${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.status);
      this.notify("Avatar mis à jour");
    } catch (err) { this.notify("Image refusée : " + err.message, "error"); }
  }

  async reset(id) {
    const res = await fetch(`/api/avatar?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    this.notify(res.ok ? "Avatar par défaut rétabli" : "Échec", res.ok ? "info" : "error");
  }
}
