#!/usr/bin/env python3
"""Local French TTS service. POST /tts {"agent": "<agent id>", "voice": "<voice id>"?, "text": "..."} -> audio/wav.

Voices form a catalogue (vendor/voices/voices.json) independent of any agent. The voice of an agent is,
in order: the `voice` given in the request (the Node server sends the one it resolved), the `voice`
field of config/agents.json (or agents.example.json), else an automatic, deterministic pick from the
catalogue (same rule as server/agents.mjs). Unknown agents therefore always get a voice.
Engines, chosen per voice in vendor/voices/voices.json:
  - "supertonic": Supertonic 3 sidecar (:8182) — native French, 10 built-in styles, native speed, RTF ~0.25.
  - "pockettts": Kyutai Pocket TTS sidecar (:8181) — native French, cloned timbres, RTF ~0.4.
  - "openvoice": MeloTTS + OpenVoice v2 sidecar (:8180) — cloned timbres, RTF ~0.9.
  - "kokoro":    Kokoro-82M in-process (only ff_siwis is native French).
  - "piper":     Piper (ONNX) — instant, less natural. Always the fallback when a sidecar is down or fails.
Before any engine: pronunciation lexicon, then numbers/times/dates/amounts/units in words (fr_normalize.py).
Post-processing shared by all: pitch/timbre shift, optional "robot" treatment, fades.
Bound to loopback only: the Node server is the single client.
"""
import io, json, os, re, sys, threading, time, wave
from fractions import Fraction
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly, butter, lfilter
from piper import PiperVoice
from piper.voice import SynthesisConfig

from fr_normalize import normalize as normalize_numbers

APP = Path(__file__).resolve().parent.parent
VOICES_DIR = APP / "vendor" / "voices"
os.environ.setdefault("HF_HOME", str(APP / "vendor" / "tts-eval" / "hf_cache"))  # Kokoro weights live here
HOST, PORT = "127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8179

_voices_doc = json.loads((VOICES_DIR / "voices.json").read_text())
voices_cfg = _voices_doc["voices"]
CADENCE = _voices_doc.get("_meta", {}).get("cadence")
VOICE_IDS = [k for k in voices_cfg if not k.startswith("_")]
# First voice of each register = safe Piper fallback when a synthesis runs away (order of the catalogue matters).
FALLBACK = {}
for _k in VOICE_IDS:
    FALLBACK.setdefault(voices_cfg[_k].get("register", "m"), _k)
_agents_file = next((f for f in (APP / "config" / "agents.json", APP / "config" / "agents.example.json") if f.exists()), None)
agents = json.loads(_agents_file.read_text())["agents"] if _agents_file else []


def fnv1a(s):
    h = 2166136261
    for b in s.encode():
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


def assign_voices(agent_list):
    """agent id -> voice id. Explicit `voice` wins; otherwise a slot derived from the id's hash, moving to the
    next free voice on collision so a small team gets distinct timbres. Identical to server/agents.mjs."""
    out, taken = {}, set()
    for a in agent_list:
        if a.get("voice") in voices_cfg:
            out[a["id"]] = a["voice"]; taken.add(a["voice"])
    for a in agent_list:
        if a["id"] in out or not VOICE_IDS:
            continue
        start = fnv1a(a["id"]) % len(VOICE_IDS)
        pick = next((VOICE_IDS[(start + k) % len(VOICE_IDS)] for k in range(len(VOICE_IDS)) if VOICE_IDS[(start + k) % len(VOICE_IDS)] not in taken), VOICE_IDS[start])
        out[a["id"]] = pick; taken.add(pick)
    return out


AGENT_VOICE = assign_voices(agents)
_agent_lock = threading.Lock()


def voice_for(agent_id, requested=None):
    if requested in voices_cfg:
        return requested
    with _agent_lock:
        if agent_id not in AGENT_VOICE:  # agent unknown to the config: same deterministic rule, remembered
            known = [{"id": k, "voice": v} for k, v in AGENT_VOICE.items()]
            AGENT_VOICE[agent_id] = assign_voices(known + [{"id": agent_id}])[agent_id]
        return AGENT_VOICE[agent_id]


lexicon_file = next((f for f in (APP / "config" / "pronunciation.json", APP / "config" / "pronunciation.example.json") if f.exists()), None)
LEXICON = [(re.compile(rf"(?<![\w-]){re.escape(k)}(?![\w-])", re.I), v)
           for k, v in (json.loads(lexicon_file.read_text()) if lexicon_file else {}).items() if not k.startswith("_")]

_models, _locks = {}, {}
_load_lock = threading.Lock()
_kokoro = {"pipe": None, "lock": threading.Lock(), "error": None}


def model_for(file_name):
    with _load_lock:
        if file_name not in _models:
            t0 = time.time()
            _models[file_name] = PiperVoice.load(str(VOICES_DIR / "models" / file_name))
            _locks[file_name] = threading.Lock()  # a Piper session is not re-entrant
            print(f"[tts] piper {file_name} chargé en {time.time() - t0:.2f}s", flush=True)
    return _models[file_name], _locks[file_name]


