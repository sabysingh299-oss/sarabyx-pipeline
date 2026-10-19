#!/usr/bin/env node
/** CLI helper — posts in the customer's Google Chrome (no Playwright). */
import fs from "node:fs";
import { combineCaption } from "./lib/draft.mjs";
import { postInstagramInChrome } from "./lib/chrome-post.mjs";
import { resolveMedia } from "./lib/paths.mjs";
import { getRowById } from "./lib/sheet.mjs";

const rowId = process.argv.includes("--row")
  ? process.argv[process.argv.indexOf("--row") + 1]
  : null;
const row = rowId ? getRowById(rowId) : null;
const text = combineCaption(
  process.argv.includes("--caption")
    ? process.argv[process.argv.indexOf("--caption") + 1]
    : row?.caption,
  process.argv.includes("--hashtags")
    ? process.argv[process.argv.indexOf("--hashtags") + 1]
    : row?.hashtags,
);
const imagePath = resolveMedia(
  process.argv.includes("--image")
    ? process.argv[process.argv.indexOf("--image") + 1]
    : row?.image_path,
);
if (!text) throw new Error("Caption required");
if (!imagePath || !fs.existsSync(imagePath)) throw new Error("Image required");
console.log(JSON.stringify(await postInstagramInChrome({ text, imagePath }), null, 2));
