import { Orb } from "./orb.js";
import { Crew } from "./crew.js";
import { Backdrop } from "./backdrop.js";
import { sigilSvg, openclawSigilSvg } from "./sigil.js";
import { renderMarkdown } from "./md.js";
import { AvatarManager } from "./avatars.js";
import { WindowManager } from "./windows.js";
import { HistoryWindow } from "./history.js";
import { Parallax, bootSequence, spectrumBands } from "./fx.js";
import { bootSfx, IGNITION, READY } from "./sfx.js";

const $ = (id) => document.getElementById(id);
const STATE_WORD = { sleep: "veille", idle: "à l'écoute", listening: "je vous écoute", thinking: "réflexion", tool: "au travail", speaking: "", offline: "liaison perdue" };

const orb = new Orb($("orb"));
const backdrop = new Backdrop($("backdrop"));
const crew = new Crew($("crew"), (id) => { send({ t: "select", id }); });
const agents = new Map();
let user = { name: "Vous", avatar: null, hasDefault: false };
const avatarManager = new AvatarManager($("avatar-manager"), (text, level) => toast(text, level));
const windows = new WindowManager($("windows"), agents, (msg) => send(msg));
const historyWin = new HistoryWindow(windows, agents, (msg) => send(msg), () => user);
let lastAgent = null;       // last agent spoken to: the history button opens its conversation
let ws, active = null, awake = false, micOn = false, userSpeaking = false, linkUp = true, wsBackoff = 500;

// ───────────────────────────── audio out ─────────────────────────────
let actx, analyserOut, analyserIn, levelBuf;
const queue = [];           // { id, text, buffer, runId }
let current = null;         // item being played
const spokenLog = [];       // recent sentences, for server-side echo rejection

function ensureAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  analyserOut = actx.createAnalyser(); analyserOut.fftSize = 512; analyserOut.smoothingTimeConstant = 0.5;
  analyserOut.connect(actx.destination);
  analyserIn = actx.createAnalyser(); analyserIn.fftSize = 512;
  levelBuf = new Float32Array(512);
  const freq = new Uint8Array(256);
  orb.spectrumSource = () => {
    const an = current ? analyserOut : micOn ? analyserIn : null;
    if (!an) return null;
    an.getByteFrequencyData(freq);
    return spectrumBands(freq, current ? 0 : 36); // mic: cut the noise floor so idle stays calm
  };
  orb.levelSource = () => {
    const an = current ? analyserOut : userSpeaking || micOn ? analyserIn : null;
    if (!an) return 0;
    an.getFloatTimeDomainData(levelBuf);
    let sum = 0; for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
    const rms = Math.sqrt(sum / levelBuf.length);
    return Math.min(1, rms * (current ? 4.5 : 7));
  };
}

async function enqueue(header, bytes) {
  const item = { ...header, buffer: null };
  if (bytes && actx) { try { item.buffer = await actx.decodeAudioData(bytes); } catch (e) { console.warn("decode", e); } }
  queue.push(item); queue.sort((a, b) => a.seq - b.seq);
  if (!current) playNext();
}

function playNext() {
  const item = queue.shift();
  if (!item) {
    const last = current; current = null;
    send({ t: "playback", playing: false, id: last?.id });
    refreshState();
    return;
  }
  current = item;
  if (item.id !== active) setActive(item.id, false);
  spokenLog.push(item.text); if (spokenLog.length > 6) spokenLog.shift();
  send({ t: "playback", playing: true, id: item.id, text: spokenLog.join(" ") });
  const duration = item.buffer?.duration ?? Math.max(1.2, item.text.length * 0.06);
  subtitle(item.id, item.text, duration);
  refreshState();
  if (!item.buffer) { item.timer = setTimeout(playNext, duration * 1000); return; }
  const src = actx.createBufferSource(); src.buffer = item.buffer; src.connect(analyserOut);
  src.onended = () => { if (current === item) playNext(); };
  item.src = src; src.start();
}

