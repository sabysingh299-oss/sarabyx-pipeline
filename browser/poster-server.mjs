#!/usr/bin/env node
/**
 * Sarabyx Pipeline local app + browser posting API.
 * UI lives in /app — users never touch the CSV sheet.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  adaptCaptionForPlatform,
  createDraft,
  combineCaption,
  testAiConnection,
} from "./lib/draft.mjs";
import {
  enableChromeControl,
  ensureCdp,
  isCdpUp,
  openUrlInPipelineChrome,
  scanCdpSessions,
} from "./lib/cdp.mjs";
import {
  postInstagramInChrome,
  postLinkedInInChrome,
} from "./lib/chrome-post.mjs";
import { env } from "./lib/env.mjs";
import {
  addRow,
  deleteRow,
  getReadyRows,
  getRowById,
  listRows,
  updateRow,
} from "./lib/sheet.mjs";
import {
  aiConfig,
  applyPreset,
  publicSettings,
  writeSettings,
} from "./lib/settings.mjs";
import { MEDIA_DIR, ROOT, resolveMedia } from "./lib/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const PORT = Number(env("POSTER_PORT", "3920"));
const CONNECTIONS_PATH = path.join(ROOT, "data", "connections.json");

const LOGIN_URLS = {
  instagram: "https://www.instagram.com/",
  linkedin: "https://www.linkedin.com/feed/",
};

function readConnections() {
  try {
    if (!fs.existsSync(CONNECTIONS_PATH)) {
      return { instagram: { connected: false }, linkedin: { connected: false } };
    }
    return JSON.parse(fs.readFileSync(CONNECTIONS_PATH, "utf8"));
  } catch {
    return { instagram: { connected: false }, linkedin: { connected: false } };
  }
}

function writeConnections(next) {
  fs.mkdirSync(path.dirname(CONNECTIONS_PATH), { recursive: true });
  fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(next, null, 2), "utf8");
}

function markConnection(platform, connected, via = "manual") {
  const connections = readConnections();
  connections[platform] = {
    connected: Boolean(connected),
    checkedAt: new Date().toISOString(),
    via,
  };
  writeConnections(connections);
  return connections;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function runNode(script, args = [], { detach = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: __dirname,
      env: process.env,
      stdio: detach ? "ignore" : ["ignore", "pipe", "pipe"],
      detached: detach,
    });

    if (detach) {
      child.unref();
      resolve({ ok: true, pid: child.pid });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse((stdout || stderr).trim());
      } catch {
        parsed = { raw: stdout || stderr };
      }
      if (code === 0) resolve(parsed);
      else {
        const err = new Error(parsed?.error || stderr || `Exit ${code}`);
        err.payload = parsed;
        reject(err);
      }
    });
  });
}

function platformsOf(row) {
  return String(row.platforms || "instagram|linkedin")
    .split(/[|,]/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isApproved(row) {
  return String(row?.status || "").toLowerCase() === "approved";
}

/** Publish one Approved row via Pipeline Chrome. Throws or returns result object. */
async function publishApprovedRow(row, { platforms } = {}) {
  if (!isApproved(row)) {
    const err = new Error("Post now is only allowed for Approved posts. Approve it first.");
    err.statusCode = 400;
    throw err;
  }

  const wanted = (platforms
    ? String(platforms).split(/[|,]/)
    : platformsOf(row)
  ).map((p) => p.trim().toLowerCase()).filter(Boolean);

  const imagePath = resolveMedia(row.image_path);
  const defaults = aiConfig();

  await ensureCdp({ openUi: false });
  const scan = await scanCdpSessions();
  if (wanted.includes("instagram") && !scan.instagram?.connected) {
    const err = new Error(
      "Instagram is not signed in in Pipeline Chrome. Open Instagram there, log in, Detect sessions, then Post.",
    );
    err.statusCode = 400;
    err.scan = scan;
    throw err;
  }
  if (wanted.includes("linkedin") && !scan.linkedin?.connected) {
    const err = new Error(
      "LinkedIn is not signed in in Pipeline Chrome. Open LinkedIn there, log in, Detect sessions, then Post.",
    );
    err.statusCode = 400;
    err.scan = scan;
    throw err;
  }

  async function textFor(platform) {
    const stored =
      platform === "instagram"
        ? String(row.instagram_caption || "").trim()
        : String(row.linkedin_caption || "").trim();
    if (stored) return stored;

    const prompt =
      platform === "instagram"
        ? String(row.instagram_prompt || defaults.promptInstagram || "").trim()
        : String(row.linkedin_prompt || defaults.promptLinkedin || "").trim();

    const adapted = await adaptCaptionForPlatform({
      platform,
      caption: row.caption,
      hashtags: row.hashtags,
      prompt,
      idea: row.idea,
      angle: row.angle,
    });
    return adapted.text || combineCaption(row.caption, row.hashtags);
  }

  const results = {};
  try {
    if (wanted.includes("instagram")) {
      const text = await textFor("instagram");
      results.instagram = await postInstagramInChrome({ text, imagePath });
      updateRow(row.id, {
        instagram_caption: text,
        instagram_url: results.instagram.url || "",
        notes: results.instagram.note || "",
      });
    }
    if (wanted.includes("linkedin")) {
      const text = await textFor("linkedin");
      results.linkedin = await postLinkedInInChrome({ text, imagePath });
      updateRow(row.id, {
        linkedin_caption: text,
        linkedin_url: results.linkedin.url || "",
        notes: results.linkedin.note || "",
      });
    }
  } catch (error) {
    const updated = updateRow(row.id, {
      status: "Failed",
      notes: `Chrome post failed: ${error.message}`,
    });
    const err = new Error(error.message);
    err.statusCode = 500;
    err.row = updated;
    err.results = results;
    throw err;
  }

  const failed = Object.values(results).some((r) => r && r.ok === false);
  const updated = updateRow(row.id, {
    status: failed ? "Failed" : "Posted",
    posted_at: new Date().toISOString(),
    notes: failed
      ? "One or more platforms failed"
      : "Posted in Pipeline Chrome",
  });

  return { ok: !failed, row: updated, results, browser: "Pipeline Chrome" };
}

