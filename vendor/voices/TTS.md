> **Mise à jour 2026-09-22** : le mapping des voix décrit plus bas (locuteurs mls 70/75/91) a été abandonné, car inintelligible d après tts/voice_qa.py. Le mapping en vigueur est dans voices.json (4 locuteurs stables + variantes de hauteur). Le reste de ce document (installation, API Piper, benchmarks) reste valable.
>
> **Mise à jour 2026-09-24** : `voices.json` n'est plus indexé par agent mais forme un **catalogue de voix** à identifiants neutres (`fr-m-clair`, `fr-f-douce`, `fr-m-direct`, `fr-f-precise`, `fr-m-grave`, `fr-f-ferme`, `fr-m-grave-robot`) ; un agent y est relié par le champ `voice` de `config/agents.json`, sinon automatiquement. Les prénoms d'agents cités ci-dessous appartiennent à l'équipe d'exemple qui a servi aux mesures ; le document reste un compte rendu historique.

# Synthèse vocale française locale — Piper TTS

Setup 100 % local, 100 % gratuit, CPU-only (testé sur AMD Ryzen 7 6800H, pas de GPU),
pour 7 voix françaises distinctes (une par agent IA). Aucun `sudo`, tout est confiné à
`<dépôt>/app/`.

## 1. Installation (reproductible)

```bash
cd app   # le dossier du dépôt

# venv (créé une seule fois, réutilisable)
~/.local/bin/uv venv --python 3.12 .venv

# dépendances
~/.local/bin/uv pip install --python .venv/bin/python \
    piper-tts onnxruntime numpy soundfile librosa
```

Versions effectivement installées (2026-09-22, `uv pip list`) :

| paquet | version |
|---|---|
| piper-tts | 1.8.0 |
| onnxruntime | 1.30.0 |
| numpy | 2.5.3 |
| soundfile | 0.14.0 |
| librosa | 1.0.0 (utilisé seulement pour la mesure de F0, pas requis en prod) |
| scipy | 1.18.1 (dépendance de librosa) |

Vérification :
```bash
.venv/bin/python -c "import piper, onnxruntime; print(piper.__file__)"
```

### Téléchargement des voix (HuggingFace `rhasspy/piper-voices`)

```bash
cd app/vendor/voices/models
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR"

curl -sL -o fr_FR-siwis-medium.onnx       "$BASE/siwis/medium/fr_FR-siwis-medium.onnx"
curl -sL -o fr_FR-siwis-medium.onnx.json  "$BASE/siwis/medium/fr_FR-siwis-medium.onnx.json"
curl -sL -o fr_FR-upmc-medium.onnx        "$BASE/upmc/medium/fr_FR-upmc-medium.onnx"
curl -sL -o fr_FR-upmc-medium.onnx.json   "$BASE/upmc/medium/fr_FR-upmc-medium.onnx.json"
curl -sL -o fr_FR-tom-medium.onnx         "$BASE/tom/medium/fr_FR-tom-medium.onnx"
curl -sL -o fr_FR-tom-medium.onnx.json    "$BASE/tom/medium/fr_FR-tom-medium.onnx.json"
curl -sL -o fr_FR-mls-medium.onnx         "$BASE/mls/medium/fr_FR-mls-medium.onnx"
curl -sL -o fr_FR-mls-medium.onnx.json    "$BASE/mls/medium/fr_FR-mls-medium.onnx.json"
# gilles n'existe qu'en qualité "low" (16 kHz) sur ce repo, pas de "medium"
curl -sL -o fr_FR-gilles-low.onnx         "$BASE/gilles/low/fr_FR-gilles-low.onnx"
curl -sL -o fr_FR-gilles-low.onnx.json    "$BASE/gilles/low/fr_FR-gilles-low.onnx.json"
```

`gilles-low` a été téléchargé mais **n'est pas utilisé** dans le mapping final (qualité
16 kHz nettement inférieure aux modèles 22.05/44.1 kHz disponibles) ; conservé comme
voix de secours si besoin d'une 8e voix.

Poids des modèles (`vendor/voices/models/`) : siwis 61 Mo, tom 61 Mo, gilles-low 61 Mo,
upmc 74 Mo, mls 74 Mo — total ≈ 335 Mo.

## 2. API Python exacte (piper-tts 1.8.0)

L'API a changé plusieurs fois entre versions de `piper-tts`. Pour la 1.8.0 installée ici :

- `PiperVoice.load(model_path, config_path=None, use_cuda=False, ...)` — charge le modèle
  ONNX + son `.onnx.json`.
