(() => {
  const statusEl = document.getElementById("status");
  const logEl = document.getElementById("log");
  const toastEl = document.getElementById("toast");
  const toastTitleEl = document.getElementById("toastTitle");
  const toastBodyEl = document.getElementById("toastBody");
  const audioEl = document.getElementById("alertAudio");

  const btnCalibrate = document.getElementById("btnCalibrate");
  const btnTest = document.getElementById("btnTest");

  const cooldownSecEl = document.getElementById("cooldownSec");
  const scanMsEl = document.getElementById("scanMs");
  const enableSoundEl = document.getElementById("enableSound");
  const enableVisualEl = document.getElementById("enableVisual");

  const STORAGE_KEY = "rs3_soul_tracker_v1";
  const state = loadState();

  // ---- Alt1 presence checks
  const inAlt1 = typeof alt1 !== "undefined";
  if (!inAlt1) {
    statusEl.textContent = "Open this inside Alt1 Toolkit (alt1 not detected).";
  } else {
    statusEl.textContent = "Alt1 detected. Calibrate chat area if needed.";
  }

  // ---- Cooldown bookkeeping: per soul type
  const lastAlertAt = {
    lost: 0,
    mimicking: 0,
    unstable: 0,
    vengeful: 0,
  };

  // Also dedupe on exact OCR text to reduce repeats from the same frame
  let lastOcrHash = "";

  // ---- UI init from saved state
  if (typeof state.cooldownSec === "number") cooldownSecEl.value = String(state.cooldownSec);
  if (typeof state.scanMs === "number") scanMsEl.value = String(state.scanMs);
  if (typeof state.enableSound === "boolean") enableSoundEl.checked = state.enableSound;
  if (typeof state.enableVisual === "boolean") enableVisualEl.checked = state.enableVisual;

  btnCalibrate.addEventListener("click", async () => {
    if (!inAlt1) return;

    // Alt1 has built-in region selection helpers in some setups.
    // If your Alt1 build doesn’t expose a helper, we can do manual entry instead.
    //
    // This tries to use alt1.overLayRect selection if available; otherwise falls back.
    try {
      statusEl.textContent = "Select chat region (drag a rectangle).";
      const rect = await selectRect();
      if (!rect) {
        statusEl.textContent = "Calibration cancelled.";
        return;
      }
      state.chatRect = rect;
      saveState(state);
      statusEl.textContent = `Chat area saved: x=${rect.x}, y=${rect.y}, w=${rect.w}, h=${rect.h}`;
    } catch (e) {
      console.error(e);
      statusEl.textContent = "Calibration failed. (Your Alt1 may not support selection in this template.)";
    }
  });

  btnTest.addEventListener("click", () => {
    fireAlert({
      type: "mimicking",
      message: "A mimicking soul appears nearby. Corner them before they get away.",
    });
  });

  cooldownSecEl.addEventListener("change", () => persistSettings());
  scanMsEl.addEventListener("change", () => persistSettings());
  enableSoundEl.addEventListener("change", () => persistSettings());
  enableVisualEl.addEventListener("change", () => persistSettings());

  function persistSettings() {
    state.cooldownSec = clampInt(cooldownSecEl.value, 1, 600, 30);
    state.scanMs = clampInt(scanMsEl.value, 100, 2000, 350);
    state.enableSound = !!enableSoundEl.checked;
    state.enableVisual = !!enableVisualEl.checked;
    saveState(state);
  }

  // ---- Main scan loop
  let timer = null;
  function startLoop() {
    if (timer) clearInterval(timer);

    const scanMs = clampInt(scanMsEl.value, 100, 2000, 350);
    timer = setInterval(scanTick, scanMs);
  }

  startLoop();

  async function scanTick() {
    if (!inAlt1) return;
    if (!state.chatRect) {
      statusEl.textContent = "Alt1 detected. Calibrate chat area.";
      return;
    }

    // NOTE: Exact OCR API surface varies by Alt1 version.
    // This is a “template” approach:
    // 1) capture the chat rectangle bitmap
    // 2) OCR it
    //
    // If your Alt1 build uses a different API, tell me which Alt1 JS libs you’re using
    // (e.g., a1lib + ChatboxReader), and I’ll adapt the code precisely.
    let text = "";
    try {
      text = await ocrRect(state.chatRect);
    } catch (e) {
      // Don’t spam status constantly
      statusEl.textContent = "OCR error (check capture permissions / rectangle).";
      return;
    }

    const normalized = normalizeOcr(text);
    const hash = simpleHash(normalized);
    if (hash === lastOcrHash) return;
    lastOcrHash = hash;

    const detections = detectSouls(normalized);
    if (detections.length === 0) return;

    statusEl.textContent = `Watching chat… (${new Date().toLocaleTimeString()})`;

    for (const det of detections) {
      maybeAlert(det);
    }
  }

  function maybeAlert(det) {
    const cooldownSec = clampInt(cooldownSecEl.value, 1, 600, 30);
    const now = Date.now();
    const last = lastAlertAt[det.type] || 0;

    if (now - last < cooldownSec * 1000) return;

    lastAlertAt[det.type] = now;
    fireAlert(det);
  }

  function fireAlert(det) {
    addLogLine(det.type, det.message);

    if (enableVisualEl.checked) {
      showToast(det);
    }
    if (enableSoundEl.checked) {
      playSound();
    }
  }

  function addLogLine(type, message) {
    const line = document.createElement("div");
    line.className = "logLine";
    line.innerHTML = `
      <div>
        <span class="logType">${escapeHtml(type.toUpperCase())}</span>
        <div style="margin-top:4px; color: rgba(231,224,207,.75); font-size: 12px;">
          ${escapeHtml(message)}
        </div>
      </div>
      <div class="logTime">${new Date().toLocaleTimeString()}</div>
    `;
    logEl.prepend(line);

    // keep last ~10
    while (logEl.children.length > 10) logEl.removeChild(logEl.lastChild);
  }

  function showToast(det) {
    const isRed = det.type === "vengeful";
    toastEl.classList.remove("toast--green", "toast--red");
    toastEl.classList.add(isRed ? "toast--red" : "toast--green");

    toastTitleEl.textContent = "Soul detected";
    toastBodyEl.textContent = det.message;

    toastEl.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("show"), 4000);
  }

  function playSound() {
    try {
      audioEl.currentTime = 0;
      const p = audioEl.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  }

  // ---- Detection logic
  function detectSouls(normalizedText) {
    // normalizedText may include multiple lines merged; we just search substrings.
    if (!normalizedText.includes("soul appears nearby")) return [];

    // Build up possible detections (in case multiple appeared in OCR block)
    const out = [];

    // prefer matching the leading “a <type> soul appears nearby”
    const candidates = [
      { type: "lost", key: "lost" },
      { type: "mimicking", key: "mimicking" },
      { type: "unstable", key: "unstable" },
      { type: "vengeful", key: "vengeful" },
    ];

    for (const c of candidates) {
      if (normalizedText.includes(`a ${c.key} soul appears nearby`)) {
        out.push({ type: c.type, message: prettyMessage(c.type) });
      }
    }

    // Fallback if OCR misses the "a "
    if (out.length === 0) {
      for (const c of candidates) {
        if (normalizedText.includes(`${c.key} soul appears nearby`)) {
          out.push({ type: c.type, message: prettyMessage(c.type) });
        }
      }
    }

    // De-duplicate
    return uniqueBy(out, (x) => x.type);
  }

  function prettyMessage(type) {
    switch (type) {
      case "lost":
        return "A lost soul appears nearby.";
      case "mimicking":
        return "A mimicking soul appears nearby. Corner them before they get away.";
      case "unstable":
        return "A unstable soul appears nearby.";
      case "vengeful":
        return "A vengeful soul appears nearby! Avoid it until it realises you're not the intended target.";
      default:
        return "Soul detected.";
    }
  }

  // ---- OCR helpers (template)
  async function ocrRect(rect) {
    // This is intentionally abstract because Alt1 OCR APIs differ by setup.
    // Many plugins use a1lib + OCR libraries (e.g., ChatboxReader).
    //
    // If your environment has `alt1.capture` and `alt1.bindReadString`, you’d implement here.
    // For now, throw so you’re forced to connect the correct OCR library.
    throw new Error("OCR not wired: tell me which Alt1 JS libs you’re using (a1lib/ChatboxReader/etc.)");
  }

  // ---- Calibration selection (template)
  function selectRect() {
    // If your Alt1 exposes an overlay selection helper, wire it here.
    // Otherwise we can implement a 2-click top-left/bottom-right flow.
    return Promise.reject(new Error("Rect selection not wired"));
  }

  // ---- utilities
  function normalizeOcr(s) {
    return (s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .trim();
  }

  function uniqueBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = keyFn(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(String(v), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function simpleHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return String(h >>> 0);
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveState(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
})();