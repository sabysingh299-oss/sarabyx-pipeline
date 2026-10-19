const LOGIN_URLS = {
  instagram: "https://www.instagram.com/",
  linkedin: "https://www.linkedin.com/feed/",
};

const state = {
  rows: [],
  stage: "all",
  selectedId: null,
  busy: false,
  settings: null,
};

const stageCopy = {
  all: {
    title: "All posts",
    sub: "Write once. Approve. Post to Instagram and LinkedIn.",
  },
  ideas: {
    title: "Ideas",
    sub: "Raw ideas waiting for a draft.",
  },
  review: {
    title: "Needs you",
    sub: "Drafts waiting for your approval — or comments to regenerate.",
  },
  queue: {
    title: "Ready to post",
    sub: "Approved only. Post one, mark as posted, or post all approved in sequence.",
  },
  done: {
    title: "Posted",
    sub: "Confirmed live — removed from the active work list.",
  },
};

const els = {
  list: document.getElementById("post-list"),
  listTitle: document.getElementById("list-title"),
  listSub: document.getElementById("list-sub"),
  empty: document.getElementById("empty-editor"),
  editor: document.getElementById("editor"),
  editorTitle: document.getElementById("editor-title"),
  editorStatus: document.getElementById("editor-status"),
  idea: document.getElementById("field-idea"),
  angle: document.getElementById("field-angle"),
  date: document.getElementById("field-date"),
  caption: document.getElementById("field-caption"),
  hashtags: document.getElementById("field-hashtags"),
  feedback: document.getElementById("field-feedback"),
  promptIg: document.getElementById("field-prompt-ig"),
  promptLi: document.getElementById("field-prompt-li"),
  ig: document.getElementById("plat-instagram"),
  li: document.getElementById("plat-linkedin"),
  note: document.getElementById("editor-note"),
  error: document.getElementById("editor-error"),
  drop: document.getElementById("dropzone"),
  dropCopy: document.getElementById("drop-copy"),
  preview: document.getElementById("image-preview"),
  file: document.getElementById("field-image"),
  toast: document.getElementById("toast"),
  setup: document.getElementById("setup-panel"),
  settingsPanel: document.getElementById("settings-panel"),
  modal: document.getElementById("new-modal"),
  newForm: document.getElementById("new-form"),
  ideasModal: document.getElementById("ideas-modal"),
  ideasForm: document.getElementById("ideas-form"),
  settingsForm: document.getElementById("settings-form"),
  settingsHint: document.getElementById("settings-hint"),
};