function hush(id) {
  for (let i = queue.length - 1; i >= 0; i--) if (!id || queue[i].id === id) queue.splice(i, 1);
  if (current && (!id || current.id === id)) {
    const item = current; current = null;
    clearTimeout(item.timer);
    try { item.src && (item.src.onended = null, item.src.stop()); } catch {}
    document.querySelectorAll(".sub.agent.live").forEach((el) => el.classList.add("cut"));
    playNext();
  }
}

// ───────────────────────────── audio in (VAD) ─────────────────────────────
let micVad;
let booting = false;        // startup sequence playing: the mic is open but what it hears is ignored
/** Page-side problems go to the server log too: a silent mic is otherwise impossible to diagnose. */
const report = (text) => { try { send({ t: "clog", text: String(text).slice(0, 400) }); } catch { /* socket down */ } };
addEventListener("error", (e) => report(`erreur : ${e.message} (${e.filename?.split("/").pop()}:${e.lineno})`));
addEventListener("unhandledrejection", (e) => report(`promesse rejetée : ${e.reason?.message ?? e.reason}`));
async function startMic() {
  if (micVad) { await micVad.start(); micOn = true; refreshState(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast("Micro indisponible : ouvrez la page en HTTPS", "error"); return; }
  try {
    micVad = await vad.MicVAD.new({
      model: "v5", baseAssetPath: "/vendor/", onnxWASMBasePath: "/vendor/", audioContext: actx, startOnLoad: false,
      positiveSpeechThreshold: 0.6, negativeSpeechThreshold: 0.4, redemptionMs: 650, preSpeechPadMs: 350, minSpeechMs: 220,
      getStream: async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        actx.createMediaStreamSource(stream).connect(analyserIn);
        return stream;
      },
      onSpeechStart: () => { if (booting) return; userSpeaking = true; refreshState(); liveCaption(true); },
      onVADMisfire: () => { userSpeaking = false; refreshState(); liveCaption(false); },
      onSpeechEnd: (audio) => { if (booting) return; userSpeaking = false; refreshState(); sendUtterance(audio); },
    });
    await micVad.start();
    micOn = true;
  } catch (e) {
    console.error(e);
    report(`micro : ${e.name} ${e.message}`);
    toast(e.name === "NotAllowedError" ? "Accès au micro refusé" : "Micro indisponible", "error");
    micOn = false;
  }
  refreshState();
}

function sendUtterance(f32) {
  if (!ws || ws.readyState !== 1) return liveCaption(false);
  const pcm = new DataView(new ArrayBuffer(44 + f32.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => pcm.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); pcm.setUint32(4, 36 + f32.length * 2, true); str(8, "WAVEfmt "); pcm.setUint32(16, 16, true);
  pcm.setUint16(20, 1, true); pcm.setUint16(22, 1, true); pcm.setUint32(24, 16000, true); pcm.setUint32(28, 32000, true);
  pcm.setUint16(32, 2, true); pcm.setUint16(34, 16, true); str(36, "data"); pcm.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) pcm.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f32[i])) * 0x7fff, true);
  send({ t: "utt", ms: Math.round(f32.length / 16) });
  ws.send(pcm.buffer);
}

// ───────────────────────────── subtitles ─────────────────────────────
const subs = $("subtitles");
let liveEl = null;

function liveCaption(on) {
  if (on && !liveEl) { liveEl = addSub("user pending", "VOUS", ""); liveEl.querySelector(".txt").innerHTML = '<i class="dots"><b></b><b></b><b></b></i>'; }
  else if (!on && liveEl) { liveEl.remove(); liveEl = null; }
}

function addSub(cls, who, text, color) {
  const el = document.createElement("p");
  el.className = "sub " + cls;
  if (color) el.style.setProperty("--c", color);
  el.innerHTML = `<span class="who"></span><span class="txt"></span>`;
  el.querySelector(".who").textContent = who;
  if (cls.startsWith("user") && user.avatar) { const img = new Image(); img.src = user.avatar; img.alt = ""; el.querySelector(".who").prepend(img); }
  el.querySelector(".txt").textContent = text;
  subs.append(el);
  while (subs.children.length > 5) subs.firstElementChild.remove();
  [...subs.children].forEach((c, i, all) => c.style.setProperty("--age", all.length - 1 - i));
  return el;
}

