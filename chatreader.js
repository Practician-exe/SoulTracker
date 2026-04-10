/**
 * chatreader.js
 *
 * Thin wrapper around the alt1 ChatBoxReader (from lib/a1lib-chatbox.js).
 * Exposes window.SoulChatReader with find/read/hasPosition helpers
 * used by app.js.
 *
 * Loading order requirement (index.html):
 *   1. lib/a1lib-base.js    → sets globalThis.A1lib
 *   2. lib/a1lib-ocr.js     → sets globalThis.OCR
 *   3. lib/a1lib-chatbox.js → sets globalThis.Chatbox
 *   4. chatreader.js        (this file)
 *   5. app.js
 */
(function () {
  "use strict";

  // The UMD chatbox bundle exports the class as Chatbox.default
  var ChatBoxReader =
    typeof Chatbox !== "undefined" && Chatbox && Chatbox.default
      ? Chatbox.default
      : null;

  // How many consecutive reads without any timestamp before we warn.
  var TIMESTAMP_WARNING_THRESHOLD = 5;
  var MAX_PROBE_CANDIDATES = 3;

  window.SoulChatReader = {
    /** @type {InstanceType<ChatBoxReader> | null} */
    _reader: null,
    /** Number of consecutive reads where no line had a timestamp. */
    _noTimestampStreak: 0,
    /** true once the chatbox position has been found */
    _found: false,

    /**
     * Returns true if the ChatBoxReader bundle loaded successfully.
     */
    isAvailable: function () {
      return ChatBoxReader !== null;
    },

    /**
     * Lazily creates the ChatBoxReader instance.
     * Safe to call multiple times.
     */
    _ensureReader: function () {
      if (!ChatBoxReader) return false;
      if (!this._reader) {
        this._reader = new ChatBoxReader();
      }
      return true;
    },

    /**
     * Scan the full RS3 window to locate the chatbox.
     * Must be called at least once (or whenever the chatbox moves / is not found).
     * Returns true if the chatbox was found.
     */
    find: function () {
      if (!this._ensureReader()) return false;
      // Do NOT catch here – let the caller handle errors so it can show the
      // correct message (e.g. "pixel capture not available – install the app").
      var result = this._reader.find();
      if (result && result.boxes && result.boxes.length > 1) {
        var best = this._pickBestMainbox(result);
        if (best) {
          result.mainbox = best;
          this._reader.pos.mainbox = best;
        }
      }
      this._found = result !== null && result !== undefined;
      if (this._found) {
        // Reset streak counter on successful find
        this._noTimestampStreak = 0;
      }
      return this._found;
    },

    _pickBestMainbox: function (pos) {
      if (!pos || !pos.boxes || !pos.boxes.length) return null;

      var ranked = pos.boxes
        .map(function (box, index) {
          return {
            box: box,
            score: this._scoreBoxHeuristically(box, index),
          };
        }, this)
        .sort(function (a, b) { return b.score - a.score; });

      var best = null;
      var bestScore = -Infinity;
      var limit = Math.min(ranked.length, MAX_PROBE_CANDIDATES);

      for (var i = 0; i < limit; i++) {
        var candidate = ranked[i];
        var totalScore = candidate.score + this._probeBox(candidate.box);
        if (totalScore > bestScore) {
          bestScore = totalScore;
          best = candidate.box;
        }
      }

      return best || pos.mainbox || ranked[0].box;
    },

    _scoreBoxHeuristically: function (box, index) {
      if (!box || !box.rect) return -Infinity;

      var rect = box.rect;
      var width = rect.width || 0;
      var height = rect.height || 0;
      var area = width * height;
      var y = rect.y || 0;
      var score = 0;

      if (box.type === "main") score += 1000000;
      if (box.leftfound) score += 150000;
      if (box.timestamp) score += 50000;

      score += Math.min(area, 250000);
      score += width * 250;
      score += height * 50;
      score += y * 25;
      score -= index;
      return score;
    },

    _probeBox: function (box) {
      if (!this._reader || !this._reader.pos || !box) return -Infinity;

      var reader = this._reader;
      var snapshot = {
        pos: reader.pos,
        overlaplines: reader.overlaplines ? reader.overlaplines.slice() : [],
        lastTimestamp: reader.lastTimestamp,
        lastTimestampUpdate: reader.lastTimestampUpdate,
        addedLastread: reader.addedLastread,
        font: reader.font,
        lastReadBuffer: reader.lastReadBuffer,
      };

      try {
        reader.pos.mainbox = box;
        reader.overlaplines = [];
        reader.lastTimestamp = -1;
        reader.lastTimestampUpdate = 0;
        reader.addedLastread = false;
        reader.font = null;

        var lines = reader.read() || [];
        var score = 0;

        for (var i = 0; i < lines.length; i++) {
          var text = lines[i] && lines[i].text ? lines[i].text.trim() : "";
          if (!text) continue;

          if (/^\[\d{2}:\d{2}:\d{2}\]/.test(text)) score += 400;
          if (/[a-z]{3,}/i.test(text)) score += 120;

          var stripped = text.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
          score += Math.min(stripped.length, 120);
        }

        return score;
      } catch (_e) {
        return -Infinity;
      } finally {
        reader.pos = snapshot.pos;
        reader.overlaplines = snapshot.overlaplines;
        reader.lastTimestamp = snapshot.lastTimestamp;
        reader.lastTimestampUpdate = snapshot.lastTimestampUpdate;
        reader.addedLastread = snapshot.addedLastread;
        reader.font = snapshot.font;
        reader.lastReadBuffer = snapshot.lastReadBuffer;
      }
    },

    /**
     * Returns true if the chatbox position is currently known.
     */
    hasPosition: function () {
      return this._found && !!(this._reader && this._reader.pos);
    },

    /**
     * Read new chat lines since the last read.
     * Returns an array of {text: string} objects, or null on error.
     * Each text entry may look like:
     *   "[12:34:56] A lost soul appears nearby."
     *
     * Also updates internal timestamp-streak counter so callers can
     * detect when RS3 timestamps are disabled.
     */
    read: function () {
      if (!this._reader || !this._reader.pos) return null;
      try {
        var lines = this._reader.read();
        if (!lines) return null;

        // Track whether we're seeing timestamps
        var sawTimestamp = false;
        for (var i = 0; i < lines.length; i++) {
          if (/^\[\d{2}:\d{2}:\d{2}\]/.test(lines[i].text)) {
            sawTimestamp = true;
            break;
          }
        }

        if (lines.length > 0) {
          if (sawTimestamp) {
            this._noTimestampStreak = 0;
          } else {
            this._noTimestampStreak++;
          }
        }

        return lines;
      } catch (e) {
        console.error("[SoulChatReader] read() error:", e);
        return null;
      }
    },

    /**
     * Returns true if the recent reads suggest timestamps are disabled in RS3.
     */
    timestampsLikelyDisabled: function () {
      return this._noTimestampStreak >= TIMESTAMP_WARNING_THRESHOLD;
    },

    /**
     * Returns the bounding rect of the main chatbox after a successful find(),
     * as a plain {x, y, width, height} object suitable for drawing an overlay.
     * Returns null if no position is known.
     *
     * The underlying ChatBoxReader stores pos as { mainbox: { rect: Rect, ... }, boxes: [] },
     * so we unwrap to mainbox.rect here.
     */
    getPos: function () {
      if (!this._reader || !this._reader.pos) return null;
      var p = this._reader.pos;
      if (p.mainbox && p.mainbox.rect) {
        return p.mainbox.rect;
      }
      // Fallback: if the library ever returns a flat rect directly
      return (typeof p === "object" && p.x != null) ? p : null;
    },

    /**
     * Reset internal state (useful when refreshing detection).
     */
    reset: function () {
      this._found = false;
      this._noTimestampStreak = 0;
      if (this._reader) {
        this._reader.pos = null;
        this._reader.overlaplines = [];
        this._reader.lastTimestamp = -1;
        this._reader.font = null;
      }
    },
  };
})();
