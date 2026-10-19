#!/usr/bin/env node
import { enableChromeControl, isCdpUp } from "../browser/lib/cdp.mjs";

if (await isCdpUp()) {
  console.log("Chrome control already ON");
  process.exit(0);
}

console.log("Starting Google Chrome with control…");
const result = await enableChromeControl();
console.log(result.message || "OK");
