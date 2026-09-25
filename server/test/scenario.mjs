// Scenario check: two agents at once, then "stop" while one is talking, then "annule".
// Usage: node test/scenario.mjs
// Two agents in parallel, "stop" while one speaks, then "annule": the first two agents of the roster.
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { loadAgents } from "../agents.mjs";
const APP = new URL("../../", import.meta.url).pathname;
const { agents } = loadAgents({ app: APP, ocCfg: JSON.parse(readFileSync(`${process.env.HOME}/.openclaw/openclaw.json`, "utf8")) });
if (agents.length < 2) { console.error("scénario : il faut au moins deux agents"); process.exit(2); }
const [A, B] = agents; // A runs a long task, B answers quickly meanwhile
const ws = new WebSocket("ws://127.0.0.1:8480/ws");
const t0 = Date.now(), at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + "s";
const seen = { aRunning: false, bSpokeWhileARan: false, hush: false, cancelled: false };
let pending = null, status = {};
const say = (text) => { console.log(at(), "→", text); ws.send(JSON.stringify({ t: "text", text })); };

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    const n = data.readUInt32LE(0); const h = JSON.parse(data.subarray(4, 4 + n).toString());
    if (h.t !== "say") return;
    const { id, text } = h;
    console.log(at(), `🔊 ${id}: ${text}`);
    if (id === B.id && ["thinking", "tool"].includes(status[A.id])) seen.bSpokeWhileARan = true;
    ws.send(JSON.stringify({ t: "playback", playing: true, id, text }));
    if (id === B.id && !seen.hushSent) { seen.hushSent = true; setTimeout(() => say("stop"), 300); }
    return;
  }
  const m = JSON.parse(data.toString());
  if (m.t === "hello") { say(`${A.name}, compte jusqu'à vingt lentement, puis attends dix secondes avant de me répondre.`); setTimeout(() => say(`${B.name}, quelle est la capitale de l'Italie ?`), 2500); }
  else if (m.t === "agent") { if (status[m.id] !== m.status) console.log(at(), `   ${m.id}: ${m.status}${m.tool ? " (" + m.tool.label + ")" : ""}`); status[m.id] = m.status; if (m.id === A.id && m.status !== "idle") seen.aRunning = true; }
  else if (m.t === "hush") { seen.hush = true; console.log(at(), "🤫 hush reçu"); ws.send(JSON.stringify({ t: "playback", playing: false, id: B.id })); if (!seen.cancelSent) { seen.cancelSent = true; setTimeout(() => say(`${A.name}, annule`), 1500); } }
  else if (m.t === "notice") { console.log(at(), "ℹ", m.text); if (/annul/i.test(m.text)) seen.cancelled = true; }
  else if (m.t === "done") console.log(at(), "✔ done", m.id, `${m.ms} ms, ${m.tools} outil(s)`);
});
setTimeout(() => { console.log("\nRésultat:", JSON.stringify(seen)); process.exit(seen.bSpokeWhileARan && seen.hush && seen.cancelled ? 0 : 1); }, 45000);
