# README screenshots

These are captures of the real React renderer in `packages/ui`, using fictional
clients, messages, and illustrative AI responses from `demo-data.mjs`. They are
UI demonstrations, not connector or model-quality acceptance results.

The capture uses a separate browser context with an in-memory `window.chaiApi`.
It does not launch Electron, read the user's app database, connect accounts,
download a model, or send messages. Both send methods throw. Requests outside
the local renderer origin are blocked and make the capture fail. The clock is
fixed at 19 October 2026, 10:30 IST. Textarea outputs are expanded using their
native resize handles; settings and onboarding details are cropped for clarity.

## Recreate

From the repository root, install the workspace dependencies and start only the
renderer:

```bash
pnpm install
pnpm --filter @chai/ai-prompts build
pnpm --filter @chai/ui dev --host 127.0.0.1 --port 4178 --strictPort
```

In a second terminal, use an available Playwright installation, or install it
outside the repository:

```bash
npm install --prefix /tmp/chai-readme-tools playwright
/tmp/chai-readme-tools/node_modules/.bin/playwright install chromium
CHAI_PLAYWRIGHT_MODULE=/tmp/chai-readme-tools/node_modules/playwright/index.mjs node docs/screenshots/capture.mjs
```

If `playwright` already resolves from the project, run
`node docs/screenshots/capture.mjs` directly. Optional overrides:

- `CHAI_SCREENSHOT_URL`: loopback renderer URL, default `http://127.0.0.1:4178`.
- `CHAI_PLAYWRIGHT_MODULE`: absolute path to an installed Playwright module.
- `CHAI_CHROMIUM_PATH`: absolute path to an existing compatible Chromium binary.

The script replaces the eight numbered PNGs in this folder. It waits for the
real UI actions to complete and rejects renderer errors or external requests.
Review each image and the main README after refreshing captures. Keep fixture
data and the displayed version consistent with the app being documented.
