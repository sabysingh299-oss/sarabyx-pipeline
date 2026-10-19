import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { ROOT, SHEET_PATH } from "./paths.mjs";

const HEADERS = [
  "id",
  "idea",
  "angle",
  "scheduled_date",
  "platforms",
  "image_path",
  "status",
  "caption",
  "hashtags",
  "feedback",
  "instagram_prompt",
  "linkedin_prompt",
  "instagram_caption",
  "linkedin_caption",
  "instagram_url",
  "linkedin_url",
  "posted_at",
  "notes",
];

function normalizeRow(row) {
  const out = {};
  for (const key of HEADERS) out[key] = row?.[key] ?? "";
  return out;
}

function ensureSheet() {
  if (fs.existsSync(SHEET_PATH)) return;
  const example = path.join(ROOT, "sheet", "content.example.csv");
  fs.mkdirSync(path.dirname(SHEET_PATH), { recursive: true });
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, SHEET_PATH);
  } else {
    const header = HEADERS.join(",");
    fs.writeFileSync(
      SHEET_PATH,
      `${header}\n1,Welcome post,Introduce your product in one plain sentence,,instagram|linkedin,,Draft,,,,,,,,,,,\n`,
      "utf8",
    );
  }
}

function readRaw() {
  ensureSheet();
  const text = fs.readFileSync(SHEET_PATH, "utf8");
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

function writeRows(rows) {
  const body = stringify(rows, { header: true, columns: HEADERS });
  fs.writeFileSync(SHEET_PATH, body, "utf8");
}

export function listRows() {
  return readRaw().map(normalizeRow);
}

export function getReadyRows() {
  return listRows().filter((row) => String(row.status || "").toLowerCase() === "ready");
}

export function getRowById(id) {
  return listRows().find((row) => String(row.id) === String(id)) || null;
}

export function updateRow(id, patch) {
  const rows = readRaw().map(normalizeRow);
  const index = rows.findIndex((row) => String(row.id) === String(id));
  if (index === -1) {
    throw new Error(`Row not found: ${id}`);
  }
  rows[index] = normalizeRow({ ...rows[index], ...patch });
  writeRows(rows);
  return rows[index];
}

export function addRow(fields) {
  const rows = readRaw().map(normalizeRow);
  const nextId =
    rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  const row = normalizeRow({
    id: String(nextId),
    idea: fields.idea || "",
    angle: fields.angle || "",
    scheduled_date: fields.scheduled_date || "",
    platforms: fields.platforms || "instagram|linkedin",
    image_path: fields.image_path || "",
    status: fields.status || "Draft",
    caption: fields.caption || "",
    hashtags: fields.hashtags || "",
    feedback: fields.feedback || "",
    instagram_prompt: fields.instagram_prompt || "",
    linkedin_prompt: fields.linkedin_prompt || "",
    instagram_caption: fields.instagram_caption || "",
    linkedin_caption: fields.linkedin_caption || "",
    notes: fields.notes || "",
  });
  rows.push(row);
  writeRows(rows);
  return row;
}

export function deleteRow(id) {
  const rows = readRaw().map(normalizeRow);
  const next = rows.filter((row) => String(row.id) !== String(id));
  if (next.length === rows.length) {
    throw new Error(`Row not found: ${id}`);
  }
  writeRows(next);
  return { ok: true, id: String(id) };
}