function subtitle(id, text, seconds) {
  const a = agents.get(id);
  document.querySelectorAll(".sub.agent.live").forEach((el) => el.classList.remove("live"));
  const el = addSub("agent live", a?.name ?? "", "", a?.color);
  const txt = el.querySelector(".txt");
  const words = text.split(/(\s+)/);
  const spans = words.map((w) => { const s = document.createElement("span"); s.textContent = w; s.className = "w"; txt.append(s); return s; });
  const total = words.reduce((n, w) => n + w.trim().length + 1, 0);
  let acc = 0;
  spans.forEach((s, i) => { setTimeout(() => s.classList.add("on"), (acc / total) * seconds * 1000 * 0.92); acc += words[i].trim().length + 1; });
}

function heard(msg) {
  liveCaption(false);
  if (!msg.text) return;
  const ignored = msg.kind === "ignored";
  const el = addSub("user" + (ignored ? " ignored" : "") + (msg.kind === "stop" ? " cmd" : ""), "VOUS", msg.text);
  if (ignored) {
    // Say why, so a misheard name or an expired window is obvious instead of looking like a bug.
    const why = {
      "aucun agent appelé": msg.active ? `non transmis — dites le prénom (« ${agents.get(msg.active)?.name ?? "…"}, … »)` : "non transmis — commencez par le prénom d'un agent",
      "agent en train de parler": "non transmis — un agent parlait (dites « stop » ou son prénom)",
      "écho": "écho de la voix de l'agent, ignoré", "bruit": "bruit, ignoré", "inaudible": "inaudible",
    }[msg.reason] ?? "non transmis";
    const tag = document.createElement("i"); tag.className = "why"; tag.textContent = why; el.append(tag);
    setTimeout(() => el.classList.add("gone"), 7000);
  }
}

// ───────────────────────────── stage ─────────────────────────────
/** Put an agent's picture (or its generated emblem) in the orb, with the hologram glitch. */
function showAvatar(a, glitch) {
  const av = $("avatar");
  if (glitch) { av.classList.remove("swap"); void av.offsetWidth; av.classList.add("swap"); }
  setTimeout(() => {
    $("avatar-img").hidden = !a.avatar;
    if (a.avatar) $("avatar-img").src = a.avatar;
    $("avatar-sigil").innerHTML = a.avatar ? "" : sigilSvg(a.name, a.color);
  }, glitch ? 180 : 0);
}

function syncAvatarManager() {
  avatarManager.setEntries([...[...agents.values()].map((a) => ({ id: a.id, name: a.name, color: a.color, avatar: a.avatar, hasDefault: a.hasDefault })),
    { id: "user", name: user.name ?? "Vous", color: "#dbe7f3", avatar: user.avatar, hasDefault: user.hasDefault }]);
}

function setActive(id, flash = true) {
  const a = agents.get(id); if (!a) return;
  const changed = active !== id;
  active = id; lastAgent = id;
  crew.setActive(id);
  orb.setColor(a.color); backdrop.setColor(a.color);
  document.documentElement.style.setProperty("--c", a.color);
  if (changed) {
    showAvatar(a, true);
    const nm = $("agent-name"); nm.textContent = a.name; nm.dataset.text = a.name;
    nm.classList.remove("glitch"); void nm.offsetWidth; nm.classList.add("glitch");
    if (flash) orb.flash();
    showDetailFor(id);
  } else if (flash) orb.flash();
  refreshState();
}

