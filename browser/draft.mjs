#!/usr/bin/env node
import { createDraft, combineCaption } from "./lib/draft.mjs";
import { getRowById, updateRow } from "./lib/sheet.mjs";

const id = process.argv[2];
if (!id) {
  console.error("Usage: node draft.mjs <row-id>");
  process.exit(1);
}

const row = getRowById(id);
if (!row) {
  console.error(`Row not found: ${id}`);
  process.exit(1);
}

const draft = await createDraft({ idea: row.idea, angle: row.angle });
const updated = updateRow(id, {
  caption: draft.caption,
  hashtags: draft.hashtags,
  status: "Needs Approval",
  notes: `Drafted via ${draft.source}`,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      row: updated,
      preview: combineCaption(updated.caption, updated.hashtags),
    },
    null,
    2,
  ),
);
