#!/usr/bin/env python3
"""Sidecar TTS engine: Pocket TTS (Kyutai, ~100 M params, native French, voice cloning).
POST /tts {"voice": "<key>", "text": "..."} -> audio/wav mono 16-bit (model sample rate, 24 kHz).
Voice keys map to reference clips in vendor/voices/refs/ (voices.json → "pockettts": {"ref": ...}).
Needs the Hugging Face token in config/hf-token.txt (gated cloning weights). Loopback only.
"""
import io, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
REFS = APP / "vendor" / "voices" / "refs"
HOST, PORT = "127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8181
tok = APP / "config" / "hf-token.txt"
if tok.exists():
    os.environ.setdefault("HF_TOKEN", tok.read_text().strip())
os.environ.setdefault("HF_HOME", str(APP / "vendor" / "tts-eval" / "hf_cache"))

import numpy as np                      # noqa: E402
import soundfile as sf                  # noqa: E402
import torch                            # noqa: E402
from pocket_tts import TTSModel         # noqa: E402

torch.set_num_threads(int(os.environ.get("JARVIS_TTS_THREADS", "6")))
t0 = time.time()
model = TTSModel.load_model(language=os.environ.get("JARVIS_POCKET_MODEL", "french"))
if not model.has_voice_cloning:
    print("[tts-pk] poids de clonage indisponibles (jeton HF / conditions non acceptées) — service inutilisable", flush=True)
    sys.exit(3)
voices = json.loads((APP / "vendor" / "voices" / "voices.json").read_text())["voices"]
def prompt_for(cfg):
    """Reference clip, optionally time-compressed (WSOLA, pitch/timbre preserved): Pocket TTS mimics the
    speaking rate of its prompt, so a faster prompt gives a faster voice with no post-processing on the output."""
    path = str(REFS / cfg["ref"])
    speed = float(cfg.get("ref_speed") or 1.0)
    if abs(speed - 1.0) < 0.02:
        return path
    from audiotsm import wsola
    from audiotsm.io.array import ArrayReader, ArrayWriter
    x, sr = sf.read(path)
    r, w = ArrayReader(x.reshape(1, -1).astype(np.float32)), ArrayWriter(1)
    wsola(1, speed=speed).run(r, w)
    return _tmp_wav(w.data[0], sr)


def _tmp_wav(y, sr):
    import tempfile
    f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False); sf.write(f.name, y, sr, subtype="PCM_16"); return f.name


STATES = {k: model.get_state_for_audio_prompt(prompt_for(v["pockettts"])) for k, v in voices.items() if v.get("pockettts", {}).get("ref")}
print(f"[tts-pk] prêt en {time.time() - t0:.1f}s, {len(STATES)} timbres : {', '.join(STATES)}", flush=True)
lock = threading.Lock()


def synth(voice, text):
    st = STATES.get(voice)
    if st is None:
        raise ValueError(f"timbre inconnu : {voice}")
    # One- or two-word inputs make the model invent a tail ("Oui." → "Oui. N'est-ce pas ?");
    # an ellipsis ending stops it cleanly (measured with tts/voice_qa.py).
    if len(text.split()) <= 2:
        text = text.rstrip(" .!?…") + "..."
    with lock:
        t1 = time.time()
        audio = model.generate_audio(st, text, copy_state=True)
    a = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
    print(f"[tts-pk] {voice} {len(text)} car : {time.time() - t1:.2f}s pour {len(a) / model.sample_rate:.1f}s", flush=True)
    buf = io.BytesIO()
    sf.write(buf, a, model.sample_rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200 if self.path == "/healthz" else 404)
        self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "voices": list(STATES), "sampleRate": model.sample_rate}).encode())

    def do_POST(self):
        if self.path != "/tts":
            self.send_response(404); self.end_headers(); return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            data = synth(str(body.get("voice", "")), str(body.get("text", ""))[:1200])
            self.send_response(200)
            self.send_header("content-type", "audio/wav"); self.send_header("content-length", str(len(data))); self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            msg = json.dumps({"error": str(e)}).encode()
            self.send_response(500); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(msg)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