function toast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function setBusy(busy) {
  state.busy = busy;
  document
    .querySelectorAll(
      ".editor-actions .btn, .modal-actions .btn, .list-tools .btn, [data-login], [data-confirm], #btn-scan, #btn-chrome-enable, #btn-generate-all, #btn-regenerate, #btn-post-queue, #btn-mark-posted",
    )
    .forEach((btn) => {
      if (btn.id === "btn-new-cancel" || btn.id === "btn-ideas-cancel") return;
      btn.disabled = busy;
    });
  if (!busy) syncActionButtons();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function stageOf(row) {
  const s = String(row.status || "").toLowerCase();
  if (s === "needs approval" || s === "generating") return "review";
  if (s === "approved" || s === "ready") return "queue";
  if (s === "posted") return "done";
  if (s === "failed") return "review";
  return "ideas";
}

function chipClass(row) {
  const stage = stageOf(row);
  if (String(row.status).toLowerCase() === "failed") return "failed";
  return stage;
}

function filteredRows() {
  // Active work list excludes Posted so confirmed posts leave the main list
  if (state.stage === "all") {
    return state.rows.filter((row) => stageOf(row) !== "done");
  }
  return state.rows.filter((row) => stageOf(row) === state.stage);
}

function approvedRows() {
  return state.rows.filter(
    (row) => String(row.status || "").toLowerCase() === "approved",
  );
}

function syncActionButtons() {
  const row = selectedRow();
  const postBtn = document.getElementById("btn-post");
  const markBtn = document.getElementById("btn-mark-posted");
  const approveBtn = document.getElementById("btn-approve");
  const queueBtn = document.getElementById("btn-post-queue");
  const status = String(row?.status || "").toLowerCase();
  const approved = status === "approved";
  const posted = status === "posted";

  if (postBtn) {
    postBtn.disabled = state.busy || !row || !approved;
    postBtn.title = approved
      ? "Post this Approved item in Pipeline Chrome"
      : "Approve this post first — Post now is only for Approved";
  }
  if (markBtn) {
    markBtn.hidden = !row || posted;
    markBtn.disabled = state.busy || !row || posted;
  }
  if (approveBtn) {
    approveBtn.disabled = state.busy || !row || approved || posted;
  }
  if (queueBtn) {
    const n = approvedRows().length;
    queueBtn.hidden = n === 0;
    queueBtn.disabled = state.busy || n === 0;
    queueBtn.textContent =
      n > 1 ? `Post all approved (${n})` : n === 1 ? "Post approved (1)" : "Post all approved";
  }
}

function selectedRow() {
  return state.rows.find((row) => String(row.id) === String(state.selectedId)) || null;
}

function platformsValue() {
  const list = [];
  if (els.ig.checked) list.push("instagram");
  if (els.li.checked) list.push("linkedin");
  return list.join("|") || "instagram|linkedin";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderCounts() {
  const counts = { all: 0, ideas: 0, review: 0, queue: 0, done: 0 };
  for (const row of state.rows) {
    const stage = stageOf(row);
    counts[stage] += 1;
    if (stage !== "done") counts.all += 1;
  }
  for (const [key, value] of Object.entries(counts)) {
    const el = document.querySelector(`[data-count="${key}"]`);
    if (el) el.textContent = String(value);
  }
  syncActionButtons();
}

function renderList() {
  const rows = filteredRows();
  const copy = stageCopy[state.stage];
  els.listTitle.textContent = copy.title;
  els.listSub.textContent = copy.sub;
  renderCounts();

  if (!rows.length) {
    els.list.innerHTML =
      '<div class="list-empty">Nothing here yet. Add ideas or click <strong>New post</strong>.</div>';
    return;
  }

  els.list.innerHTML = rows
    .map((row) => {
      const selected = String(row.id) === String(state.selectedId) ? " is-selected" : "";
      return `
        <button type="button" class="post-item${selected}" data-id="${row.id}">
          <strong>${escapeHtml(row.idea || "Untitled")}</strong>
          <span>${escapeHtml(row.angle || "No angle yet")}</span>
          <div class="post-meta">
            <span class="chip ${chipClass(row)}">${escapeHtml(row.status || "Draft")}</span>
            <span class="chip">${escapeHtml(row.scheduled_date || "No date")}</span>
          </div>
        </button>
      `;
    })
    .join("");

  els.list.querySelectorAll(".post-item").forEach((btn) => {
    btn.addEventListener("click", () => selectPost(btn.dataset.id));
  });
}

function setPreview(imagePath) {
  els.preview.innerHTML = "";
  if (!imagePath) {
    els.preview.hidden = true;
    els.drop.classList.remove("has-image");
    return;
  }
  const img = document.createElement("img");
  img.className = "preview-frame";
  img.alt = "Post image preview";
  img.src = `/media/${encodeURIComponent(imagePath)}?t=${Date.now()}`;
  els.preview.appendChild(img);
  els.preview.hidden = false;
  els.drop.classList.add("has-image");
}

function fillEditor(row) {
  if (!row) {
    els.editor.hidden = true;
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;
  els.editor.hidden = false;
  els.editorTitle.textContent = row.idea || "Untitled idea";
  els.editorStatus.textContent = row.status || "Draft";
  els.idea.value = row.idea || "";
  els.angle.value = row.angle || "";
  els.date.value = row.scheduled_date || "";
  els.caption.value = row.caption || "";
  els.hashtags.value = row.hashtags || "";
  els.feedback.value = row.feedback || "";
  els.promptIg.value = row.instagram_prompt || "";
  els.promptLi.value = row.linkedin_prompt || "";
  const platforms = String(row.platforms || "instagram|linkedin").toLowerCase();
  els.ig.checked = platforms.includes("instagram");
  els.li.checked = platforms.includes("linkedin");
  setPreview(row.image_path);
  els.note.hidden = !row.notes;
  els.note.textContent = row.notes || "";
  els.error.hidden = true;
  syncActionButtons();
}

function selectPost(id) {
  state.selectedId = id;
  renderList();
  fillEditor(selectedRow());
}

async function refresh(selectId = state.selectedId) {
  const data = await api("/api/posts");
  state.rows = data.rows || [];
  if (selectId && state.rows.some((row) => String(row.id) === String(selectId))) {
    state.selectedId = selectId;
  } else if (!state.rows.some((row) => String(row.id) === String(state.selectedId))) {
    state.selectedId = state.rows[0]?.id || null;
  }
  renderList();
  fillEditor(selectedRow());
}

async function saveSelected(extra = {}) {
  const row = selectedRow();
  if (!row) return null;
  const data = await api("/api/posts/update", {
    method: "POST",
    body: JSON.stringify({
      id: row.id,
      idea: els.idea.value.trim(),
      angle: els.angle.value.trim(),
      scheduled_date: els.date.value,
      platforms: platformsValue(),
      caption: els.caption.value,
      hashtags: els.hashtags.value,
      feedback: els.feedback.value,
      instagram_prompt: els.promptIg.value,
      linkedin_prompt: els.promptLi.value,
      ...extra,
    }),
  });
  return data.row;
}

async function refreshConnections() {
  const data = await api("/api/connections");
  for (const platform of ["instagram", "linkedin"]) {
    const el = document.getElementById(`status-${platform}`);
    const connected = data[platform]?.connected;
    el.textContent = connected ? "Connected" : "Not connected";
    el.classList.toggle("ok", connected);
    el.classList.toggle("warn", !connected);
  }
  const control = document.getElementById("status-chrome-control");
  if (control) {
    control.textContent = data.chromeControl ? "Control ON" : "Control OFF";
    control.classList.toggle("ok", Boolean(data.chromeControl));
    control.classList.toggle("warn", !data.chromeControl);
  }
  return data;
}

async function loadSettings() {
  const data = await api("/api/settings");
  state.settings = data.settings;
  const presets = data.settings.presets || {};
  const select = document.getElementById("set-preset");
  select.innerHTML = Object.entries(presets)
    .map(
      ([key, preset]) =>
        `<option value="${key}">${escapeHtml(preset.label || key)}</option>`,
    )
    .join("");
  select.value = data.settings.aiPreset || "custom";
  document.getElementById("set-model").value = data.settings.aiModel || "";
  document.getElementById("set-image-model").value =
    data.settings.aiImageModel || "dall-e-3";
  document.getElementById("set-base").value = data.settings.aiBaseUrl || "";
  document.getElementById("set-key").value = "";
  document.getElementById("set-key").placeholder = data.settings.aiApiKeySet
    ? `Saved (${data.settings.aiApiKeyMasked}) — paste to replace`
    : "Paste API key";
  document.getElementById("set-voice").value = data.settings.brandVoice || "";
  document.getElementById("set-prompt-ig").value =
    data.settings.promptInstagram || "";
  document.getElementById("set-prompt-li").value =
    data.settings.promptLinkedin || "";
  const connectIg = document.getElementById("connect-prompt-ig");
  const connectLi = document.getElementById("connect-prompt-li");
  if (connectIg) connectIg.value = data.settings.promptInstagram || "";
  if (connectLi) connectLi.value = data.settings.promptLinkedin || "";
  document.getElementById("set-tags").value = data.settings.defaultHashtags || "";
  els.settingsHint.textContent = data.settings.aiApiKeySet
    ? `Model ready: ${data.settings.aiModel || "custom"}`
    : "No API key yet — drafts will use a free template until you add one.";
}

async function uploadImage(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const result = await api("/api/upload", {
    method: "POST",
    body: JSON.stringify({
      id: state.selectedId,
      filename: file.name,
      data: btoa(binary),
      contentType: file.type,
    }),
  });
  return result.row;
}

function openNewModal() {
  els.newForm.reset();
  const date = els.newForm.elements.scheduled_date;
  if (date) date.value = new Date().toISOString().slice(0, 10);
  els.modal.showModal();
}

function hidePanels() {
  els.setup.hidden = true;
  els.settingsPanel.hidden = true;
}

document.querySelectorAll(".stage").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".stage").forEach((el) => el.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.stage = btn.dataset.stage;
    renderList();
  });
});