function refreshState() {
  const a = active && agents.get(active);
  let state = awake ? "idle" : "sleep";
  if (!linkUp) state = "offline";
  else if (current && current.id === active) state = "speaking";
  else if (userSpeaking) state = "listening";
  else if (a && (a.status === "thinking" || a.status === "tool")) state = a.status;
  else if (a && micOn) state = "idle";
  else if (a) state = "idle";
  document.body.dataset.state = state;
  document.body.classList.toggle("mic-on", micOn);
  orb.setState(state === "offline" ? "sleep" : state);
  const toolLabel = state === "tool" ? a.tool?.label : null;
  $("agent-state").textContent = toolLabel ?? (state === "idle" && !a ? "appelez un agent par son prénom" : STATE_WORD[state]) ?? "";
}

// ───────────────────────────── detail panel ─────────────────────────────
const details = new Map(); // agentId → markdown
function showDetailFor(id) {
  const md = details.get(id);
  if (!md) return;
  windows.open({ key: `detail:${id}`, agentId: id, kind: "detail", title: agents.get(id)?.name ?? "", markdown: md });
}

// ───────────────────────────── link ─────────────────────────────
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { wsBackoff = 500; };
  ws.onclose = () => { linkUp = false; refreshState(); setTimeout(connect, wsBackoff = Math.min(8000, wsBackoff * 1.7)); };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") {
      const n = new DataView(ev.data).getUint32(0, true);
      const h = JSON.parse(new TextDecoder().decode(new Uint8Array(ev.data, 4, n)));
      const payload = ev.data.slice(4 + n);
      if (h.t === "say") enqueue(h, payload); else if (h.t === "frame") windows.frame(h, payload);
      return;
    }
    const m = JSON.parse(ev.data);
    switch (m.t) {
      case "hello":
        linkUp = m.link; agents.clear(); m.agents.forEach((a) => agents.set(a.id, a));
        user = m.user ?? user;
        if (m.agents[0]) $("typebox").placeholder = `${m.agents[0].name}, …`;
        crew.setAgents(m.agents); syncAvatarManager();
        if (active && agents.has(active)) { const id = active; active = null; setActive(id, false); }
        refreshState(); break;
      case "link": linkUp = m.up; if (!m.up) toast("Gateway OpenClaw injoignable", "error"); refreshState(); break;
      case "agent": { const a = agents.get(m.id); if (a) { Object.assign(a, m); crew.update(m.id, m); refreshState(); } break; }
      case "avatar": {
        const target = m.id === "user" ? user : agents.get(m.id);
        if (!target) break;
        target.avatar = m.avatar; target.hasDefault = m.hasDefault;
        if (m.id !== "user") { crew.setAvatar(m.id, m.avatar); if (m.id === active) showAvatar(target, true); }
        syncAvatarManager(); break;
      }
      case "pulse": crew.pulse(m.id, m.tool); if (m.id === active) orb.flash(); break;
      case "heard": heard(m); break;
      case "wake": setActive(m.id); chime(); break;
      case "sent": details.delete(m.id); windows.closeAgent(m.id, "detail"); break;
      case "say": enqueue(m, null); break;
      case "hush": hush(m.id); break;
      case "detail": if (m.markdown) { details.set(m.id, m.markdown); showDetailFor(m.id); } break;
      case "window": windows.open({ key: m.key, agentId: m.id, kind: "browser", title: m.title, url: m.url, w: m.w, h: m.h }); break;
      case "notice": toast((agents.get(m.id)?.name ? agents.get(m.id).name + " · " : "") + m.text, m.level); break;
      case "done": historyWin.refresh(m.id); break;
      case "history": historyWin.receive(m); break;
    }
  };
}

function chime() {
  if (!actx) return;
  const t = actx.currentTime, g = actx.createGain(); g.connect(actx.destination);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  for (const [f, d] of [[880, 0], [1320, 0.07]]) { const o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f; o.connect(g); o.start(t + d); o.stop(t + 0.5); }
}

