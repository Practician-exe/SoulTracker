# RS3 Soul Tracker

Alt1 app for RuneScape 3 that watches a manually selected chat area and alerts when it sees nearby soul.

## Quick Start

1. Install [Alt1 Toolkit](https://runeapps.org/alt1).
2. Copy & Paste the following to add this app in Alt 1.
```
alt1://addapp/https://practician-exe.github.io/SoulTracker/appconfig.json
```
4. Open RS3 and make sure the relevant chat is visible.
5. Click `Drag select` and draw a box around the visible chat text area.
6. Leave the app open while playing.

## How It Works

- The app captures the selected part of the RS3 window.
- It looks for the soul messages using template matching against the provided message images.
- If template matching does not hit, it falls back to OCR-based text matching.
- Each soul type has its own cooldown to prevent repeat spam.

## Recommended RS3 Settings

- Chat timestamps: On
- Chatbox visible and not collapsed
- Keep the selected chat area in the same on-screen position after saving

Timestamps help the OCR fallback deduplicate lines more reliably.

## Controls

| Control | Purpose |
|---------|---------|
| `Drag select` | Capture the RS3 window and draw a box around the visible chat text area. |
| `Clear manual` | Remove the saved chat selection. |
| `Test alert` | Trigger a sample alert so you can verify the sound and alert card. |
| `Cooldown (seconds)` | Minimum delay before the same soul type can alert again. |
| `Scan interval (ms)` | How often the app scans the selected area. Lower is faster, higher uses less CPU. |
| `Sound` | Enable or disable alert audio. |
| `Volume` | Set alert audio volume. |

## Detected Messages

| Soul type | Message |
|-----------|---------|
| Lost | `A lost soul appears nearby.` |
| Mimicking | `A mimicking soul appears nearby. Corner them before they get away.` |
| Unstable | `An unstable soul appears nearby.` |
| Vengeful | `A vengeful soul appears nearby! Avoid it until it realises you're not the intended target.` |

## Files

```text
index.html                      app UI
app.js                          detection loop and app behavior
chatreader.js                   chat reader wrapper and manual area state
theme.css                       app styling
appconfig.json                  Alt1 app metadata
templates/                      message templates used for matching
lib/a1lib-base.js               Alt1 base library
lib/a1lib-ocr.js                Alt1 OCR library
lib/a1lib-chatbox.js            Alt1 chatbox reader library
```

## Notes

- This app is built for Alt 1
- If detection stops working after moving your interface, run `Drag select` again.

## Credit

- Full credit to Codex & GitHub. This was made almost entirely using AI after having an idea. - Husbulla