document.getElementById("btn-new").addEventListener("click", openNewModal);
document.getElementById("btn-new-empty").addEventListener("click", openNewModal);
document.getElementById("btn-new-cancel").addEventListener("click", () => els.modal.close());
document.getElementById("btn-ideas").addEventListener("click", () => els.ideasModal.showModal());
document.getElementById("btn-ideas-cancel").addEventListener("click", () => els.ideasModal.close());

document.getElementById("btn-setup").addEventListener("click", async () => {
  const open = els.setup.hidden;
  hidePanels();
  els.setup.hidden = !open;
  if (!els.setup.hidden) {
    await loadSettings();
    refreshConnections();
  }
});
document.getElementById("btn-setup-close").addEventListener("click", () => {
  els.setup.hidden = true;
});

document.getElementById("btn-settings").addEventListener("click", async () => {
  const open = els.settingsPanel.hidden;
  hidePanels();
  els.settingsPanel.hidden = !open;
  if (!els.settingsPanel.hidden) await loadSettings();
});
document.getElementById("btn-settings-close").addEventListener("click", () => {
  els.settingsPanel.hidden = true;
});

document.getElementById("set-preset").addEventListener("change", async (event) => {
  try {
    const data = await api("/api/settings/preset", {
      method: "POST",
      body: JSON.stringify({ preset: event.target.value }),
    });
    state.settings = data.settings;
    document.getElementById("set-base").value = data.settings.aiBaseUrl || "";
    document.getElementById("set-model").value = data.settings.aiModel || "";
    toast(`Preset: ${data.settings.aiPreset}`);
  } catch (error) {
    toast(error.message);
  }
});

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setBusy(true);
    const patch = {
      aiPreset: document.getElementById("set-preset").value,
      aiModel: document.getElementById("set-model").value.trim(),
      aiImageModel:
        document.getElementById("set-image-model").value.trim() || "dall-e-3",
      aiBaseUrl: document.getElementById("set-base").value.trim(),
      brandVoice: document.getElementById("set-voice").value.trim(),
      promptInstagram: document.getElementById("set-prompt-ig").value.trim(),
      promptLinkedin: document.getElementById("set-prompt-li").value.trim(),
      defaultHashtags: document.getElementById("set-tags").value.trim(),
    };
    const key = document.getElementById("set-key").value.trim();
    if (key) patch.aiApiKey = key;
    const data = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify(patch),
    });
    state.settings = data.settings;
    document.getElementById("set-key").value = "";
    await loadSettings();
    toast("Settings saved.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-settings-test").addEventListener("click", async () => {
  try {
    setBusy(true);
    const key = document.getElementById("set-key").value.trim();
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        aiPreset: document.getElementById("set-preset").value,
        aiModel: document.getElementById("set-model").value.trim(),
        aiImageModel:
          document.getElementById("set-image-model").value.trim() || "dall-e-3",
        aiBaseUrl: document.getElementById("set-base").value.trim(),
        brandVoice: document.getElementById("set-voice").value.trim(),
        promptInstagram: document.getElementById("set-prompt-ig").value.trim(),
        promptLinkedin: document.getElementById("set-prompt-li").value.trim(),
        defaultHashtags: document.getElementById("set-tags").value.trim(),
        ...(key ? { aiApiKey: key } : {}),
      }),
    });
    const result = await api("/api/settings/test", { method: "POST", body: "{}" });
    els.settingsHint.textContent = result.ok
      ? `Connected to ${result.model}`
      : result.error || "Test failed";
    toast(result.ok ? "Model OK." : result.error || "Model test failed");
    await loadSettings();
  } catch (error) {
    els.settingsHint.textContent = error.message;
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-save-platform-prompts")?.addEventListener("click", async () => {
  try {
    setBusy(true);
    const data = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        promptInstagram: document.getElementById("connect-prompt-ig").value.trim(),
        promptLinkedin: document.getElementById("connect-prompt-li").value.trim(),
      }),
    });
    state.settings = data.settings;
    await loadSettings();
    toast("Instagram & LinkedIn LLM prompts saved.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-chrome-enable").addEventListener("click", async () => {
  try {
    setBusy(true);
    toast("Restarting Chrome with control… Pipeline will reopen automatically.");
    const data = await api("/api/chrome/enable", { method: "POST", body: "{}" });
    // Chrome restarted — this page may die; poll after reopen
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const conn = await refreshConnections();
        if (conn.chromeControl) {
          toast(data.message || "Chrome control is ON. You can post now.");
          return;
        }
      } catch {
        // page/server waking up
      }
    }
    toast(data.message || "Chrome control enabled — refresh if the page looks stuck.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-scan").addEventListener("click", async () => {
  try {
    setBusy(true);
    toast("Scanning Google Chrome tabs…");
    const data = await api("/api/connections/scan", { method: "POST", body: "{}" });
    await refreshConnections();
    const ig = data.scan?.instagram?.connected;
    const li = data.scan?.linkedin?.connected;
    if (ig && li) toast("Instagram + LinkedIn detected in Chrome.");
    else if (ig || li) toast(`${ig ? "Instagram" : "LinkedIn"} detected. Open the other and scan again.`);
    else toast(data.message || "No signed-in Instagram/LinkedIn tabs found. Open them, then scan.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.querySelectorAll("[data-login]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const platform = btn.dataset.login;
    try {
      setBusy(true);
      // One CDP open only — server reuses the existing tab for that site (no double tabs)
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ platform, open: true }),
      });
      await refreshConnections();
      toast(`Opened ${platform} in Pipeline Chrome. Sign in there, then Detect sessions.`);
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  });
});

