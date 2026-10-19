import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Drive the customer's existing Google Chrome — no Playwright / Chromium install.
 */

export function runOsascript(source) {
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

export async function openInChrome(url) {
  return new Promise((resolve, reject) => {
    const child = spawn("open", ["-a", "Google Chrome", url], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, url, browser: "Google Chrome" });
      else reject(new Error(`Could not open Chrome (exit ${code})`));
    });
  });
}

/** One-time preference so Pipeline can run page scripts inside Chrome tabs. */
export async function ensureChromeJsAppleEvents() {
  if (process.platform !== "darwin") return { ok: false };
  try {
    await execFileAsync("defaults", [
      "write",
      "com.google.Chrome",
      "AllowJavascriptAppleEvents",
      "-bool",
      "true",
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function activateChrome() {
  const { code, err } = await runOsascript(`
tell application "Google Chrome" to activate
delay 0.2
`);
  if (code !== 0) throw new Error(err || "Could not activate Google Chrome");
}

/**
 * Focus an existing tab whose URL contains `needle`, or open a new tab.
 */
export async function focusChromeTab(needle, fallbackUrl) {
  const script = `
tell application "System Events"
  if not (exists process "Google Chrome") then error "Google Chrome is not running. Open Chrome first."
end tell
tell application "Google Chrome"
  activate
  set found to false
  repeat with w in windows
    set i to 0
    repeat with t in tabs of w
      set i to i + 1
      if URL of t contains "${needle.replace(/"/g, "")}" then
        set active tab index of w to i
        set index of w to 1
        set found to true
        exit repeat
      end if
    end repeat
    if found then exit repeat
  end repeat
  if not found then
    if (count of windows) is 0 then make new window
    tell window 1
      make new tab with properties {URL:"${fallbackUrl}"}
    end tell
  end if
end tell
return "ok"
`;
  const { code, out, err } = await runOsascript(script);
  if (code !== 0) {
    throw new Error(
      err ||
        "Could not control Chrome. Grant Automation access in System Settings → Privacy & Security → Automation.",
    );
  }
  return out;
}

/**
 * Run JavaScript in the active Chrome tab. Payload is base64 to avoid quoting issues.
 */
export async function runInActiveTab(jsSource) {
  const b64 = Buffer.from(jsSource, "utf8").toString("base64");
  const script = `
tell application "Google Chrome"
  activate
  tell active tab of front window
    set r to execute javascript "(() => { try { return String(eval(atob('${b64}'))); } catch (e) { return 'ERR:' + (e && e.message ? e.message : e); } })()"
  end tell
  return r
end tell
`;
  const { code, out, err } = await runOsascript(script);
  if (code !== 0) {
    const msg = err || out || "Chrome JavaScript failed";
    if (/javascript/i.test(msg) || /not allowed/i.test(msg) || /error/i.test(msg)) {
      throw new Error(
        "Chrome blocked page control. In Chrome menu: View → Developer → Allow JavaScript from Apple Events (turn ON), then try again. Keep Chrome open.",
      );
    }
    throw new Error(msg);
  }
  if (out.startsWith("ERR:")) {
    throw new Error(out.slice(4));
  }
  return out;
}

/** Choose a file in the macOS file dialog (Cmd+Shift+G). */
export async function chooseFileInDialog(absolutePath) {
  const escaped = absolutePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
tell application "Google Chrome" to activate
delay 0.6
tell application "System Events"
  keystroke "g" using {command down, shift down}
  delay 0.45
  keystroke "${escaped}"
  delay 0.25
  keystroke return
  delay 0.35
  keystroke return
end tell
return "ok"
`;
  const { code, err } = await runOsascript(script);
  if (code !== 0) {
    throw new Error(
      err ||
        "Could not pick the image file. Grant Accessibility access for the app running Pipeline.",
    );
  }
}

export async function scanChromeSessions() {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      supported: false,
      message: "Chrome automation is supported on macOS. Use Open in this browser + I’ve signed in.",
      instagram: { open: false, connected: false },
      linkedin: { open: false, connected: false },
    };
  }

  const script = `
tell application "System Events"
  if not (exists process "Google Chrome") then return "CHROME_NOT_RUNNING"
end tell
tell application "Google Chrome"
  set out to ""
  repeat with w in windows
    repeat with t in tabs of w
      set u to URL of t as string
      set out to out & u & linefeed
    end repeat
  end repeat
  return out
end tell
`;

  const { code, out, err } = await runOsascript(script);
  if (out === "CHROME_NOT_RUNNING") {
    return {
      ok: true,
      supported: true,
      chromeRunning: false,
      message: "Google Chrome is not running.",
      instagram: { open: false, connected: false },
      linkedin: { open: false, connected: false },
    };
  }
  if (code !== 0) {
    return {
      ok: false,
      supported: true,
      message:
        err ||
        "Could not read Chrome tabs. Grant Automation access in System Settings → Privacy → Automation.",
      instagram: { open: false, connected: false },
      linkedin: { open: false, connected: false },
    };
  }

  const urls = out
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean);

  const igUrls = urls.filter((u) => /instagram\.com/i.test(u));
  const liUrls = urls.filter((u) => /linkedin\.com/i.test(u));
  const igLogin = igUrls.some((u) => /accounts\/login|\/login/i.test(u));
  const liLogin = liUrls.some((u) => /\/login|\/uas\/login|checkpoint/i.test(u));

  return {
    ok: true,
    supported: true,
    chromeRunning: true,
    tabsScanned: urls.length,
    instagram: {
      open: igUrls.length > 0,
      connected: igUrls.length > 0 && !igLogin,
      urls: igUrls.slice(0, 5),
    },
    linkedin: {
      open: liUrls.length > 0,
      connected: liUrls.length > 0 && !liLogin,
      urls: liUrls.slice(0, 5),
    },
  };
}
