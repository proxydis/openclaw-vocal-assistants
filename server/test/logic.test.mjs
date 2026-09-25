import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { route, findCall, echoScore } from "../router.mjs";
import { ReplyStream, takeSentences, cleanForSpeech, wantsWindow, voiceBrief, historyEntries } from "../speech.mjs";

// Fixture = the example team shipped with the repo (config/agents.example.json), so the assertions
// below hold whatever the local config/agents.json says.
const { agents } = JSON.parse(readFileSync(new URL("../../config/agents.example.json", import.meta.url)));
const ctx = (o = {}) => ({ agents, activeAgent: null, followUpUntil: 0, now: 1000, ...o });

test("appel par prénom en tête", () => {
  assert.deepEqual(route("Neo, lance les tests du projet.", ctx()), { kind: "message", agentId: "neo", text: "lance les tests du projet." });
  assert.equal(route("Hey Alan tu es là ?", ctx()).agentId, "alan");
  assert.equal(route("Dis-moi Éva, quel temps fait-il ?", ctx()).agentId, "eva");
  assert.equal(route("Morphéus, vérifie les sauvegardes", ctx()).agentId, "morpheus");
  assert.equal(route("Axiome, résume ma journée", ctx()).agentId, "main");
});

test("prénom en fin de phrase", () => {
  const r = route("Tu peux vérifier la CI, Trinity ?", ctx());
  assert.equal(r.kind, "message"); assert.equal(r.agentId, "trinity"); assert.equal(r.text, "Tu peux vérifier la CI?");
});

test("prénom seul = réveil", () => {
  assert.deepEqual(route("Ada ?", ctx()), { kind: "wake", agentId: "ada" });
  assert.deepEqual(route("Ok Neo.", ctx()), { kind: "wake", agentId: "neo" });
});

test("sans prénom : ignoré, sauf fenêtre de suivi", () => {
  assert.equal(route("Il faudrait penser à acheter du pain.", ctx()).kind, "ignored");
  const r = route("Et pour demain ?", ctx({ activeAgent: "eva", followUpUntil: 5000 }));
  assert.deepEqual(r, { kind: "message", agentId: "eva", text: "Et pour demain ?", followUp: true });
  assert.equal(route("Et pour demain ?", ctx({ activeAgent: "eva", followUpUntil: 500 })).kind, "ignored");
});

test("un autre agent peut être appelé pendant qu'un premier est actif", () => {
  const r = route("Ada, relis le rapport.", ctx({ activeAgent: "neo", followUpUntil: 99999 }));
  assert.equal(r.agentId, "ada");
});

test("stop et annulation", () => {
  assert.equal(route("Stop.", ctx({ speaking: true })).kind, "stop");
  assert.equal(route("Stop !", ctx()).kind, "stop");
  assert.equal(route("Neo, stop", ctx({ speaking: true })).kind, "stop");
  assert.equal(route("Arrête", ctx({ speaking: true })).kind, "stop");
  assert.deepEqual(route("Neo, annule", ctx()), { kind: "cancel", agentId: "neo" });
  assert.equal(route("Neo, arrête le serveur de staging et relance-le", ctx()).kind, "message");
});

test("pendant la parole : seul un appel explicite passe, l'écho est rejeté", () => {
  const spokenText = "Les tests sont passés, tout est vert sur la branche principale.";
  assert.equal(route("les tests sont passés tout est vert", ctx({ speaking: true, spokenText, activeAgent: "neo", followUpUntil: 99999 })).kind, "ignored");
  assert.equal(route("Ada, tu as fini ?", ctx({ speaking: true, spokenText })).agentId, "ada");
  assert.ok(echoScore("les tests sont passés tout est vert", spokenText) > 0.6);
});

test("hallucinations Whisper ignorées", () => {
  for (const t of ["Sous-titres réalisés par la communauté d'Amara.org", "Merci.", "...", "[Musique]"]) assert.equal(route(t, ctx({ activeAgent: "neo", followUpUntil: 99999 })).kind, "ignored");
});

