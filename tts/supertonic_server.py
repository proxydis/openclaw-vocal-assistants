#!/usr/bin/env python3
"""Sidecar TTS engine: Supertonic 3 (Supertone, ~99 M params, ONNX on CPU, 31 languages incl. French).
POST /tts {"voice": "<catalogue key>", "text": "...", "speed": 1.0?, "steps": 8?} -> audio/wav mono 16-bit, 24 kHz
(the model renders 44.1 kHz; speech needs no more than 24 kHz and the WAV sent to the browser is 45 % lighter).
Catalogue keys map to one of the 10 built-in voice styles (voices.json → "supertonic": {"voice": "M1"..
"M5" | "F1".."F5", "speed": ...}). No cloning in the open release, but a native speed control: the model
paces its own output, so there is no post-processing on the audio.
Numbers are already written out in words by tts_server.py (fr_normalize) before reaching this service;
supertonic_respell() then respells what this model garbles ("dix-huit" -> "dizhuite", "soixante" -> "swassante").
Weights: vendor/supertonic3 (downloaded on first start if missing, OpenRAIL-M). Loopback only.
"""
import io, json, os, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
HOST, PORT = "127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8182
os.environ.setdefault("SUPERTONIC_CACHE_DIR", str(APP / "vendor" / "supertonic3"))

import numpy as np                      # noqa: E402
import soundfile as sf                  # noqa: E402
from scipy.signal import resample_poly  # noqa: E402
from supertonic import TTS              # noqa: E402

from fr_normalize import supertonic_respell  # noqa: E402

LANG = os.environ.get("JARVIS_TTS_LANG", "fr")  # respellings below are French: applied only when LANG == "fr"
STEPS_RANGE = (1, 32)
STEPS = min(STEPS_RANGE[1], max(STEPS_RANGE[0], int(os.environ.get("JARVIS_SUPERTONIC_STEPS", "8"))))  # 8 = model default
OUT_RATE = 24000
t0 = time.time()
tts = TTS(model="supertonic-3", auto_download=True, intra_op_num_threads=int(os.environ.get("JARVIS_TTS_THREADS", "4")))
voices = json.loads((APP / "vendor" / "voices" / "voices.json").read_text())["voices"]
STYLES = {name: tts.get_voice_style(name) for name in tts.voice_style_names}
CFG = {}
for key, v in voices.items():
    style = v.get("supertonic", {}).get("voice")
    if not style:
        continue
    if style not in STYLES:  # a typo must cost one voice (Piper fallback), not the whole service in a restart loop
        print(f"[tts-st] voix {key} ignorée : style Supertonic inconnu {style!r} (disponibles : {', '.join(STYLES)})", flush=True)
        continue
    CFG[key] = v["supertonic"]
tts.synthesize("Prêt.", voice_style=STYLES[next(iter(STYLES))], lang=LANG)  # warm-up: first run allocates the ONNX arenas
print(f"[tts-st] prêt en {time.time() - t0:.1f}s, styles {', '.join(STYLES)} ; voix : "
      + ", ".join(f"{k}→{c['voice']}" for k, c in CFG.items()), flush=True)
lock = threading.Lock()


def synth(voice, text, speed=None, steps=None):
    """`voice` = catalogue key (or a raw style name such as "F3", handy for A/B tests)."""
    cfg = CFG.get(voice) or ({"voice": voice} if voice in STYLES else None)
    if cfg is None:
        raise ValueError(f"voix inconnue : {voice}")
    speed = float(speed or cfg.get("speed") or 1.05)
    if LANG == "fr":
        text = supertonic_respell(text)
    steps = min(STEPS_RANGE[1], max(STEPS_RANGE[0], int(steps or STEPS)))
    with lock:
        t1 = time.time()
        wav, _ = tts.synthesize(text, voice_style=STYLES[cfg["voice"]], lang=LANG, speed=min(2.0, max(0.7, speed)), total_steps=steps)
    a = np.asarray(wav, dtype=np.float32).reshape(-1)
    if tts.sample_rate != OUT_RATE:
        a = resample_poly(a, OUT_RATE, tts.sample_rate)
    print(f"[tts-st] {voice}/{cfg['voice']} {len(text)} car : {time.time() - t1:.2f}s pour {len(a) / OUT_RATE:.1f}s", flush=True)
    buf = io.BytesIO()
    sf.write(buf, np.clip(a, -1.0, 1.0), OUT_RATE, subtype="PCM_16", format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path != "/healthz":
            self.send_response(404); self.end_headers(); return
        self.send_response(200)
        self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "voices": {k: c["voice"] for k, c in CFG.items()}, "styles": list(STYLES), "sampleRate": OUT_RATE}).encode())

    def do_POST(self):
        if self.path != "/tts":
            self.send_response(404); self.end_headers(); return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            data = synth(str(body.get("voice", "")), str(body.get("text", ""))[:1200], body.get("speed"), body.get("steps"))
            self.send_response(200)
            self.send_header("content-type", "audio/wav"); self.send_header("content-length", str(len(data))); self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            msg = json.dumps({"error": str(e)}).encode()
            self.send_response(500); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(msg)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
