import fs from "node:fs";
import path from "node:path";
import { readSettings } from "./settings.mjs";
import { sleep } from "./chrome.mjs";
import { connectToTab, ensureCdp, setFileOnPage } from "./cdp.mjs";

function assertMac() {
  if (process.platform !== "darwin") {
    throw new Error("Chrome posting is supported on macOS with Google Chrome.");
  }
}

async function clickCss(session, selectors, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const hit = await session.evaluate(`
(() => {
  const selectors = ${JSON.stringify(selectors)};
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const target = el.closest('button,[role="button"],a') || el;
    target.click();
    return sel;
  }
  return null;
})()
`);
    if (hit) return hit;
    await sleep(300);
  }
  throw new Error(
    "Could not find a control in Chrome. Stay signed in and keep the tab visible, then try again.",
  );
}

async function clickText(session, patterns, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const hit = await session.evaluate(`
(() => {
  const patterns = ${JSON.stringify(patterns)};
  const nodes = [...document.querySelectorAll('button, div[role="button"], a, span')];
  for (const pat of patterns) {
    const re = new RegExp(pat, 'i');
    const el = nodes.find((n) => re.test((n.textContent || '').trim()));
    if (!el) continue;
    const target = el.closest('button,[role="button"],a') || el;
    target.click();
    return pat;
  }
  return null;
})()
`);
    if (hit) return hit;
    await sleep(300);
  }
  throw new Error(`Could not find “${patterns.join(" / ")}” in Chrome.`);
}

async function typeText(session, selectors, text, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const ok = await session.evaluate(`
(() => {
  const selectors = ${JSON.stringify(selectors)};
  const text = ${JSON.stringify(text)};
  let el = null;
  for (const sel of selectors) {
    const found = document.querySelector(sel);
    if (found) { el = found; break; }
  }
  if (!el) return false;
  el.focus();
  el.click();
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  } else {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
})()
`);
    if (ok) return;
    await sleep(300);
  }
  throw new Error("Could not find the caption / text box in Chrome.");
}

async function assertInstagramLoggedIn(session) {
  const loggedIn = await session.evaluate(`
(() => {
  if (document.querySelector('input[name="username"], input[name="email"]')) return false;
  const t = document.body?.innerText || '';
  if (/log in to instagram/i.test(t)) return false;
  return Boolean(
    document.querySelector('svg[aria-label="New post"], svg[aria-label="New Post"], a[href*="/create"]')
    || document.querySelector('svg[aria-label="Home"]')
  );
})()
`);
  if (!loggedIn) {
    throw new Error(
      "Instagram is not signed in in Pipeline Chrome. Click Open Instagram, log in there, then Detect sessions and Post again.",
    );
  }
}

async function assertLinkedInLoggedIn(session) {
  const loggedIn = await session.evaluate(`
(() => {
  if (document.querySelector('input[name="session_key"], #username')) return false;
  const t = document.body?.innerText || '';
  if (/sign in to linkedin|^sign in$/i.test(t) && /join now/i.test(t)) return false;
  return Boolean(
    document.querySelector('input[aria-label*="Search"]')
    || document.querySelector('.global-nav')
    || [...document.querySelectorAll('button,div[role="button"]')]
      .some((n) => /start a post/i.test(n.textContent || ''))
  );
})()
`);
  if (!loggedIn) {
    throw new Error(
      "LinkedIn is not signed in in Pipeline Chrome. Click Open LinkedIn, log in there, then Detect sessions and Post again.",
    );
  }
}

async function openLinkedInComposer(session) {
  // Prefer dedicated share-box trigger, then text match
  try {
    await clickCss(
      session,
      [
        'button.share-box-feed-entry__trigger',
        '.share-box-feed-entry__trigger',
        'button.artdeco-button.artdeco-button--muted[aria-label*="Start a post"]',
        'button[aria-label="Start a post"]',
        '.share-box-feed-entry button',
      ],
      12,
    );
  } catch {
    await clickText(session, ["start a post", "start a post…", "start a post..."], 25);
  }
  await sleep(1400);

  // Wait until a compose editor exists
  for (let i = 0; i < 40; i += 1) {
    const ready = await session.evaluate(`
(() => {
  const sels = [
    'div.ql-editor[contenteditable="true"]',
    '.share-creation-state div[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '.editor-content div[contenteditable="true"]',
    'div[data-placeholder][contenteditable="true"]',
  ];
  return sels.some((s) => !!document.querySelector(s));
})()
`);
    if (ready) return;
    await sleep(250);
  }
  throw new Error(
    "LinkedIn compose box did not open. Keep the LinkedIn feed tab visible in Pipeline Chrome and try again.",
  );
}

async function typeLinkedInCaption(session, text) {
  const selectors = [
    'div.ql-editor[contenteditable="true"]',
    '.share-creation-state div[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '.editor-content div[contenteditable="true"]',
    'div[data-placeholder][contenteditable="true"]',
  ];

  for (let i = 0; i < 40; i += 1) {
    const ok = await session.evaluate(`
(() => {
  const selectors = ${JSON.stringify(selectors)};
  const text = ${JSON.stringify(text)};
  let el = null;
  for (const sel of selectors) {
    const found = document.querySelector(sel);
    if (found && found.offsetParent !== null) { el = found; break; }
  }
  if (!el) {
    for (const sel of selectors) {
      const found = document.querySelector(sel);
      if (found) { el = found; break; }
    }
  }
  if (!el) return false;
  el.focus();
  el.click();
  // Clear existing content
  if (document.execCommand) {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  }
  el.innerHTML = '';
  // Insert as paragraphs (LinkedIn Quill-friendly)
  const lines = text.split(/\\n/);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line || '';
    if (!line) p.appendChild(document.createElement('br'));
    el.appendChild(p);
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return (el.innerText || el.textContent || '').trim().length > 0;
})()
`);
    if (ok) return;
    await sleep(300);
  }
  throw new Error("Could not find the LinkedIn post text box in Chrome.");
}

