// Maps raw tool names to a tiny French label + icon family for the activity view.
// Deliberately terse: the UI shows at most two words per action, never arguments.
const RULES = [
  [/^(read|view|cat|notebookread)|file_fetch|memory_get/i, "lecture", "file"],
  [/^(write|edit|multiedit|notebookedit)|file_write|apply_patch/i, "écriture", "edit"],
  [/^(bash|exec|shell|process|terminal)/i, "commande", "term"],
  [/^(grep|glob|ls|find|search_files|dir_list|toolsearch)/i, "exploration", "scan"],
  [/web_?search|perplexity|brave|tavily/i, "recherche web", "web"],
  [/web_?fetch|browser|navigate|playwright/i, "navigation", "web"],
  [/memory|recall|wiki/i, "mémoire", "mem"],
  [/^(agent|task)$|sessions_spawn|subagent|sessions_send|agents_wait|workflow/i, "délégation", "team"],
  [/message|slack|telegram|discord|email|gmail/i, "message", "msg"],
  [/image|video|music|tts|canvas|pdf|view_image/i, "média", "media"],
  [/cron|schedule|goal|progress|todo|plan/i, "planification", "plan"],
  [/git|github|gh_/i, "dépôt git", "git"],
];

export function describeTool(name = "") {
  const bare = String(name).replace(/^mcp__[^_]+(?:_[^_]+)*__/, "");
  for (const [re, label, icon] of RULES) if (re.test(bare) || re.test(name)) return { label, icon };
  return { label: "outil", icon: "tool" };
}
