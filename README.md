# J.A.R.V.I.S — a local voice interface for your OpenClaw agents

Talk to your [OpenClaw](https://github.com/openclaw/openclaw) agents by name, from any browser on your
local network. Say *"Neo, lance les tests"* and Neo wakes up, works, answers out loud with his own
voice, and shows the details on screen. Call Ada while Neo is still busy: she starts in parallel.

Speech recognition and speech synthesis run **100 % on your machine** (no cloud service, no
subscription). The agents are your normal OpenClaw agents, reached through your local OpenClaw
Gateway, with their own sessions, tools and memory.

> **Language:** the voice pipeline is **French** today: Whisper runs with `-l fr`, the voices are
> French, and spoken numbers are written out in French. The interface text is French too. See
> [Limitations](#limitations).

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [User guide](#user-guide)
- [Configuration reference](#configuration-reference)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Licences and third-party components](#licences-and-third-party-components)
- [Licence](#licence)

More detailed documents, in French: [UTILISATION.md](UTILISATION.md) (day-to-day use) and
[INSTALLATION.md](INSTALLATION.md) (architecture and installation).

---

## Features

- **Wake by name.** Each OpenClaw agent answers to its own first name, at the start or at the end of a
  sentence. For two minutes after an answer you can keep talking to the same agent without repeating
  its name. Sentences without a name are shown in grey and sent to nobody.
- **Several agents at once.** Each agent works in its own OpenClaw session (`agent:<id>:jarvis`);
  calling a second agent never interrupts the first one. Asking an agent something while it is still
  working is fine too: the answer is not lost.
- **Voice control.** *"Stop"* cuts the voice (the task goes on); *"Neo, annule"* cancels Neo's task.
- **One voice per agent.** 7 distinct French voices (4 male including a robotic one, 3 female) from
  Supertonic 3, assigned automatically and consistently; Piper takes over automatically if Supertonic
  fails.
- **Numbers read properly.** Times, dates, amounts, percentages, units, phone numbers, versions and
  codes are written out in words before synthesis (*"14h30"* → *"quatorze heures trente"*). Subtitles
  keep the original digits.
- **Conversation history.** A button opens the whole history with an agent, day by day and time-stamped,
  read from its OpenClaw session.
- **Short spoken answers, details on screen.** Agents are asked to answer in one or two spoken
  sentences; tables, lists and code open in a floating window per agent.
- **Browser windows on request.** Ask for a page "in a window" and it is rendered by a headless Chrome
  on the host and streamed into the interface (even sites that forbid embedding).
- **Futuristic, responsive UI.** WebGL orb reacting to your voice and to the agent's voice,
  holographic avatars, live activity rail, word-by-word subtitles, startup sequence with sound effects
  synthesised in the browser. Works on desktop, tablet and phone.
- **Generic.** Nothing about your team is hard-coded: agents are discovered from your OpenClaw
  configuration.

## How it works

```
Browser (PC / tablet / phone)                  Host running the OpenClaw Gateway
┌──────────────────────────────┐    HTTPS     ┌───────────────────────────────────────────────────┐
│ microphone → voice detection │ ───────────▶ │ jarvis-web        Node, :8443 (LAN), :8480 (local) │
│ orb, subtitles, playback     │ ◀─────────── │  ├─▶ jarvis-stt          whisper.cpp small        │
└──────────────────────────────┘  WebSocket   │  ├─▶ jarvis-stt-precise  whisper.cpp large-v3-turbo│
                                              │  ├─▶ jarvis-tts          voice router + numbers   │
                                              │  │    └─▶ jarvis-tts-st  Supertonic 3             │
                                              │  └─▶ OpenClaw Gateway    loopback, chat.send      │
                                              └───────────────────────────────────────────────────┘
```

| Service (`systemd --user`) | Role | Listens on |
|---|---|---|
| `jarvis-web` | web page, WebSocket, wake-word routing, bridge to the OpenClaw Gateway | `0.0.0.0:8443` (HTTPS), `127.0.0.1:8480` (HTTP, local only) |
| `jarvis-stt` | whisper.cpp `small`: short utterances (names, "stop") | `127.0.0.1:8178` |
| `jarvis-stt-precise` | whisper.cpp `large-v3-turbo` (q5): full sentences | `127.0.0.1:8188` |
| `jarvis-tts` | text-to-speech entry point: pronunciation lexicon, numbers in words, voice routing, Piper fallback | `127.0.0.1:8179` |
| `jarvis-tts-st` | Supertonic 3 engine (ONNX, CPU) | `127.0.0.1:8182` |

The page detects when you speak (Silero VAD, running in the browser) and sends the audio to
`jarvis-web`. The server transcribes it with Whisper, finds which agent you called, and sends your
sentence to that agent with `chat.send` on the Gateway. The streamed answer is split into sentences,
each one synthesised as soon as it arrives and played back in the browser.

## Requirements

- **OS:** Linux with `systemd --user` (developed on Ubuntu 24.04, x86-64). macOS and Windows are not
  supported by the install script.
- **OpenClaw** installed on the **same machine**, with the Gateway running. `jarvis-web` reads the
  Gateway port, its token and your agents from `~/.openclaw/openclaw.json` and connects over loopback.
- **Node.js ≥ 22.19**, **Python 3.12** with [`uv`](https://docs.astral.sh/uv/), `git`, `curl`, a C/C++
  compiler (`gcc`/`g++`).
- **Speech recognition hardware:** a GPU with a Vulkan driver is recommended (Mesa RADV for AMD,
  including integrated GPUs; NVIDIA and Intel have Vulkan drivers too). whisper.cpp also builds for
  CPU only (slower) or for CUDA.
- **Resources:** about 6 GB of disk (Whisper models, voices, build tools) and about 1.3 GB of RAM when
  running (Supertonic about 0.7 GB). Reference machine: Ryzen 7 6800H with its integrated Radeon 680M.
- **Google Chrome** at `/usr/bin/google-chrome` (or set `JARVIS_CHROME`), only for browser windows.
- **No root needed**, except to open the HTTPS port if you run a firewall.

## Installation

All commands run from the repository folder, called `app/` below. Paths are resolved at install time,
so you can clone it anywhere.

```bash
git clone https://github.com/proxydis/openclaw-vocal-assistants.git app
cd app
```

### 1. Speech recognition (whisper.cpp)

```bash
uv tool install cmake && uv tool install ninja      # user-space build tools
export PATH="$HOME/.local/bin:$PATH"

cd vendor
git clone --depth 1 --branch v1.9.4 https://github.com/ggml-org/whisper.cpp.git whisper.cpp
cd whisper.cpp
# GPU (Vulkan): the Vulkan SDK is needed for the build only. Without root, the LunarG tarball works:
#   https://sdk.lunarg.com/sdk/download/latest/linux/vulkan-sdk.tar.xz  →  source <sdk>/setup-env.sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=1 -DWHISPER_SDL2=OFF
#   CPU only: drop -DGGML_VULKAN=1.   NVIDIA/CUDA: -DGGML_CUDA=1 instead.
cmake --build build --config Release -j 8
cd ../..

mkdir -p vendor/models
curl -L -o vendor/models/ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
curl -L -o vendor/models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

Make sure the GPU is really used: `vulkaninfo --summary` must list your GPU, and once the services run,
the `jarvis-stt-precise` log must show a `ggml_vulkan:` line naming it (not `llvmpipe`). Detailed notes
and benchmarks: [vendor/WHISPER.md](vendor/WHISPER.md).

### 2. Speech synthesis (Supertonic 3, with Piper as fallback)

```bash
uv venv -p 3.12 .venv
uv pip install --python .venv/bin/python piper-tts onnxruntime numpy scipy soundfile supertonic==1.3.1 num2words

# Piper voices (required: they are the fallback and are loaded at start-up)
mkdir -p vendor/voices/models
for v in siwis tom upmc; do for ext in onnx onnx.json; do
  curl -L -o "vendor/voices/models/fr_FR-$v-medium.$ext" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/$v/medium/fr_FR-$v-medium.$ext"
done; done
```

The Supertonic 3 weights (about 390 MB) are downloaded into `vendor/supertonic3/` the first time
`jarvis-tts-st` starts. Older optional engines (Kokoro, Pocket TTS, MeloTTS + OpenVoice) are described
in [INSTALLATION.md](INSTALLATION.md) § 3; they are not needed.

### 3. Web server

```bash
cd server && npm ci && cd ..
```

### 4. Services, HTTPS certificate, auto-start

```bash
bin/jarvis install                  # installs and starts the systemd --user units, creates the certificate
loginctl enable-linger "$USER"      # keeps the services running without an open session (once)
bin/jarvis status                   # every service "active", then {"ok":true,"gateway":true}
bin/jarvis url                      # the addresses to open
```

`bin/jarvis install` writes the units to `~/.config/systemd/user/`, enables them at boot, and creates a
local certificate authority and a server certificate with [mkcert](https://github.com/FiloSottile/mkcert)
(downloaded into `vendor/`) for every IP address and name of the machine.

### 5. Check

```bash
bin/jarvis test
```

Unit tests first, then an end-to-end check that really talks to your agents: a synthesised sentence
("<first agent>, dis simplement bonjour.") goes through Whisper and the Gateway, followed by a
two-agent scenario with "stop" and "annule".

## User guide

### Open the interface

- **On the host itself:** open `http://localhost:8480`. No certificate, no access code.
- **From another device on the network** (PC, tablet, phone): browsers only give the microphone to
  HTTPS pages, so each device must trust the app's local certificate authority **once**.
  1. Open `https://<host-ip>:8443/ca.crt` and accept the warning this one time: `jarvis-ca.crt`
     downloads. `bin/jarvis url` prints the exact address.
  2. Install it as a trusted authority:
     - **Windows:** double-click → Install → Local machine → "Trusted Root Certification Authorities".
     - **macOS:** double-click → Keychain Access → "Always Trust".
     - **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
     - **iPhone / iPad:** open the file → Settings → Profile Downloaded → Install, then Settings →
       General → About → Certificate Trust Settings → enable it.
     - **Linux (Chrome / Firefox):** Settings → Certificates → Authorities → Import.
  3. Open `https://<host-ip>:8443` and type the access code shown by `bin/jarvis code` on the host.
  4. Optional: "Add to Home Screen" for a full-screen, app-like experience.

  With a firewall, open the port for your LAN, for example
  `sudo ufw allow from 192.168.1.0/24 to any port 8443 proto tcp`. If the host's IP address changes,
  run `bin/jarvis certs`: devices keep trusting the same authority. With
  [Tailscale](https://tailscale.com), `tailscale serve --bg https+insecure://localhost:8443` gives a real
  certificate and nothing to import.
- Touch **ACTIVER** and allow the microphone. A ~4-second startup sequence plays; what the microphone
  hears during it is ignored. To mute its sound effects: `localStorage.setItem("jarvis.sfx", "off")` in
  the browser console. Then just talk.

### Talk to your agents

Your agents answer to the names they have in OpenClaw (see
[Adapt it to your OpenClaw setup](#adapt-it-to-your-openclaw-setup)). Examples with an agent called
*Neo*; you speak French:

| You say | What happens |
|---|---|
| « **Neo** » | Neo wakes up: the orb takes his colour, his avatar appears, he says he is listening. |
| « **Neo, lance les tests** » | Wake-up and request in one sentence. |
| « Tu peux vérifier la CI, **Neo** ? » | The name works at the end of the sentence too. |
| « Et sur la branche principale ? » (within 2 min) | Follow-up to the same agent, no name needed. |
| « **Ada, relis le rapport** » while Neo works | Ada starts in parallel; Neo's answer is read when it comes. |
| « **Stop** » (or « arrête », « silence », « chut ») | The voice stops at once. The task **goes on**. |
| « **Neo, annule** » | Neo's task is cancelled. |
| « Neo, **montre-moi** la doc de Piper **dans une fenêtre** » | Neo opens the page in a browser window. Agents only open windows when you explicitly ask for one. |

Good to know:

- A name **in the middle** of a sentence wakes nobody (« j'ai vu le rapport de Neo hier »).
- While an agent is speaking, only "stop" and a call by name are taken into account, so it never
  answers itself.
- The voice conversation lives in the agent's OpenClaw session `agent:<id>:jarvis`: you can read it in
  the OpenClaw Control UI, and the agent keeps the thread from one day to the next.
- Count about 4 s between the end of your sentence and the start of a simple answer; longer when the
  agent uses tools (you see it working on the orb and in the activity rail).

### Read the screen

- **Orb:** takes the active agent's colour. Calm = listening; converging waves = it hears you; spinning
  rings and sparks = thinking or using a tool; radiating waves = speaking.
- **Under the orb:** the agent's name and a status word (« à l'écoute », « réflexion », « recherche web »…).
- **Subtitles:** what you say (white) and what the agents say (in their colour, lit word by word).
  Ignored sentences turn grey, with the reason.
- **Agent rail** (left on large screens, top on phones): one ring per agent. Solid = active,
  spinning = working, dotted = busy elsewhere (Slack, Telegram, a scheduled job). On large screens,
  each agent has a 45-second pulse line: flat = idle, wavy = thinking, white spikes = tool calls,
  bars = speaking. Touch an agent to select it without speaking.
- **Windows:** details (tables, lists, code, links) in one floating window per agent, with the agent's
  avatar as a badge. Move them by the title bar, resize them by the corner, close them with `×`.

### Without your voice

| Action | Effect |
|---|---|
| Microphone button or `M` | mute / unmute the microphone |
| Red square button (while an agent speaks) or `Esc` | stop the voice |
| Keyboard button or `/` | type instead of speaking (« Neo, … ») |
| Clock button or `H` | conversation history with the current agent: every exchange, grouped by day, with the time of each message; switch agent with the tabs at the top. It is read from the agent's OpenClaw session, so it survives restarts and matches the Control UI |
| Silhouette button | change avatars: touch an avatar or drop an image on it (any format, cropped in the browser); « ↺ défaut » restores the original |

### Adapt it to your OpenClaw setup

Out of the box, nothing needs configuring: **your agents are discovered automatically** from
`agents.entries` in `~/.openclaw/openclaw.json` (id, `name` or `identity.name`, emoji). The default
agent `main` comes first; if it has no name in OpenClaw, it answers to **"Jarvis"** (the French word
*main* would wake it by accident). Each agent gets an alias (its name in lower case without accents,
plus its id), a neon colour and a voice from the catalogue, all stable from one start to the next.

After adding or renaming an agent in OpenClaw, run `bin/jarvis restart`.

To fine-tune, create local files. They are ignored by git; the `*.example.json` files show the format.

1. **Your name.** Copy `config/settings.example.json` to `config/settings.json` and set `userName`. It
   is used in the brief sent to the agents (« <your name> te parle à voix haute… ») and in greetings.
2. **Agents.** Copy `config/agents.example.json` to `config/agents.json` and replace the example team
   with your agents (`id` = the OpenClaw agent id). This file **replaces** the automatic discovery.
   For each agent you can set:
   - `name` and `aliases`, the spellings Whisper produces for the name: look at the grey subtitle when
     a call is missed and add what you see;
   - `color` and `glyph`;
   - `voice`, one of the catalogue voices: `fr-m-clair`, `fr-m-direct`, `fr-m-grave`,
     `fr-m-grave-robot`, `fr-f-douce`, `fr-f-precise`, `fr-f-ferme`.
3. **Pronunciation.** Copy `config/pronunciation.example.json` to `config/pronunciation.json` to force
   how a word is said (your name, agent names, acronyms). The voices read everything the French way,
   so a name whose final consonant must be heard needs a written final "e": `"Jordan": "Jordanne"`.
4. **Avatars.** Drop `web/avatars/<name in lower case, without accents>.jpg` (yourself: `user.jpg`), or
   use the avatar manager in the interface. Without an image, a holographic sigil is drawn.
5. **Voices.** `vendor/voices/voices.json` is the voice catalogue: engine, Supertonic style (`F1`-`F5`,
   `M1`-`M5`), speed, pitch, robot effect. Check any change with `.venv/bin/python tts/voice_qa.py`,
   which synthesises test sentences and transcribes them back.

The Gateway token and port are read from `~/.openclaw/openclaw.json` at start-up: nothing to copy.

## Configuration reference

| File | Content |
|---|---|
| `config/settings.json` | `userName`; ports (`httpsPort` 8443, `httpPort` 8480) and `bind`; service URLs; `sessionSuffix` (`jarvis`); follow-up window `followUpMs` (2 min); `wakePhrases`; optional Whisper prompt `sttPrompt` (generated from your agent names otherwise); `debug` |
| `config/agents.json` | optional agent list (replaces the discovery) |
| `config/pronunciation.json` | optional forced pronunciations |
| `vendor/voices/voices.json` | voice catalogue |
| `config/access-code.txt` | LAN access code, generated; delete it and restart to get a new one |
| `certs/` | local certificate authority and server certificate |

Environment variables: `JARVIS_CHROME` (Chrome path), `JARVIS_TTS_THREADS` (Supertonic threads,
default 4), `JARVIS_SUPERTONIC_STEPS` (quality steps, 1-32, default 8), `JARVIS_AGENTS_FILE`
(alternative agents file), `JARVIS_HTTP_PORT` (local HTTP port).

## Operations

| Command | Effect |
|---|---|
| `bin/jarvis status` | state of the services and of the Gateway link |
| `bin/jarvis start` / `stop` / `restart` | control the services |
| `bin/jarvis logs` | live logs; errors from the page appear as `page: …` |
| `bin/jarvis url` | access addresses |
| `bin/jarvis code` | LAN access code |
| `bin/jarvis certs` | regenerate the HTTPS certificate (after an IP change) |
| `bin/jarvis test` | unit tests, end-to-end check, two-agent scenario |
| `bin/jarvis uninstall` | remove the services (files are kept) |

Other checks: `node server/test/ui.mjs` drives the real page in headless Chrome with a fake microphone
and saves screenshots to `/tmp/jarvis`; `.venv/bin/python -m unittest tts/test_fr_normalize.py` tests
how numbers are read.

## Troubleshooting

| Symptom | What to check |
|---|---|
| « Micro indisponible » | page opened over plain HTTP from another device, certificate authority not imported, or microphone denied in the browser |
| Nobody answers and no subtitle appears | `bin/jarvis logs`: if no `entendu:` line appears when you speak, the page sends nothing; look for a `page:` error line (microphone refused, script error) |
| « liaison perdue » | the Gateway is down: `openclaw status`, then `bin/jarvis restart` |
| « Reconnaissance vocale indisponible » | `journalctl --user -u jarvis-stt-precise -n 50`, and check the `ggml_vulkan:` line |
| An agent does not wake up on its name | read the grey subtitle (what Whisper heard) and add it to the agent's `aliases` |
| A word or a name is mispronounced | add it to `config/pronunciation.json` |
| A number, time or amount is read wrongly | add the case to `tts/fr_normalize.py`, with a test in `tts/test_fr_normalize.py` |
| The agent hears itself | lower the volume, move the microphone away from the speakers, or use a headset |
| The page cannot be reached from another device | `bin/jarvis status` first, then the firewall (port 8443) and Wi-Fi client isolation on the router |

## Limitations

- **French only for now.** Another language means changing Whisper's `-l fr` in
  `systemd/jarvis-stt*.service`, choosing voices for that language, replacing the French number
  normaliser (`tts/fr_normalize.py`), and translating the interface strings.
- **Same machine as the Gateway:** `jarvis-web` reaches the Gateway over loopback and reads
  `~/.openclaw/openclaw.json` locally.
- **No emotions** in the voices (Supertonic 3 has none). One speaker at a time on the microphone, and no
  speaker identification.
- Very technical text (file paths, mixed identifiers) is read imperfectly.
- The microphone requires HTTPS (or `localhost`). Automated tests run in Chrome; other browsers are
  used in practice but not tested automatically.

## Licences and third-party components

| Component | Use | Licence |
|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and OpenAI Whisper models | speech recognition | MIT |
| [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) (Supertone) | speech synthesis | model OpenRAIL-M (use restrictions apply), code MIT |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) (`piper-tts` package) and its French voices (siwis, tom, upmc) | fallback voices | package GPL-3.0-or-later; see each voice's model card |
| [Silero VAD](https://github.com/snakers4/silero-vad) via [`@ricky0123/vad-web`](https://github.com/ricky0123/vad), ONNX Runtime Web | voice detection in the browser | MIT (Silero, ONNX Runtime), ISC (vad-web) |
| [Puppeteer](https://github.com/puppeteer/puppeteer) (`puppeteer-core`) | browser windows | Apache-2.0 |
| [num2words](https://github.com/savoirfairelinux/num2words) | numbers in words | LGPL-2.1 |
| OpenClaw mascot (`openclaw/openclaw`, `ui/public/favicon.svg`) | emblem, redrawn | MIT |
| [mkcert](https://github.com/FiloSottile/mkcert) | local certificates | BSD-3-Clause |

## Licence

J.A.R.V.I.S is free software, released under the **GNU General Public License v3.0 or later**
([LICENSE](LICENSE)). The GPL was chosen because the speech service links the GPL-3.0 `piper-tts`
package; the third-party components above keep their own licences.
