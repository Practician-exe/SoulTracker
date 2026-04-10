(() => {
  const statusEl = document.getElementById("status");
  const logEl = document.getElementById("log");
  const toastEl = document.getElementById("toast");
  const toastTitleEl = document.getElementById("toastTitle");
  const toastBodyEl = document.getElementById("toastBody");
  const audioEl = document.getElementById("alertAudio");

  const btnRefresh = document.getElementById("btnRefresh");
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
  } else if (!window.SoulChatReader || !window.SoulChatReader.isAvailable()) {
    statusEl.textContent = "Chat reader library failed to load.";
  } else {
    statusEl.textContent = "Alt1 detected. Locating chatbox...";
  }

  // ---- Cooldown bookkeeping: per soul type
  const lastAlertAt = {
    lost: 0,
    mimicking: 0,
    unstable: 0,
    vengeful: 0,
  };

  // ---- UI init from saved state
  if (typeof state.cooldownSec === "number") cooldownSecEl.value = String(state.cooldownSec);
  if (typeof state.scanMs === "number") scanMsEl.value = String(state.scanMs);
  if (typeof state.enableSound === "boolean") enableSoundEl.checked = state.enableSound;
  if (typeof state.enableVisual === "boolean") enableVisualEl.checked = state.enableVisual;

  // ---- Button handlers
  btnRefresh.addEventListener("click", () => {
    if (!inAlt1 || !window.SoulChatReader) return;
    statusEl.textContent = "Re-scanning for chatbox...";
    window.SoulChatReader.reset();
    tryFindChatbox();
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

  // ---- Chatbox finder
  // Number of ticks between auto-retry attempts while chatbox is not found.
  const FIND_RETRY_INTERVAL = 10;
  let findRetries = 0;

  function tryFindChatbox() {
    if (!inAlt1 || !window.SoulChatReader || !window.SoulChatReader.isAvailable()) return;
    findRetries = 0;
    const found = window.SoulChatReader.find();
    if (found) {
      statusEl.textContent = "Chatbox found. Watching chat...";
    } else {
      statusEl.textContent = "Chatbox not found - make sure RS3 is open and chat is visible. Retrying...";
    }
  }

  // ---- Main scan loop
  let timer = null;
  function startLoop() {
    if (timer) clearInterval(timer);
    const scanMs = clampInt(scanMsEl.value, 100, 2000, 350);
    timer = setInterval(scanTick, scanMs);
  }

  // Kick off: first try finding the chatbox, then start polling.
  if (inAlt1 && window.SoulChatReader && window.SoulChatReader.isAvailable()) {
    tryFindChatbox();
  }
  startLoop();

  function scanTick() {
    if (!inAlt1) return;
    const reader = window.SoulChatReader;
    if (!reader || !reader.isAvailable()) return;

    // If chatbox position is unknown, retry periodically.
    if (!reader.hasPosition()) {
      findRetries++;
      if (findRetries % FIND_RETRY_INTERVAL === 0) {
        const found = reader.find();
        if (found) {
          statusEl.textContent = "Chatbox found. Watching chat...";
          findRetries = 0;
        }
      }
      return;
    }

    // Read new chat lines since last tick.
    let lines;
    try {
      lines = reader.read();
    } catch (e) {
      statusEl.textContent = "Chat read error - click Refresh to retry.";
      console.error("[SoulTracker] read error:", e);
      return;
    }

    if (!lines) return;

    // Warn if RS3 timestamps appear to be disabled.
    if (reader.timestampsLikelyDisabled()) {
      statusEl.textContent =
        "Enable RS3 chat timestamps (Chat Settings > Timestamp) for best results.";
    } else if (lines.length > 0) {
      statusEl.textContent = "Watching chat... (" + new Date().toLocaleTimeString() + ")";
    }

    // Check each new line for soul messages.
    for (const line of lines) {
      const normalized = normalizeLine(line.text);
      const detections = detectSouls(normalized);
      for (const det of detections) {
        maybeAlert(det);
      }
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
    line.innerHTML =
      '<div>' +
        '<span class="logType">' + escapeHtml(type.toUpperCase()) + '</span>' +
        '<div style="margin-top:4px; color: rgba(231,224,207,.75); font-size: 12px;">' +
          escapeHtml(message) +
        '</div>' +
      '</div>' +
      '<div class="logTime">' + new Date().toLocaleTimeString() + '</div>';
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
    } catch (_) {}
  }

  // ---- Detection logic

  /**
   * Detect soul messages in a single (already-normalized) chat line.
   * Returns an array of {type, message} objects.
   */
  function detectSouls(normalizedText) {
    if (!normalizedText.includes("soul appears nearby")) return [];

    const out = [];
    const candidates = [
      { type: "lost",      key: "lost" },
      { type: "mimicking", key: "mimicking" },
      { type: "unstable",  key: "unstable" },
      { type: "vengeful",  key: "vengeful" },
    ];

    for (const c of candidates) {
      // Primary match: "a <type> soul appears nearby"
      if (normalizedText.includes("a " + c.key + " soul appears nearby")) {
        out.push({ type: c.type, message: prettyMessage(c.type) });
        continue;
      }
      // Fallback: OCR may drop leading "a " occasionally
      if (normalizedText.includes(c.key + " soul appears nearby")) {
        out.push({ type: c.type, message: prettyMessage(c.type) });
      }
    }

    return uniqueBy(out, function(x) { return x.type; });
  }

  function prettyMessage(type) {
    switch (type) {
      case "lost":
        return "A lost soul appears nearby.";
      case "mimicking":
        return "A mimicking soul appears nearby. Corner them before they get away.";
      case "unstable":
        return "An unstable soul appears nearby.";
      case "vengeful":
        return "A vengeful soul appears nearby! Avoid it until it realises you're not the intended target.";
      default:
        return "Soul detected.";
    }
  }

  // ---- Utilities

  /**
   * Strip the RS3 timestamp prefix [HH:MM:SS] (if present),
   * lowercase, and collapse whitespace for reliable substring matching.
   */
  function normalizeLine(s) {
    return (s || "")
      .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\u2019/g, "'")
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

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveState(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
})();
