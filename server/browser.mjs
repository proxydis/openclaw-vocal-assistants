// Server-side browser windows: pages are rendered in a headless Chrome on the host and streamed to
// the JARVIS page as JPEG frames; clicks, scroll and keys are forwarded back. Works for every site,
// including those that forbid embedding (GitHub, Google…), and never exposes the user's own cookies.
import { createHash } from "node:crypto";

const CHROME = process.env.JARVIS_CHROME ?? "/usr/bin/google-chrome";
const VIEW = { width: 1024, height: 680 };
const FRAME_MS = 450;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

export class BrowserWindows {
  constructor({ send, log }) { this.send = send; this.log = log; this.wins = new Map(); this.browser = null; this.idleTimer = null; }

  async launch() {
    if (this.browser?.connected) return this.browser;
    const puppeteer = (await import("puppeteer-core")).default;
    this.browser = await puppeteer.launch({
      executablePath: CHROME, headless: "new",
      args: ["--mute-audio", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--lang=fr-FR", `--window-size=${VIEW.width},${VIEW.height}`],
    });
    this.browser.on("disconnected", () => { this.browser = null; });
    this.log("navigateur: Chrome sans écran démarré");
    return this.browser;
  }

  async open({ clientId, key, url, agentId, title }) {
    clearTimeout(this.idleTimer);
    let win = this.wins.get(key);
    if (win) { if (win.clientId !== clientId) return; await win.page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {}); return; }
    const browser = await this.launch();
    const page = await browser.newPage();
    await page.setViewport(VIEW);
    await page.setUserAgent((await browser.userAgent()).replace(/HeadlessChrome/, "Chrome"));
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    win = { key, clientId, agentId, page, last: "", busy: false, timer: null, title: title ?? "" };
    this.wins.set(key, win);
    this.send(clientId, { t: "window", id: agentId, kind: "browser", key, url, title: win.title, w: VIEW.width, h: VIEW.height });
    page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch((e) => this.log(`navigateur ${key}: ${e.message}`));
    win.timer = setInterval(() => this.frame(win), FRAME_MS);
    return win;
  }

  async frame(win) {
    if (win.busy || win.page.isClosed()) return;
    win.busy = true;
    try {
      const shot = await win.page.screenshot({ type: "jpeg", quality: 62, optimizeForSpeed: true });
      const h = createHash("md5").update(shot).digest("hex");
      const url = win.page.url();
      if (h !== win.last || url !== win.url) {
        win.last = h; win.url = url;
        let title = ""; try { title = await win.page.title(); } catch {}
        this.send(win.clientId, { t: "frame", key: win.key, url, title: title || win.title, w: VIEW.width, h: VIEW.height }, shot);
      }
    } catch (e) { if (!/closed|detached|Target/.test(e.message)) this.log(`navigateur ${win.key}: ${e.message}`); }
    win.busy = false;
  }

  async input(clientId, m) {
    const win = this.wins.get(m.key);
    if (!win || win.clientId !== clientId || win.page.isClosed()) return;
    const p = win.page;
    try {
      switch (m.kind) {
        case "click": await p.mouse.click(clamp(m.x, VIEW.width), clamp(m.y, VIEW.height)); break;
        case "scroll": await p.mouse.move(clamp(m.x ?? VIEW.width / 2, VIEW.width), clamp(m.y ?? VIEW.height / 2, VIEW.height)); await p.mouse.wheel({ deltaY: Math.max(-1200, Math.min(1200, Number(m.dy) || 0)) }); break;
        case "key": if (typeof m.key2 === "string" && m.key2.length === 1) await p.keyboard.type(m.key2); else if (KEYS.has(m.key2)) await p.keyboard.press(m.key2); break;
        case "nav": if (/^https?:\/\//i.test(m.url ?? "")) await p.goto(m.url, { waitUntil: "domcontentloaded", timeout: 25000 }); break;
        case "back": await p.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {}); break;
        case "reload": await p.reload({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {}); break;
      }
      setTimeout(() => this.frame(win), 120);
    } catch (e) { this.log(`navigateur ${m.key} ${m.kind}: ${e.message}`); }
  }

  async close(key, clientId) {
    const win = this.wins.get(key);
    if (!win || (clientId && win.clientId !== clientId)) return;
    this.wins.delete(key); clearInterval(win.timer);
    await win.page.close().catch(() => {});
    if (this.wins.size === 0) this.idleTimer = setTimeout(() => this.browser?.close().catch(() => {}), IDLE_CLOSE_MS).unref();
  }

  closeClient(clientId) { for (const [k, w] of this.wins) if (w.clientId === clientId) this.close(k); }
}

const KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Delete", "Space"]);
const clamp = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
