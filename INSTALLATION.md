# Installation — assistant vocal JARVIS pour OpenClaw

Tout vit dans le dossier du dépôt (ci-dessous `app/`, où que vous l'ayez cloné : `bin/jarvis install` écrit les chemins réels dans les unités systemd). Une fois installés, les services démarrent seuls à l'allumage : cette page sert à comprendre, réinstaller ou déplacer l'outil.

## 1. Vue d'ensemble

```
Navigateur (PC / tablette / mobile)          Machine hôte
┌──────────────────────────────┐   HTTPS    ┌─────────────────────────────────────────────┐
│ micro → détection de voix    │ ─────────▶ │ jarvis-web  (Node, :8443)                   │
│ orbe, sous-titres, lecture   │ ◀───────── │   ├─▶ jarvis-stt          Whisper small, GPU │
└──────────────────────────────┘  WebSocket │   ├─▶ jarvis-stt-precise  Whisper turbo, GPU │
                                            │   ├─▶ jarvis-tts          catalogue voix FR  │
                                            │   └─▶ Gateway OpenClaw (loopback :18789)    │
                                            └─────────────────────────────────────────────┘
```

| Service | Rôle | Écoute |
|---|---|---|
| `jarvis-web` | page web, pont vers la Gateway, réveil par prénom, mise en voix | `0.0.0.0:8443` (HTTPS) et `127.0.0.1:8480` (HTTP local) |
| `jarvis-stt` | Whisper `small` sur la Radeon 680M (énoncés courts) | `127.0.0.1:8178` |
| `jarvis-stt-precise` | Whisper `large-v3-turbo` q5 sur la Radeon 680M (phrases) | `127.0.0.1:8188` |
| `jarvis-tts` | point d'entrée synthèse vocale : chiffres écrits en toutes lettres (`tts/fr_normalize.py`), puis route vers Supertonic, Pocket TTS, OpenVoice, Kokoro ou Piper selon la voix ; Piper en repli | `127.0.0.1:8179` |
| `jarvis-tts-st` | Supertonic 3 (Supertone, français natif, 10 styles de voix intégrés, vitesse native, CPU) | `127.0.0.1:8182` |
| `jarvis-tts-pk` (désactivé) | Pocket TTS (Kyutai) : timbres clonés (`vendor/voices/refs/`), jeton HF dans `config/hf-token.txt` ; moteur précédent, retour arrière possible | `127.0.0.1:8181` |
| `jarvis-tts-ov` (désactivé) | MeloTTS + OpenVoice v2, alternative plus lourde aux mêmes timbres | `127.0.0.1:8180` |

## 2. Prérequis

- Linux x86-64 avec pilote Vulkan (Mesa RADV pour AMD), `gcc`/`g++`, `curl`, Node.js ≥ 22.19, [`uv`](https://docs.astral.sh/uv/).
- OpenClaw installé, Gateway locale en service, jeton dans `~/.openclaw/openclaw.json`.
- Aucun droit root nécessaire. Environ 6 Go de disque (SDK Vulkan, modèles Whisper, voix, torch) et ≈ 1,3 Go de RAM en fonctionnement (dont ≈ 0,7 Go pour Supertonic 3).

## 3. Installation depuis zéro

```bash
cd app   # le dossier du dépôt

# a) Reconnaissance vocale GPU — commandes détaillées et pièges : vendor/WHISPER.md
#    (cmake via uv, SDK Vulkan LunarG en tarball, whisper.cpp v1.9.4 avec -DGGML_VULKAN=1,
#     modèles ggml-small.bin et ggml-large-v3-turbo-q5_0.bin dans vendor/models/)

# b) Synthèse vocale — détails : vendor/voices/TTS.md
uv venv .venv
uv pip install --python .venv/bin/python piper-tts onnxruntime numpy scipy soundfile
uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cpu   # CPU seulement
uv pip install --python .venv/bin/python kokoro   # Kokoro-82M ; poids téléchargés au 1er lancement dans vendor/tts-eval/hf_cache
#    voix fr_FR-siwis-medium, fr_FR-tom-medium, fr_FR-upmc-medium (.onnx + .onnx.json)
#    depuis https://huggingface.co/rhasspy/piper-voices → vendor/voices/models/

# b bis) Timbres clonés (MeloTTS + OpenVoice v2) — venv séparé Python 3.11, détails : vendor/tts-eval2/RAPPORT.md § installation
#    (uv venv --python 3.11 .venv-openvoice ; melo-tts, openvoice ; checkpoints_v2 depuis huggingface myshell-ai/OpenVoiceV2 ; python -m unidic download)

# b ter) Supertonic 3 (moteur par défaut) — dans app/.venv : uv pip install --python .venv/bin/python supertonic==1.3.1 num2words
#    Poids (≈ 390 Mo, OpenRAIL-M) téléchargés au premier démarrage de jarvis-tts-st dans vendor/supertonic3.

# b quater) Pocket TTS (moteur précédent, facultatif) — dans app/.venv : uv pip install --python .venv/bin/python pocket-tts
#    Poids de clonage "gated" : compte Hugging Face, accepter les conditions sur https://huggingface.co/kyutai/pocket-tts,
#    puis jeton (Read) dans config/hf-token.txt (chmod 600). Les poids se téléchargent au premier démarrage.

# c) Serveur web
cd server && npm ci && cd ..

# d) Services + certificat HTTPS + démarrage automatique
bin/jarvis install
```

`bin/jarvis install` copie les quatre unités dans `~/.config/systemd/user/`, les active, génère le certificat (`bin/make-certs.sh`, via mkcert téléchargé dans `vendor/`) et affiche les adresses. Pour que les services tournent sans session ouverte : `loginctl enable-linger $USER` (déjà actif sur la machine hôte).

## 4. Accès depuis un autre appareil du réseau

Le micro n'est accordé par les navigateurs qu'aux pages **HTTPS**. L'app utilise une autorité de certification locale qu'il faut faire connaître **une fois** à chaque appareil :

1. Sur l'appareil, ouvrir `https://<ip-de-la-machine>:8443/ca.crt` (accepter l'avertissement cette seule fois) : le fichier `jarvis-ca.crt` se télécharge. `bin/jarvis url` donne l'adresse exacte.
2. L'installer comme autorité de confiance :
   - **Android** : Paramètres → Sécurité → Chiffrement et identifiants → Installer un certificat → Certificat CA.
   - **iPhone/iPad** : ouvrir le fichier → Réglages → Profil téléchargé → Installer, puis Réglages → Général → Informations → Réglages de confiance des certificats → activer.
   - **Windows** : double-clic → Installer → Ordinateur local → « Autorités de certification racines de confiance ».
   - **macOS** : double-clic → Trousseau → « Toujours approuver ».
   - **Linux (Chrome/Firefox)** : Paramètres → Certificats → Autorités → Importer.
3. Ouvrir `https://<ip-de-la-machine>:8443`, saisir le code d'accès (`bin/jarvis code` sur la machine hôte), autoriser le micro.
4. Facultatif : « Ajouter à l'écran d'accueil » pour l'avoir en plein écran comme une application.

Si l'IP de la machine hôte change : `bin/jarvis certs` régénère le certificat (l'autorité, elle, ne change pas : rien à refaire sur les appareils). Une IP fixe (bail DHCP réservé sur la box) évite le problème.
Si un pare-feu est actif sur la machine hôte : `sudo ufw allow from 192.168.1.0/24 to any port 8443 proto tcp`.

