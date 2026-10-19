#!/usr/bin/env node
import { openInChrome } from "./lib/chrome.mjs";
await openInChrome("https://www.instagram.com/");
console.log("Opened Instagram in Google Chrome. Sign in there, then use Detect from Chrome in the Pipeline UI.");