document.querySelectorAll("[data-confirm]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      setBusy(true);
      await api("/api/connections/confirm", {
        method: "POST",
        body: JSON.stringify({ platform: btn.dataset.confirm, connected: true }),
      });
      await refreshConnections();
      toast(`${btn.dataset.confirm} connected.`);
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  });
});

els.newForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setBusy(true);
    const fd = new FormData(els.newForm);
    const platforms = [];
    if (fd.get("instagram")) platforms.push("instagram");
    if (fd.get("linkedin")) platforms.push("linkedin");
    const created = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({
        idea: String(fd.get("idea") || "").trim(),
        angle: String(fd.get("angle") || "").trim(),
        scheduled_date: String(fd.get("scheduled_date") || ""),
        platforms: platforms.join("|") || "instagram|linkedin",
        status: "Ready",
        draft: true,
      }),
    });
    els.modal.close();
    state.stage = "review";
    document.querySelectorAll(".stage").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.stage === "review");
    });
    await refresh(created.row.id);
    toast("Draft ready — review or regenerate.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

els.ideasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setBusy(true);
    const fd = new FormData(els.ideasForm);
    const data = await api("/api/ideas/bulk", {
      method: "POST",
      body: JSON.stringify({ text: String(fd.get("text") || "") }),
    });
    els.ideasModal.close();
    state.stage = "ideas";
    document.querySelectorAll(".stage").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.stage === "ideas");
    });
    await refresh(data.rows?.[0]?.id);
    toast(`Added ${data.count} ideas. Click “Generate drafts for ideas”.`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-generate-all").addEventListener("click", async () => {
  try {
    setBusy(true);
    toast("Generating drafts…");
    const data = await api("/api/ideas/generate-all", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.stage = "review";
    document.querySelectorAll(".stage").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.stage === "review");
    });
    await refresh();
    toast(`Drafted ${data.drafted}/${data.count}. Review under Needs you.`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-save").addEventListener("click", async () => {
  try {
    setBusy(true);
    const row = await saveSelected();
    await refresh(row.id);
    toast("Saved.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-draft").addEventListener("click", async () => {
  try {
    setBusy(true);
    await saveSelected();
    const data = await api("/api/draft", {
      method: "POST",
      body: JSON.stringify({ id: state.selectedId }),
    });
    await refresh(data.row.id);
    toast(data.source === "ai" ? "AI draft ready." : "Template draft ready — add API key in Settings for AI.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-regenerate").addEventListener("click", async () => {
  try {
    setBusy(true);
    await saveSelected();
    const feedback = els.feedback.value.trim();
    const data = await api("/api/regenerate", {
      method: "POST",
      body: JSON.stringify({ id: state.selectedId, feedback }),
    });
    await refresh(data.row.id);
    toast(
      data.imageGenerated
        ? "Image generated and attached — review before posting."
        : "Regenerated from your comments.",
    );
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-approve").addEventListener("click", async () => {
  try {
    setBusy(true);
    await saveSelected();
    const data = await api("/api/approve", {
      method: "POST",
      body: JSON.stringify({
        id: state.selectedId,
        caption: els.caption.value,
        hashtags: els.hashtags.value,
      }),
    });
    await refresh(data.row.id);
    toast("Approved — ready to post.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-post").addEventListener("click", async () => {
  const row = selectedRow();
  if (!row || String(row.status || "").toLowerCase() !== "approved") {
    toast("Approve this post first — Post now is only for Approved.");
    return;
  }
  try {
    setBusy(true);
    await saveSelected();
    toast("Posting in Pipeline Chrome…");
    const data = await api("/api/post", {
      method: "POST",
      body: JSON.stringify({ id: state.selectedId }),
    });
    await refresh(data.row?.id);
    if (data.ok) {
      state.stage = "done";
      document.querySelectorAll("[data-stage]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.stage === "done");
      });
      renderList();
      toast("Posted — moved to Posted list.");
    } else {
      toast(data.error || "Finished with errors — check notes.");
    }
  } catch (error) {
    toast(error.message);
    await refresh(state.selectedId);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-mark-posted").addEventListener("click", async () => {
  const row = selectedRow();
  if (!row) return;
  if (
    !confirm(
      `Mark “${row.idea || "this post"}” as already posted? It will leave the active list and move to Posted.`,
    )
  ) {
    return;
  }
  try {
    setBusy(true);
    await saveSelected();
    const data = await api("/api/posts/mark-posted", {
      method: "POST",
      body: JSON.stringify({ id: state.selectedId }),
    });
    state.stage = "done";
    document.querySelectorAll("[data-stage]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.stage === "done");
    });
    await refresh(data.row.id);
    toast("Marked as posted — moved out of the active list.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-post-queue").addEventListener("click", async () => {
  const n = approvedRows().length;
  if (!n) {
    toast("No Approved posts to publish.");
    return;
  }
  if (
    !confirm(
      `Post ${n} Approved item${n === 1 ? "" : "s"} in sequence in Pipeline Chrome? Instagram/LinkedIn must already be signed in.`,
    )
  ) {
    return;
  }
  try {
    setBusy(true);
    toast(`Posting ${n} approved post${n === 1 ? "" : "s"} in sequence…`);
    const data = await api("/api/post-queue", {
      method: "POST",
      body: JSON.stringify({ delayMs: 12000 }),
    });
    await refresh();
    toast(
      data.ok
        ? `Posted ${data.posted} in sequence.`
        : `Posted ${data.posted || 0} of ${data.attempted || n}. ${data.results?.find((r) => !r.ok)?.error || "Stopped on an error."}`,
    );
    if (data.posted > 0) {
      state.stage = "done";
      document.querySelectorAll("[data-stage]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.stage === "done");
      });
      renderList();
    }
  } catch (error) {
    toast(error.message);
    await refresh();
  } finally {
    setBusy(false);
  }
});

document.getElementById("btn-delete").addEventListener("click", async () => {
  const row = selectedRow();
  if (!row) return;
  if (!confirm(`Delete “${row.idea}”?`)) return;
  try {
    setBusy(true);
    await api("/api/posts/delete", {
      method: "POST",
      body: JSON.stringify({ id: row.id }),
    });
    state.selectedId = null;
    await refresh();
    toast("Deleted.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  if (!file || !state.selectedId) return;
  try {
    setBusy(true);
    const row = await uploadImage(file);
    await refresh(row.id);
    toast("Image added.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

["dragenter", "dragover"].forEach((type) => {
  els.drop.addEventListener(type, (event) => {
    event.preventDefault();
    els.drop.style.borderColor = "var(--blue)";
  });
});
["dragleave", "drop"].forEach((type) => {
  els.drop.addEventListener(type, (event) => {
    event.preventDefault();
    els.drop.style.borderColor = "";
  });
});
els.drop.addEventListener("drop", async (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file || !state.selectedId) return;
  try {
    setBusy(true);
    const row = await uploadImage(file);
    await refresh(row.id);
    toast("Image added.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});

// Boot: load UI, scan Chrome if possible, show connections if needed
await loadSettings();
const connections = await refreshConnections();
await refresh();
if (!connections.instagram?.connected || !connections.linkedin?.connected) {
  els.setup.hidden = false;
  try {
    const scan = await api("/api/connections/scan", { method: "POST", body: "{}" });
    await refreshConnections();
    if (scan.scan?.instagram?.connected || scan.scan?.linkedin?.connected) {
      toast("Detected signed-in sessions in Chrome.");
    }
  } catch {
    // Automation permission may be missing — manual connect still works
  }
}
