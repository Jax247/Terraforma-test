---
name: verify
description: Build/launch/drive recipe for verifying Terraforma tester changes end-to-end (Vite + React hotseat GUI).
---

# Verifying Terraforma changes

## Launch

```bash
npm run dev > /tmp/vite.log 2>&1 &   # Vite; picks 5174 if 5173 busy — read the log for the port
```

No system Chrome on this machine. Use Playwright's own Chromium:

```bash
# in a scratch dir (NOT the repo — keeps playwright out of package.json):
npm init -y && npm install playwright
npx playwright install chromium      # cache: ~/Library/Caches/ms-playwright
```

Launch with the FULL chromium channel — the default headless-shell binary may be missing:

```js
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
```

## Drive

- Setup screen: `.setup`, two `.setup-col` panels (Human/AI toggle buttons per seat; "AI knowledge" panel appears when any seat is AI), `button.start`.
- Game: `.board`, `.statusline .big` shows `P<n> · <leader>`, `End turn` button, `.log` for the engine log.
- AI: topbar has per-seat `label.ai-toggle` checkboxes and a `🤖 P<n> is playing…` indicator while an AI seat acts (one action per 350 ms).
- Wait for AI handback with `waitForFunction(() => !document.body.textContent.includes('is playing'))`.

## Gotchas

- Plain unit moves produce NO log line — watch the board, not the log, for movement.
- `/favicon.ico` 404s in the console (pre-existing; harmless).
- Engine/AI behavior is better verified via vitest (fuzz, self-play suites); reserve browser driving for UI flows.
- Shut down YOUR dev server by PID (`kill %1` or note the PID at launch) — `pkill -f vite` also kills the user's own dev server on 5173.
