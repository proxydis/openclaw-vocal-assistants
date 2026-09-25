// UI check of the avatar manager: open it, replace Ada's picture through the real file input
// (a PNG, to exercise the in-browser crop/JPEG conversion), verify it propagates, then restore.
import puppeteer from "puppeteer-core";
import { mkdirSync, statSync } from "node:fs";

const shots = "/tmp/jarvis-av"; mkdirSync(shots, { recursive: true });
const APP = new URL("../../", import.meta.url).pathname;
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-sandbox", "--window-size=1440,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:8480/", { waitUntil: "networkidle0" });
await page.click("#gate-btn"); await new Promise((r) => setTimeout(r, 1200));
await page.click('.crew-node[data-id="main"]'); await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${shots}/1-axiom.png` });
await page.click("#btn-avatars"); await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${shots}/2-manager.png` });
const tiles = await page.$$eval(".am-tile b", (els) => els.map((e) => e.textContent));
console.log("tuiles:", tiles.join(", "));

const before = statSync(`${APP}web/avatars/ada.jpg`).size;
const adaFace = (await page.$$(".am-tile .am-face"))[tiles.indexOf("Ada")];
const [chooser] = await Promise.all([page.waitForFileChooser(), adaFace.click()]);
await chooser.accept([`${APP}web/icon.svg`.replace("icon.svg", "avatars/generated/trinity.jpg")]);
await new Promise((r) => setTimeout(r, 1500));
const after = statSync(`${APP}web/avatars/ada.jpg`).size;
const railSrc = await page.$eval('.crew-node[data-id="ada"] img', (i) => i.src);
console.log("ada.jpg:", before, "→", after, "octets | rail:", railSrc.split("/").pop(), "| toast:", await page.$eval("#toast", (t) => t.textContent));
await page.screenshot({ path: `${shots}/3-after-upload.png` });

const adaReset = (await page.$$(".am-tile"))[tiles.indexOf("Ada")];
await (await adaReset.$(".am-reset")).click(); await new Promise((r) => setTimeout(r, 800));
console.log("après ↺ :", statSync(`${APP}web/avatars/ada.jpg`).size, "octets (défaut =", statSync(`${APP}web/avatars/defaults/ada.jpg`).size + ")");
console.log(errors.length ? "ERREURS: " + errors.join(" | ") : "(console propre)");
await browser.close();