let toastTimer;
function toast(text, level = "info") {
  const el = $("toast"); el.textContent = text; el.dataset.level = level; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

// ───────────────────────────── controls ─────────────────────────────
async function toggleMic() {
  if (micOn) { await micVad?.pause(); micOn = false; userSpeaking = false; liveCaption(false); refreshState(); }
  else await startMic();
}
const stopAll = () => { send({ t: "stop" }); hush(); };
const toggleType = (show) => { const bar = $("typebar"); bar.hidden = show === undefined ? !bar.hidden : !show; if (!bar.hidden) $("typebox").focus(); };

$("btn-mic").onclick = toggleMic;
$("btn-stop").onclick = stopAll;
$("btn-type").onclick = () => toggleType();
$("btn-avatars").onclick = () => avatarManager.open();
$("btn-history").onclick = () => historyWin.open(active ?? lastAgent);
$("typebar").onsubmit = (e) => { e.preventDefault(); const v = $("typebox").value.trim(); if (v) send({ t: "text", text: v }); $("typebox").value = ""; };
addEventListener("keydown", (e) => {
  if (e.target === $("typebox")) { if (e.key === "Escape") toggleType(false); return; }
  if (e.key === "Escape") stopAll();
  else if (e.key === "/") { e.preventDefault(); toggleType(true); }
  else if (e.key.toLowerCase() === "m") toggleMic();
  else if (e.key.toLowerCase() === "h") historyWin.open(active ?? lastAgent);
});

$("gate-btn").onclick = async () => {
  ensureAudio(); await actx.resume();
  $("gate-btn").disabled = true;
  booting = true;
  // The mic opens now, inside the click: some browsers (Safari, iPad) only grant it within the user gesture.
  // What it hears during the startup sequence is ignored (see `booting`), so the sound effects never reach the VAD.
  const mic = startMic();
  const sfx = localStorage.getItem("jarvis.sfx") === "off" ? { key() {}, ignite() {}, ready() {} } : bootSfx(actx);
  document.body.classList.add("booting");
  $("gate").classList.add("open");
  setTimeout(() => $("gate").remove(), 900);
  awake = true;
  $("agent-name").textContent = "J.A.R.V.I.S";
  $("avatar-img").hidden = true; $("avatar-sigil").innerHTML = openclawSigilSvg("#38bdf8");
  refreshState();
  // Ignition: impact of the soundtrack + orb flash + a shockwave centred on the orb.
  setTimeout(() => {
    sfx.ignite(); orb.flash(); document.body.classList.add("ignite");
    const shock = document.createElement("div"), r = $("orb-wrap").getBoundingClientRect(); shock.id = "shock";
    shock.style.left = `${r.left + r.width / 2}px`; shock.style.top = `${r.top + r.height / 2}px`;
    document.body.append(shock);
    shock.addEventListener("animationend", () => shock.remove());
  }, IGNITION * 1000);
  setTimeout(() => sfx.ready(), READY * 1000);
  try {
    await bootSequence($("boot"), [...agents.values()].map((a) => a.name), linkUp,
      { onKey: (ch) => sfx.key(ch), typeUntil: (IGNITION - 0.15) * 1000, readyAt: READY * 1000 });
  } finally {
    booting = false;
    document.body.classList.remove("booting", "ignite");
  }
  await mic;
  if ("wakeLock" in navigator) navigator.wakeLock.request("screen").catch(() => {});
};
document.addEventListener("visibilitychange", () => { if (!document.hidden && actx?.state === "suspended") actx.resume(); });

connect();
refreshState();
new Parallax([[$("orb-wrap"), 14], [$("backdrop"), -8], [$("ident"), 8]]);

// Test hooks (used by the automated checks; harmless in production).
window.jarvis = {
  say: (text) => send({ t: "text", text }),
  injectAudio: async (url) => { const b = await (await fetch(url)).arrayBuffer(); send({ t: "utt", ms: 0 }); ws.send(b); },
  state: () => ({ active, state: document.body.dataset.state, queue: queue.length, playing: Boolean(current), agents: [...agents.values()].map((a) => [a.id, a.status]) }),
};
