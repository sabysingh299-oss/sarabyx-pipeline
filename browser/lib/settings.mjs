import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.mjs";

const SETTINGS_PATH = path.join(ROOT, "data", "settings.json");

export const AI_PRESETS = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  together: {
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    model: "",
  },
};

const DEFAULTS = {
  aiPreset: "openai",
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  /** OpenAI-compatible image model for “generate image” comments */
  aiImageModel: "dall-e-3",
  brandVoice:
    "Clear, practical, founder tone. Short sentences. No hype. No emojis.",
  defaultHashtags: "#buildinpublic #automation",
  /** Extra LLM instructions applied when drafting/posting to each platform */
  promptInstagram:
    "Instagram: slightly shorter, punchy opening, keep hashtags, conversational.",
  promptLinkedin:
    "LinkedIn: professional but human, no hashtag spam, stronger insight opening.",
  linkedinTarget: "profile",
  linkedinCompanyName: "",
};

function ensureDir() {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
}

export function readSettings() {
  ensureDir();
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { ...DEFAULTS };
  }
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(patch) {
  const next = { ...readSettings(), ...patch, updatedAt: new Date().toISOString() };
  ensureDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return publicSettings(next);
}

export function publicSettings(settings = readSettings()) {
  const key = settings.aiApiKey || "";
  return {
    ...settings,
    aiApiKey: key,
    aiApiKeySet: Boolean(key),
    aiApiKeyMasked: key ? `${key.slice(0, 3)}•••${key.slice(-4)}` : "",
    presets: AI_PRESETS,
  };
}

export function applyPreset(presetKey) {
  const preset = AI_PRESETS[presetKey] || AI_PRESETS.custom;
  return writeSettings({
    aiPreset: presetKey,
    aiBaseUrl: preset.baseUrl || readSettings().aiBaseUrl,
    aiModel: preset.model || readSettings().aiModel,
  });
}

/** Effective AI config for drafting (settings file wins over process env). */
export function aiConfig() {
  const s = readSettings();
  const baseUrl = (s.aiBaseUrl || process.env.AI_BASE_URL || "").replace(/\/$/, "");
  const apiKey = s.aiApiKey || process.env.AI_API_KEY || "";
  const model = s.aiModel || process.env.AI_MODEL || "gpt-4o-mini";
  return {
    baseUrl,
    apiKey,
    model,
    brandVoice: s.brandVoice || DEFAULTS.brandVoice,
    defaultHashtags: s.defaultHashtags || DEFAULTS.defaultHashtags,
    promptInstagram: s.promptInstagram || DEFAULTS.promptInstagram,
    promptLinkedin: s.promptLinkedin || DEFAULTS.promptLinkedin,
    configured: Boolean(baseUrl && apiKey),
  };
}
