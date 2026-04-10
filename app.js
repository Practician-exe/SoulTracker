(() => {
  const statusEl = document.getElementById("status");
  const logEl = document.getElementById("log");
  const toastEl = document.getElementById("toast");
  const toastTitleEl = document.getElementById("toastTitle");
  const toastBodyEl = document.getElementById("toastBody");
  const audioEl = document.getElementById("alertAudio");

  const btnManual = document.getElementById("btnManual");
  const btnClearManual = document.getElementById("btnClearManual");
  const btnTest = document.getElementById("btnTest");

  const cooldownSecEl = document.getElementById("cooldownSec");
  const scanMsEl = document.getElementById("scanMs");
  const enableSoundEl = document.getElementById("enableSound");
  const enableVisualEl = document.getElementById("enableVisual");

  const STORAGE_KEY = "rs3_soul_tracker_v1";
  const state = loadState();
  const TEMPLATE_PATHS = {
    lost: "templates/lost_soul.png",
    unstable: "templates/unstable_soul.png",
    mimicking: "templates/mimicking_soul.png",
    vengeful: "templates/vengeful_soul.png",
  };
  const visibleMatches = {
    lost: false,
    unstable: false,
    mimicking: false,
    vengeful: false,
  };
  let messageTemplates = null;
  let templatesReady = false;
  let templateLoadError = null;

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

  // ---- Alt1 presence checks
  const inAlt1 = typeof alt1 !== "undefined";
  // When the app is browsed to in Alt1's built-in browser without being installed,
  // alt1.permissionPixel is false and pixel capture is blocked by Alt1 itself.
  const hasPixelPermission = inAlt1 && alt1.permissionPixel === true;
  const hasOverlayPermission = inAlt1 && alt1.permissionOverlay === true;

  if (!inAlt1) {
    statusEl.textContent = "Open this inside Alt1 Toolkit (alt1 not detected).";
  } else if (!hasPixelPermission) {
    setStatusWithLink(
      "This app needs to be installed in Alt1 to scan the chatbox. ",
      "Click here to install",
      ", then reopen it from your Apps panel."
    );
    btnManual.disabled = true;
  } else if (!window.SoulChatReader || !window.SoulChatReader.isAvailable()) {
    statusEl.textContent = "Chat reader library failed to load.";
  } else {
    statusEl.textContent = hasOverlayPermission
      ? "Alt1 detected. Select the chat area to begin."
      : "Alt1 detected. Select the chat area to begin. Game overlay permission is off, so notifications will show in-app.";
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
  var MANUAL_GROUP = "st_manual";
  var manualPickTimer = null;
  var manualPickInterval = null;
  var manualSelectionStart = null;

  /**
   * Draw a native Alt1 overlay notification near the current mouse position.
   * Falls back silently if any overlay API is unavailable.
   */
  function showAlt1Overlay(det) {
    try {
      if (!inAlt1 || !hasOverlayPermission) return false;
      if (
        typeof alt1.overLayClearGroup !== "function" ||
        typeof alt1.overLaySetGroup !== "function" ||
        typeof alt1.overLayRect !== "function" ||
        typeof alt1.overLayText !== "function" ||
        typeof alt1.overLayFreezeGroup !== "function"
      ) {
        return false;
      }

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
      var width = 248;
      var height = 64;
      // Clamp so the box stays inside the RS3 window
      ox = Math.max(4, Math.min(ox, alt1.rsWidth - width - 4));
      oy = Math.max(4, Math.min(oy, alt1.rsHeight - height - 4));

      var isRed = det.type === "vengeful";
      var accent = isRed ? A1lib.mixColor(255, 86, 86) : A1lib.mixColor(201, 166, 75);
      var border = isRed ? A1lib.mixColor(255, 116, 116) : A1lib.mixColor(214, 185, 111);
      var bg = A1lib.mixColor(16, 20, 26, 238);
      var bg2 = A1lib.mixColor(28, 32, 39, 210);
      var fg = A1lib.mixColor(231, 224, 207);
      var sub = A1lib.mixColor(167, 159, 139);
      var ms     = 4000;

      alt1.overLayClearGroup(OVERLAY_GROUP);
      alt1.overLaySetGroup(OVERLAY_GROUP);
      alt1.overLayRect(bg, ox, oy, width, height, ms, 0);
      alt1.overLayRect(bg2, ox + 1, oy + 1, width - 2, 18, ms, 0);
      alt1.overLayRect(border, ox, oy, width, height, ms, 1);
      alt1.overLayRect(accent, ox, oy, width, 2, ms, 0);
      alt1.overLayText("SOUL TRACKER", sub, 10, ox + 8, oy + 13, ms);
      alt1.overLayText(det.type.toUpperCase() + " SOUL DETECTED", accent, 13, ox + 8, oy + 31, ms);
      var msg = det.message.length > 48 ? det.message.slice(0, 45) + "..." : det.message;
      alt1.overLayText(msg, fg, 11, ox + 8, oy + 50, ms);
      alt1.overLayFreezeGroup(OVERLAY_GROUP);
      return true;
    } catch (e) {
      console.warn("[SoulTracker] overlay error:", e);
      return false;
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

  function clearManualSelectionTimers() {
    clearTimeout(manualPickTimer);
    clearInterval(manualPickInterval);
    manualPickTimer = null;
    manualPickInterval = null;
  }

  function setButtonsDisabled(disabled) {
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
    resetVisibleMatches();
    persistManualRect(rect);
    showRectOverlay(rect, A1lib.mixColor(57, 210, 106), 3500, MANUAL_GROUP);
    statusEl.textContent = "Manual chat area saved. Watching chat...";
    return true;
  }

  function captureMouseAfterCountdown(label, seconds, done) {
    clearManualSelectionTimers();
    var remaining = seconds;
    var lastValidPos = null;

    manualPickInterval = setInterval(function () {
      var pos = getRsMousePos();
      if (pos) {
        lastValidPos = pos;
      }
    }, 100);

    function tick() {
      statusEl.textContent =
        "Manual select: hover " + label + " over the visible chat text area in RS3. Capturing in " + remaining + "...";

      if (remaining <= 0) {
        clearManualSelectionTimers();
        var pos = getRsMousePos() || lastValidPos;
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
    manualSelectionStart = null;

    captureMouseAfterCountdown("TOP-LEFT", 3, function (topLeft) {
      if (!topLeft) {
        setButtonsDisabled(false);
        statusEl.textContent = "Manual select failed: keep your mouse over the RS3 window during capture.";
        return;
      }

       manualSelectionStart = topLeft;
       showRectOverlay({ x: topLeft.x - 2, y: topLeft.y - 2, width: 4, height: 4 }, A1lib.mixColor(201, 166, 75), 3500, MANUAL_GROUP);

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
  btnManual.addEventListener("click", () => {
    startManualSelection();
  });

  btnClearManual.addEventListener("click", () => {
    clearManualSelectionTimers();
    manualSelectionStart = null;
    if (window.SoulChatReader) {
      window.SoulChatReader.clearManualRect();
    }
    resetVisibleMatches();
    persistManualRect(null);
    clearManualOverlay();
    statusEl.textContent = "Manual chat area cleared. Click Manual select to choose it again.";
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

  async function loadMessageTemplates() {
    if (templatesReady || templateLoadError) return;

    try {
      const entries = await Promise.all(
        Object.entries(TEMPLATE_PATHS).map(async ([type, url]) => {
          const image = await A1lib.imageDataFromUrl(new URL(url, window.location.href).href);
          return [type, image];
        })
      );

      messageTemplates = Object.fromEntries(entries);
      templatesReady = true;

      if (window.SoulChatReader && window.SoulChatReader.hasPosition()) {
        statusEl.textContent = "Watching chat... templates loaded.";
      }
    } catch (e) {
      templateLoadError = e;
      console.error("[SoulTracker] template load error:", e);
      statusEl.textContent = "Failed to load soul message templates.";
    }
  }

  function resetVisibleMatches() {
    Object.keys(visibleMatches).forEach((type) => {
      visibleMatches[type] = false;
    });
  }

  function detectSoulTemplates(rect) {
    if (!templatesReady || !messageTemplates || !rect) return [];

    var captured = A1lib.capture(rect.x, rect.y, rect.width, rect.height);
    if (!captured) return [];

    const detections = [];
    Object.entries(messageTemplates).forEach(([type, template]) => {
      const matches = captured.findSubimage(template);
      const found = matches && matches.length > 0;
      if (found && !visibleMatches[type]) {
        detections.push({ type: type, message: prettyMessage(type) });
      }
      visibleMatches[type] = found;
    });

    return detections;
  }

  // ---- Main scan loop
  let timer = null;
  function startLoop() {
    if (timer) clearInterval(timer);
    const scanMs = clampInt(scanMsEl.value, 100, 2000, 350);
    timer = setInterval(scanTick, scanMs);
  }

  // Kick off: restore the saved manual area if available, then start polling.
  if (inAlt1 && hasPixelPermission && window.SoulChatReader && window.SoulChatReader.isAvailable()) {
    if (state.manualRect && state.manualRect.x != null) {
      if (applyManualRect(state.manualRect)) {
        statusEl.textContent = "Using saved manual chat area. Watching chat...";
      }
    } else {
      statusEl.textContent = "Click Manual select to choose the visible RS3 chat area.";
    }
  }
  if (inAlt1 && hasPixelPermission) {
    loadMessageTemplates();
  }
  startLoop();

  function scanTick() {
    if (!inAlt1 || !hasPixelPermission) return;
    const reader = window.SoulChatReader;
    if (!reader || !reader.isAvailable()) return;

    if (!reader.hasPosition()) {
      statusEl.textContent = "Click Manual select to choose the visible RS3 chat area.";
      return;
    }

    if (!templatesReady) {
      if (!templateLoadError) {
        statusEl.textContent = "Loading soul message templates...";
      }
      return;
    }

    if (templateLoadError) {
      statusEl.textContent = "Failed to load soul message templates.";
      return;
    }

    const rect = reader.getPos();
    if (!rect) return;

    let detections;
    try {
      detections = detectSoulTemplates(rect);
      if (detections.length === 0) {
        const lines = reader.read() || [];
        detections = detectSoulsFromLines(lines);
      }
    } catch (e) {
      statusEl.textContent = "Chat scan error - reselect the chat area and try again.";
      console.error("[SoulTracker] template scan error:", e);
      return;
    }

    if (detections.length > 0) {
      statusEl.textContent = "Watching chat... (" + new Date().toLocaleTimeString() + ")";
    }

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
      var shownInOverlay = false;
      if (inAlt1) {
        shownInOverlay = showAlt1Overlay(det);
      }
      if (!shownInOverlay) {
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

  function detectSoulsFromLines(lines) {
    const out = [];
    for (const line of lines || []) {
      const normalized = normalizeLine(line && line.text ? line.text : "");
      const detections = detectSouls(normalized);
      for (const det of detections) {
        out.push(det);
      }
    }
    return uniqueBy(out, function (x) { return x.type; });
  }

  function detectSouls(normalizedText) {
    const compact = compactForDetection(normalizedText);
    if (!compact.includes("soul") || !compact.includes("nearby")) return [];

    const hasNearbyPhrase =
      compact.includes("appearsnearby") ||
      compact.includes("appearnearby") ||
      compact.includes("soulappearsnearby") ||
      compact.includes("soulappearnearby");

    if (!hasNearbyPhrase) return [];

    const out = [];
    const candidates = [
      { type: "lost", aliases: ["lost"] },
      { type: "mimicking", aliases: ["mimicking", "mimicling", "mlmicking"] },
      { type: "unstable", aliases: ["unstable", "unstabie"] },
      { type: "vengeful", aliases: ["vengeful", "vengefui"] },
    ];

    for (const c of candidates) {
      const matched = c.aliases.some((alias) =>
        compact.includes(alias + "soul") ||
        compact.includes("a" + alias + "soul") ||
        (compact.includes(alias) && compact.includes("soul"))
      );

      if (matched) {
        out.push({ type: c.type, message: prettyMessage(c.type) });
      }
    }

    return uniqueBy(out, function (x) { return x.type; });
  }

  // ---- Utilities

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

  function normalizeLine(s) {
    return (s || "")
      .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\u2019/g, "'")
      .trim();
  }

  function compactForDetection(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[|!]/g, "l")
      .replace(/1/g, "l")
      .replace(/0/g, "o")
      .replace(/5/g, "s")
      .replace(/[^a-z]/g, "");
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
