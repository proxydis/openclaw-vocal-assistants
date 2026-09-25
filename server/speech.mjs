// Turns a streaming agent reply into (a) sentences to speak and (b) markdown detail for the screen.
// The agent is asked to open with <voix>…</voix>; everything after it is on-screen detail.

/** True when the user explicitly asks for something on screen in a browser window ("ouvre le site…",
 * "montre-moi la doc dans une fenêtre", "affiche la page…"). Agents must not open windows on their own. */
export function wantsWindow(text) {
  const t = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/\b(fenetres?|navigateur|onglets?|browser)\b/.test(t)) return true;
  return /\b(ouvr\w*|affich\w*|montr\w*|fais[- ]moi voir|va sur|charge)\b.{0,40}\b(page|site|lien|url|web|doc|documentation|adresse)s?\b/.test(t);
}

/** System brief prepended to every utterance. `userName` comes from config/settings.json (may be empty).
 * `allowWindow`: the <fenetre> instruction is only given when the user explicitly asked for a page. */
export const voiceBrief = (userName, allowWindow = false) =>
  `[Canal vocal JARVIS — ${userName ? userName + " te parle" : "l'utilisateur te parle"} à voix haute et ta réponse sera lue par une synthèse vocale française. ` +
  "Commence TOUJOURS ta réponse par un bloc <voix>…</voix> : une à deux phrases courtes en français parlé, naturelles, " +
  "sans markdown, sans liste, sans URL, sans code, sans emoji. Après ce bloc, et seulement si c'est utile, donne le détail " +
  "en markdown : il sera affiché à l'écran, pas lu. Si tout tient dans le bloc <voix>, n'ajoute rien. " +
  (allowWindow
    ? "L'utilisateur demande explicitement une page : ajoute dans le détail une ligne <fenetre url=\"https://…\" titre=\"…\"/> " +
      "par page demandée, elle s'ouvrira dans une fenêtre navigateur à l'écran.]"
    : "N'ouvre aucune fenêtre navigateur : l'utilisateur ne l'a pas demandé.]");

const WINDOW_TAG = /<fenetre\b([^>]*?)\/?>(?:\s*<\/fenetre>)?/gi;
const attr = (s, name) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(s)?.[1] ?? new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i").exec(s)?.[1];

/** Extract <fenetre url="…" titre="…"/> tags; returns [{ url, title }] with only http(s) URLs. */
export function extractWindows(text) {
  const out = [];
  for (const m of text.matchAll(WINDOW_TAG)) {
    const url = attr(m[1], "url") ?? attr(m[1], "href");
    if (url && /^https?:\/\//i.test(url)) out.push({ url, title: attr(m[1], "titre") ?? attr(m[1], "title") ?? url.replace(/^https?:\/\//, "").slice(0, 60) });
  }
  return out;
}
export const stripWindows = (text) => text.replace(WINDOW_TAG, "").replace(/\n{3,}/g, "\n\n").trim();

const MAX_SPOKEN_SENTENCES_FALLBACK = 2;

/** Make text safe and pleasant for a French TTS engine. */
export function cleanForSpeech(t) {
  return t
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<fenetre[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~#>|]+/g, " ")
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split off complete sentences; returns [sentences[], remainder]. */
export function takeSentences(buf, flush = false) {
  const out = [];
  // A sentence ends on punctuation followed by whitespace (so "3.5" or "v2.1" stay whole) or on a newline.
  const re = /([.!?…]+)(\s+|$)|\n+/g;
  let last = 0, m;
  while ((m = re.exec(buf))) {
    const end = re.lastIndex;
    // Punctuation at the very end of the buffer may still grow ("fini." → "fini.5"): wait unless flushing.
    if (m[1] && m[2] === "" && !flush) break;
    out.push(buf.slice(last, end).trim());
    last = end;
    if (m[0] === "") re.lastIndex++;
  }
  let rest = buf.slice(last);
  if (flush && rest.trim()) { out.push(rest.trim()); rest = ""; }
  return [out.filter((s) => /[\p{L}\p{N}]/u.test(s)), rest];
}

export class ReplyStream {
  constructor() { this.full = ""; this.spokenUpTo = 0; this.pending = ""; this.spoken = []; this.mode = "unknown"; }

  /** Feed the full accumulated text so far. Returns newly completed sentences to speak. */
  update(fullText, final = false) {
    this.full = fullText;
    const open = fullText.indexOf("<voix>");
    if (open === -1) {
      // Tag may still be arriving ("<vo"). Decide only once enough text exists, or at the end.
      if (!final && fullText.trimStart().length < 12) return [];
      if (!final && "<voix>".startsWith(fullText.trimStart().slice(0, 6))) return [];
      if (!final) return [];
      this.mode = "fallback";
      const [sentences] = takeSentences(cleanForSpeech(fullText), true);
      const pick = sentences.slice(0, MAX_SPOKEN_SENTENCES_FALLBACK);
      this.spoken = pick;
      return pick;
    }
    this.mode = "tagged";
    const close = fullText.indexOf("</voix>", open);
    let voiced = fullText.slice(open + 6, close === -1 ? undefined : close);
    if (close === -1) voiced = voiced.replace(/<\/?v?o?i?x?$/, ""); // partial closing tag in flight
    const fresh = voiced.slice(this.spokenUpTo);
    const [sentences, rest] = takeSentences(fresh, close !== -1 || final);
    this.spokenUpTo = voiced.length - rest.length;
    const cleaned = sentences.map(cleanForSpeech).filter(Boolean);
    this.spoken.push(...cleaned);
    return cleaned;
  }

  /** Markdown shown on screen (everything outside the voice block). */
  get detail() {
    if (this.mode === "fallback") return stripWindows(this.full);
    const close = this.full.indexOf("</voix>");
    if (close === -1) return "";
    return stripWindows(this.full.slice(0, this.full.indexOf("<voix>")) + this.full.slice(close + 7));
  }

  get spokenText() { return this.spoken.join(" "); }
}

/** OpenClaw transcript (chat.history messages) → conversation entries for the history window:
 * [{ who: "user"|"agent", ts, text, detail }]. Keeps what was actually said: the user's sentence without
 * the voice brief the app prepends, and the agent's spoken <voix> part with its on-screen detail.
 * Tool calls, tool results and empty or silent replies are left out. */
const BRIEF = /^\[Canal vocal JARVIS[\s\S]*?\]\s*/;
const SILENT = /^(NO_REPLY|No response requested\.?)$/i;
export function historyEntries(messages = []) {
  const out = [];
  const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n") : "";
  for (const m of messages) {
    const ts = Number(m?.timestamp) || null;
    if (m?.role === "user") {
      if (Array.isArray(m.content) && m.content.some((p) => p?.type === "tool_result")) continue;
      const text = textOf(m.content).replace(BRIEF, "").trim();
      if (text) out.push({ who: "user", ts, text });
    } else if (m?.role === "assistant") {
      const raw = textOf(m.content).trim();
      if (!raw || SILENT.test(raw)) continue;
      const open = raw.indexOf("<voix>"), close = raw.indexOf("</voix>", open);
      if (open !== -1) {
        const voiced = raw.slice(open + 6, close === -1 ? undefined : close);
        const rest = close === -1 ? "" : raw.slice(0, open) + raw.slice(close + 7);
        out.push({ who: "agent", ts, text: voiced.replace(/\s+/g, " ").trim(), detail: stripWindows(rest) }); // markdown, rendered by the page
      } else out.push({ who: "agent", ts, text: "", detail: stripWindows(raw) });
    }
  }
  return out;
}
