# RS3 Soul Tracker — Alt1 Plugin

Automatically detects **lost / mimicking / unstable / vengeful** soul messages in the RS3 chatbox and fires a visual toast + sound alert with a configurable cooldown.

## Quick start

1. Install [Alt1 Toolkit](https://runeapps.org/alt1).
2. Open Alt1 → **Add app** → paste this URL (or the GitHub Pages / localhost URL of the plugin).
3. In RuneScape 3, make sure the chatbox is visible.
4. The plugin auto-detects the chatbox on load; click **Refresh chat detection** if it says "not found".

## Required RS3 settings

| Setting | Value | Why |
|---------|-------|-----|
| **Chat timestamps** | **On** | The ChatBoxReader uses `[HH:MM:SS]` timestamps to deduplicate lines and avoid re-alerting on the same message. Without them the plugin may still work but will warn you. |
| Interface mode | Resizeable / Legacy | Both are supported; the chatbox auto-finder handles either. |
| Chatbox visible | Yes (not collapsed) | The plugin reads pixels — the chat area must be on-screen. |

### Enabling timestamps

`Chat box → right-click chat tabs → Chat Settings → Timestamp: On`

## Permissions needed (Alt1)

- **Screen pixel capture** — used by the ChatBoxReader to locate the chatbox and read text.
- Alt1 grants these automatically to apps added through the toolkit; no extra steps needed.

## Detected messages

| Soul type | Message |
|-----------|---------|
| Lost | "A lost soul appears nearby." |
| Mimicking | "A mimicking soul appears nearby. Corner them before they get away." |
| Unstable | "An unstable soul appears nearby." |
| Vengeful | "A vengeful soul appears nearby! Avoid it until it realises you're not the intended target …" |

## Cooldown

Each soul type has an independent 30-second cooldown by default (configurable in the panel).  This prevents spam if the same message scrolls through chat multiple times.

## Controls

| Control | Purpose |
|---------|---------|
| **Refresh chat detection** | Re-runs the chatbox finder. Use if you moved/resized the chatbox or the plugin shows "not found". |
| **Test alert** | Fires a simulated mimicking-soul alert so you can verify sound and toast work. |
| Cooldown (s) | Seconds between repeated alerts for the **same** soul type. |
| Scan interval (ms) | How often the plugin polls the chatbox (lower = faster response, higher = less CPU). |
| Sound / Visual toast | Toggle each alert type independently. |

## Files

```
index.html                     — plugin UI
app.js                         — main detection logic
chatreader.js                  — ChatBoxReader wrapper (SoulChatReader)
theme.css                      — RS3-themed styles
appconfig.json                 — Alt1 metadata
soul_detected_check_your_rs.mp3 — alert sound
lib/
  a1lib-base.js                — @alt1/base UMD bundle (screen capture)
  a1lib-ocr.js                 — @alt1/ocr UMD bundle (font OCR)
  a1lib-chatbox.js             — @alt1/chatbox UMD bundle (ChatBoxReader)
```

## Credits

Chat detection powered by [alt1 / a1lib](https://github.com/skillbert22/alt1-electron) by skillbert22.
