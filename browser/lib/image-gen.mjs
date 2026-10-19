import fs from "node:fs";
import path from "node:path";
import { aiConfig, readSettings } from "./settings.mjs";
import { MEDIA_DIR } from "./paths.mjs";

/** True when feedback asks for a new / generated image. */
export function wantsImageFromFeedback(feedback) {
  const t = String(feedback || "").trim();
  if (!t) return false;
  return (
    /\b(generate|create|make|draw|design|render|produce|need|want|add|new)\b[\s\S]{0,60}\b(image|img|picture|photo|visual|graphic|illustration|cover|thumbnail|artwork)\b/i.test(
      t,
    ) ||
    /\b(image|picture|photo|visual|graphic|illustration)\b[\s\S]{0,40}\b(generate|create|make|please|for me)\b/i.test(
      t,
    ) ||
    /^(generate|create|make)\s+(an?\s+)?(image|picture|photo)\b/i.test(t)
  );
}

/** Keep caption when the comment is mainly about imagery. */
export function wantsTextFromFeedback(feedback) {
  const t = String(feedback || "").trim();
  if (!t) return false;
  if (!wantsImageFromFeedback(t)) return true;
  return /\b(shorter|longer|rewrite|rephrase|caption|hashtag|tone|voice|less|more|salesy|question|cta|hook|punchier|softer|formal|casual|edit\s+text|change\s+copy|change\s+caption)\b/i.test(
    t,
  );
}

async function buildImagePrompt({ idea, angle, feedback, caption }) {
  const { baseUrl, apiKey, model, brandVoice, configured } = aiConfig();
  if (!configured) {
    throw new Error("AI is not configured. Add Base URL + API key in Settings.");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "You write concise image-generation prompts for social posts. Reply with the prompt only — no quotes, no JSON, no markdown.",
        },
        {
          role: "user",
          content: `Create one image prompt (max 60 words) for a social post.

Idea: ${idea}
Angle: ${angle || idea}
Caption (context): ${caption || "(none)"}
User request: ${feedback}
Visual style: clean, modern, high contrast, no tiny unreadable text, brand voice: ${brandVoice}

If the user described the image, follow that. Otherwise invent a strong matching visual.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Image prompt failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const prompt = String(payload.choices?.[0]?.message?.content || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!prompt) throw new Error("Model returned an empty image prompt.");
  return prompt.slice(0, 1200);
}

async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download generated image (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/**
 * Generate an image via OpenAI-compatible /images/generations and save under media/.
 * Returns { filename, prompt, model }.
 */
export async function generatePostImage({
  idea,
  angle,
  feedback,
  caption = "",
  rowId = "post",
}) {
  const { baseUrl, apiKey, configured } = aiConfig();
  if (!configured) {
    throw new Error("AI is not configured. Add Base URL + API key in Settings.");
  }

  const settings = readSettings();
  const imageModel =
    settings.aiImageModel || process.env.AI_IMAGE_MODEL || "dall-e-3";

  const prompt = await buildImagePrompt({ idea, angle, feedback, caption });

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: imageModel,
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    // Retry with URL format (some proxies reject b64_json)
    if (/response_format|b64|unknown_parameter/i.test(raw)) {
      return generatePostImageUrlFallback({
        baseUrl,
        apiKey,
        imageModel,
        prompt,
        rowId,
      });
    }
    throw new Error(
      `Image generation failed (${response.status}). Your provider may not support /images/generations with model “${imageModel}”. Set Image model in Settings (e.g. dall-e-3) or upload an image manually. ${raw.slice(0, 220)}`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Image API returned non-JSON.");
  }

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const filename = `${rowId}-${Date.now()}-ai.png`;
  const dest = path.join(MEDIA_DIR, filename);

  const b64 = payload.data?.[0]?.b64_json;
  const url = payload.data?.[0]?.url;
  if (b64) {
    fs.writeFileSync(dest, Buffer.from(b64, "base64"));
  } else if (url) {
    await downloadToFile(url, dest);
  } else {
    throw new Error("Image API returned no image data.");
  }

  return { filename, prompt, model: imageModel, source: "ai-image" };
}

async function generatePostImageUrlFallback({
  baseUrl,
  apiKey,
  imageModel,
  prompt,
  rowId,
}) {
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: imageModel,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Image generation failed (${response.status}). Model “${imageModel}” may be unavailable on this endpoint. ${raw.slice(0, 220)}`,
    );
  }
  const payload = JSON.parse(raw);
  const url = payload.data?.[0]?.url;
  const b64 = payload.data?.[0]?.b64_json;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const filename = `${rowId}-${Date.now()}-ai.png`;
  const dest = path.join(MEDIA_DIR, filename);
  if (b64) fs.writeFileSync(dest, Buffer.from(b64, "base64"));
  else if (url) await downloadToFile(url, dest);
  else throw new Error("Image API returned no image data.");
  return { filename, prompt, model: imageModel, source: "ai-image" };
}
