#!/usr/bin/env python3
"""Sidecar TTS engine: MeloTTS (native French base) + OpenVoice V2 tone-colour conversion.
Runs in its own venv (app/.venv-openvoice, Python 3.11). POST /tts {"voice": "<key>", "text": "...", "speed": 1.0}
-> audio/wav mono 16-bit 22050 Hz. Voice keys map to reference clips in vendor/voices/refs/ (voices.json).
Loopback only; tts_server.py is the single client.
"""
import io, json, os, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

APP = Path(__file__).resolve().parent.parent
CKPT = APP / "vendor" / "tts-eval2" / "checkpoints_v2"
REFS = APP / "vendor" / "voices" / "refs"
HOST, PORT = "127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8180
torch.set_num_threads(int(os.environ.get("JARVIS_TTS_THREADS", "8")))

from melo.api import TTS                      # noqa: E402  (slow imports after config)
from openvoice.api import ToneColorConverter  # noqa: E402

t0 = time.time()
melo = TTS(language="FR", device="cpu")
SPK = melo.hps.data.spk2id["FR"]
conv = ToneColorConverter(str(CKPT / "converter" / "config.json"), device="cpu")
conv.load_ckpt(str(CKPT / "converter" / "checkpoint.pth"))
SRC_SE = torch.load(str(CKPT / "base_speakers" / "ses" / "fr.pth"), map_location="cpu")
voices = json.loads((APP / "vendor" / "voices" / "voices.json").read_text())["voices"]
# Speaker embeddings are extracted once at startup (~1 s each), never per request.
TGT_SE = {k: conv.extract_se(str(REFS / v["openvoice"]["ref"])) for k, v in voices.items() if v.get("openvoice", {}).get("ref")}
print(f"[tts-ov] prêt en {time.time() - t0:.1f}s, {len(TGT_SE)} timbres : {', '.join(TGT_SE)}", flush=True)
lock = threading.Lock()  # neither model is re-entrant
TMP = Path("/dev/shm" if os.path.isdir("/dev/shm") else tempfile.gettempdir())


def synth(voice, text, speed=1.0, tau=0.3):
    se = TGT_SE.get(voice)
    if se is None:
        raise ValueError(f"timbre inconnu : {voice}")
    base = TMP / f"jarvis-ov-{threading.get_ident()}.wav"
    with lock:
        t1 = time.time()
        melo.tts_to_file(text, SPK, str(base), speed=speed, quiet=True)
        t2 = time.time()
        audio = conv.convert(audio_src_path=str(base), src_se=SRC_SE, tgt_se=se, output_path=None, tau=tau, message="default")
        print(f"[tts-ov] {voice} {len(text)} car : melo {t2 - t1:.2f}s + conversion {time.time() - t2:.2f}s", flush=True)
    base.unlink(missing_ok=True)
    buf = io.BytesIO()
    sf.write(buf, np.asarray(audio), conv.hps.data.sampling_rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200 if self.path == "/healthz" else 404)
        self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "voices": list(TGT_SE)}).encode())

    def do_POST(self):
        if self.path != "/tts":
            self.send_response(404); self.end_headers(); return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            t1 = time.time()
            data = synth(str(body.get("voice", "")), str(body.get("text", ""))[:1200], float(body.get("speed") or 1.0), float(body.get("tau") or 0.3))
            self.send_response(200)
            self.send_header("content-type", "audio/wav"); self.send_header("content-length", str(len(data)))
            self.send_header("x-synth-ms", str(int((time.time() - t1) * 1000))); self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            msg = json.dumps({"error": str(e)}).encode()
            self.send_response(500); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(msg)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
