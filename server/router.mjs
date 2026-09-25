// Pure routing logic: decides what a transcribed utterance means.
// No I/O here so it can be unit-tested (see test/router.test.mjs).

export const normalize = (s) =>
  s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim();

const STOP_WORDS = new Set(["stop", "stoppe", "stope", "arrete", "arretes", "arretez", "silence", "chut", "tais-toi", "tais", "suffit", "pause"]);
const CANCEL_WORDS = new Set(["annule", "annuler", "annulez", "abandonne", "abandonner"]);
const FILLERS = new Set(["hey", "he", "eh", "ok", "okay", "dis", "dis-moi", "salut", "bonjour", "bonsoir", "s'il", "te", "plait", "merci", "euh", "alors", "et", "oh", "ah", "allo"]);
// Whisper hallucinations on noise/silence — never route these.
const HALLUCINATIONS = [
  /sous-?titr/, /amara\.?org/, /merci d'avoir regarde/, /abonnez-?vous/, /^merci\.?$/, /^\.+$/, /^\[.*\]$/, /^\(.*\)$/, /^musique$/, /^a bientot\.?$/,
];

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Returns agent id if `token` is a name/alias. Fuzzy (1 edit) only for names >= 5 letters. */
export function matchAgentToken(token, agents) {
  for (const a of agents) for (const al of a.aliases) if (token === al) return a.id;
  if (token.length >= 5) for (const a of agents) for (const al of a.aliases) if (al.length >= 5 && lev(token, al) <= 1) return a.id;
  return null;
}

/**
 * Find an agent name in the utterance. A name counts as a call when it sits in the leading
 * tokens (after fillers) or is the very last token ("tu peux vérifier ça, <Prénom> ?").
 * Returns { agentId, rest } with the name removed from the message, or null.
 */
export function findCall(text, agents) {
  const rawTokens = text.trim().split(/\s+/);
  const norm = rawTokens.map((t) => normalize(t));
  let lead = 0;
  while (lead < norm.length && (FILLERS.has(norm[lead]) || norm[lead] === "")) lead++;
  let tail = norm.length - 1;
  while (tail > 0 && norm[tail] === "") tail--; // skip a detached "?" or "!"
  const candidates = [lead, lead + 1, tail].filter((i, k, arr) => i >= 0 && i < norm.length && arr.indexOf(i) === k);
  for (const i of candidates) {
    const id = matchAgentToken(norm[i].replace(/'s$/, ""), agents);
    if (!id) continue;
    const kept = rawTokens.filter((_, k) => k !== i && !(k < i && i <= lead + 1 && FILLERS.has(norm[k])));
    const rest = kept.join(" ").replace(/^[\s,;:.!?-]+/, "").replace(/\s+([,.!?])/g, "$1").replace(/[,;:]+([.!?])/g, "$1").replace(/[,;:\s]+$/, "").trim();
    return { agentId: id, rest };
  }
  return null;
}

export const isHallucination = (text) => {
  const n = normalize(text);
  return n.length < 2 || HALLUCINATIONS.some((re) => re.test(n));
};

/** Rough similarity (token overlap) used to drop echoes of the assistant's own speech. */
export function echoScore(heard, spoken) {
  const h = normalize(heard).split(" ").filter((t) => t.length > 2);
  if (h.length < 3) return 0;
  const s = new Set(normalize(spoken).split(" "));
  return h.filter((t) => s.has(t)).length / h.length;
}

/**
 * ctx: { agents, activeAgent, followUpUntil, now, speaking, spokenText }
 * → { kind: "stop" | "cancel" | "wake" | "message" | "ignored", agentId?, text?, reason? }
 */
export function route(text, ctx) {
  const { agents, activeAgent, followUpUntil = 0, now = Date.now(), speaking = false, spokenText = "" } = ctx;
  if (isHallucination(text)) return { kind: "ignored", reason: "bruit" };
  const tokens = normalize(text).split(" ").filter(Boolean);
  const call = findCall(text, agents);
  const core = tokens.filter((t) => !FILLERS.has(t) && !matchAgentToken(t, agents));

  if (tokens.length <= 4 && core.length <= 2 && core.some((t) => STOP_WORDS.has(t))) return { kind: "stop", agentId: call?.agentId };
  if (tokens.length <= 5 && core.length <= 3 && core.some((t) => CANCEL_WORDS.has(t))) return { kind: "cancel", agentId: call?.agentId ?? activeAgent };

  // While an agent is talking the mic hears the speakers: only explicit calls get through.
  if (speaking && !call) return { kind: "ignored", reason: echoScore(text, spokenText) > 0.5 ? "écho" : "agent en train de parler" };
  if (speaking && call && echoScore(text, spokenText) > 0.6) return { kind: "ignored", reason: "écho" };

  if (call) {
    const restCore = normalize(call.rest).split(" ").filter((t) => t && !FILLERS.has(t));
    if (restCore.length === 0) return { kind: "wake", agentId: call.agentId };
    return { kind: "message", agentId: call.agentId, text: call.rest };
  }
  if (activeAgent && now < followUpUntil) return { kind: "message", agentId: activeAgent, text: text.trim(), followUp: true };
  return { kind: "ignored", reason: "aucun agent appelé" };
}