**Variante Tailscale** (non installée) : `tailscale serve --bg https+insecure://localhost:8443` donne une adresse `https://<machine>.<tailnet>.ts.net` avec un vrai certificat, sans rien importer sur les appareils.

## 5. Commandes

| Commande | Effet |
|---|---|
| `bin/jarvis status` | état des 4 services + liaison Gateway |
| `bin/jarvis start` / `stop` / `restart` | pilotage des services |
| `bin/jarvis logs` | journaux en direct |
| `bin/jarvis url` | adresses d'accès |
| `bin/jarvis code` | code d'accès (pour en changer : supprimer `config/access-code.txt` puis `bin/jarvis restart`) |
| `bin/jarvis certs` | régénérer le certificat HTTPS |
| `bin/jarvis test` | tests unitaires + bout en bout + scénario multi-agents |
| `bin/jarvis uninstall` | retirer les services (les fichiers restent) |

## 6. Configuration

| Fichier | Contenu |
|---|---|
| `config/agents.json` (facultatif) | agents affichés, alias de prénom reconnus par Whisper, couleur, voix (`voice`). Absent : les agents sont lus dans `~/.openclaw/openclaw.json` (`agents.entries`) et tout est attribué automatiquement. Modèle : `config/agents.example.json` |
| `config/settings.json` | ports, fenêtre de suivi (`followUpMs`), phrases de réveil, seuil court/long de Whisper, amorce Whisper `sttPrompt` (facultative, générée sinon) |
| `config/pronunciation.json` | comment prononcer sigles et anglicismes (et les prénoms de vos agents si besoin) |
| `vendor/voices/voices.json` | **catalogue** de voix (`fr-m-clair`, `fr-f-douce`, …) : moteur (`supertonic`/`pockettts`/`openvoice`/`kokoro`/`piper`), style Supertonic (`F1`-`F5`, `M1`-`M5`) et vitesse, débit, hauteur, effet robot — vérifier avec `.venv/bin/python tts/voice_qa.py` |
| `web/avatars/<prénom en minuscules, sans accents>.jpg` | avatar de l'agent (sinon sigle généré) |

