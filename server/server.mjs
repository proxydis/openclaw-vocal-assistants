// JARVIS vocal assistant — web server + bridge between browsers, the OpenClaw Gateway,
// the local Whisper server (STT) and the local Piper service (TTS).
import { createServer as createHttps } from "node:https";
import { createServer as createHttp } from "node:http";
import { readFileSync, existsSync, statSync, createReadStream, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize as normPath, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { GatewayClient } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { route } from "./router.mjs";
import { ReplyStream, voiceBrief, cleanForSpeech, extractWindows, wantsWindow, historyEntries } from "./speech.mjs";
import { describeTool } from "./tools.mjs";
import { BrowserWindows } from "./browser.mjs";
import { loadAgents, buildSttPrompt, assignVoices, readVoiceIds } from "./agents.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(APP, "web");
// config/settings.json is local (gitignored); settings.example.json ships the defaults.
const settingsFile = ["config/settings.json", "config/settings.example.json"].map((f) => join(APP, f)).find(existsSync);
const settings = { ...JSON.parse(readFileSync(settingsFile, "utf8")), ...envOverrides() };
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const debug = (...a) => settings.debug && log("[debug]", ...a);
// The Gateway config gives us the token and, when config/agents.json is absent, the agents themselves.
const ocCfg = JSON.parse(readFileSync(join(homedir(), ".openclaw/openclaw.json"), "utf8"));
const { agents: agentsCfg, source: agentsSource } = loadAgents({ app: APP, ocCfg });
// agent id → voice id of the catalogue (vendor/voices/voices.json); the TTS service applies the same
// rule on its own, the id is sent along so both stay in step.
const voiceOf = assignVoices(agentsCfg, readVoiceIds(join(APP, "vendor/voices/voices.json")));
log(`agents (${agentsSource}) : ${agentsCfg.map((a) => `${a.name}[${a.id}]→${voiceOf.get(a.id) ?? "?"}`).join(" ")}`);

function envOverrides() {
  const o = {};
  if (process.env.JARVIS_DEBUG) o.debug = true;
  if (process.env.JARVIS_HTTPS_PORT) o.httpsPort = Number(process.env.JARVIS_HTTPS_PORT);
  if (process.env.JARVIS_HTTP_PORT) o.httpPort = Number(process.env.JARVIS_HTTP_PORT);
  return o;
}

// ───────────────────────────── access code (LAN protection) ─────────────────────────────
// The agents run with full permissions: anything that can talk to this server can drive them.
const secretFile = join(APP, "config/access-code.txt");
if (!existsSync(secretFile)) {
  mkdirSync(dirname(secretFile), { recursive: true });
  writeFileSync(secretFile, randomBytes(4).toString("hex") + "\n", { mode: 0o600 });
}
const accessCode = readFileSync(secretFile, "utf8").trim();
const cookieValue = createHash("sha256").update("jarvis-session|" + accessCode).digest("hex");
const safeEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const isLoopback = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
const hasSession = (req) => isLoopback(req) || (req.headers.cookie ?? "").split(/;\s*/).some((c) => c.startsWith("jv=") && safeEq(c.slice(3), cookieValue));
const loginFailures = new Map(); // ip → { n, until }

// ───────────────────────────── Gateway link ─────────────────────────────
const runs = new Map(); // runId → { agentId, stream: ReplyStream, clientId, startedAt, tool, sayChain }
const agentState = new Map(agentsCfg.map((a) => [a.id, { status: "idle", tool: null, runs: 0, external: 0 }]));
let gatewayUp = false;

const gateway = new GatewayClient({
  url: `ws://127.0.0.1:${ocCfg.gateway?.port ?? 18789}`,
  token: ocCfg.gateway?.auth?.token,
  minProtocol: PROTOCOL_VERSION,
  maxProtocol: PROTOCOL_VERSION,
  caps: ["tool-events"],
  onHelloOk: () => { gatewayUp = true; log("gateway: connecté"); broadcast({ t: "link", up: true }); subscribeRoster(); },
  onConnectError: (e) => log("gateway: erreur de connexion", e?.message),
  onClose: () => { if (gatewayUp) log("gateway: déconnecté"); gatewayUp = false; broadcast({ t: "link", up: false }); },
  onEvent: (ev) => { try { onGatewayEvent(ev); } catch (e) { log("event handler error", e); } },
});
gateway.start();

const sessionKeyFor = (agentId) => `agent:${agentId}:${settings.sessionSuffix}`;
/** Agent id of one of our voice sessions (`agent:<id>:<suffix>`), else null. */
const agentOfSession = (key) => {
  const m = /^agent:([^:]+):(.+)$/.exec(key ?? "");
  return m && m[2] === settings.sessionSuffix && agentState.has(m[1]) ? m[1] : null;
};
const lastClientFor = new Map(); // agentId → client that spoke to it last (owner of replies we did not ask for)

function newRun(agentId, clientId, runId) {
  const run = { runId, agentId, clientId, stream: new ReplyStream(), startedAt: Date.now(), toolCount: 0, sayChain: Promise.resolve(), muted: false, lastDetail: "", allowWindow: false, seen: false };
  runs.set(runId, run);
  agentState.get(agentId).runs++;
  return run;
}

/** Local run for a gateway event. A message sent while the agent is busy does not always come back under
 * our runId: by default the gateway steers it into the active run, or runs it later as a followup turn.
 * Such events are re-attached to the oldest local run of that agent still waiting for its first event;
 * failing that, a run is opened for the client that last spoke to the agent, so a reply is never dropped. */
const finishedRuns = new Map(); // runId → end time: late events of a finished run must not reopen it
function runFor(ev) {
  const p = ev.payload ?? {};
  const known = runs.get(p.runId);
  if (known) return known;
  if (finishedRuns.has(p.runId)) return null;
  const agentId = agentOfSession(p.sessionKey);
  if (!agentId) return null;
  // Only the beginning of an actual reply may attach or open a run (not a trailing lifecycle/tool event).
  const starts = (ev.event === "chat" && ["delta", "final"].includes(p.state)) || (ev.event === "agent" && p.stream === "lifecycle" && p.data?.phase === "start");
  if (!starts) return null;
  const waiting = [...runs.values()].filter((r) => r.agentId === agentId && !r.seen).sort((a, b) => a.startedAt - b.startedAt)[0];
  if (waiting) {
    debug("run ré-attaché", waiting.runId, "→", p.runId);
    runs.delete(waiting.runId); waiting.runId = p.runId; runs.set(p.runId, waiting);
    return waiting;
  }
  const clientId = lastClientFor.get(agentId);
  if (!clientId) return null;
  debug("run ouvert pour une réponse non sollicitée", agentId, p.runId);
  setStatus(agentId, "thinking");
  return newRun(agentId, clientId, p.runId);
}
const agentOfSessionKey = (key) => /^agent:([^:]+):/.exec(key ?? "")?.[1] ?? null;

async function subscribeRoster() {
  // Roster of every session lets us show agents busy elsewhere (Slack, Telegram, cron…).
  try { await gateway.request("sessions.subscribe", {}); } catch (e) { debug("sessions.subscribe indisponible:", e?.message); }
  refreshExternalActivity();
}

async function refreshExternalActivity() {
  if (!gatewayUp) return;
  try {
    const res = await gateway.request("sessions.list", { activeMinutes: 120, limit: 200 });
    const counts = new Map();
    for (const s of res.sessions ?? []) {
      const id = agentOfSessionKey(s.key);
      const active = s.hasActiveRun ?? s.sessionInfo?.hasActiveRun ?? false;
      if (id && active && s.key !== sessionKeyFor(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, st] of agentState) {
      const n = counts.get(id) ?? 0;
      if (st.external !== n) { st.external = n; pushAgent(id); }
    }
  } catch (e) { debug("sessions.list:", e?.message); }
}
setInterval(refreshExternalActivity, 8000).unref();

function pushAgent(id) {
  const st = agentState.get(id);
  if (st) broadcast({ t: "agent", id, status: st.status, tool: st.tool, busyElsewhere: st.external > 0 });
}

function setStatus(id, status, tool = null) {
  const st = agentState.get(id);
  if (!st) return;
  st.status = status; st.tool = tool;
  pushAgent(id);
}

function onGatewayEvent(ev) {
  const p = ev.payload ?? {};
  if (ev.event === "sessions.changed" || ev.event === "session.changed") return void refreshExternalActivity();
  const run = runFor(ev);
  if (!run) return;
  run.seen = true;

  if (ev.event === "agent") {
    if (p.stream === "tool" || p.stream === "tools") {
      const d = p.data ?? {};
      const phase = d.phase ?? d.state ?? d.status;
      if (["start", "started", "running", "call"].includes(phase) || (!phase && d.name)) {
        const tool = describeTool(d.name ?? d.toolName ?? d.tool ?? "", d.args ?? d.input ?? d.params);
        run.toolCount++;
        setStatus(run.agentId, "tool", tool);
        broadcast({ t: "pulse", id: run.agentId, tool });
      } else setStatus(run.agentId, "thinking");
    } else if (p.stream === "lifecycle" && p.data?.phase === "start") setStatus(run.agentId, "thinking");
    else if (!["assistant", "lifecycle", "run_status"].includes(p.stream)) debug("agent stream", p.stream, JSON.stringify(p.data).slice(0, 300));
    return;
  }
  if (ev.event !== "chat") return;
  const text = (p.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  // A new assistant message inside the same run (answer to a message steered in while it was working):
  // the text no longer extends what we have. Close the previous reply and speak this one from its start.
  if (text && !p.replace && run.stream.full && !text.startsWith(run.stream.full) && !run.stream.full.startsWith(text)) {
    sendDetail(run, true);
    run.stream = new ReplyStream(); run.lastDetail = "";
  }
  if (p.state === "delta") {
    if (p.replace || text.length >= run.stream.full.length) speak(run, run.stream.update(text, false));
    sendDetail(run, false);
  } else if (p.state === "final" || p.state === "aborted" || p.state === "error") {
    if (p.state === "error") {
      log("run error", run.agentId, p.errorKind, p.errorMessage);
      speak(run, ["Désolé, je n'ai pas pu terminer."]);
      send(run.clientId, { t: "notice", id: run.agentId, level: "error", text: frenchError(p.errorKind) });
    } else if (p.state === "final") speak(run, run.stream.update(text || run.stream.full, true));
    sendDetail(run, true);
    // Windows only when the user asked for one in this utterance: an agent never opens them on its own.
    if (run.allowWindow) for (const w of extractWindows(run.stream.full)) browserWins.open({ clientId: run.clientId, key: `browser:${run.agentId}:${w.url}`, url: w.url, agentId: run.agentId, title: w.title }).catch((e) => log("navigateur:", e.message));
    finishRun(p.runId, run);
    // Messages sent to this agent while this run was active and that never got an event of their own were
    // steered into it: their answer has just been delivered. (If one runs later as a followup instead,
    // runFor() opens a new run for it.)
    for (const r of [...runs.values()]) if (r.agentId === run.agentId && !r.seen && r.startedAt > run.startedAt) finishRun(r.runId, r);
  }
}

const frenchError = (kind) => ({ rate_limit: "Limite de débit atteinte", timeout: "Délai dépassé", context_length: "Contexte saturé", refusal: "Demande refusée" }[kind] ?? "Erreur pendant la tâche");

function sendDetail(run, final) {
  const md = run.stream.detail;
  if (md === run.lastDetail && !final) return;
  run.lastDetail = md;
  if (md || final) send(run.clientId, { t: "detail", id: run.agentId, runId: run.runId, markdown: md, final });
}

// Safety net: a run that never received a single event (message lost, gateway restarted) must not keep
// its agent "thinking" forever.
setInterval(() => {
  for (const r of [...runs.values()]) if (!r.seen && Date.now() - r.startedAt > 10 * 60_000) { log("run sans réponse abandonné", r.agentId, r.runId); finishRun(r.runId, r); }
}, 60_000).unref();

function finishRun(runId, run) {
  runs.delete(runId);
  finishedRuns.set(runId, Date.now());
  if (finishedRuns.size > 500) for (const [id, t] of finishedRuns) if (Date.now() - t > 3_600_000 || finishedRuns.size > 400) finishedRuns.delete(id);
  const st = agentState.get(run.agentId);
  st.runs = Math.max(0, st.runs - 1);
  // Status returns to idle once the last sentence has been handed to the client (see speak()).
  run.sayChain.then(() => {
    if (st.runs === 0 && st.status !== "speaking") setStatus(run.agentId, "idle");
    broadcast({ t: "done", id: run.agentId, runId, tools: run.toolCount, ms: Date.now() - run.startedAt });
  });
}

// ───────────────────────────── speech out (TTS) ─────────────────────────────
let saySeq = 0;
function speak(run, sentences) {
  for (const sentence of sentences) {
    const seq = ++saySeq;
    // Synthesis starts immediately (parallel), delivery stays ordered through the chain.
    const audio = synth(run.agentId, sentence).catch((e) => { log("tts error:", e.message); return null; });
    run.sayChain = run.sayChain.then(async () => {
      if (run.muted) return;
      const wav = await audio;
      send(run.clientId, { t: "say", id: run.agentId, runId: run.runId, seq, text: sentence, audio: Boolean(wav) }, wav);
    });
  }
}

async function synth(agentId, text) {
  const res = await fetch(`${settings.ttsUrl}/tts`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: agentId, voice: voiceOf.get(agentId), text }), signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ───────────────────────────── speech in (STT) ─────────────────────────────
// Whisper "prompt" = a few utterances in the expected style. Measured: it fixes names and short
// commands ("<Prénom> condient fond 12 x 12" → "<Prénom>, combien font douze fois douze ?"), whereas a
// bare list of names made the model hallucinate names on bad audio. Generated from the roster unless
// settings.sttPrompt is set explicitly.
const sttPrompt = settings.sttPrompt ?? buildSttPrompt(agentsCfg);
debug("sttPrompt:", sttPrompt);
async function transcribe(wav) {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "utt.wav");
  form.append("language", "fr");
  form.append("response_format", "json");
  form.append("temperature", "0.0");
  if (sttPrompt) form.append("prompt", sttPrompt);
  const t0 = Date.now();
  // Two Whisper servers share the GPU: a fast small model for short utterances ("stop", a bare
  // name) where reaction time matters, a precise one for real sentences where accuracy matters.
  const audioMs = ((wav.length - 44) / 32000) * 1000;
  const urls = audioMs <= settings.sttFastMaxMs ? [settings.sttFastUrl, settings.sttUrl] : [settings.sttUrl, settings.sttFastUrl];
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(`${url}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
      const text = ((await res.json()).text ?? "").replace(/\s+/g, " ").trim();
      debug(`stt ${Math.round(audioMs)} ms audio → ${Date.now() - t0} ms (${url.slice(-4)}):`, text);
      return text;
    } catch (e) { lastError = e; }
  }
  throw new Error(`STT indisponible: ${lastError?.message}`);
}

// ───────────────────────────── conversation logic ─────────────────────────────
const clients = new Map(); // clientId → { ws, activeAgent, followUpUntil, speaking, spokenText }
const browserWins = new BrowserWindows({ send: (id, msg, bin) => send(id, msg, bin), log });

async function handleUtterance(client, text, { typed = false } = {}) {
  const decision = route(text, {
    agents: agentsCfg, activeAgent: client.activeAgent, followUpUntil: typed ? Infinity : client.followUpUntil,
    speaking: typed ? false : client.speaking, spokenText: client.spokenText,
  });
  // Always logged (not only in debug): the only way to diagnose "it ignored me" reports afterwards.
  log(`entendu${typed ? " (clavier)" : ""}: « ${text} » → ${decision.kind}${decision.agentId ? " " + decision.agentId : ""}${decision.reason ? " (" + decision.reason + ")" : ""}`);
  send(client.id, { t: "heard", text, kind: decision.kind, id: decision.agentId ?? null, reason: decision.reason, active: client.activeAgent });

  if (decision.kind === "stop") return stopSpeech(client, decision.agentId);
  if (decision.kind === "cancel") return cancelRuns(client, decision.agentId);
  if (decision.kind === "wake") return wake(client, decision.agentId, true);
  if (decision.kind !== "message") return;
  if (client.activeAgent !== decision.agentId) wake(client, decision.agentId, false);
  if (client.speaking) stopSpeech(client); // talking over the agent = barge-in
  client.followUpUntil = Date.now() + settings.followUpMs;
  await sendToAgent(client, decision.agentId, decision.text);
}

function wake(client, agentId, acknowledge) {
  client.activeAgent = agentId;
  client.followUpUntil = Date.now() + settings.followUpMs;
  send(client.id, { t: "wake", id: agentId });
  if (acknowledge) {
    const phrase = settings.wakePhrases[Math.floor(Math.random() * settings.wakePhrases.length)];
    synth(agentId, phrase).then((wav) => send(client.id, { t: "say", id: agentId, runId: null, seq: ++saySeq, text: phrase, audio: true }, wav)).catch((e) => log("tts error:", e.message));
  }
}

function stopSpeech(client, agentId) {
  for (const run of runs.values()) if (run.clientId === client.id && (!agentId || run.agentId === agentId)) run.muted = true;
  send(client.id, { t: "hush", id: agentId ?? null });
}

async function cancelRuns(client, agentId) {
  stopSpeech(client, agentId);
  if (!agentId) return;
  try {
    await gateway.request("chat.abort", { sessionKey: sessionKeyFor(agentId) });
    send(client.id, { t: "notice", id: agentId, level: "info", text: "Tâche annulée" });
  } catch (e) { log("chat.abort:", e?.message); }
}

/** Whole voice conversation with one agent, read back from its OpenClaw session (source of truth: it
 * survives restarts and is the same history the Control UI shows). */
async function sendHistory(client, agentId) {
  try {
    const r = await gateway.request("chat.history", { sessionKey: sessionKeyFor(agentId), limit: 1000 }, { timeoutMs: 20000 });
    const entries = historyEntries(r?.messages).slice(-600);
    send(client.id, { t: "history", id: agentId, entries, truncated: Boolean(r?.hasMore) });
  } catch (e) {
    log("chat.history:", e?.message);
    send(client.id, { t: "history", id: agentId, entries: [], error: "Historique indisponible" });
  }
}

async function sendToAgent(client, agentId, text) {
  if (!gatewayUp) return send(client.id, { t: "notice", id: agentId, level: "error", text: "Gateway OpenClaw injoignable" });
  const runId = `jarvis-${randomUUID()}`;
  const allowWindow = wantsWindow(text);
  lastClientFor.set(agentId, client.id);
  const run = newRun(agentId, client.id, runId);
  run.allowWindow = allowWindow;
  setStatus(agentId, "thinking");
  send(client.id, { t: "sent", id: agentId, runId, text });
  try {
    await gateway.request("chat.send", { sessionKey: sessionKeyFor(agentId), message: `${voiceBrief(settings.userName, allowWindow)}\n\n${text}`, idempotencyKey: runId }, { timeoutMs: 60000 });
  } catch (e) {
    log("chat.send:", e?.message);
    runs.delete(runId);
    agentState.get(agentId).runs--;
    setStatus(agentId, "idle");
    send(client.id, { t: "notice", id: agentId, level: "error", text: "Envoi impossible : " + (e?.message ?? "erreur") });
  }
}

// ───────────────────────────── browser link ─────────────────────────────
function send(clientId, msg, binary) {
  const targets = clients.has(clientId) ? [clients.get(clientId)] : [...clients.values()];
  for (const c of targets) {
    if (c.ws.readyState !== 1) continue;
    if (!binary) { c.ws.send(JSON.stringify(msg)); continue; }
    // One self-describing binary message: [u32 header length][JSON header][payload]. Audio and browser
    // frames can interleave freely; a separate JSON-then-binary pair could be mismatched.
    const head = Buffer.from(JSON.stringify(msg));
    const len = Buffer.alloc(4); len.writeUInt32LE(head.length);
    c.ws.send(Buffer.concat([len, head, binary]), { binary: true });
  }
}
const broadcast = (msg) => { for (const c of clients.values()) if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };

// ───────────────────────────── avatars ─────────────────────────────
// One JPEG per agent (web/avatars/<prénom en minuscules, sans accents>.jpg) + one for the user. Without
// a file the page draws a generated emblem. The page crops/resizes before uploading, so the server only
// checks that it really is a reasonably sized JPEG.
const AVATARS = join(WEB, "avatars");
const USER_KEY = "user"; // avatar file for the human: web/avatars/user.jpg (optional default: avatars/defaults/user.jpg)
const avatarKey = (id) => (id === "user" ? USER_KEY : agentsCfg.find((a) => a.id === id)?.avatarKey);
const hasDefaultAvatar = (key) => existsSync(join(AVATARS, "defaults", `${key}.jpg`));
function avatarUrl(key) {
  const file = join(AVATARS, `${key}.jpg`);
  return existsSync(file) ? `avatars/${key}.jpg?v=${Math.round(statSync(file).mtimeMs)}` : null; // ?v= busts the long cache
}
function announceAvatar(id) {
  const key = avatarKey(id);
  broadcast({ t: "avatar", id, avatar: avatarUrl(key), hasDefault: hasDefaultAvatar(key) });
}

function handleAvatarApi(req, res, url) {
  const id = url.searchParams.get("id") ?? "";
  const key = avatarKey(id);
  const reply = (code, body) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (!key) return reply(404, { error: "agent inconnu" });
  const target = join(AVATARS, `${key}.jpg`);
  if (req.method === "DELETE") { // back to the default picture (or to the generated emblem if none)
    const def = join(AVATARS, "defaults", `${key}.jpg`);
    if (existsSync(def)) copyFileSync(def, target); else rmSync(target, { force: true });
    announceAvatar(id);
    return reply(200, { ok: true });
  }
  if (req.method !== "POST") return reply(405, { error: "méthode" });
  const chunks = []; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 3 * 1024 * 1024) { reply(413, { error: "image trop lourde" }); req.destroy(); } else chunks.push(c); });
  req.on("end", () => {
    if (res.writableEnded) return;
    const buf = Buffer.concat(chunks);
    if (buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return reply(400, { error: "JPEG attendu" });
    writeFileSync(target, buf, { mode: 0o644 });
    log(`avatar mis à jour : ${key} (${Math.round(buf.length / 1024)} Ko)`);
    announceAvatar(id);
    reply(200, { ok: true });
  });
}

function onBrowser(ws) {
  const client = { id: randomUUID(), ws, activeAgent: null, followUpUntil: 0, speaking: false, spokenText: "", pendingUtt: null };
  clients.set(client.id, client);
  ws.send(JSON.stringify({
    t: "hello", link: gatewayUp, followUpMs: settings.followUpMs,
    user: { name: settings.userName, avatar: avatarUrl(USER_KEY), hasDefault: hasDefaultAvatar(USER_KEY) },
    agents: agentsCfg.map((a) => {
      const st = agentState.get(a.id);
      return { id: a.id, name: a.name, color: a.color, glyph: a.glyph, avatar: avatarUrl(avatarKey(a.id)), hasDefault: hasDefaultAvatar(avatarKey(a.id)), status: st.status, tool: st.tool, busyElsewhere: st.external > 0 };
    }),
  }));
  ws.on("message", async (data, isBinary) => {
    try {
      if (isBinary) {
        if (!client.pendingUtt) return;
        client.pendingUtt = null;
        if (data.length > 16000 * 2 * 45) return; // > 45 s: not an utterance
        const text = await transcribe(data);
        if (text) await handleUtterance(client, text);
        else send(client.id, { t: "heard", text: "", kind: "ignored", reason: "inaudible" });
        return;
      }
      const msg = JSON.parse(data.toString());
      if (msg.t === "utt") client.pendingUtt = msg;
      else if (msg.t === "text" && typeof msg.text === "string") await handleUtterance(client, msg.text.slice(0, 2000), { typed: true });
      else if (msg.t === "select" && agentState.has(msg.id)) wake(client, msg.id, false);
      else if (msg.t === "stop") stopSpeech(client);
      else if (msg.t === "history" && agentState.has(msg.id)) await sendHistory(client, msg.id);
      else if (msg.t === "clog") log("page:", String(msg.text ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").slice(0, 400)); // client-side errors (mic, audio, scripts)
      else if (msg.t === "win.input") await browserWins.input(client.id, msg);
      else if (msg.t === "win.close") await browserWins.close(String(msg.key), client.id);
      else if (msg.t === "win.open" && /^https?:\/\//i.test(msg.url ?? "")) await browserWins.open({ clientId: client.id, key: `browser:user:${msg.url}`, url: msg.url, agentId: client.activeAgent ?? agentsCfg[0].id, title: msg.url });
      else if (msg.t === "playback") {
        // Client reports what is audible right now: drives echo rejection and status.
        client.speaking = Boolean(msg.playing);
        client.speakingAgent = msg.playing ? msg.id : null;
        client.spokenText = String(msg.text ?? "").slice(0, 2000);
        if (msg.id && agentState.has(msg.id)) {
          const st = agentState.get(msg.id);
          if (msg.playing) setStatus(msg.id, "speaking");
          else if (st.status === "speaking") setStatus(msg.id, st.runs > 0 ? "thinking" : "idle");
        }
        if (!msg.playing) client.followUpUntil = Date.now() + settings.followUpMs;
      }
    } catch (e) {
      log("ws message error:", e.message);
      send(client.id, { t: "notice", level: "error", text: /STT/.test(e.message) ? "Reconnaissance vocale indisponible" : "Erreur interne" });
    }
  });
  ws.on("close", () => {
    clients.delete(client.id);
    browserWins.closeClient(client.id);
    // A page that vanishes mid-sentence must not leave its agent "speaking" forever.
    for (const [id, st] of agentState) if (st.status === "speaking" && ![...clients.values()].some((c) => c.speakingAgent === id)) setStatus(id, st.runs > 0 ? "thinking" : "idle");
  });
}

// ───────────────────────────── HTTP(S) ─────────────────────────────
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".crt": "application/x-x509-ca-cert", ".woff2": "font/woff2" };

function serveFile(res, file, headers = {}) {
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end("Introuvable"); return; }
  const ext = extname(file);
  const immutable = file.includes("/vendor/") || file.includes("/avatars/");
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=604800" : "no-cache", ...headers });
  createReadStream(file).pipe(res);
}

function handler(req, res) {
  const url = new URL(req.url, "http://x");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  if (url.pathname === "/api/login" && req.method === "POST") {
    const ip = req.socket.remoteAddress;
    const f = loginFailures.get(ip);
    if (f && f.until > Date.now()) { res.writeHead(429).end(); return; }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1000) req.destroy(); });
    req.on("end", () => {
      let code = "";
      try { code = String(JSON.parse(body).code ?? "").trim().toLowerCase(); } catch {}
      if (code && safeEq(createHash("sha256").update(code).digest("hex"), createHash("sha256").update(accessCode).digest("hex"))) {
        loginFailures.delete(ip);
        res.writeHead(200, { "set-cookie": `jv=${cookieValue}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${req.socket.encrypted ? "; Secure" : ""}`, "content-type": "application/json" }).end('{"ok":true}');
      } else {
        const n = (f?.n ?? 0) + 1;
        loginFailures.set(ip, { n, until: Date.now() + Math.min(60000, 500 * 2 ** n) });
        res.writeHead(401, { "content-type": "application/json" }).end('{"ok":false}');
      }
    });
    return;
  }
  if (url.pathname === "/ca.crt") return serveFile(res, join(APP, "certs/rootCA.pem"), { "content-disposition": 'attachment; filename="jarvis-ca.crt"' });
  if (url.pathname === "/healthz") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, gateway: gatewayUp })); return; }
  const publicFiles = ["/login.html", "/login.js", "/styles.css", "/manifest.webmanifest", "/icon.svg"];
  if (!hasSession(req) && !publicFiles.includes(url.pathname)) { res.writeHead(302, { location: "/login.html" }).end(); return; }
  if (url.pathname === "/api/avatar") {
    // Same-origin only: a page from another site must not be able to change pictures through the cookie.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) { res.writeHead(403).end(); return; }
    return handleAvatarApi(req, res, url);
  }
  const rel = normPath(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (rel.includes("..")) { res.writeHead(400).end(); return; }
  serveFile(res, join(WEB, rel));
}

function attachWs(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    const sameOrigin = !origin || new URL(origin).host === req.headers.host;
    if (req.url !== "/ws" || !hasSession(req) || !sameOrigin) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, onBrowser);
  });
}

const certFile = join(APP, "certs/server.pem"), keyFile = join(APP, "certs/server-key.pem");
if (existsSync(certFile) && existsSync(keyFile)) {
  const s = createHttps({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, handler);
  attachWs(s);
  s.listen(settings.httpsPort, settings.bind, () => log(`HTTPS prêt : https://<ip-de-la-machine>:${settings.httpsPort}`));
} else log("certs/ absent : HTTPS désactivé (lancer bin/make-certs.sh). Le micro ne fonctionnera que sur localhost.");
// Plain HTTP stays on loopback: enough for local use and tests, never exposed to the LAN.
const plain = createHttp(handler);
attachWs(plain);
plain.listen(settings.httpPort, "127.0.0.1", () => log(`HTTP local : http://localhost:${settings.httpPort}`));

// Logged because on 2026-09-23 the process received a SIGTERM from outside systemd (clean exit, no trace).
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => { log(`${sig} reçu, arrêt (ppid ${process.ppid})`); gateway.stop(); process.exit(0); });