test("pas de faux positifs sur des mots proches", () => {
  assert.equal(findCall("Il y avait un problème", agents), null);
  assert.equal(findCall("Un néon est cassé dans le garage", agents), null);
});

test("découpage en phrases", () => {
  assert.deepEqual(takeSentences("Bonjour. Il est 3.5 fois plus rapide ! Et la suite")[0], ["Bonjour.", "Il est 3.5 fois plus rapide !"]);
  assert.deepEqual(takeSentences("C'est fini.")[0], []); // may still grow ("fini.5")
  assert.deepEqual(takeSentences("C'est fini.", true)[0], ["C'est fini."]);
});

test("flux de réponse balisé <voix>", () => {
  const rs = new ReplyStream();
  const full = "<voix>C'est fait. Les douze tests passent.</voix>\n\n## Détail\n- `pytest` : 12 OK";
  const said = [];
  for (let i = 1; i <= full.length; i++) said.push(...rs.update(full.slice(0, i), i === full.length));
  assert.deepEqual(said, ["C'est fait.", "Les douze tests passent."]);
  assert.equal(rs.detail, "## Détail\n- `pytest` : 12 OK");
});

test("réponse sans balise : deux premières phrases, détail complet", () => {
  const rs = new ReplyStream();
  assert.deepEqual(rs.update("**Oui.** Voici le plan. Étape une. Étape deux.", false), []);
  assert.deepEqual(rs.update("**Oui.** Voici le plan. Étape une. Étape deux.", true), ["Oui.", "Voici le plan."]);
  assert.match(rs.detail, /Étape deux/);
});

test("nettoyage pour la synthèse", () => {
  assert.equal(cleanForSpeech("Voir [la doc](https://x.y) et `npm test` ✅ https://a.b/c"), "Voir la doc et npm test");
});

test("fenêtres navigateur : seulement sur demande explicite", () => {
  for (const t of ["montre-moi la doc de Piper dans une fenêtre", "ouvre le site de Météo-France", "affiche la page GitHub du projet",
    "mets ça dans le navigateur", "ouvre un onglet sur le dépôt"]) assert.equal(wantsWindow(t), true, t);
  for (const t of ["quelle heure est-il ?", "résume la documentation de Piper", "ouvre la carte Trello", "lance les tests",
    "montre-moi le résultat"]) assert.equal(wantsWindow(t), false, t);
  assert.match(voiceBrief("", false), /N'ouvre aucune fenêtre/);
  assert.doesNotMatch(voiceBrief("", false), /<fenetre/);
  assert.match(voiceBrief("", true), /<fenetre url=/);
});

test("historique : phrases dites, sans brief ni outils", () => {
  const brief = voiceBrief("Ada", false);
  const e = historyEntries([
    { role: "user", timestamp: 1000, content: `${brief}\n\nquelle heure est-il ?` },
    { role: "assistant", timestamp: 1100, content: [{ type: "toolcall", name: "Bash" }] },
    { role: "user", timestamp: 1150, content: [{ type: "tool_result", content: "12:00" }] },
    { role: "assistant", timestamp: 1200, content: [{ type: "text", text: "<voix>Il est **midi**.</voix>\n\n| a | b |\n<fenetre url=\"https://x.fr\" titre=\"X\"/>" }] },
    { role: "assistant", timestamp: 1300, content: [{ type: "text", text: "No response requested." }] },
    { role: "assistant", timestamp: 1400, content: [{ type: "text", text: "Réponse sans bloc voix." }] },
  ]);
  assert.deepEqual(e, [
    { who: "user", ts: 1000, text: "quelle heure est-il ?" },
    { who: "agent", ts: 1200, text: "Il est **midi**.", detail: "| a | b |" },
    { who: "agent", ts: 1400, text: "", detail: "Réponse sans bloc voix." },
  ]);
});
