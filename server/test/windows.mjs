// Headless check of agent windows: a typed request asks an agent to open a browser window; we wait for
// the detail window and the browser window to appear, then screenshot.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
const shots = "/tmp/jarvis-win"; mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-sandbox", "--window-size=1440,900"] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:8480/", { waitUntil: "networkidle0" });
await page.click("#gate-btn"); await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => window.jarvis.say("Neo, réponds en une phrase, ouvre une fenêtre navigateur sur https://github.com/openclaw/openclaw avec le titre Exemple, et mets dans le détail un tableau de deux lignes."));
const t0 = Date.now();
try { await page.waitForSelector('.win-browser .view img[src^="blob:"]', { timeout: 120000 }); } catch { console.log("pas d'image de page après 120 s"); }
await new Promise((r) => setTimeout(r, 2500));
const wins = await page.$$eval(".win", (els) => els.map((w) => ({ kind: w.className.replace(/win |pop/g, "").trim(), agent: w.dataset.agent, title: w.querySelector(".title").textContent, badge: Boolean(w.querySelector(".badge img, .badge .sigil")), frame: w.querySelector(".view img")?.src?.slice(0, 5) ?? null, avatarOk: !(w.querySelector(".badge img")?.src ?? "").startsWith("blob:"), url: w.querySelector(".urlbar")?.textContent ?? null })));
console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(wins));
await page.screenshot({ path: `${shots}/windows.png` });
console.log(errors.length ? "ERREURS: " + errors.join(" | ") : "(console propre)");
await browser.close();