def load_kokoro():
    """Runs in a background thread at startup: torch import + weights take ~5-10 s; Piper answers meanwhile."""
    try:
        t0 = time.time()
        from kokoro import KPipeline
        pipe = KPipeline(lang_code="f", repo_id="hexgrad/Kokoro-82M")
        for r in pipe("Prêt.", voice="ff_siwis"):  # warm-up: first call compiles kernels
            pass
        _kokoro["pipe"] = pipe
        print(f"[tts] kokoro prêt en {time.time() - t0:.1f}s", flush=True)
    except Exception as e:  # noqa: BLE001
        _kokoro["error"] = str(e)
        print(f"[tts] kokoro indisponible : {e} — repli Piper", flush=True)


def prepare(text):
    for rx, spoken in LEXICON:
        text = rx.sub(spoken, text)
    try:
        text = normalize_numbers(text)  # "14h30" -> "quatorze heures trente": no engine reads digits reliably
    except Exception as e:  # noqa: BLE001 - a normalisation bug must never cost the sentence
        print(f"[tts] normalisation ignorée ({e}) : {text!r}", flush=True)
    return re.sub(r"\s+", " ", text).strip()


def robot_fx(x, rate, amount=1.0):
    """Synthetic-voice treatment that keeps consonants intact (checked with tts/voice_qa.py):
    ring modulation (metallic buzz) + short comb delay (resonant "helmet") + band limiting + gentle bit
    reduction. `amount` 0..1.5 scales the effect."""
    n = len(x)
    t = np.arange(n, dtype=np.float32) / rate
    carrier = 1.0 - 0.28 * amount * (1.0 - np.cos(2 * np.pi * 42.0 * t))     # ring mod, never fully silent
    y = x * carrier
    d = int(rate * 0.0037)                                                     # 3.7 ms comb → metallic timbre
    if d and n > d:
        y[d:] += 0.35 * amount * y[:-d]
    b, a = butter(2, [90 / (rate / 2), min(5200, rate / 2 - 100) / (rate / 2)], btype="band")  # keep a male fundamental
    y = lfilter(b, a, y)
    step = 32768 / (2 ** (16 - 5 * amount))                                    # ~11-bit grain when amount = 1
    y = np.round(y / step) * step
    peak = np.max(np.abs(y)) or 1.0
    return np.clip(y * (0.92 * 32767 / peak), -32768, 32767)


def synth_piper(v, text, slow):
    model, lock = model_for(v["model_file"])
    cfg = SynthesisConfig(speaker_id=v.get("speaker_id"), length_scale=(v.get("length_scale") or 1.0) * slow)
    buf = io.BytesIO()
    with lock, wave.open(buf, "wb") as wf:
        model.synthesize_wav(text, wf, syn_config=cfg)
    with wave.open(io.BytesIO(buf.getvalue())) as wf:
        rate, frames = wf.getframerate(), wf.readframes(wf.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32), rate


def synth_kokoro(v, text, slow):
    pipe = _kokoro["pipe"]
    if pipe is None:
        raise RuntimeError("kokoro pas prêt")
    with _kokoro["lock"]:
        chunks = [r.audio.numpy() for r in pipe(text, voice=v["voice"], speed=(v.get("speed") or 1.0) / slow) if r.audio is not None]
    if not chunks:
        raise RuntimeError("kokoro: pas d'audio")
    audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    return np.clip(audio * 32767, -32768, 32767).astype(np.float32), 24000


SIDECARS = {"openvoice": os.environ.get("JARVIS_OV_URL", "http://127.0.0.1:8180"), "pockettts": os.environ.get("JARVIS_PK_URL", "http://127.0.0.1:8181"),
            "supertonic": os.environ.get("JARVIS_ST_URL", "http://127.0.0.1:8182")}


