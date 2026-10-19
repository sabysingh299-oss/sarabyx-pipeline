import { aiConfig } from "./settings.mjs";

function templateDraft({ idea, angle }) {
  const voiceAngle = angle?.trim() || idea;
  const { defaultHashtags } = aiConfig();
  const caption = [
    voiceAngle.endsWith(".") ? voiceAngle : `${voiceAngle}.`,
    "",
    `Here's a practical take on ${idea}:`,
    "1. Start with the real question your customer is asking.",
    "2. Answer it in plain language.",
    "3. Show one concrete next step.",
    "4. Invite a reply — what are you stuck on?",
  ].join("\n");

  return {
    caption,
    hashtags: defaultHashtags || "#buildinpublic #automation",
    instagram_caption: caption,
    linkedin_caption: caption,
    source: "template",
  };
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model did not return JSON");
  }
}

async function aiDraft({
  idea,
  angle,
  feedback,
  previousCaption,
  instagramPrompt = "",
  linkedinPrompt = "",
  platforms = ["instagram", "linkedin"],
}) {
  const {
    baseUrl,
    apiKey,
    model,
    brandVoice,
    defaultHashtags,
    promptInstagram,
    promptLinkedin,
    configured,
  } = aiConfig();

  if (!configured) return null;

  const igPrompt = String(instagramPrompt || promptInstagram || "").trim();
  const liPrompt = String(linkedinPrompt || promptLinkedin || "").trim();
  const wantsIg = platforms.includes("instagram");
  const wantsLi = platforms.includes("linkedin");

  const feedbackBlock = feedback
    ? `\n\nThe previous draft was rejected. Improve it using this feedback:\n${feedback}\n\nPrevious draft:\n${previousCaption || "(none)"}`
    : "";

  const prompt = `Write social post copy for the selected platforms.

Idea: ${idea}
Angle: ${angle || idea}
Platforms: ${platforms.join(", ")}
${feedbackBlock}

Brand voice: ${brandVoice}

Instagram customization prompt: ${igPrompt || "(none)"}
LinkedIn customization prompt: ${liPrompt || "(none)"}

Return JSON only with keys:
- caption: shared base caption (80-180 words), ready to post, no title line
- hashtags: 3-8 space-separated hashtags (Instagram-friendly; LinkedIn may use fewer)
- instagram_caption: ${wantsIg ? "final Instagram text applying the Instagram prompt (include hashtags if useful)" : '""'}
- linkedin_caption: ${wantsLi ? "final LinkedIn text applying the LinkedIn prompt (little or no hashtag spam)" : '""'}
`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You write short social posts for founders. Apply each platform's customization prompt. Reply with valid JSON only. No markdown fences.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI draft failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "{}";
  const parsed = extractJson(content);
  const caption = String(parsed.caption || "").trim();
  const hashtags = String(parsed.hashtags || defaultHashtags).trim();

  return {
    caption,
    hashtags,
    instagram_caption: String(parsed.instagram_caption || caption).trim(),
    linkedin_caption: String(parsed.linkedin_caption || caption).trim(),
    source: "ai",
    model,
  };
}

export async function createDraft({
  idea,
  angle,
  feedback = "",
  previousCaption = "",
  instagramPrompt = "",
  linkedinPrompt = "",
  platforms = ["instagram", "linkedin"],
  allowTemplateFallback = true,
}) {
  try {
    const ai = await aiDraft({
      idea,
      angle,
      feedback,
      previousCaption,
      instagramPrompt,
      linkedinPrompt,
      platforms,
    });
    if (ai?.caption) return ai;
  } catch (error) {
    if (!allowTemplateFallback) throw error;
    console.warn(`[draft] AI unavailable, using template: ${error.message}`);
  }
  if (!allowTemplateFallback) {
    throw new Error("AI is not configured. Add a model URL + API key in Settings.");
  }
  return templateDraft({ idea, angle });
}

export function combineCaption(caption, hashtags) {
  const body = String(caption || "").trim();
  const tags = String(hashtags || "").trim();
  if (!tags) return body;
  if (body.includes(tags)) return body;
  return `${body}\n\n${tags}`;
}

/**
 * Adapt base caption for a platform using the LLM + customization prompt.
 * Falls back to base text if AI is unavailable or prompt is empty.
 */
export async function adaptCaptionForPlatform({
  platform,
  caption,
  hashtags = "",
  prompt = "",
  idea = "",
  angle = "",
}) {
  const base = combineCaption(caption, hashtags);
  const {
    baseUrl,
    apiKey,
    model,
    brandVoice,
    promptInstagram,
    promptLinkedin,
    configured,
  } = aiConfig();

  const platformPrompt =
    String(prompt || "").trim() ||
    (platform === "instagram" ? promptInstagram : promptLinkedin) ||
    "";

  if (!platformPrompt || !configured || !base) {
    return { text: base, source: "base", adapted: false };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You adapt social posts for one platform. Reply with JSON only: {\"text\":\"...\"}. No markdown.",
        },
        {
          role: "user",
          content: `Adapt this post for ${platform}.

Idea: ${idea}
Angle: ${angle || idea}
Brand voice: ${brandVoice}
Customization prompt: ${platformPrompt}

Original post:
${base}

Return JSON: {"text":"final ready-to-post text for ${platform}"}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return { text: base, source: "base", adapted: false };
  }

  try {
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content || "{}";
    const parsed = extractJson(content);
    const text = String(parsed.text || "").trim();
    if (!text) return { text: base, source: "base", adapted: false };
    return { text, source: "ai", adapted: true, model };
  } catch {
    return { text: base, source: "base", adapted: false };
  }
}

export async function testAiConnection() {
  const { baseUrl, apiKey, model, configured } = aiConfig();
  if (!configured) {
    return { ok: false, error: "Set Base URL and API key first." };
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 40,
      messages: [
        {
          role: "user",
          content: `Reply with JSON only: {"ok":true,"model":"${model}"}`,
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, error: text.slice(0, 500) };
  }
  return { ok: true, model, baseUrl, sample: text.slice(0, 300) };
}
