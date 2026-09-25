// Conversation history window: every exchange with one agent, grouped by day, with the time of each
// message. The server reads it from the agent's OpenClaw session (chat.history), so it survives restarts.
import { renderMarkdown } from "./md.js";

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayKey = (ts) => new Date(ts).toDateString();

export class HistoryWindow {
  /** windows: WindowManager · agents: Map id → agent · send: WebSocket sender · user(): { name } */
  constructor(windows, agents, send, user) {
    this.windows = windows; this.agents = agents; this.send = send; this.user = user;
    this.agentId = null; this.node = null;
  }

  get isOpen() { return Boolean(this.node?.isConnected); }

  open(agentId) {
    this.agentId = agentId ?? this.agentId ?? [...this.agents.keys()][0];
    if (!this.agentId) return;
    this.node = document.createElement("div");
    this.node.className = "hist";
    this.node.innerHTML = `<nav class="hist-agents"></nav><div class="hist-list"><div class="hist-wait"><i></i>chargement…</div></div>`;
    const nav = this.node.querySelector(".hist-agents");
    for (const a of this.agents.values()) {
      const b = document.createElement("button");
      b.textContent = a.name; b.style.setProperty("--c", a.color); b.dataset.id = a.id;
      b.classList.toggle("on", a.id === this.agentId);
      b.onclick = () => this.open(a.id);
      nav.append(b);
    }
    this.windows.open({ key: "history", agentId: this.agentId, kind: "history", title: `Historique · ${this.agents.get(this.agentId)?.name ?? ""}`, node: this.node });
    this.send({ t: "history", id: this.agentId });
  }

  /** New exchange finished with the agent on display: reload its history (keeps the reader at the bottom). */
  refresh(agentId) { if (this.isOpen && agentId === this.agentId) this.send({ t: "history", id: agentId }); }

  receive(m) {
    if (!this.isOpen || m.id !== this.agentId) return;
    const list = this.node.querySelector(".hist-list");
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40 || list.querySelector(".hist-wait");
    list.replaceChildren();
    if (m.error || !m.entries.length) {
      const p = document.createElement("p"); p.className = "hist-empty";
      p.textContent = m.error ?? "Aucun échange pour l'instant.";
      list.append(p); return;
    }
    if (m.truncated) { const p = document.createElement("p"); p.className = "hist-empty"; p.textContent = "Seuls les échanges les plus récents sont affichés."; list.append(p); }
    const agent = this.agents.get(m.id);
    let day = null;
    for (const e of m.entries) {
      if (e.ts && dayKey(e.ts) !== day) {
        day = dayKey(e.ts);
        const h = document.createElement("h4"); h.className = "hist-day"; h.textContent = DAY.format(e.ts); list.append(h);
      }
      const msg = document.createElement("div");
      msg.className = `hist-msg ${e.who === "user" ? "from-user" : "from-agent"}`;
      msg.innerHTML = `<header><b></b><time></time></header>`;
      msg.querySelector("b").textContent = e.who === "user" ? (this.user()?.name || "Vous") : (agent?.name ?? m.id);
      if (e.ts) { const t = msg.querySelector("time"); t.textContent = TIME.format(e.ts); t.dateTime = new Date(e.ts).toISOString(); }
      if (e.text) { const d = document.createElement("div"); d.className = "hist-text"; d.innerHTML = renderMarkdown(e.text); msg.append(d); }
      if (e.detail) {
        const det = document.createElement("details");
        det.innerHTML = `<summary>${e.text ? "détail affiché à l'écran" : "réponse affichée à l'écran"}</summary><article>${renderMarkdown(e.detail)}</article>`;
        if (!e.text) det.open = true;
        msg.append(det);
      }
      list.append(msg);
    }
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
}
