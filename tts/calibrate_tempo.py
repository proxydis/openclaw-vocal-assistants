#!/usr/bin/env python3
"""Align every voice's speaking rate on a reference voice (default: the first voice of the catalogue).
Synthesises one calibration sentence per voice through the Pocket TTS sidecar (no tempo applied),
measures the audio duration, and writes tempo = duration / reference_duration into voices.json.
Usage: .venv/bin/python tts/calibrate_tempo.py [reference_voice_id]   then restart jarvis-tts."""
import io, json, sys, urllib.request, soundfile as sf
from pathlib import Path
APP = Path(__file__).resolve().parent.parent
TEXT = "Bonjour. Les douze tests passent, le déploiement est prévu demain matin. Je vous tiens au courant. Il reste trois points à vérifier avant la publication."
p = APP / "vendor/voices/voices.json"; c = json.loads(p.read_text()); v = c["voices"]
ids = [k for k in v if not k.startswith("_")]
REF = sys.argv[1] if len(sys.argv) > 1 else ids[0]
if REF not in v:
    sys.exit(f"voix inconnue : {REF} (catalogue : {', '.join(ids)})")
width = max(len(k) for k in ids)
dur = {}
for k in ids:
    body = json.dumps({"voice": k, "text": TEXT}).encode()
    data = urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8181/tts", body, {"content-type": "application/json"}), timeout=120).read()
    x, sr = sf.read(io.BytesIO(data)); dur[k] = len(x) / sr
    print(f"{k:{width}s} {dur[k]:5.2f} s", flush=True)
for k in ids:
    v[k]["tempo"] = round(dur[k] / dur[REF], 3)
    print(f"{k:{width}s} tempo {v[k]['tempo']}")
p.write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n")
print("voices.json mis à jour — redémarrer jarvis-tts")
