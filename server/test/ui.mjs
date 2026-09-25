// Headless UI check with a FAKE MICROPHONE: Chrome plays a WAV file as if it were the mic, so the
// whole real path is exercised (getUserMedia → VAD → WebSocket → Whisper → agent → Piper → playback).
// Usage: node test/ui.mjs [--say "<Prénom>, bonjour"] [--viewport 1440x900|390x844] [--shots /tmp/jarvis] [--seconds 25]
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { loadAgents } from "../agents.mjs";

const arg = (name, def) => { const i = process.argv.indexOf("--" + name); return i > -1 ? process.argv[i + 1] : def; };
const APP = new URL("../../", import.meta.url).pathname;
const { agents } = loadAgents({ app: APP, ocCfg: JSON.parse(readFileSync(`${process.env.HOME}/.openclaw/openclaw.json`, "utf8")) });
const say = arg("say", `${agents[0].name}, dis simplement bonjour.`);
const [vw, vh] = arg("viewport", "1440x900").split("x").map(Number);
const shots = arg("shots", "/tmp/jarvis"); mkdirSync(shots, { recursive: true });
const seconds = Number(arg("seconds", 25));

// Fake mic file: 6 s of silence (the startup sequence, ~4.4 s, is deliberately not listened to), the phrase, then silence (Chrome loops the file; keep it long).
const tts = execFileSync("curl", ["-s", "-X", "POST", "localhost:8179/tts", "-H", "content-type: application/json", "-d", JSON.stringify({ agent: (agents[1] ?? agents[0]).id, engine: "piper", text: say })], { maxBuffer: 1 << 26 });
writeFileSync("/tmp/ui_say.wav", tts);
execFileSync(`${APP}.venv/bin/python`, ["-c", `
import soundfile as sf, numpy as np
from scipy.signal import resample_poly
x,sr=sf.read('/tmp/ui_say.wav'); y=resample_poly(x,48000,sr)
z=np.concatenate([np.zeros(int(48000*6)),y*0.9,np.zeros(48000*${Math.max(30, seconds + 10)})])
sf.write('/tmp/ui_mic.wav',z,48000,subtype='PCM_16')`]);

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=/tmp/ui_mic.wav",
    "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=swiftshader", `--window-size=${vw},${vh}`, "--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1, isMobile: vw < 700, hasTouch: vw < 700 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()}`));
const t0 = Date.now();
const snap = async (name) => { await page.screenshot({ path: `${shots}/${name}.png` }); console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", name, JSON.stringify(await page.evaluate(() => ({ ...window.jarvis?.state(), subs: [...document.querySelectorAll(".sub")].map((e) => e.innerText.replace(/\s+/g, " ")), windows: [...document.querySelectorAll(".win")].map((w) => w.className.replace("win ", "") + ":" + w.dataset.agent), stateWord: document.getElementById("agent-state").textContent })))); };

await page.goto("http://localhost:8480/", { waitUntil: "networkidle0" });
await snap("01-gate");
await page.click("#gate-btn");
const marks = [[1.5, "02-awake"], [4.2, "03-listening"], [7, "04-thinking"], [10, "05-t10"], [13, "06-t13"], [17, "07-t17"], [seconds, "08-end"]];
for (const [t, name] of marks) { await new Promise((r) => setTimeout(r, Math.max(0, t * 1000 - (Date.now() - t0 - 0)))); await snap(name); }
console.log(logs.filter((l) => !/\[debug\]|\[log\]/.test(l) || /error/i.test(l)).slice(0, 25).join("\n") || "(console propre)");
await browser.close();
