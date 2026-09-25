# Sources des extraits de voix de référence (clonage Pocket-TTS)

Chaque extrait alimente une voix du **catalogue** `vendor/voices/voices.json` (identifiants neutres
`fr-<registre>-<caractère>`). Les noms de fichiers portent le prénom de l'agent de l'équipe d'exemple
pour lequel l'extrait a été choisi à l'origine ; ils n'ont plus de rôle fonctionnel (le lien se fait
par `voices.json` → `pockettts.ref` / `openvoice.ref`).

Toutes les voix proviennent de LibriVox (lectures de poésie française, domaine public /
"public domain dedication" — LibriVox exige que chaque lecteur place son enregistrement
dans le domaine public). Fichiers récupérés via les miroirs archive.org de LibriVox
(collection `librivoxaudio`, `language:(fre)`), flux 64 kbps MP3, puis découpés en local
avec `soundfile`/`numpy`/`scipy` (aucune conversion ffmpeg nécessaire).

| Voix (catalogue) | Fichier réf. | Identifiant archive.org | Piste | Auteur du poème | Code lecteur LibriVox | Fenêtre extraite |
|---|---|---|---|---|---|---|
| `fr-m-direct` | `neo_nm.wav` | compilationpoemes014_2105_librivox | Dix-huit ans (poemes014_dixhuitans_nm) | — | nm | 30.0–40.0 s |
| `fr-m-clair` | `alan_sb.wav` | compilationpoemes_002_1011_librivox | Ni bonjour ni bonsoir (poemes002_nibonjournibonsoir_sb) | — | sb | 5.0–15.0 s |
| `fr-m-grave` | `morpheus_mk.wav` | compilationpoemes014_2105_librivox | Invraisemblable mais vrai (poemes014_invraisemblablemaisvrai_mk) | — | mk | 15.0–25.0 s |
| `fr-f-precise` | `ada_cs.wav` | compilationpoemes_002_1011_librivox | Les Chats (poemes002_chats_cs) | Charles Baudelaire | cs | 10.0–20.0 s |
| `fr-f-ferme` | `trinity_chj.wav` | compilationpoemes014_2105_librivox | C'est aujourd'hui (poemes014_cestaujourdhui_chj) | — | chj | 35.0–45.0 s |
| `fr-f-douce` | `eva_leiri.wav` | compilationpoemes_002_1011_librivox | Les Djinns (poemes002_djinns_leiri) | Victor Hugo | leiri | 15.0–25.0 s |
| `fr-m-grave-robot` (référence openvoice) | `axiom_rab.wav` | compilationpoemes_003_1108_librivox | En sourdine (poemes003_ensourdine_rab) | Paul Verlaine | rab | 35.0–45.0 s |
| `fr-m-grave-robot` (référence pockettts, v2 masculin, 2026-09-24) | `axiom_gf.wav` | compilationpoemes014_2105_librivox | Impossible (poemes014_impossible_gf) | — | gf | 14.0–24.0 s |

Téléchargement : `https://archive.org/download/<identifiant>/<piste>_64kb.mp3`
(découverte du catalogue via `https://archive.org/advancedsearch.php?q=collection:librivoxaudio+AND+language:(fre)`,
le filtre `language=French` de l'API LibriVox officielle `librivox.org/api/feed/audiobooks`
s'est révélé non fonctionnel — il ignore le paramètre et retourne le catalogue anglais).

**Licence** : domaine public (LibriVox public domain dedication — tous les enregistrements
LibriVox sont placés dans le domaine public par leurs lecteurs bénévoles). Aucune attribution
légalement requise ; les codes lecteurs LibriVox (pseudonymes, pas les vrais noms) sont
indiqués ci-dessus par courtoisie/traçabilité.

Format des fichiers extraits : WAV mono PCM16, 24000 Hz (fréquence attendue par Pocket-TTS),
10.0 s chacun, crête normalisée à -3 dBFS, fenêtre choisie par balayage F0 (librosa.pyin,
pas de 5 s) pour prendre une portion vocale stable (>65-89 % de trames voisées) et représentative
de la médiane F0 du locuteur sur l'ensemble de la piste.

## F0 médian mesuré sur l'extrait final (librosa.yin/pyin, 24 kHz)

| Voix | Fichier | F0 médian | Rôle voulu |
|---|---|---:|---|
| `fr-m-grave` | morpheus_mk | 103.8 Hz | homme grave |
| `fr-m-direct` | neo_nm | 122.8 Hz | homme direct |
| `fr-m-clair` | alan_sb | 146.0 Hz | homme clair |
| `fr-f-precise` | ada_cs | 173.6 Hz | femme précise |
| (référence openvoice de `fr-m-grave-robot`) | axiom_rab | 186.1 Hz | neutre |
| `fr-f-ferme` | trinity_chj | 201.7 Hz | femme ferme |
| `fr-f-douce` | eva_leiri | 270.9 Hz | femme douce |
| `fr-m-grave-robot` (pockettts) | axiom_gf | ≈ 122 Hz | homme grave + traitement robot |

Écarts intra-genre : grave↔direct = 19.0 Hz, direct↔clair = 23.2 Hz (hommes, ≥15 Hz OK) ;
précise↔ferme = 28.1 Hz, ferme↔douce = 70.7 Hz (femmes, ≥15 Hz OK).
L'extrait neutre `axiom_rab` (186 Hz) n'était qu'à 12.5 Hz de `ada_cs` — c'est la limite de cette sélection :
le catalogue LibriVox français exploré (poèmes/contes multi-lecteurs, ~15 lecteurs distincts échantillonnés)
ne contenait pas de locuteur au timbre franchement "neutre/androgyne" à F0 intermédiaire
(~155-165 Hz) parmi les extraits testés. Il a été remplacé par `axiom_gf` (masculin, choisi parmi 14 pistes
analysées) pour la voix `fr-m-grave-robot` côté Pocket TTS ; `axiom_rab` reste sa référence OpenVoice.
