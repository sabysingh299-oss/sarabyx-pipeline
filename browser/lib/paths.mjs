import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");
export const BROWSER_DIR = path.resolve(__dirname, "..");
export const SHEET_PATH = path.join(ROOT, "sheet", "content.csv");
export const MEDIA_DIR = path.join(BROWSER_DIR, "media");
export const INSTAGRAM_PROFILE = path.join(BROWSER_DIR, "profiles", "instagram");
export const LINKEDIN_PROFILE = path.join(BROWSER_DIR, "profiles", "linkedin");

export function resolveMedia(imagePath) {
  if (!imagePath) return null;
  if (path.isAbsolute(imagePath)) return imagePath;
  return path.join(MEDIA_DIR, imagePath);
}
