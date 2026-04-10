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
      try {
        var result = this._reader.find();
        this._found = result !== null;
        if (this._found) {
          // Reset streak counter on successful find
          this._noTimestampStreak = 0;
        }
        return this._found;
      } catch (e) {
        console.error("[SoulChatReader] find() error:", e);
        this._found = false;
        return false;
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
     * Returns the raw position object from the underlying ChatBoxReader after a
     * successful find(). The exact shape is library-internal, but it typically
     * exposes x, y, width, height so callers can draw a calibration overlay.
     * Returns null if no position is known.
     */
    getPos: function () {
      if (!this._reader || !this._reader.pos) return null;
      var p = this._reader.pos;
      // pos may be a rect-like object or a more complex structure.
      // Return it as-is for the caller to inspect.
      return typeof p === "object" ? p : null;
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
