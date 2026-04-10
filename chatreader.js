/**
 * chatreader.js
 *
 * Thin wrapper around the Alt1 ChatBoxReader (from lib/a1lib-chatbox.js).
 * Exposes window.SoulChatReader with find/read/hasPosition helpers
 * used by app.js.
 */
(function () {
  "use strict";

  var ChatBoxReader =
    typeof Chatbox !== "undefined" && Chatbox && Chatbox.default
      ? Chatbox.default
      : null;

  var TIMESTAMP_WARNING_THRESHOLD = 5;
  var MAX_PROBE_CANDIDATES = 3;

  window.SoulChatReader = {
    _reader: null,
    _noTimestampStreak: 0,
    _found: false,
    _manualRect: null,

    isAvailable: function () {
      return ChatBoxReader !== null;
    },

    _ensureReader: function () {
      if (!ChatBoxReader) return false;
      if (!this._reader) {
        this._reader = new ChatBoxReader();
      }
      return true;
    },

    _makeManualPos: function (rect) {
      return {
        mainbox: {
          rect: rect,
          leftfound: true,
          line0x: 0,
          line0y: rect.height - 12,
          timestamp: false,
          type: "main",
        },
        boxes: [],
      };
    },

    find: function () {
      if (!this._ensureReader()) return false;

      if (this._manualRect) {
        this._reader.pos = this._makeManualPos(this._manualRect);
        this._found = true;
        this._noTimestampStreak = 0;
        return true;
      }

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

    hasPosition: function () {
      return this._found && !!(this._reader && this._reader.pos);
    },

    hasManualRect: function () {
      return !!this._manualRect;
    },

    setManualRect: function (rect) {
      if (!this._ensureReader()) return false;
      if (!rect || rect.x == null || rect.y == null || rect.width == null || rect.height == null) {
        return false;
      }

      this._manualRect = {
        x: rect.x | 0,
        y: rect.y | 0,
        width: rect.width | 0,
        height: rect.height | 0,
      };

      this._reader.pos = this._makeManualPos(this._manualRect);
      this._reader.overlaplines = [];
      this._reader.lastTimestamp = -1;
      this._reader.lastTimestampUpdate = 0;
      this._reader.addedLastread = false;
      this._reader.font = null;
      this._found = true;
      this._noTimestampStreak = 0;
      return true;
    },

    clearManualRect: function () {
      this._manualRect = null;
      this.reset();
    },

    read: function () {
      if (!this._reader || !this._reader.pos) return null;
      try {
        var lines = this._reader.read();
        if (!lines) return null;

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

    timestampsLikelyDisabled: function () {
      return this._noTimestampStreak >= TIMESTAMP_WARNING_THRESHOLD;
    },

    getPos: function () {
      if (this._manualRect) return this._manualRect;
      if (!this._reader || !this._reader.pos) return null;
      var p = this._reader.pos;
      if (p.mainbox && p.mainbox.rect) {
        return p.mainbox.rect;
      }
      return typeof p === "object" && p.x != null ? p : null;
    },

    reset: function () {
      this._found = false;
      this._noTimestampStreak = 0;
      if (this._reader) {
        this._reader.pos = this._manualRect ? this._makeManualPos(this._manualRect) : null;
        this._reader.overlaplines = [];
        this._reader.lastTimestamp = -1;
        this._reader.font = null;
      }
      if (this._manualRect && this._reader) {
        this._found = true;
      }
    },
  };
})();