async function clickLinkedInPostButton(session) {
  const hit = await session.evaluate(`
(() => {
  // Prefer the primary Post button inside the share modal
  const modal = document.querySelector('.share-box, .share-creation-state, [role="dialog"], .artdeco-modal');
  const scope = modal || document;
  const buttons = [...scope.querySelectorAll('button')];
  const post = buttons.find((b) => {
    const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).trim();
    if (!/^post$/i.test((b.textContent || '').trim()) && !/^post$/i.test((b.getAttribute('aria-label') || '').trim())) {
      return false;
    }
    return !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  });
  if (!post) return null;
  post.click();
  return true;
})()
`);
  if (!hit) {
    await clickText(session, ["^Post$"], 20);
  }
}

export async function postInstagramInChrome({ text, imagePath, dryRun = false }) {
  assertMac();
  await ensureCdp({ openUi: false });
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error("Instagram needs an image. Add one in the Pipeline editor.");
  }
  const abs = path.resolve(imagePath);
  const session = await connectToTab("instagram.com");
  try {
    await sleep(1500);
    await assertInstagramLoggedIn(session);
    await clickCss(session, [
      'svg[aria-label="New post"]',
      'svg[aria-label="New Post"]',
      'a[href*="/create"]',
    ]);
    await sleep(900);
    try {
      await clickText(session, ["^Post$"], 8);
    } catch {
      // already in create flow
    }
    await sleep(700);

    try {
      await setFileOnPage(session, abs);
    } catch {
      await clickText(session, ["select from computer"], 15);
      await sleep(400);
      await setFileOnPage(session, abs);
    }
    await sleep(2200);

    for (let i = 0; i < 3; i += 1) {
      try {
        await clickText(session, ["^Next$", "^OK$"], 6);
        await sleep(800);
      } catch {
        break;
      }
    }

    await typeText(
      session,
      [
        'div[aria-label="Write a caption..."]',
        'div[aria-label="Write a caption…"]',
        'textarea[aria-label="Write a caption..."]',
        '[contenteditable="true"][role="textbox"]',
        'div[role="textbox"]',
      ],
      text,
    );
    await sleep(500);
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        platform: "instagram",
        browser: "Pipeline Chrome",
        note: "Dry run — caption filled, Share/Post not clicked",
      };
    }
    await clickText(session, ["^Share$", "^Post$"], 20);
    await sleep(4000);
    return {
      ok: true,
      platform: "instagram",
      browser: "Pipeline Chrome",
      url: "https://www.instagram.com/",
      note: "Posted in Pipeline Chrome",
    };
  } finally {
    session.close();
  }
}

/**
 * @param {{ text: string, imagePath?: string, dryRun?: boolean }} opts
 * dryRun=true fills the LinkedIn composer but does NOT click Post.
 */
export async function postLinkedInInChrome({ text, imagePath, dryRun = false }) {
  assertMac();
  await ensureCdp({ openUi: false });
  const settings = readSettings();
  const companyName = settings.linkedinCompanyName || "";
  const target = settings.linkedinTarget || "profile";
  const session = await connectToTab("linkedin.com", {
    preferUrl: "https://www.linkedin.com/feed/",
  });
  try {
    await sleep(2000);
    await assertLinkedInLoggedIn(session);

    // Always land on feed for the share box
    const href = await session.evaluate("location.href");
    if (!/linkedin\.com\/(feed|home)/i.test(String(href || ""))) {
      await session.send("Page.navigate", { url: "https://www.linkedin.com/feed/" });
      await sleep(2800);
    }

    await openLinkedInComposer(session);

    if (target === "company" && companyName) {
      await session.evaluate(`
(() => {
  const actor = document.querySelector('button.share-creation-state__actor-btn, button[aria-label*="Post as"]');
  if (actor) actor.click();
  return true;
})()
`);
      await sleep(600);
      await session.evaluate(`
(() => {
  const name = ${JSON.stringify(companyName)};
  const opt = [...document.querySelectorAll('div[role="button"], li, span')]
    .find((n) => (n.textContent || '').includes(name));
  if (opt) opt.click();
  return true;
})()
`);
      await sleep(600);
    }

    await typeLinkedInCaption(session, text);

    if (imagePath && fs.existsSync(imagePath)) {
      const abs = path.resolve(imagePath);
      try {
        await setFileOnPage(session, abs);
      } catch {
        try {
          await clickText(session, ["add a photo", "add media", "^Media$"], 10);
          await sleep(400);
          await setFileOnPage(session, abs);
        } catch {
          // text-only LinkedIn is fine
        }
      }
      await sleep(2000);
    }

    if (dryRun) {
      const preview = await session.evaluate(`
(() => {
  const el = document.querySelector('div.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
  return (el?.innerText || el?.textContent || '').trim().slice(0, 200);
})()
`);
      return {
        ok: true,
        dryRun: true,
        platform: "linkedin",
        browser: "Pipeline Chrome",
        url: "https://www.linkedin.com/feed/",
        note: "Dry run — compose ready, Post button NOT clicked",
        preview,
      };
    }

    await clickLinkedInPostButton(session);
    await sleep(3500);
    return {
      ok: true,
      platform: "linkedin",
      browser: "Pipeline Chrome",
      url: "https://www.linkedin.com/feed/",
      note: "Posted in Pipeline Chrome",
    };
  } finally {
    session.close();
  }
}
