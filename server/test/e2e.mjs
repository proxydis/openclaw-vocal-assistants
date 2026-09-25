// End-to-end check without a browser: plays the role of the web page over the WebSocket.
// Usage: node test/e2e.mjs "<phrase à dire>" [--typed] [--wait 60]
// Spoken mode synthesises the phrase with Piper, resamples to 16 kHz and sends it like the mic would.
import WebSocket from "ws";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadAgents } from "../agents.mjs";

const args = process.argv.slice(2);
const APP = new URL("../../", import.meta.url).pathname;
// Agents come from the same sources as the server (local file, then OpenClaw config, then the example).
const ocCfg = JSON.parse(readFileSync(`${process.env.HOME}/.openclaw/openclaw.json`, "utf8"));
const { agents } = loadAgents({ app: APP, ocCfg });
const phrase = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--wait") ?? `${agents[0].name}, dis simplement bonjour.`; // not the value of --wait
const typed = args.includes("--typed");
const wait = Number(args[args.indexOf("--wait") + 1] || 60) * 1000;
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6) + "s";

function spokenWav(text) {
  const res = execFileSync("curl", ["-s", "-X", "POST", "localhost:8179/tts", "-H", "content-type: application/json", "-d", JSON.stringify({ agent: (agents[1] ?? agents[0]).id, engine: "piper", text })], { maxBuffer: 1 << 26 });
  writeFileSync("/tmp/e2e_in.wav", res);
  execFileSync(`${APP}.venv/bin/python`, ["-c", "import soundfile as sf\nfrom scipy.signal import resample_poly\nx,sr=sf.read('/tmp/e2e_in.wav'); sf.write('/tmp/e2e_16.wav',resample_poly(x,16000,sr),16000,subtype='PCM_16')"]);
  return readFileSync("/tmp/e2e_16.wav");
}

const ws = new WebSocket("ws://127.0.0.1:8480/ws");
let pending = null, audioBytes = 0, sentences = 0, firstAudioAt = null;
ws.on("open", () => console.log(at(), "connecté"));
ws.on("message", (data, isBinary) => {
  if (isBinary) {
    const n = data.readUInt32LE(0); const h = JSON.parse(data.subarray(4, 4 + n).toString()); data = data.subarray(4 + n);
    if (h.t !== "say") { console.log(at(), h.t.toUpperCase(), data.length, "o"); return; }
    audioBytes += data.length; sentences++;
    firstAudioAt ??= Date.now() - t0;
    console.log(at(), `AUDIO ${data.length} o  ← « ${h.text} »`);
    // Pretend to play it so the server sees realistic playback state.
    const { id, text } = h;
    ws.send(JSON.stringify({ t: "playback", playing: true, id, text }));
    setTimeout(() => ws.send(JSON.stringify({ t: "playback", playing: false, id })), 400);
    return;
  }
  const m = JSON.parse(data.toString());
  if (m.t === "hello") {
    console.log(at(), "agents:", m.agents.map((a) => `${a.name}${a.avatar ? "🖼" : ""}`).join(" "), "| gateway:", m.link);
    if (typed) ws.send(JSON.stringify({ t: "text", text: phrase }));
    else { const wav = spokenWav(phrase); console.log(at(), `envoi de ${wav.length} o audio`); ws.send(JSON.stringify({ t: "utt" })); ws.send(wav); }
  } else if (m.t === "say") { pending = m; if (!m.audio) console.log(at(), "SAY (sans audio)", m.text); }
  else if (m.t === "detail") console.log(at(), `DETAIL final=${m.final} ${m.markdown.length} car. :`, JSON.stringify(m.markdown.slice(0, 160)));
  else if (m.t === "done") { console.log(at(), "DONE", JSON.stringify(m), `| 1er audio à ${firstAudioAt} ms, ${sentences} phrase(s), ${audioBytes} o`); setTimeout(() => process.exit(0), 800); }
  else console.log(at(), m.t.toUpperCase(), JSON.stringify({ ...m, t: undefined }));
});
ws.on("error", (e) => { console.error("ws error", e.message); process.exit(1); });
setTimeout(() => { console.log(at(), "fin d'attente"); process.exit(sentences ? 0 : 2); }, wait);