def synth_sidecar(engine, v, text, slow):
    import urllib.request
    body = json.dumps({"voice": v["_key"], "text": text, "speed": (v.get("speed") or 1.0) / slow}).encode()
    req = urllib.request.Request(f"{SIDECARS[engine]}/tts", body, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    with wave.open(io.BytesIO(data)) as wf:
        rate, frames = wf.getframerate(), wf.readframes(wf.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32), rate


def render(voice_key, text, base_key=None):
    """voice_key = catalogue id, or a private variant (`_<id>_<engine>`, `_tmp`) whose sidecar timbre is base_key."""
    v = voices_cfg[voice_key]
    pitch = float(v.get("pitch") or 1.0)
    engine = v.get("engine", "piper")
    # Pitch/timbre shift = play the audio `pitch` times faster. Synthesising `pitch` times slower
    # first keeps the speaking rate unchanged, so only the voice character moves.
    if engine in SIDECARS:
        try:
            pcm, rate = synth_sidecar(engine, {**v[engine], "_key": base_key or voice_key}, text, pitch)
        except Exception as e:  # noqa: BLE001
            print(f"[tts] {engine} a échoué ({e}) → piper", flush=True)
            pcm, rate = synth_piper(v["piper"], text, pitch)
    elif engine == "kokoro" and _kokoro["pipe"] is not None:
        try:
            pcm, rate = synth_kokoro(v["kokoro"], text, pitch)
        except Exception as e:  # noqa: BLE001
            print(f"[tts] kokoro a échoué ({e}) → piper", flush=True)
            pcm, rate = synth_piper(v["piper"], text, pitch)
    else:
        pcm, rate = synth_piper(v["piper"], text, pitch)
    if abs(pitch - 1.0) > 0.005:
        ratio = Fraction(1 / pitch).limit_denominator(50)
        pcm = np.clip(resample_poly(pcm, ratio.numerator, ratio.denominator), -32768, 32767).astype(np.float32)
    # Common cadence: every voice is stretched (pitch preserved) to the same letters-per-second rate,
    # because cloned models speak at the pace of their reference clip and vary from one run to the next.
    tempo = float(v.get("tempo") or 1.0)
    n_letters = len(re.findall(r"[^\W\d_]", text))
    if CADENCE and n_letters >= CADENCE.get("min_letters", 12) and len(pcm) > rate * 0.3:
        tempo *= CADENCE["target_letters_per_sec"] / (n_letters / (len(pcm) / rate))  # > 1 when the voice is slower than the target
        lo, hi = CADENCE.get("clamp", [0.8, 1.35]); tempo = min(hi, max(lo, tempo))
    if abs(tempo - 1.0) > 0.03:  # phase vocoder; > 1 = faster
        import librosa
        y = librosa.effects.time_stretch(pcm / 32768.0, rate=tempo)
        pcm = np.clip(y * 32768.0, -32768, 32767).astype(np.float32)
    if v.get("fx") == "robot":
        pcm = robot_fx(pcm, rate, float(v.get("fx_amount") or 1.0))
    # Short fade in/out: avoids clicks when sentences are played back to back.
    fade = min(len(pcm) // 4, int(rate * 0.008))
    if fade:
        ramp = np.linspace(0, 1, fade, dtype=np.float32)
        pcm[:fade] *= ramp; pcm[-fade:] *= ramp[::-1]
    pcm = pcm.astype(np.int16)
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(rate); wf.writeframes(pcm.tobytes())
    return out.getvalue(), len(pcm) / rate


_cache, _cache_lock = {}, threading.Lock()   # short phrases (wake words, "Oui.", acks) come back instantly


def synth(agent_id, text, engine=None, voice=None):
    text = prepare(text)
    base = voice_for(agent_id, voice)
    key = base
    if engine in ("piper", "kokoro", "openvoice", "pockettts", "supertonic") and engine != voices_cfg[key].get("engine"):  # explicit override (tests, A/B)
        voices_cfg[f"_{key}_{engine}"] = {**voices_cfg[key], "engine": engine}
        key = f"_{key}_{engine}"
    ck = (key, text, voices_cfg[key].get("engine"))
    if len(text) <= 48:
        with _cache_lock:
            if ck in _cache:
                return _cache[ck]
    data, seconds = render(key, text, base)
    # Guard against a runaway synthesis (babbling, 2-5x too long): replay with the safe Piper voice of the same register.
    limit = 2.5 + 0.13 * len(text)
    fallback = FALLBACK.get(voices_cfg[base].get("register", "m"), VOICE_IDS[0])
    if seconds > limit and base != fallback:
        print(f"[tts] durée anormale pour {key} ({seconds:.1f}s > {limit:.1f}s) → repli {fallback} (piper)", flush=True)
        v = dict(voices_cfg[fallback]); v["engine"] = "piper"
        voices_cfg["_tmp"] = v
        data, seconds = render("_tmp", text, fallback)
    if len(text) <= 48:
        with _cache_lock:
            if len(_cache) > 300:
                _cache.pop(next(iter(_cache)))
            _cache[ck] = data
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):
        self.send_response(200 if self.path == "/healthz" else 404)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "voices": VOICE_IDS, "agents": AGENT_VOICE, "piper": list(_models), "kokoro": _kokoro["pipe"] is not None, "kokoroError": _kokoro["error"]}).encode())

    def do_POST(self):
        if self.path != "/tts":
            self.send_response(404); self.end_headers(); return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            text = str(body.get("text", ""))[:1200]
            if not re.search(r"\w", text):
                raise ValueError("texte vide")
            t0 = time.time()
            data = synth(str(body.get("agent", "main")), text, body.get("engine"), body.get("voice"))
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(data)))
            self.send_header("x-synth-ms", str(int((time.time() - t0) * 1000)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001 - surface any synthesis failure to the caller
            msg = json.dumps({"error": str(e)}).encode()
            self.send_response(500); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(msg)


if __name__ == "__main__":
    print(f"[tts] voix : {', '.join(f'{a}→{v}' for a, v in AGENT_VOICE.items()) or 'attribution automatique à la demande'}", flush=True)
    for key in dict.fromkeys([*AGENT_VOICE.values(), *FALLBACK.values()]):  # warm every Piper voice in use so the fallback is instant
        model_for(voices_cfg[key]["piper"]["model_file"])
    if any(v.get("engine") == "kokoro" for v in voices_cfg.values()):
        threading.Thread(target=load_kokoro, daemon=True).start()
    print(f"[tts] prêt sur http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
