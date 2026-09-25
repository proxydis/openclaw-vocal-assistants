# whisper.cpp GPU (Vulkan) — Ubuntu 24.04 / Ryzen 7 6800H (Radeon 680M) — user-space, no sudo

Tout est installé sous `app/vendor/` (aucune modification système, aucun `sudo`).

## Résumé rapide

- **GPU détecté et utilisé** : `AMD Radeon Graphics (RADV REMBRANDT)` via Mesa RADV (driver système `mesa-vulkan-drivers` 25.2.8, déjà présent, pas touché).
- **Binaires** : `app/vendor/whisper.cpp/build/bin/{whisper-cli,whisper-server,whisper-bench}`
- **Modèles** : `app/vendor/models/{ggml-small.bin, ggml-large-v3-turbo-q5_0.bin}`
- **Modèle recommandé pour énoncés courts en français, faible latence** : **ggml-small.bin** (voir benchmark). Aucun des deux modèles ne descend sous 1 s de latence serveur à chaud sur ce matériel ; small.bin est le plus proche (~1.3 s).

## 1. cmake / ninja (uv tool, user-space)

```bash
~/.local/bin/uv tool install cmake     # -> cmake 4.4.3 dans ~/.local/bin
~/.local/bin/uv tool install ninja     # -> ninja 1.13.2 dans ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"
```

## 2. Vulkan SDK LunarG (tarball user-space)

```bash
mkdir -p app/vendor/vulkan-sdk && cd app/vendor/vulkan-sdk
curl -L -o vulkan-sdk.tar.xz "https://sdk.lunarg.com/sdk/download/latest/linux/vulkan-sdk.tar.xz"
tar -xf vulkan-sdk.tar.xz     # -> extrait dans 1.4.357.1/
source 1.4.357.1/setup-env.sh   # exporte VULKAN_SDK, PATH, LD_LIBRARY_PATH, VK_LAYER_PATH
```

Vérification (essentielle — sur ce genre de machine, un backend logiciel `llvmpipe` peut masquer
l'absence d'accélération réelle) :

```bash
vulkaninfo --summary
```

Résultat obtenu — **GPU0 = RADV réel**, GPU1 = llvmpipe (CPU, ignoré) :

```
GPU0:
	deviceType         = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU
	deviceName         = AMD Radeon Graphics (RADV REMBRANDT)
	driverID           = DRIVER_ID_MESA_RADV
	driverName         = radv
	driverInfo         = Mesa 25.2.8-0ubuntu0.24.04.2
GPU1:
	deviceType         = PHYSICAL_DEVICE_TYPE_CPU
	deviceName         = llvmpipe (LLVM 20.1.2, 256 bits)
```

Le tarball LunarG a fonctionné directement (330 Mo téléchargés, pas eu besoin du repli
Vulkan-Headers + shaderc manuel).

Aucun `VK_ICD_FILENAMES` n'a été nécessaire : le loader trouve le driver RADV système via
`/usr/share/vulkan/icd.d/radeon_icd.x86_64.json` (déjà installé avec `mesa-vulkan-drivers`,
non modifié).

## 3. Build whisper.cpp (Vulkan backend)

```bash
cd app/vendor
git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git whisper.cpp
cd whisper.cpp
git fetch --tags --depth 1 origin
git checkout v1.9.4        # dernière release taggée au 2026-09-22 (commit 927cfce)

export PATH="$HOME/.local/bin:$PATH"
source ../vulkan-sdk/1.4.357.1/setup-env.sh

cmake -S . -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_VULKAN=1 \
  -DWHISPER_SDL2=OFF

cmake --build build --config Release -j 8
```

Le log CMake confirme la détection : `-- Found Vulkan: .../libvulkan.so (found version "1.4.357")`
et `-- Including Vulkan backend`. Build terminé sans erreur (382 cibles), produit entre autres :
`whisper-cli`, `whisper-server`, `whisper-bench`, `libggml-vulkan.so.0.23.0` (53 Mo, tous les
shaders SPIR-V compilés avec `glslc` du SDK).

Remarque : `whisper-cli` intègre un décodeur audio bundlé (miniaudio) qui lit directement
`wav`, `flac`, `mp3`, `ogg` — donc pas besoin de ffmpeg pour la conversion des échantillons de
test, seulement pour produire le WAV 16 kHz mono initial (fait en Python, voir §4).

## 4. Environnement d'exécution

Le binaire est linké avec un RPATH qui pointe vers la libvulkan du SDK, donc **il suffit
d'exposer les libs de build** (`libggml*`, `libwhisper*`, `libparakeet*`) :

```bash
cd app/vendor/whisper.cpp
export LD_LIBRARY_PATH="$(pwd)/build/bin"
```