- `SynthesisConfig(speaker_id=None, length_scale=None, noise_scale=None, noise_w_scale=None, normalize_audio=True, volume=1.0)`
  — paramètres de synthèse. **Pas de paramètre de pitch-shift.**
- `voice.synthesize(text, syn_config=None) -> Iterable[AudioChunk]` — génère l'audio
  **en streaming, un `AudioChunk` par phrase détectée** (découpage sur `.`, `!`, `?`).
  `AudioChunk` expose `sample_rate`, `audio_int16_array` (PCM 16-bit numpy), `audio_float_array`.
- `voice.synthesize_wav(text, wav_file, syn_config=None)` — écrit directement dans un
  `wave.Wave_write` déjà ouvert (pratique pour produire un buffer WAV en mémoire).

### Extrait minimal testé — texte → bytes WAV pour un agent donné

```python
import io, json, wave
from piper import PiperVoice
from piper.voice import SynthesisConfig

VOICES = json.load(open("app/vendor/voices/voices.json"))["voices"]

_cache = {}  # un PiperVoice par fichier modèle, à réutiliser (chargement ~0.5-1s)

def synthesize_for_agent(agent: str, text: str) -> bytes:
    v = VOICES[agent]
    model_path = f"app/vendor/voices/models/{v['model_file']}"
    if model_path not in _cache:
        _cache[model_path] = PiperVoice.load(model_path)
    voice = _cache[model_path]
    cfg = SynthesisConfig(
        speaker_id=v["speaker_id"],
        length_scale=v["length_scale"],
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text, wf, syn_config=cfg)
    return buf.getvalue()

# exemple
wav_bytes = synthesize_for_agent("morpheus", "Bonjour, ici Morpheus. Je suis à l'écoute.")
open("/tmp/out.wav", "wb").write(wav_bytes)
```

Testé et exécuté avec succès pour les 7 agents (voir `samples/*.wav`, générés avec
exactement ce code).

### Streaming phrase par phrase (latence basse)

`voice.synthesize()` segmente déjà le texte par phrase (sur la ponctuation forte) et
retourne un générateur : consommer les `AudioChunk` au fur et à mesure donne le même
temps-jusqu'au-premier-audio qu'un découpage manuel par phrase (vérifié : 0.162s dans
les deux cas sur un texte à 4 phrases). Il **n'est donc pas nécessaire** de segmenter le
texte soi-même tant qu'il contient une ponctuation de fin de phrase normale.

```python
for chunk in voice.synthesize(long_text, syn_config=cfg):
    play_or_stream(chunk.audio_int16_array, chunk.sample_rate)  # dès que dispo
```

Piège : si le texte ne contient **aucune** ponctuation de fin de phrase, il est traité
comme une seule phrase → un seul chunk → latence = temps de synthèse total du texte
entier (pas de streaming réel). Toujours terminer les phrases par `.`/`!`/`?`.

## 3. Mapping des 7 voix (agent → modèle/speaker)

Voir `voices.json` pour le détail machine-readable. Résumé :

| Agent | Rôle | Modèle | speaker_id | length_scale | F0 médian mesuré | Qualité / SR |
|---|---|---|---:|---:|---:|---|
| **Axiom** | main, neutre | `fr_FR-siwis-medium.onnx` | — | 1.00 | 194.1 Hz | medium, 22.05 kHz |
| **Neo** | masculin | `fr_FR-tom-medium.onnx` | — | 1.00 | 113.9 Hz | medium, 44.1 kHz |
| **Alan** | masculin | `fr_FR-upmc-medium.onnx` | 1 (pierre) | 1.00 | 117.5 Hz | medium, 22.05 kHz |
| **Morpheus** | masculin grave | `fr_FR-mls-medium.onnx` | 91 | 1.08 | 97.3 Hz | medium, 22.05 kHz |
| **Ada** | féminin | `fr_FR-upmc-medium.onnx` | 0 (jessica) | 0.95 | 223.8 Hz | medium, 22.05 kHz |
| **Eva** | féminin | `fr_FR-mls-medium.onnx` | 75 | 1.00 | 187.6 Hz | medium, 22.05 kHz |
| **Trinity** | féminin | `fr_FR-mls-medium.onnx` | 70 | 0.97 | 163.4 Hz | medium, 22.05 kHz |

