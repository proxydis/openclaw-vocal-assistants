#!/usr/bin/env python3
"""Objective intelligibility check of the voices: synthesise → transcribe with the precise Whisper
server → compare. Nobody can listen during automated setup, so the machine listens.
Usage: .venv/bin/python tts/voice_qa.py [voice-id | agent-id ...]
Without arguments: every voice of the catalogue (vendor/voices/voices.json). An argument that is not a
voice id is taken as an agent id (voice resolved by the TTS service, as in production)."""
import difflib, io, json, re, sys, unicodedata, urllib.request, uuid
from pathlib import Path
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fr_normalize import normalize as spell  # Whisper writes "12" for "douze": compare both in words

APP = Path(__file__).resolve().parent.parent
SENTENCES = [
    "C'est fait, les douze tests passent.",
    "Je n'ai rien trouvé d'anormal dans les sauvegardes de cette nuit.",
    "Bonjour, je vous écoute.",
    "La livraison est prévue pour demain matin, je vous tiens au courant.",
    "Il reste trois points à corriger avant de publier la nouvelle version.",
    "Oui ?",
    "D'accord, je m'en occupe tout de suite.",
    "J'ai terminé l'analyse du rapport, le détail est affiché à l'écran.",
]
norm = lambda s: re.sub(r"[^a-z0-9 ]+", " ", unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()).split()
VOICES = [k for k in json.loads((APP / "vendor/voices/voices.json").read_text())["voices"] if not k.startswith("_")]


def tts(target, text):
    body = {"voice": target, "text": text} if target in VOICES else {"agent": target, "text": text}
    req = urllib.request.Request("http://127.0.0.1:8179/tts", json.dumps(body).encode(), {"content-type": "application/json"})
    return urllib.request.urlopen(req, timeout=60).read()


def stt(wav16):
    b = uuid.uuid4().hex
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in {"language": "fr", "response_format": "json", "temperature": "0.0"}.items()]
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + wav16 + f"\r\n--{b}--\r\n".encode())
    req = urllib.request.Request("http://127.0.0.1:8188/inference", b"".join(parts), {"content-type": f"multipart/form-data; boundary={b}"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read())["text"].strip()


targets = sys.argv[1:] or VOICES
width = max(len(t) for t in targets)
for target in targets:
    scores = []
    for s in SENTENCES:
        x, sr = sf.read(io.BytesIO(tts(target, s)))
        buf = io.BytesIO(); sf.write(buf, resample_poly(x, 16000, sr), 16000, subtype="PCM_16", format="WAV")
        heard = stt(buf.getvalue())
        ratio = difflib.SequenceMatcher(None, norm(spell(s)), norm(spell(heard))).ratio()
        scores.append(ratio)
        flag = "  " if ratio > 0.8 else "✗ "
        print(f"  {flag}{target:{width}} {len(x)/sr:4.1f}s {ratio:.2f}  « {s} » → « {heard} »")
    print(f"== {target}: intelligibilité moyenne {sum(scores)/len(scores):.2f}, min {min(scores):.2f}\n")