Ajouter un agent : le déclarer dans OpenClaw suffit (redémarrer `jarvis-web` et `jarvis-tts` : `bin/jarvis restart`). Pour affiner : un bloc dans `config/agents.json` (l'`id` est celui d'OpenClaw) avec ses alias, sa couleur et sa `voice` du catalogue ; pour une nouvelle voix, une entrée dans `voices.json` (extrait de référence dans `vendor/voices/refs/`, licence dans `SOURCES.md`).

## 7. Tests

- `node --test test/*.test.mjs` — logique de réveil/stop/écho, découpage des réponses, découverte des agents, amorce Whisper, attribution des voix (sur l'équipe d'exemple `config/agents.example.json`).
- `node test/e2e.mjs "<Prénom>, quelle heure est-il ?"` — une phrase synthétisée est envoyée comme le ferait le micro ; affiche transcription, routage, audio reçu et délais (sans argument : le premier agent).
- `node test/scenario.mjs` — deux agents en parallèle, « stop » pendant la parole, « annule ».
- `node test/ui.mjs --viewport 390x844` — Chrome sans écran avec **faux micro** : exerce la vraie page de bout en bout et produit des captures dans `/tmp/jarvis`.
- `.venv/bin/python tts/voice_qa.py` — intelligibilité de chaque voix (synthèse → retranscription).

## 8. Dépannage

| Symptôme | Piste |
|---|---|
| « Micro indisponible » | page ouverte en HTTP non local, ou autorité non importée (étape 4), ou micro refusé dans le navigateur |
| « liaison perdue » | Gateway arrêtée : `openclaw status`, puis `bin/jarvis restart` |
| « Reconnaissance vocale indisponible » | `journalctl --user -u jarvis-stt-precise -n 50` ; vérifier la ligne `ggml_vulkan: … AMD Radeon` |
| L'agent se réveille mal à son prénom | regarder ce que Whisper a écrit (sous-titre gris) et l'ajouter aux `aliases` |
| Un mot est mal prononcé | l'ajouter à `config/pronunciation.json` |
| Un nombre, une heure, une date ou un montant mal lu | ajouter le cas (et son test) dans `tts/fr_normalize.py` / `tts/test_fr_normalize.py` ; si seul Supertonic l'écorche, une graphie phonétique dans `supertonic_respell()`, validée avec `tts/voice_qa.py` |
| Revenir à Pocket TTS | `engine: pockettts` pour chaque voix de `vendor/voices/voices.json`, `systemctl --user enable --now jarvis-tts-pk`, `bin/jarvis restart` |
| L'agent s'entend lui-même | baisser le volume, éloigner le micro des enceintes, ou utiliser un casque |