Vérifié : ça fonctionne aussi bien avec juste cette variable qu'en sourçant `setup-env.sh` du
SDK (le SDK n'est nécessaire qu'au **build**, pas à l'exécution). Aucun `VK_ICD_FILENAMES` requis.

## 5. Modèles

```bash
mkdir -p app/vendor/models && cd app/vendor/models
curl -L -o ggml-large-v3-turbo-q5_0.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin   # 574 Mo
curl -L -o ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin                  # 488 Mo
```

## 6. Échantillons de test français

Pas de `ffmpeg` ni de source audio libre trouvée rapidement (recherche web indisponible /
quota épuisé pendant la session) → **généré via TTS** (méthode explicitement acceptée en
repli), puis rééchantillonné en 16 kHz mono WAV avec un venv `uv` (soundfile + scipy, pas de
ffmpeg) :

```bash
uv venv app/vendor/pyenv/.venv --python 3.12
source app/vendor/pyenv/.venv/bin/activate
uv pip install soundfile scipy numpy
```

```python
import soundfile as sf, scipy.signal as sig, numpy as np
data, sr = sf.read(src_wav)                      # sortie TTS, 24 kHz mono
resampled = sig.resample(data, int(len(data) * 16000 / sr))
sf.write(dst_wav, resampled, 16000, subtype='PCM_16')
```

Fichiers produits dans `app/vendor/samples/` :
- `fr_short.wav` — 3.44 s — « Bonjour, peux-tu me dire quelle heure il est s'il te plaît ? »
- `fr_long.wav` — 13.24 s — présentation courte (« Bonjour, je m'appelle Alan et j'habite à
  Paris depuis plusieurs années... »), 16 kHz mono PCM16.

## 7. Benchmark

Toutes les mesures = `whisper-cli`, `-l fr`, modèle chargé à froid à chaque appel (temps de
chargement mesuré séparément). GPU = backend Vulkan (RADV REMBRANDT). CPU = `-ng`
(`--no-gpu`), 8 threads.

### 7.a Réglages par défaut du CLI (beam-size=5, best-of=5 — réaliste pour la qualité, pas pour la latence)

| Modèle | Clip | Backend | Load (ms) | Total (ms) |
|---|---|---|---:|---:|
| small | short (3.4s) | GPU | 391 | 5208 |
| small | short (3.4s) | CPU (8t) | 415 | 4277 |
| small | long (13.2s) | GPU | 342 | 13810 |
| small | long (13.2s) | CPU (8t) | 463 | 6218 |
| large-v3-turbo-q5_0 | short (3.4s) | GPU | 474 | 6604 |
| large-v3-turbo-q5_0 | short (3.4s) | CPU (8t) | 561 | 12069 |
| large-v3-turbo-q5_0 | long (13.2s) | GPU | 233 | 9797 |
| large-v3-turbo-q5_0 | long (13.2s) | CPU (8t) | 312 | 14992 |

**Piège rencontré** : avec beam-size=5 par défaut, le GPU est *plus lent* que le CPU sur le
petit modèle (5.2 s vs 4.3 s pour le clip court). La recherche en faisceau multiplie les
appels de décodage séquentiels ; chaque dispatch Vulkan a un coût fixe non négligeable sur un
iGPU, ce qui pénalise le petit modèle dont le décodage est déjà rapide sur CPU. Le gain GPU
n'est net qu'avec le gros modèle (l'encodeur domine le temps total).

### 7.b Décodage greedy (`-bs 1`, 8 threads) — configuration pertinente pour un assistant temps réel

| Modèle | Clip | Backend | Encode (ms) | Decode (ms) | Total (ms) |
|---|---|---|---:|---:|---:|
| small | short (3.4s) | GPU | 587 | 1109 | 2182 |
| small | short (3.4s) | CPU (8t) | 2433 | 636 | 3696 |
| small | long (13.2s) | GPU | 592 | 3633 | 4791 |
| small | long (13.2s) | CPU (8t) | 2449 | 1694 | 4818 |
| large-v3-turbo-q5_0 | short (3.4s) | GPU | 1659 | 971 | 3141 |
| large-v3-turbo-q5_0 | short (3.4s) | CPU (8t) | 17149 | 190 | 17983 |
| large-v3-turbo-q5_0 | long (13.2s) | GPU | 1687 | 2972 | 5202 |
| large-v3-turbo-q5_0 | long (13.2s) | CPU (8t) | 16845 | 636 | 18111 |

**Enseignement** : l'accélération Vulkan gagne nettement sur l'**encodeur** (jusqu'à ~10x
pour large-v3-turbo-q5_0 : 1.66 s GPU vs 17.1 s CPU). Le **décodage** token-par-token (petits
batchs) est parfois plus lent sur GPU que sur CPU (overhead de dispatch par token sur un iGPU
UMA) — normal et documenté pour les iGPU sur whisper.cpp. Toujours confirmé dans les logs :
`whisper_backend_init_gpu: using Vulkan0 backend` sur chaque run GPU.

### 7.c Latence serveur à chaud (`whisper-server`, modèle déjà chargé — métrique la plus
réaliste pour un assistant vocal)

Le serveur whisper.cpp utilise **greedy par défaut** (`beam_size=-1` → stratégie greedy,
`best_of=2`), donc pas besoin de forcer `-bs 1` côté CLI serveur.

| Modèle | Clip | Paramètre requête | Latence HTTP à chaud |
|---|---|---|---:|
| small | short (3.4s) | (défaut, best_of=2) | 1.80 s |
| small | short (3.4s) | `best_of=1` | **1.33 s** |
| small | long (13.2s) | (défaut) | 2.78 s |
| large-v3-turbo-q5_0 | short (3.4s) | `best_of=1` | 1.87 s |

Aucune des deux configurations ne descend sous l'objectif de **< 1 s**. `ggml-small.bin` avec
`best_of=1` est la meilleure combinaison mesurée (1.33 s sur un énoncé court de 3.4 s).

## 8. Lancement du serveur (retenu)

```bash
cd app/vendor/whisper.cpp
export LD_LIBRARY_PATH="$(pwd)/build/bin"
./build/bin/whisper-server \
  -m ../models/ggml-small.bin \
  --host 127.0.0.1 --port 8178 \
  -l fr -t 8
```

Test :

```bash
curl -F file=@app/vendor/samples/fr_short.wav \
     -F language=fr -F response_format=json -F best_of=1 \
     http://127.0.0.1:8178/inference
# => {"text":" Bonjour, peux-tu me dire quelle heure il est s'il te plaît ?\n"}
```

Le serveur a été testé (démarré, requêtes validées avec transcriptions correctes en français,
puis **arrêté** — `kill` du PID — après le benchmark, conformément à la consigne).

## 9. Recommandation

**`ggml-small.bin`, backend Vulkan, `best_of=1`** pour des énoncés courts en français :
- meilleur compromis latence mesuré (~1.3 s à chaud sur un clip de 3.4 s), très en dessous de
  `large-v3-turbo-q5_0` (~1.9 s) et bien en dessous du CPU pur en greedy (~3.7-18 s selon le
  modèle).
- qualité de transcription correcte sur les deux clips de test (ponctuation et accents
  corrects).
- **L'objectif < 1 s n'est pas atteint** avec la configuration testée. Prochaines pistes non
  testées ici (à explorer si le budget de latence est strict) : `ggml-tiny` ou `ggml-base`
  (nettement plus rapides, qualité moindre), réduction du contexte audio (`-ac`), VAD pour
  découper avant transcription, ou passer par la lib `whisper.cpp` directement en process
  persistant (évite l'overhead HTTP/multipart, non mesuré séparément ici).

## 10. Pièges rencontrés

1. **Nom de commande piégé par le hook `rtk`** : sur cette machine, les commandes shell sont
   réécrites par un hook ; une lecture de fichier via un chemin absolu a échoué avec
   `[rtk: No such file or directory]` — contourné avec `rtk proxy bash -c '...'`.
2. **`llvmpipe` vs RADV** : `vulkaninfo --summary` liste systématiquement un GPU logiciel
   (`llvmpipe`, CPU) en plus du vrai GPU — bien vérifier `driverName = radv` et
   `deviceType = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU` sur le bon device (GPU0 ici), pas juste
   la présence d'un device Vulkan.
3. **Beam search par défaut trompeur pour le GPU** : `whisper-cli` sans option utilise
   `beam_size=5, best_of=5`, ce qui peut faire paraître le GPU plus lent que le CPU. Pour
   juger l'accélération réelle, comparer en greedy (`-bs 1`) ou regarder séparément
   `encode time` (où le GPU gagne nettement) vs `decode time` (overhead de dispatch par
   token, GPU pas toujours gagnant sur un iGPU).
4. **Pas de ffmpeg, pas de source audio FR libre trouvée rapidement** (recherche web
   indisponible/quota épuisé pendant la session) → généré un échantillon FR via TTS (méthode
   de repli explicitement autorisée), puis reséchantillonné en 16 kHz mono avec
   `soundfile`/`scipy` dans un venv `uv` (aucune dépendance système ajoutée).
5. **RPATH du build** : le binaire `whisper-cli`/`whisper-server` compilé contre le SDK
   LunarG embarque un RPATH vers `libvulkan.so.1` du SDK — donc le SDK n'a pas besoin d'être
   sourcé à l'exécution, seulement au build (`LD_LIBRARY_PATH=build/bin` suffit à l'usage).
6. **Décodage token-par-token plus lent sur GPU pour le petit modèle** (overhead de dispatch
   Vulkan par appel, iGPU UMA) — attendu et documenté dans les issues upstream de
   ggml-org/whisper.cpp concernant les iGPU AMD/Intel ; pas un bug de cette installation.

## Chemins clés

- Binaires : `<dépôt>/app/vendor/whisper.cpp/build/bin/{whisper-cli,whisper-server,whisper-bench}`
- Modèles : `<dépôt>/app/vendor/models/{ggml-small.bin,ggml-large-v3-turbo-q5_0.bin}`
- Échantillons : `<dépôt>/app/vendor/samples/{fr_short.wav,fr_long.wav}`
- SDK Vulkan (build uniquement) : `<dépôt>/app/vendor/vulkan-sdk/1.4.357.1/`
- venv Python (conversion audio) : `<dépôt>/app/vendor/pyenv/.venv/`
