(() => {
  const statusEl = document.getElementById("status");
  const logEl = document.getElementById("log");
  const toastEl = document.getElementById("toast");
  const toastTitleEl = document.getElementById("toastTitle");
  const toastBodyEl = document.getElementById("toastBody");
  const audioEl = document.getElementById("alertAudio");

  const btnRefresh = document.getElementById("btnRefresh");
  const btnManual = document.getElementById("btnManual");
  const btnClearManual = document.getElementById("btnClearManual");
  const btnTest = document.getElementById("btnTest");

  const cooldownSecEl = document.getElementById("cooldownSec");
  const scanMsEl = document.getElementById("scanMs");
  const enableSoundEl = document.getElementById("enableSound");
  const enableVisualEl = document.getElementById("enableVisual");

  const STORAGE_KEY = "rs3_soul_tracker_v1";
  const state = loadState();

  // ---- Helpers

  /**
   * Returns the alt1://addapp/ install URL derived from the current page location.
   */
  function makeInstallUrl() {
    return "alt1://addapp/" + new URL("appconfig.json", window.location.href).href;
  }

  /**
   * Safely replace statusEl content with a plain-text message followed by a
   * clickable install link, avoiding innerHTML string injection.
   *
   * @param {string} prefix  - Text shown before the link.
   * @param {string} linkText - Visible link label.
   * @param {string} [suffix] - Optional text shown after the link; omit or pass "" to skip.
   */
  function setStatusWithLink(prefix, linkText, suffix) {
    statusEl.textContent = "";
    statusEl.appendChild(document.createTextNode(prefix));
    const a = document.createElement("a");
    a.href = makeInstallUrl();
    a.style.color = "#57d26a";
    a.textContent = linkText;
    statusEl.appendChild(a);
    if (suffix) statusEl.appendChild(document.createTextNode(suffix));
  }

  function getAlt1CaptureIssue(error) {
    const msg = error && error.message ? String(error.message) : "";

    if (inAlt1 && (alt1.rsWidth <= 0 || alt1.rsHeight <= 0)) {
      return (
        "Alt1 can't access the RS3 game window right now. Open RS3, keep it visible on-screen, and try again."
      );
    }

    if (/capturehold failed/i.test(msg)) {
      return (
        "Alt1 detected the app, but couldn't bind the RS3 window for pixel capture. Make sure RS3 is open and visible, then try again."
      );
    }

    if (/outside of Alt1/i.test(msg)) {
      return "Open this app from inside Alt1 Toolkit.";
    }

    return (
      "Alt1 couldn't capture the RS3 window. Make sure RS3 is open and visible, then try again."
    );
  }

  // ---- Alt1 presence checks
  const inAlt1 = typeof alt1 !== "undefined";
  // When the app is browsed to in Alt1's built-in browser without being installed,
  // alt1.permissionPixel is false and pixel capture is blocked by Alt1 itself.
  const hasPixelPermission = inAlt1 && alt1.permissionPixel === true;

  if (!inAlt1) {
    statusEl.textContent = "Open this inside Alt1 Toolkit (alt1 not detected).";
  } else if (!hasPixelPermission) {
    setStatusWithLink(
      "This app needs to be installed in Alt1 to scan the chatbox. ",
      "Click here to install",
      ", then reopen it from your Apps panel."
    );
    btnRefresh.disabled = true;
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

  // ---- Alt1 native overlay (shown near the mouse cursor over the RS3 window)
  // Group name used for our notifications so we can clear them before redrawing.
  var OVERLAY_GROUP = "st_soul";
  var CALIBRATE_GROUP = "st_cal";
  var MANUAL_GROUP = "st_manual";
  var manualPickTimer = null;

  /**
   * Draw a native Alt1 overlay notification near the current mouse position.
   * Falls back silently if any overlay API is unavailable.
   */
  function showAlt1Overlay(det) {
    try {
      // Decode packed mouse position: high 16 bits = x, low 16 bits = y.
      // Returns -1 when the mouse is not over the RS3 window.
      var mp = alt1.mousePosition;
      var ox, oy;
      if (mp === -1) {
        // Centre of the RS3 window as fallback
        ox = Math.max(4, ((alt1.rsWidth / 2) | 0) - 110);
        oy = 40;
      } else {
        ox = (mp >>> 16) + 20;
        oy = ((mp & 0xFFFF) - 64) | 0;
      }
      // Clamp so the box stays inside the RS3 window
      ox = Math.max(4, Math.min(ox, alt1.rsWidth - 224));
      oy = Math.max(4, Math.min(oy, alt1.rsHeight - 58));

      var isRed  = det.type === "vengeful";
      var accent = isRed ? A1lib.mixColor(255, 90, 90) : A1lib.mixColor(57, 210, 106);
      var bg     = A1lib.mixColor(14, 17, 22, 220);
      var fg     = A1lib.mixColor(231, 224, 207);
      var ms     = 4000;

      alt1.overLayClearGroup(OVERLAY_GROUP);
      alt1.overLaySetGroup(OVERLAY_GROUP);
      // Dark background panel
      alt1.overLayRect(bg, ox, oy, 220, 52, ms, 0);
      // Accent top strip (2 px filled rect)
      alt1.overLayRect(accent, ox, oy, 220, 2, ms, 0);
      // Title: "<TYPE> SOUL DETECTED"
      alt1.overLayText(det.type.toUpperCase() + " SOUL DETECTED", accent, 13, ox + 6, oy + 17, ms);
      // Message (truncated to fit the box width)
      var msg = det.message.length > 47 ? det.message.slice(0, 44) + "..." : det.message;
      alt1.overLayText(msg, fg, 11, ox + 6, oy + 36, ms);
      alt1.overLayFreezeGroup(OVERLAY_GROUP);
    } catch (e) {
      console.warn("[SoulTracker] overlay error:", e);
    }
  }

  function getRsMousePos() {
    if (!inAlt1) return null;
    var mp = alt1.mousePosition;
    if (mp === -1) return null;
    return { x: mp >>> 16, y: mp & 0xFFFF };
  }

  function showRectOverlay(rect, color, ms, group) {
    try {
      alt1.overLayClearGroup(group);
      alt1.overLaySetGroup(group);
      alt1.overLayRect(color, rect.x, rect.y, rect.width, rect.height, ms, 2);
      alt1.overLayFreezeGroup(group);
    } catch (_e) {}
  }

  function clearManualOverlay() {
    try {
      alt1.overLayClearGroup(MANUAL_GROUP);
    } catch (_e) {}
  }

  function setButtonsDisabled(disabled) {
    btnRefresh.disabled = disabled;
    btnManual.disabled = disabled;
    btnClearManual.disabled = disabled;
    btnTest.disabled = disabled;
  }

  function normalizeRect(a, b) {
    var left = Math.min(a.x, b.x);
    var top = Math.min(a.y, b.y);
    var right = Math.max(a.x, b.x);
    var bottom = Math.max(a.y, b.y);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  function persistManualRect(rect) {
    if (rect) {
      state.manualRect = rect;
    } else {
      delete state.manualRect;
    }
    saveState(state);
  }

  function applyManualRect(rect) {
    if (!window.SoulChatReader || !window.SoulChatReader.isAvailable()) return false;
    var ok = window.SoulChatReader.setManualRect(rect);
    if (!ok) return false;
    persistManualRect(rect);
    showRectOverlay(rect, A1lib.mixColor(57, 210, 106), 3500, MANUAL_GROUP);
    statusEl.textContent = "Manual chat area saved. Watching chat...";
    return true;
  }

  function captureMouseAfterCountdown(label, seconds, done) {
    clearTimeout(manualPickTimer);
    var remaining = seconds;

    function tick() {
      statusEl.textContent =
        "Manual select: hover " + label + " over the visible chat text area in RS3. Capturing in " + remaining + "...";

      if (remaining <= 0) {
        var pos = getRsMousePos();
        done(pos);
        return;
      }

      remaining--;
      manualPickTimer = setTimeout(tick, 1000);
    }

    tick();
  }

  function startManualSelection() {
    if (!inAlt1) {
      statusEl.textContent = "Open this app inside Alt1 Toolkit first.";
      return;
    }
    if (!hasPixelPermission) {
      setStatusWithLink(
        "Pixel permission not granted – the app must be ",
        "installed in Alt1",
        " (not just opened in the browser). Reopen it from your Apps panel after installing."
      );
      return;
    }

    setButtonsDisabled(true);
    clearManualOverlay();

    captureMouseAfterCountdown("TOP-LEFT", 3, function (topLeft) {
      if (!topLeft) {
        setButtonsDisabled(false);
        statusEl.textContent = "Manual select failed: keep your mouse over the RS3 window during capture.";
        return;
      }

      captureMouseAfterCountdown("BOTTOM-RIGHT", 3, function (bottomRight) {
        setButtonsDisabled(false);
        if (!bottomRight) {
          statusEl.textContent = "Manual select failed: keep your mouse over the RS3 window during capture.";
          return;
        }

        var rect = normalizeRect(topLeft, bottomRight);
        if (rect.width < 120 || rect.height < 40) {
          statusEl.textContent = "Manual select failed: the selected area was too small. Try again.";
          return;
        }

        if (!applyManualRect(rect)) {
          statusEl.textContent = "Manual select failed: chat reader is not available.";
        }
      });
    });
  }
  btnRefresh.addEventListener("click", () => {
    if (!inAlt1) {
      statusEl.textContent = "Open this app inside Alt1 Toolkit first.";
      return;
    }
    if (!hasPixelPermission) {
      setStatusWithLink(
        "Pixel permission not granted \u2013 the app must be ",
        "installed in Alt1",
        " (not just opened in the browser). Reopen it from your Apps panel after installing."
      );
      return;
    }
    if (!window.SoulChatReader || !window.SoulChatReader.isAvailable()) {
      statusEl.textContent = "Chat reader library failed to load \u2013 try refreshing the app.";
      return;
    }
    statusEl.textContent = "Scanning for chatbox\u2026";
    if (window.SoulChatReader && window.SoulChatReader.hasManualRect()) {
      window.SoulChatReader.clearManualRect();
      persistManualRect(null);
      clearManualOverlay();
    }
    window.SoulChatReader.reset();
    let found;
    try {
      found = window.SoulChatReader.find();
    } catch (e) {
      console.error("[SoulTracker] calibration error:", e);
      statusEl.textContent = getAlt1CaptureIssue(e);
      return;
    }
    if (found) {
      statusEl.textContent = "Chatbox found. Watching chat\u2026";
      // Flash a green outline around the detected chatbox so the user can confirm
      // the right region was picked up.
      try {
        const pos = window.SoulChatReader.getPos();
        if (pos && pos.x != null) {
          alt1.overLayClearGroup(CALIBRATE_GROUP);
          alt1.overLaySetGroup(CALIBRATE_GROUP);
          alt1.overLayRect(A1lib.mixColor(57, 210, 106), pos.x, pos.y, pos.width, pos.height, 2500, 2);
          alt1.overLayFreezeGroup(CALIBRATE_GROUP);
        }
      } catch (_) {}
    } else {
      statusEl.textContent =
        "Calibration failed \u2013 make sure RS3 is open and the chatbox is visible, then try again.";
    }
  });

  btnManual.addEventListener("click", () => {
    startManualSelection();
  });

  btnClearManual.addEventListener("click", () => {
    clearTimeout(manualPickTimer);
    if (window.SoulChatReader) {
      window.SoulChatReader.clearManualRect();
    }
    persistManualRect(null);
    clearManualOverlay();
    statusEl.textContent = "Manual chat area cleared. Click Auto detect or Manual select.";
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
    if (!inAlt1 || !hasPixelPermission || !window.SoulChatReader || !window.SoulChatReader.isAvailable()) return;
    if (window.SoulChatReader.hasManualRect()) {
      statusEl.textContent = "Using saved manual chat area. Watching chat...";
      return;
    }
    findRetries = 0;
    let found;
    try {
      found = window.SoulChatReader.find();
    } catch (e) {
      console.error("[SoulTracker] auto-find error:", e);
      statusEl.textContent = getAlt1CaptureIssue(e);
      return;
    }
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
  if (inAlt1 && hasPixelPermission && window.SoulChatReader && window.SoulChatReader.isAvailable()) {
    if (state.manualRect && state.manualRect.x != null) {
      if (applyManualRect(state.manualRect)) {
        statusEl.textContent = "Using saved manual chat area. Watching chat...";
      } else {
        tryFindChatbox();
      }
    } else {
      tryFindChatbox();
    }
  }
  startLoop();

  function scanTick() {
    if (!inAlt1 || !hasPixelPermission) return;
    const reader = window.SoulChatReader;
    if (!reader || !reader.isAvailable()) return;

    // If chatbox position is unknown, retry periodically.
    if (!reader.hasPosition()) {
      findRetries++;
      if (findRetries % FIND_RETRY_INTERVAL === 0) {
        let found;
        try {
          found = reader.find();
        } catch (e) {
          console.error("[SoulTracker] find error in scan loop:", e);
          statusEl.textContent = getAlt1CaptureIssue(e);
          return;
        }
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
      if (inAlt1) {
        showAlt1Overlay(det);
      } else {
        showToast(det);
      }
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
    } catch (_e) { /* audio playback errors are non-fatal */ }
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
