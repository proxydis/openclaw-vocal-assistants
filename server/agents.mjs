// Agent roster: nothing about a particular team lives in the code. The list comes, in order of
// preference, from config/agents.json (local, gitignored), from the OpenClaw configuration itself
// (~/.openclaw/openclaw.json → agents.entries), or from config/agents.example.json as a last resort.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Neon palette, cycled when an agent has no colour of its own.
export const PALETTE = ["#4f86ff", "#39ff88", "#22d3ee", "#a78bfa", "#ff7eb6", "#ff4d6d", "#ffb454", "#2dd4bf", "#f472b6", "#facc15"];
export const DEFAULT_GLYPH = "◈";
export const DEFAULT_AGENT_ID = "main"; // OpenClaw's built-in default agent
// Display name for the default agent when OpenClaw gives it none: "Main" is a French word ("un coup de
// main") and would wake it by accident, so the app's own name serves as its wake word.
export const DEFAULT_AGENT_NAME = "Jarvis";

/** Lower-case ASCII form used for aliases and file names ("Éva Sœur" → "eva-soeur" / alias "eva"). */
export const slug = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/œ/g, "oe").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Same token shape as router.mjs normalize(); Whisper yields one token per word, so the first word is what gets matched.
const aliasOf = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/œ/g, "oe").toLowerCase().replace(/[^a-z0-9' -]+/g, " ").trim().split(/\s+/)[0] ?? "";

/** Fill the optional fields of one agent block; `i` drives the colour cycle. */
export function normalizeAgent(a, i = 0) {
  const id = String(a.id);
  const name = String(a.name ?? (id === DEFAULT_AGENT_ID ? DEFAULT_AGENT_NAME : capitalize(id)));
  const aliases = (a.aliases?.length ? a.aliases : defaultAliases(id, name)).map(aliasOf).filter(Boolean);
  return { id, name, aliases: [...new Set(aliases)], color: a.color ?? PALETTE[i % PALETTE.length], glyph: a.glyph ?? DEFAULT_GLYPH, voice: a.voice ?? null, avatarKey: a.avatarKey ?? slug(name) };
}

function defaultAliases(id, name) {
  const out = [aliasOf(name)];
  // The id is a second handle ("neo" for "Néo"), except OpenClaw's generic "main" — a French word
  // ("donne-moi un coup de main") that would wake the agent by accident.
  if (id !== DEFAULT_AGENT_ID && slug(id) !== out[0]) out.push(aliasOf(id));
  return out;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Agents declared in OpenClaw's own configuration (`agents.entries`, keyed by id; older layouts
 * used an array). Display name = identity.name, then name, then the id. The default agent comes first.
 */
export function discoverAgents(ocCfg) {
  const raw = ocCfg?.agents?.entries ?? ocCfg?.agents?.list ?? {};
  const list = Array.isArray(raw) ? raw.map((e) => ({ id: e.id, ...e })) : Object.entries(raw).map(([id, e]) => ({ id, ...(e ?? {}) }));
  const ordered = [...list.filter((e) => e.id === DEFAULT_AGENT_ID), ...list.filter((e) => e.id !== DEFAULT_AGENT_ID)];
  return ordered.filter((e) => e.id && e.enabled !== false).map((e, i) => normalizeAgent({
    id: e.id, name: e.identity?.name ?? e.name ?? undefined, glyph: e.identity?.emoji ?? undefined,
  }, i));
}

/** Parse config/agents.json (or another file); null when absent. */
export function readAgentsFile(file) {
  if (!file || !existsSync(file)) return null;
  const agents = JSON.parse(readFileSync(file, "utf8")).agents ?? [];
  return agents.map(normalizeAgent);
}

/**
 * Resolve the roster. `env.JARVIS_AGENTS_FILE` points to an alternate file (a non-existent path
 * forces discovery — handy to test the auto mode without touching the local config).
 * Returns { agents, source }.
 */
export function loadAgents({ app, ocCfg, env = process.env }) {
  const local = env.JARVIS_AGENTS_FILE ?? join(app, "config/agents.json");
  const fromFile = readAgentsFile(local);
  if (fromFile?.length) return { agents: fromFile, source: local };
  const discovered = discoverAgents(ocCfg);
  if (discovered.length) return { agents: discovered, source: "openclaw.json" };
  const example = readAgentsFile(join(app, "config/agents.example.json"));
  if (example?.length) return { agents: example, source: "config/agents.example.json" };
  throw new Error("aucun agent : ni config/agents.json, ni agents.entries dans ~/.openclaw/openclaw.json");
}

// ───────────────────────────── Whisper prompt ─────────────────────────────
// Whisper's prompt must be complete example utterances, not a bare list of names: a list made the
// model hallucinate names on bad audio (measured). Built from the roster so that the
// agents' spellings are known to the recogniser.
const PROMPT_TEMPLATES = ["{N}, quelle heure est-il ?", "{N}, relis le rapport.", "{N}, annule.", "{N}, où en est la livraison ?", "{N}, vérifie les sauvegardes.", "{N}, quel temps fait-il ?", "{N}, résume ma journée.", "{N}, combien font douze fois douze ?"];

export function buildSttPrompt(agents) {
  if (!agents.length) return "";
  const n = Math.min(12, Math.max(agents.length, 4));
  const parts = Array.from({ length: n }, (_, i) => PROMPT_TEMPLATES[i % PROMPT_TEMPLATES.length].replace("{N}", agents[i % agents.length].name));
  parts.splice(1, 0, "Stop.");
  return parts.join(" ") + " Stop.";
}

// ───────────────────────────── voice assignment ─────────────────────────────
// Mirrors tts/tts_server.py (same hash, same probing) so both sides agree without talking.
export function fnv1a(s) {
  let h = 2166136261;
  for (const b of Buffer.from(String(s), "utf8")) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h;
}

/**
 * agent id → voice id. Explicit `voice` wins; otherwise a deterministic slot (hash of the id) in the
 * catalogue, moving to the next free voice on collision so a small team gets distinct timbres.
 */
export function assignVoices(agents, voiceIds) {
  const out = new Map();
  if (!voiceIds.length) return out;
  const taken = new Set();
  for (const a of agents) if (a.voice && voiceIds.includes(a.voice)) { out.set(a.id, a.voice); taken.add(a.voice); }
  for (const a of agents) {
    if (out.has(a.id)) continue;
    const start = fnv1a(a.id) % voiceIds.length;
    let pick = voiceIds[start];
    for (let k = 0; k < voiceIds.length; k++) { const v = voiceIds[(start + k) % voiceIds.length]; if (!taken.has(v)) { pick = v; break; } }
    out.set(a.id, pick); taken.add(pick);
  }
  return out;
}

/** Ids of the voice catalogue (vendor/voices/voices.json), in file order; private `_` keys skipped. */
export function readVoiceIds(file) {
  if (!existsSync(file)) return [];
  return Object.keys(JSON.parse(readFileSync(file, "utf8")).voices ?? {}).filter((k) => !k.startsWith("_"));
}