function safeMediaName(name) {
  return String(name || "image.png")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const { pathname } = url;

    if (req.method === "OPTIONS") return send(res, 204, {});

    // --- Static app ---
    if (req.method === "GET" && (pathname === "/" || pathname === "/approvals")) {
      return sendFile(res, path.join(APP_DIR, "index.html"));
    }
    if (req.method === "GET" && (pathname === "/styles.css" || pathname === "/app.js")) {
      return sendFile(res, path.join(APP_DIR, pathname.slice(1)));
    }
    if (req.method === "GET" && pathname.startsWith("/media/")) {
      const file = decodeURIComponent(pathname.slice("/media/".length));
      return sendFile(res, path.join(MEDIA_DIR, path.basename(file)));
    }

    // --- Health / n8n compatibility ---
    if (req.method === "GET" && pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "sarabyx-pipeline",
        ui: `http://127.0.0.1:${PORT}`,
        platforms: ["instagram", "linkedin"],
      });
    }
    if (req.method === "GET" && pathname === "/sheet") {
      return send(res, 200, { ok: true, rows: listRows() });
    }
    if (req.method === "GET" && pathname === "/ready") {
      return send(res, 200, { ok: true, rows: getReadyRows() });
    }
    if (req.method === "GET" && pathname === "/approved") {
      const rows = listRows().filter(
        (row) => String(row.status || "").toLowerCase() === "approved",
      );
      return send(res, 200, { ok: true, rows });
    }

    // --- App API ---
    if (req.method === "GET" && pathname === "/api/posts") {
      return send(res, 200, { ok: true, rows: listRows() });
    }

    if (req.method === "GET" && pathname === "/api/settings") {
      return send(res, 200, { ok: true, settings: publicSettings() });
    }

    if (req.method === "POST" && pathname === "/api/settings") {
      const body = await readJson(req);
      const patch = { ...body };
      if (patch.aiApiKey === "" || patch.aiApiKey === undefined) {
        delete patch.aiApiKey;
      }
      if (patch.clearAiApiKey) {
        patch.aiApiKey = "";
        delete patch.clearAiApiKey;
      }
      const settings = writeSettings(patch);
      return send(res, 200, { ok: true, settings });
    }

    if (req.method === "POST" && pathname === "/api/settings/preset") {
      const body = await readJson(req);
      return send(res, 200, {
        ok: true,
        settings: applyPreset(body.preset || "custom"),
      });
    }

    if (req.method === "POST" && pathname === "/api/settings/test") {
      const result = await testAiConnection();
      return send(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "GET" && pathname === "/api/connections") {
      const connections = readConnections();
      const cdp = await isCdpUp();
      return send(res, 200, {
        ok: true,
        browser: "Google Chrome",
        chromeControl: cdp,
        instagram: {
          connected: Boolean(connections.instagram?.connected),
          checkedAt: connections.instagram?.checkedAt || null,
        },
        linkedin: {
          connected: Boolean(connections.linkedin?.connected),
          checkedAt: connections.linkedin?.checkedAt || null,
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/chrome/enable") {
      const result = await enableChromeControl({ openUi: true });
      return send(res, 200, result);
    }

    if (req.method === "POST" && pathname === "/api/connections/scan") {
      const scan = await scanCdpSessions();
      // Always sync stored flags to live CDP truth (clear stale "connected")
      if (scan.ok) {
        markConnection(
          "instagram",
          Boolean(scan.instagram?.connected),
          "chrome-scan",
        );
        markConnection(
          "linkedin",
          Boolean(scan.linkedin?.connected),
          "chrome-scan",
        );
      }
      const connections = readConnections();
      return send(res, 200, {
        ok: Boolean(scan.ok),
        scan,
        chromeControl: await isCdpUp(),
        instagram: connections.instagram,
        linkedin: connections.linkedin,
        message: scan.message || "Scanned Pipeline Chrome tabs.",
      });
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readJson(req);
      const platform = String(body.platform || "").toLowerCase();
      const url = LOGIN_URLS[platform];
      if (!url) return send(res, 400, { ok: false, error: "Unknown platform" });
      // Ensure Chrome control without opening the Pipeline UI tab, then open ONE platform tab.
      await ensureCdp({ openUi: false });
      let opened = null;
      if (body.open !== false) {
        opened = await openUrlInPipelineChrome(url);
      }
      return send(res, 200, {
        ok: true,
        browser: "Pipeline Chrome",
        platform,
        url,
        reused: Boolean(opened?.reused),
        message: opened?.reused
          ? `Focused existing ${platform} tab in Pipeline Chrome.`
          : `Opened ${platform} in Pipeline Chrome. Sign in there if asked.`,
      });
    }

    // Safe LinkedIn compose dry-run — fills the post box, never clicks Post
    if (req.method === "POST" && pathname === "/api/linkedin/dry-run") {
      const body = await readJson(req);
      const text =
        String(body.text || "").trim() ||
        "Pipeline dry-run — this text should appear in the LinkedIn composer. Not published.";
      try {
        const result = await postLinkedInInChrome({
          text,
          imagePath: body.image_path ? resolveMedia(body.image_path) : null,
          dryRun: true,
        });
        return send(res, 200, result);
      } catch (error) {
        return send(res, 500, { ok: false, error: error.message, dryRun: true });
      }
    }

    if (req.method === "POST" && pathname === "/api/connections/confirm") {
      const body = await readJson(req);
      const platform = String(body.platform || "").toLowerCase();
      if (!LOGIN_URLS[platform]) {
        return send(res, 400, { ok: false, error: "Unknown platform" });
      }
      const connections = markConnection(
        platform,
        body.connected !== false,
        body.via || "manual",
      );
      return send(res, 200, { ok: true, ...connections });
    }

    if (req.method === "POST" && pathname === "/api/posts") {
      const body = await readJson(req);
      let row = addRow({
        idea: body.idea,
        angle: body.angle,
        scheduled_date: body.scheduled_date,
        platforms: body.platforms,
        image_path: body.image_path,
        status: body.status || "Draft",
        notes: body.notes || "",
      });
      if (body.draft) {
        const draft = await createDraft({ idea: row.idea, angle: row.angle });
        row = updateRow(row.id, {
          caption: draft.caption,
          hashtags: draft.hashtags,
          status: "Needs Approval",
          notes: `Drafted via ${draft.source}`,
        });
      }
      return send(res, 201, { ok: true, row });
    }

    if (req.method === "POST" && pathname === "/api/posts/update") {
      const body = await readJson(req);
      if (!body.id) return send(res, 400, { ok: false, error: "id required" });
      const { id, ...patch } = body;
      const updated = updateRow(id, patch);
      return send(res, 200, { ok: true, row: updated });
    }

    if (req.method === "POST" && pathname === "/api/posts/delete") {
      const body = await readJson(req);
      return send(res, 200, deleteRow(body.id));
    }

    if (req.method === "POST" && pathname === "/api/upload") {
      const body = await readJson(req);
      if (!body.id || !body.data) {
        return send(res, 400, { ok: false, error: "id and data required" });
      }
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      const ext =
        path.extname(body.filename || "") ||
        (String(body.contentType || "").includes("png") ? ".png" : ".jpg");
      const filename = `${body.id}-${Date.now()}-${safeMediaName(body.filename || `image${ext}`)}`;
      const finalName = filename.endsWith(ext) ? filename : `${filename}${ext}`;
      fs.writeFileSync(path.join(MEDIA_DIR, finalName), Buffer.from(body.data, "base64"));
      const updated = updateRow(body.id, { image_path: finalName });
      return send(res, 200, { ok: true, row: updated });
    }

    if (
      (req.method === "POST" && pathname === "/api/draft") ||
      (req.method === "POST" && pathname === "/draft")
    ) {
      const body = await readJson(req);
      const row = getRowById(body.id);
      if (!row) return send(res, 404, { ok: false, error: "Post not found" });
      const draft = await createDraft({
        idea: row.idea,
        angle: row.angle,
        feedback: body.feedback || row.feedback || "",
        previousCaption: row.caption || "",
        instagramPrompt: body.instagram_prompt || row.instagram_prompt || "",
        linkedinPrompt: body.linkedin_prompt || row.linkedin_prompt || "",
        platforms: platformsOf(row),
        allowTemplateFallback: body.requireAi ? false : true,
      });
      const updated = updateRow(row.id, {
        caption: body.caption || draft.caption,
        hashtags: body.hashtags || draft.hashtags,
        instagram_caption: draft.instagram_caption || draft.caption,
        linkedin_caption: draft.linkedin_caption || draft.caption,
        feedback: "",
        status: "Needs Approval",
        notes: `Drafted via ${draft.source}${draft.model ? ` (${draft.model})` : ""}`,
      });
      return send(res, 200, {
        ok: true,
        row: updated,
        preview: combineCaption(updated.caption, updated.hashtags),
        source: draft.source,
      });
    }

    if (req.method === "POST" && pathname === "/api/regenerate") {
      const body = await readJson(req);
      const row = getRowById(body.id);
      if (!row) return send(res, 404, { ok: false, error: "Post not found" });
      const feedback = String(body.feedback || "").trim();
      if (!feedback) {
        return send(res, 400, {
          ok: false,
          error: "Add a short comment so the model knows what to fix.",
        });
      }

      const {
        wantsImageFromFeedback,
        wantsTextFromFeedback,
        generatePostImage,
      } = await import("./lib/image-gen.mjs");
      const doImage = wantsImageFromFeedback(feedback);
      const doText = wantsTextFromFeedback(feedback);

      updateRow(row.id, {
        feedback,
        status: "Generating",
        notes: doImage
          ? "Generating image from your comment…"
          : "Regenerating from feedback…",
      });

      let caption = row.caption || "";
      let hashtags = row.hashtags || "";
      let imagePath = row.image_path || "";
      let igCaption = row.instagram_caption || "";
      let liCaption = row.linkedin_caption || "";
      const notes = [];
      let draftSource = "feedback";

      try {
        if (doText || !doImage) {
          const draft = await createDraft({
            idea: row.idea,
            angle: row.angle,
            feedback,
            previousCaption: row.caption || "",
            instagramPrompt: row.instagram_prompt || "",
            linkedinPrompt: row.linkedin_prompt || "",
            platforms: platformsOf(row),
            allowTemplateFallback: false,
          });
          caption = draft.caption;
          hashtags = draft.hashtags;
          igCaption = draft.instagram_caption || draft.caption;
          liCaption = draft.linkedin_caption || draft.caption;
          draftSource = draft.source;
          notes.push(
            `Text via ${draft.source}${draft.model ? ` (${draft.model})` : ""}`,
          );
        }

        if (doImage) {
          const image = await generatePostImage({
            idea: row.idea,
            angle: row.angle,
            feedback,
            caption,
            rowId: row.id,
          });
          imagePath = image.filename;
          notes.push(`Image via ${image.model}`);
        }
      } catch (error) {
        const failed = updateRow(row.id, {
          feedback,
          status: "Needs Approval",
          notes: `Regenerate failed: ${error.message}`,
        });
        return send(res, 500, {
          ok: false,
          error: error.message,
          row: failed,
        });
      }

      const updated = updateRow(row.id, {
        caption,
        hashtags,
        instagram_caption: igCaption || caption,
        linkedin_caption: liCaption || caption,
        image_path: imagePath,
        feedback,
        status: "Needs Approval",
        notes: notes.join(" · ") || "Regenerated from feedback",
      });
      return send(res, 200, {
        ok: true,
        row: updated,
        source: draftSource,
        imageGenerated: doImage,
      });
    }

    if (req.method === "POST" && pathname === "/api/ideas/bulk") {
      const body = await readJson(req);
      const lines = String(body.text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) {
        return send(res, 400, { ok: false, error: "Paste at least one idea." });
      }
      const created = lines.map((line) => {
        const [idea, ...rest] = line.split("|").map((p) => p.trim());
        return addRow({
          idea,
          angle: rest.join(" | ") || idea,
          scheduled_date: body.scheduled_date || "",
          platforms: body.platforms || "instagram|linkedin",
          status: "Draft",
        });
      });
      return send(res, 201, { ok: true, rows: created, count: created.length });
    }

    if (req.method === "POST" && pathname === "/api/ideas/generate-all") {
      const body = await readJson(req);
      const targets = listRows().filter((row) => {
        const s = String(row.status || "").toLowerCase();
        return s === "draft" || s === "ready" || s === "idea";
      });
      const results = [];
      for (const row of targets) {
        try {
          const draft = await createDraft({
            idea: row.idea,
            angle: row.angle,
            instagramPrompt: row.instagram_prompt || "",
            linkedinPrompt: row.linkedin_prompt || "",
            platforms: platformsOf(row),
            allowTemplateFallback: body.requireAi ? false : true,
          });
          const updated = updateRow(row.id, {
            caption: draft.caption,
            hashtags: draft.hashtags,
            instagram_caption: draft.instagram_caption || draft.caption,
            linkedin_caption: draft.linkedin_caption || draft.caption,
            status: "Needs Approval",
            notes: `Drafted via ${draft.source}${draft.model ? ` (${draft.model})` : ""}`,
          });
          results.push({ id: row.id, ok: true, row: updated });
        } catch (error) {
          updateRow(row.id, {
            status: "Draft",
            notes: `Generate failed: ${error.message}`,
          });
          results.push({ id: row.id, ok: false, error: error.message });
        }
      }
      return send(res, 200, {
        ok: true,
        count: results.length,
        drafted: results.filter((r) => r.ok).length,
        results,
      });
    }

    if (
      (req.method === "POST" && pathname === "/api/approve") ||
      (req.method === "POST" && pathname === "/approve")
    ) {
      const body = await readJson(req);
      const row = getRowById(body.id);
      if (!row) return send(res, 404, { ok: false, error: "Post not found" });
      const updated = updateRow(row.id, {
        status: "Approved",
        caption: body.caption || row.caption,
        hashtags: body.hashtags || row.hashtags,
        image_path: body.image_path || row.image_path,
        notes: "Approved in Pipeline UI",
      });
      return send(res, 200, { ok: true, row: updated });
    }

    if (req.method === "POST" && pathname === "/reject") {
      const body = await readJson(req);
      const updated = updateRow(body.id, {
        status: "Draft",
        notes: body.notes || "Sent back to ideas",
      });
      return send(res, 200, { ok: true, row: updated });
    }

    if (
      (req.method === "POST" && pathname === "/api/post") ||
      (req.method === "POST" && pathname === "/post")
    ) {
      const body = await readJson(req);
      const row = getRowById(body.id);
      if (!row) return send(res, 404, { ok: false, error: "Post not found" });

      // Allow light field updates, but never let the client self-approve via Post
      if (body.caption || body.hashtags || body.image_path) {
        updateRow(row.id, {
          caption: body.caption || row.caption,
          hashtags: body.hashtags || row.hashtags,
          image_path: body.image_path || row.image_path,
        });
      }

      try {
        const result = await publishApprovedRow(getRowById(row.id), {
          platforms: body.platforms,
        });
        return send(res, result.ok ? 200 : 500, result);
      } catch (error) {
        return send(res, error.statusCode || 500, {
          ok: false,
          error: error.message,
          row: error.row || getRowById(row.id),
          results: error.results,
          scan: error.scan,
        });
      }
    }

    if (req.method === "POST" && pathname === "/api/posts/mark-posted") {
      const body = await readJson(req);
      const row = getRowById(body.id);
      if (!row) return send(res, 404, { ok: false, error: "Post not found" });
      if (String(row.status || "").toLowerCase() === "posted") {
        return send(res, 200, { ok: true, row, already: true });
      }
      const updated = updateRow(row.id, {
        status: "Posted",
        posted_at: new Date().toISOString(),
        notes: body.notes || "Marked as posted (confirmed in Pipeline UI)",
      });
      return send(res, 200, { ok: true, row: updated });
    }

    if (req.method === "POST" && pathname === "/api/post-queue") {
      const body = await readJson(req);
      const delayMs = Math.min(
        Math.max(Number(body.delayMs) || 12000, 4000),
        60000,
      );
      const queue = listRows().filter(isApproved);
      if (!queue.length) {
        return send(res, 400, {
          ok: false,
          error: "No Approved posts in the queue.",
        });
      }

      const results = [];
      for (let i = 0; i < queue.length; i += 1) {
        const current = getRowById(queue[i].id);
        if (!current || !isApproved(current)) continue;
        try {
          const result = await publishApprovedRow(current);
          results.push({
            id: current.id,
            ok: result.ok,
            row: result.row,
            results: result.results,
          });
        } catch (error) {
          results.push({
            id: current.id,
            ok: false,
            error: error.message,
            row: error.row || getRowById(current.id),
          });
          // Stop the sequence on hard failure so the user can fix login / UI state
          break;
        }
        if (i < queue.length - 1) await sleep(delayMs);
      }

      const posted = results.filter((r) => r.ok).length;
      return send(res, 200, {
        ok: posted === results.length && results.length > 0,
        posted,
        attempted: results.length,
        remaining: listRows().filter(isApproved).length,
        results,
      });
    }

    if (req.method === "POST" && pathname === "/update") {
      const body = await readJson(req);
      if (!body.id) return send(res, 400, { ok: false, error: "id required" });
      const { id, ...patch } = body;
      return send(res, 200, { ok: true, row: updateRow(id, patch) });
    }

    if (req.method === "POST" && pathname === "/ideas") {
      const body = await readJson(req);
      return send(res, 201, { ok: true, row: addRow(body) });
    }

    return send(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error: error.message,
      details: error.payload || undefined,
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Sarabyx Pipeline UI → http://127.0.0.1:${PORT}`);
  console.log("n8n can still call /ready /approved /draft /post");
});