F0 mesuré avec `librosa.yin(fmin=60, fmax=400)` (médiane des trames voisées) directement
sur le WAV de sample réellement livré (`samples/<agent>.wav`, phrase
« Bonjour, ici *Nom*. Je suis à l'écoute. »).

Spread F0 obtenu (Hz) : Morpheus 97 < Neo 114 < Alan 118 < Trinity 163 < Eva 188 <
Axiom 194 < Ada 224 — les 7 voix sont nettement distinctes, avec 4 modèles/datasets
différents (siwis, tom, upmc, mls) et un mélange modèle-différent / speaker-mls-éloigné
comme demandé.

Piper `SynthesisConfig` n'a **pas** de paramètre de pitch-shift : la hauteur est
intrinsèque au modèle/speaker choisi, pas réglable a posteriori. `length_scale` ne
change que le débit (1.0 = normal, >1 = plus lent, <1 = plus rapide).

### Piège important découvert : instabilité du modèle `mls` sur phrases courtes

Le modèle multi-locuteurs `fr_FR-mls-medium` (125 speakers, dataset Multilingual
LibriSpeech) est **instable sur des phrases courtes à deux propositions du type
« Bonjour, ici *Nom*. Je suis à l'écoute. »** pour une majorité de ses `speaker_id` : le
prédicteur de durée du modèle VITS s'emballe et génère 2 à 5× plus d'audio que
nécessaire (pauses/hésitations excessives, quasi du babillage). Reproduit même avec un
prénom français normal (« Pierre »), donc **pas** un problème d'anglicisme/nom
étranger — c'est la structure de phrase (virgule + point médian + phrase courte) qui
déclenche l'instabilité chez ce checkpoint précis.

Criblage systématique effectué : synthèse des 125 `speaker_id` du modèle `mls` sur les
3 phrases exactes requises (« ...ici Morpheus... », « ...ici Eva... »,
« ...ici Trinity... »), mesure durée + F0 pour chacun. Seuls **13/125** speakers restent
stables (durée ≤ 5.5 s sur les 3 phrases) : `91, 46, 13, 28, 30, 70, 85, 75, 95, 54, 88,
29, 39`. Les `speaker_id` 91 (Morpheus), 75 (Eva) et 70 (Trinity) ont été choisis parmi
ces 13 pour leur F0 bien répartis. **Ne pas piocher un `speaker_id` mls au hasard sans
retester sur le texte réel qui sera prononcé.**

Les modèles single-speaker (siwis, tom, upmc) n'ont montré aucune instabilité de ce
type sur les mêmes textes.

## 4. Benchmark

### Chargement modèle + RAM (mesuré par sous-processus isolé, `resource.getrusage().ru_maxrss`)

| Modèle | Temps de chargement | RSS après chargement | Delta RAM (~empreinte modèle) |
|---|---:|---:|---:|
| `fr_FR-siwis-medium.onnx` | 0.89 s | 133.6 Mo | ≈124 Mo |
| `fr_FR-upmc-medium.onnx` | 0.91 s | 146.5 Mo | ≈137 Mo |
| `fr_FR-tom-medium.onnx` | 0.99 s | 139.7 Mo | ≈130 Mo |
| `fr_FR-mls-medium.onnx` | 0.70 s | 145.6 Mo | ≈136 Mo |
| `fr_FR-gilles-low.onnx` (non utilisé) | 0.87 s | 133.6 Mo | ≈124 Mo |

Chargement à froid dans le process complet (import `piper` + `.load()`) : ~0.5-1 s.
Charger les 7 voix (4 fichiers modèle réellement utilisés, `mls`/`upmc` partagés par
plusieurs agents) en mémoire simultanément coûte environ **4 × 130 Mo ≈ 520 Mo** de RAM
(pas 7×, car `upmc` et `mls` sont partagés par 2-3 agents chacun).

### RTF (real-time factor) et latence au premier audio

Mesuré avec `voice.synthesize()` (streaming natif par phrase), texte court = phrase de
sample (~8 mots), texte long = 4 phrases / 46 mots.

| Agent | RTF court | Latence 1er audio (court) | RTF long | Latence 1er audio (long) |
|---|---:|---:|---:|---:|
| Axiom | 0.039 | 0.083 s | 0.039 | 0.162 s |
| Neo | 0.077 | 0.136 s | 0.070 | 0.335 s |
| Alan | 0.036 | 0.075 s | 0.030 | 0.114 s |
| Morpheus | 0.044 | 0.056 s | 0.039 | 0.187 s |
| Ada | 0.042 | 0.077 s | 0.039 | 0.154 s |
| Eva | 0.040 | 0.066 s | 0.040 | 0.143 s |
| Trinity | 0.039 | 0.062 s | 0.040 | 0.132 s |

RTF ≈ 0.03-0.08 partout, soit **13× à 33× plus rapide que le temps réel sur CPU seul**
(pas de GPU). `neo` (modèle `tom`, 44.1 kHz) est le plus lent en RTF relatif (plus
d'échantillons à générer par seconde d'audio) mais reste largement temps-réel.
Latence au premier audio : 55-140 ms sur phrase courte, 110-335 ms sur texte long grâce
au streaming par phrase — un pipeline vocal peut commencer à jouer le début de la
réponse en moins de 200 ms dans la quasi-totalité des cas.

## 5. Pièges identifiés

- **Instabilité `mls` sur phrases courtes** : voir section 3. Toujours valider un
  nouveau `speaker_id` mls sur le texte exact qui sera prononcé avant de le
  déployer.
- **Streaming nécessite une ponctuation de fin de phrase** : sans `.`/`!`/`?`, tout le
  texte est traité comme une seule phrase (un seul chunk), ce qui annule le bénéfice de
  latence du streaming.
- **Phonème nasal manquant** : avertissement observé au runtime
  (`Missing phoneme from id map: ̃`) sur certains modèles/phrases contenant des voyelles
  nasales françaises (an/en/in/on/un). Non bloquant (la synthèse continue), mais la
  nasalisation de certaines voyelles peut être légèrement dégradée sur les modèles
  concernés — pas de solution identifiée côté configuration Piper, propre au jeu de
  phonèmes espeak-ng utilisé pour l'entraînement de ces voix.
- **Nombres, sigles, anglicismes** : testé sans erreur (« 14h30 », « 22 degrés »,
  « CPU », « RAM », « 100% », « 21/09/2026 », « 3,5 euros », « LLM », « OpenClaw »,
  « cool ») — aucun crash, la synthèse aboutit toujours. En revanche la **prononciation
  n'a pas pu être vérifiée à l'oreille** (pas d'accès audio dans cet environnement) :
  Piper délègue la normalisation du texte et la phonétisation à espeak-ng, qui a des
  règles françaises pour les nombres mais épelle généralement les sigles anglophones
  (CPU, LLM) lettre par lettre avec les noms de lettres **français**, ce qui peut sonner
  bizarre pour des acronymes typés IT. Les anglicismes (« cool », noms de produits) sont
  phonétisés avec les règles françaises, pas anglaises — accent probable mais pas
  vérifié. À valider à l'oreille avant mise en prod si la prononciation exacte de
  sigles/anglicismes est critique.
- **`gilles` n'existe qu'en qualité `low` (16 kHz)** sur ce dépôt HuggingFace, pas de
  version `medium`/`high` — écarté du mapping final pour cette raison (qualité
  nettement inférieure aux 4 autres modèles utilisés).
- **`normalize_audio=True` par défaut** dans `SynthesisConfig` : le pic audio est
  normalisé à ~1.0 systématiquement, donc un simple contrôle de crête ne détecte pas le
  clipping ; mieux vaut mesurer la fraction d'échantillons saturés (`clip_ratio`, tous
  < 0.02 % dans nos mesures — pas de clipping réel constaté).

## 6. Licences des voix

Le dépôt HuggingFace `rhasspy/piper-voices` déclare une licence **MIT** globale sur sa
fiche modèle (`license: mit` dans le README du dépôt). Cette licence MIT couvre les
poids ONNX distribués par le projet Piper. Les jeux de données d'entraînement
sous-jacents ont potentiellement leurs propres conditions d'origine
(SIWIS = corpus académique EPFL, MLS = Multilingual LibriSpeech dérivé de LibriVox,
UPMC = dataset agrégé façon M-AILABS/LibriVox, tom/gilles = contributions communautaires
dont l'origine précise n'est pas documentée dans les métadonnées `.onnx.json` du
dépôt — les champs `author`/`url`/`license` y sont vides). **Ceci n'est pas un avis
juridique** : pour un usage commercial ou une redistribution des voix elles-mêmes,
vérifier https://github.com/rhasspy/piper/blob/master/VOICES.md et les pages des
datasets d'origine avant publication.

## 7. Structure des fichiers produits

```
app/
  .venv/                              # venv uv (piper-tts, onnxruntime, numpy, soundfile, librosa)
  vendor/voices/
    models/
      fr_FR-siwis-medium.onnx(.json)
      fr_FR-upmc-medium.onnx(.json)   # 2 speakers: jessica(0)=Ada, pierre(1)=Alan
      fr_FR-tom-medium.onnx(.json)
      fr_FR-mls-medium.onnx(.json)    # 125 speakers, dont 91=Morpheus, 75=Eva, 70=Trinity
      fr_FR-gilles-low.onnx(.json)    # téléchargé, non utilisé (qualité 16kHz)
    samples/
      axiom.wav neo.wav alan.wav morpheus.wav ada.wav eva.wav trinity.wav
    voices.json                       # mapping agent -> modèle/speaker_id/length_scale/F0
    TTS.md                            # ce fichier
```
