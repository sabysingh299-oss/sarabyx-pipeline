#!/usr/bin/env node
import { openInChrome } from "./lib/chrome.mjs";
await openInChrome("https://www.linkedin.com/feed/");
console.log("Opened LinkedIn in Google Chrome. Sign in there, then use Detect from Chrome in the Pipeline UI.");
