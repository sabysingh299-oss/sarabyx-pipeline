#!/usr/bin/env node
/**
 * Quick CLI to add a row to the content sheet.
 *
 *   node scripts/add-idea.mjs "AEO tips" "Customers ask AI first" 2026-10-21
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sheetUrl = pathToFileURL(path.join(root, "browser/lib/sheet.mjs")).href;
const { addRow } = await import(sheetUrl);

const [idea, angle, scheduled_date, image_path] = process.argv.slice(2);
if (!idea) {
  console.error(
    'Usage: node scripts/add-idea.mjs "Idea" "Angle" [YYYY-MM-DD] [image.png]',
  );
  process.exit(1);
}

const row = addRow({
  idea,
  angle: angle || "",
  scheduled_date: scheduled_date || "",
  image_path: image_path || "",
  platforms: "instagram|linkedin",
  status: "Ready",
});

console.log(JSON.stringify({ ok: true, row }, null, 2));
console.log("\nTip: put images in browser/media/ and set image_path to the filename.");
