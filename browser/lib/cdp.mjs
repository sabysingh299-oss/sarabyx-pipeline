import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sleep } from "./chrome.mjs";
import { ROOT } from "./paths.mjs";

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9222;
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const PREF_PATH = path.join(ROOT, "data", "chrome-control.json");
const PIPELINE_URL = `http://127.0.0.1:${process.env.POSTER_PORT || 3920}/`;

/**
 * Dedicated Chrome profile for Pipeline posting.
 * Never touches your everyday Chrome Default profile.
 * We never quit/kill your main Chrome.
 */
export const PIPELINE_CHROME_PROFILE = path.join(ROOT, "data", "chrome-profile");

const CHROME_BIN =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function savePref(enabled) {
  fs.mkdirSync(path.dirname(PREF_PATH), { recursive: true });
  fs.writeFileSync(
    PREF_PATH,
    JSON.stringify(
      {
        enabled: Boolean(enabled),
        profile: PIPELINE_CHROME_PROFILE,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

export async function isCdpUp() {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  if (!res.ok) throw new Error("Could not list Chrome tabs via DevTools.");
  return res.json();
}

function launchPipelineChrome(extraUrls = []) {
  fs.mkdirSync(PIPELINE_CHROME_PROFILE, { recursive: true });
  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error(`Google Chrome not found at ${CHROME_BIN}`);
  }

  const args = [
    `--user-data-dir=${PIPELINE_CHROME_PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    ...extraUrls,
  ];

  const child = spawn("open", ["-na", "Google Chrome", "--args", ...args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

/**
 * Open or reuse a single tab for this URL (same host → navigate existing).
 * Never opens a second tab for the same site.
 */
export async function openUrlInPipelineChrome(url, { forceNew = false } = {}) {
  if (!(await isCdpUp())) {
    await ensureCdp({ openUi: false });
  }

  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }

  if (!forceNew && host) {
    const targets = await listTargets();
    const existing = targets.find((t) => {
      if (t.type !== "page" || !t.webSocketDebuggerUrl) return false;
      try {
        const h = new URL(t.url || "about:blank").hostname.replace(/^www\./, "");
        return h === host || String(t.url || "").includes(host);
      } catch {
        return String(t.url || "").includes(host);
      }
    });

    if (existing?.webSocketDebuggerUrl) {
      const session = new CdpSession(existing.webSocketDebuggerUrl);
      try {
        await session.connect();
        await session.send("Page.enable");
        const current = String(existing.url || "");
        if (current !== url && !current.startsWith(url.replace(/\/$/, ""))) {
          await session.send("Page.navigate", { url });
          await sleep(1200);
        }
        try {
          if (existing.id) await fetch(`${CDP_BASE}/json/activate/${existing.id}`);
        } catch {
          // ignore
        }
        return { ...existing, url, reused: true };
      } finally {
        session.close();
      }
    }
  }

  const res = await fetch(`${CDP_BASE}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!res.ok) {
    throw new Error(`Could not open tab: ${url}`);
  }
  return res.json();
}

/**
 * Start or reuse Pipeline Chrome with DevTools.
 * NEVER quits or kills the user's everyday Chrome.
 * @param {{ openUi?: boolean }} opts openUi focuses/opens the Pipeline UI tab (Enable button only).
 */
export async function enableChromeControl({ openUi = true } = {}) {
  if (await isCdpUp()) {
    savePref(true);
    if (openUi) {
      await openUrlInPipelineChrome(PIPELINE_URL);
    }
    return {
      ok: true,
      already: true,
      chromeControl: true,
      message:
        "Chrome control is ON. Sign into Instagram/LinkedIn in the Pipeline Chrome window if needed, then post.",
    };
  }

  // Launch once with Pipeline URL — do NOT open a second tab afterwards.
  launchPipelineChrome([PIPELINE_URL]);

  for (let i = 0; i < 50; i += 1) {
    if (await isCdpUp()) {
      savePref(true);
      await sleep(600);
      return {
        ok: true,
        already: false,
        chromeControl: true,
        message:
          "Pipeline Chrome is ready. Sign into Instagram & LinkedIn in THIS window once, then Detect sessions / Post. Your normal Chrome was not closed.",
      };
    }
    await sleep(200);
  }

  throw new Error(
    "Could not start Pipeline Chrome on port 9222. Another app may be using that port, or Chrome failed to start. Tell me and I’ll help — I will not kill your main Chrome.",
  );
}

/** Ensure DevTools is up. Does not open extra tabs. */
export async function ensureCdp({ openUi = false } = {}) {
  if (await isCdpUp()) {
    savePref(true);
    return { ok: true, chromeControl: true };
  }
  return enableChromeControl({ openUi });
}

export async function scanCdpSessions() {
  if (!(await isCdpUp())) {
    return {
      ok: false,
      chromeControl: false,
      message: "Chrome control is OFF. Click Enable Chrome control first.",
      instagram: { open: false, connected: false },
      linkedin: { open: false, connected: false },
    };
  }

  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const urls = pages.map((t) => String(t.url || ""));

  const igUrls = urls.filter((u) => /instagram\.com/i.test(u));
  const liUrls = urls.filter((u) => /linkedin\.com/i.test(u));

  async function pageLoggedIn(urlIncludes, checkJs) {
    const page = pages.find((t) => String(t.url || "").includes(urlIncludes));
    if (!page) return { open: false, connected: false };
    const session = new CdpSession(page.webSocketDebuggerUrl);
    try {
      await session.connect();
      await session.send("Runtime.enable");
      const connected = Boolean(await session.evaluate(checkJs));
      return { open: true, connected };
    } catch {
      return { open: true, connected: false };
    } finally {
      session.close();
    }
  }

  const ig = await pageLoggedIn(
    "instagram.com",
    `!document.querySelector('input[name="username"], input[name="email"]') && !/log in to instagram/i.test(document.body?.innerText || '')`,
  );
  const li = await pageLoggedIn(
    "linkedin.com",
    `[...document.querySelectorAll('button,div[role="button"]')].some(n => /start a post/i.test(n.textContent||'')) || !!document.querySelector('input[aria-label*="Search"]')`,
  );

  return {
    ok: true,
    chromeControl: true,
    tabsScanned: urls.length,
    instagram: { ...ig, urls: igUrls.slice(0, 5) },
    linkedin: { ...li, urls: liUrls.slice(0, 5) },
    message: !ig.open
      ? "Open Instagram in Pipeline Chrome, sign in, then Detect sessions."
      : !ig.connected
        ? "Instagram is open but not signed in in Pipeline Chrome. Log in there, then Detect again."
        : !li.open
          ? "Open LinkedIn in Pipeline Chrome, sign in, then Detect sessions."
          : !li.connected
            ? "LinkedIn is open but not signed in in Pipeline Chrome. Log in there, then Detect again."
            : "Instagram and LinkedIn look signed in.",
  };
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener(
        "error",
        () => reject(new Error("Chrome DevTools connection failed")),
        { once: true },
      );
    });
    this.ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message || "CDP error"));
        else resolve(data.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Chrome timed out on ${method}`));
        }
      }, 45000);
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const msg =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "Script failed in Chrome";
      throw new Error(msg);
    }
    return result.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

export async function connectToTab(urlIncludes, { preferUrl } = {}) {
  await ensureCdp({ openUi: false });

  const fallbackUrl = preferUrl
    || (urlIncludes.includes("instagram")
      ? "https://www.instagram.com/"
      : "https://www.linkedin.com/feed/");

  // Reuse one tab for this host; navigate to the preferred URL (e.g. LI feed).
  const opened = await openUrlInPipelineChrome(fallbackUrl);
  await sleep(1500);

  let targets = await listTargets();
  let page =
    targets.find(
      (t) =>
        t.type === "page" &&
        String(t.url || "").includes(urlIncludes) &&
        t.webSocketDebuggerUrl,
    ) ||
    (opened?.webSocketDebuggerUrl ? opened : null) ||
    targets.find(
      (t) =>
        t.type === "page" &&
        t.id &&
        opened?.id &&
        t.id === opened.id &&
        t.webSocketDebuggerUrl,
    );

  if (!page?.webSocketDebuggerUrl) {
    throw new Error("Could not attach to a Chrome tab. Click Enable Chrome control, then try again.");
  }

  const session = new CdpSession(page.webSocketDebuggerUrl);
  await session.connect();
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("DOM.enable");

  try {
    if (page.id) await fetch(`${CDP_BASE}/json/activate/${page.id}`);
  } catch {
    // ignore
  }

  // Ensure we are on the right surface (feed for LinkedIn compose)
  const current = await session.evaluate("location.href");
  if (!String(current || "").includes(urlIncludes) ||
      (urlIncludes.includes("linkedin") && !/linkedin\.com\/(feed|home)/i.test(String(current || "")))) {
    await session.send("Page.navigate", { url: fallbackUrl });
    await sleep(2800);
  }

  return session;
}

export async function setFileOnPage(session, absolutePath) {
  await session.send("DOM.enable");
  let node = null;
  for (let i = 0; i < 40; i += 1) {
    const doc = await session.send("DOM.getDocument", { depth: 1 });
    node = await session.send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]',
    });
    if (node?.nodeId) break;
    await sleep(250);
  }
  if (!node?.nodeId) {
    throw new Error("Could not find file upload in the Chrome page.");
  }
  await session.send("DOM.setFileInputFiles", {
    nodeId: node.nodeId,
    files: [absolutePath],
  });
}
