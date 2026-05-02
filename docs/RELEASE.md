# Release & Update Guide

This guide covers how to produce signed installers and publish updates that the in-app updater can consume.

## 1. Local unsigned build (default)

```bash
pnpm package:desktop
```

Runs `electron-builder --dir` with `mac.identity=null` and `publish=null`. Produces an unsigned `.app` (mac) / unpacked `dir` build under `apps/desktop/dist/`. Use for smoke tests only — auto-update will not work.

## 2. Signed beta release

```bash
WORKSPACE_RELEASE=1 pnpm package:desktop
# or
pnpm --filter @workspace/desktop release
```

This switches `electron-builder` to the production config in `apps/desktop/package.json`:

- mac: `dmg` + `zip` (arm64 + x64), hardened runtime, entitlements at `apps/desktop/build/entitlements.mac.plist`
- win: `nsis` (x64), per-user installer with directory choice
- linux: `AppImage`

To produce signed builds you must export the right env vars **before** running `release`:

### macOS

| Var | Purpose |
|---|---|
| `CSC_LINK` | Path or URL to a Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for the Apple ID |
| `APPLE_TEAM_ID` | Apple developer team ID |

`electron-builder` auto-notarizes when `APPLE_ID` is present. The hardened runtime is enabled in `mac.hardenedRuntime`; entitlements live in `build/entitlements.mac.plist` and grant Electron the JIT, library-validation bypass, and network client/server permissions it needs.

### Windows

| Var | Purpose |
|---|---|
| `CSC_LINK` | Path or URL to a code-signing `.pfx` |
| `CSC_KEY_PASSWORD` | Password for the `.pfx` |

For EV certs, follow electron-builder's docs on USB token signing.

## 3. Publish to GitHub Releases

Update artifacts are hosted on **GitHub Releases** for this repo (`no4jargon/Janus-Layer-0`). There is no separate update server to operate.

Two feeds are published per release; both are read by clients automatically with no env var configuration:

| Feed | Format | Consumer | Purpose |
|---|---|---|---|
| `latest-mac.yml` / `latest.yml` / `latest-linux.yml` | YAML (electron-updater convention) | `electron-updater` autoUpdater | Tells the app where to download the new installer (`.dmg` / `.exe` / `.AppImage`) and verifies SHA512 |
| `latest.json` | JSON (custom shape, see `packages/core/src/updater.ts`) | `createUpdateChecker` | Tells the app the latest version, **and** the minimum supported version for forced-update enforcement |

To cut a release and publish both feeds:

```bash
# Required: token with `contents: write` scope for the repo. If you have the
# `gh` CLI authenticated locally, you can bridge its stored auth instead of
# minting a separate PAT:
export GH_TOKEN=$(gh auth token)

# Optional: force users on older versions to update before they can keep using the app
export MIN_SUPPORTED_VERSION=0.2.0

WORKSPACE_RELEASE=1 WORKSPACE_PUBLISH=1 pnpm --filter @workspace/desktop release
```

Under the hood:

1. `electron-builder --publish=always` builds installers and uploads them + `latest-*.yml` to a draft GitHub release named `v<version>`. Requires `GH_TOKEN` (env var with `contents: write` scope) for publishing — `electron-builder` reads this env var directly and does **not** pick up `gh` CLI auth on its own, hence the `export GH_TOKEN=$(gh auth token)` line above.
2. `apps/desktop/electron/package.js` then writes `dist/latest.json` and runs `gh release upload v<version> latest.json --clobber` to attach it to the same release. If the `gh` CLI isn't installed, the script prints the manual command to run.
3. The release is created as a **draft** by default — you must publish it on GitHub before clients can see it.

Stable URLs once the release is published:

- Installers + electron-updater feed: `https://github.com/no4jargon/Janus-Layer-0/releases/latest`
- Forced-update feed: `https://github.com/no4jargon/Janus-Layer-0/releases/latest/download/latest.json`

The forced-update feed URL is hard-coded as the default in `apps/desktop/electron/main.js` (`DEFAULT_UPDATE_FEED_URL`). Override at runtime with `WORKSPACE_UPDATE_FEED_URL` for staging.

## 4. Required (forced) update enforcement

The `latest.json` feed exists in addition to electron-updater's `latest-*.yml` because electron-updater alone cannot express "users below version X are blocked from using the app until they upgrade." The JSON feed adds that.

### Default: every release forces every prior version to update

`apps/desktop/electron/package.js` defaults `minSupportedVersion` in the published `latest.json` to the release's own version. So on every release, anyone running a previous version sees the full-window Required Update screen on next launch — there is no bypass. This is the intended default for the current friends-and-family distribution.

### Opting out per release (no blocking, banner only)

To ship a release that should NOT block existing users, set `MIN_SUPPORTED_VERSION` to a version older than (or equal to) the oldest installed build you still support:

```bash
MIN_SUPPORTED_VERSION=0.1.0 WORKSPACE_RELEASE=1 WORKSPACE_PUBLISH=1 \
  pnpm --filter @workspace/desktop release
```

Result: anyone on `< 0.1.0` is still forced; anyone between `0.1.0` and (latest − 1) sees the optional sidebar banner; anyone on the latest is up-to-date.

Use the opt-out path for cosmetic fixes, non-breaking features, or anything where interrupting users would be disproportionate. Stay on the default (force everyone) for breaking DB migrations, security fixes, or connector/API contract changes that would make the old client misbehave.

### Required Update screen behavior

The desktop app is currently distributed unsigned, so in-app auto-update is not available — Apple blocks unsigned binaries from replacing themselves on macOS. The Required Update screen and the optional banner therefore link directly to the GitHub release for manual download:

1. App starts, fetches `latest.json` on boot (`bootstrap` → `runUpdateCheck`).
2. `decideUpdate` returns `kind: 'required'` because `currentVersion < minSupportedVersion`.
3. Renderer renders `RequiredUpdateScreen` instead of the workspace. **There is no bypass.**
4. User clicks **Download installer from GitHub** → opens the release page in the system browser.
5. User downloads the appropriate `.dmg` / `.exe` / `.AppImage`, installs over the existing app, and relaunches.
6. New version passes the `currentVersion >= minSupportedVersion` check and the workspace loads normally.

If/when the app is signed (see section 2), the in-app `electron-updater` flow can be re-enabled — the IPC handlers (`workspace:update:download` / `workspace:update:install`) and the autoUpdater wiring in `apps/desktop/electron/main.js` are intact and ready to be re-bound to UI buttons.

## 5. Optional update banner

When `decideUpdate` returns `kind: 'optional'`, a banner appears at the top of the sidebar with a Download / Install button and a Dismiss option. Same flow as above, but non-blocking.

## 6. Channel discipline

The plan calls for `dev` / `beta` / `stable` channels. For now the beta channel is the only one wired:

- `mac.publish.channel` and `createUpdateChecker`'s `channel` option default to `beta`.
- Override at release time with `WORKSPACE_RELEASE_CHANNEL` (used by `latest.json` generation).
- Don't move to `stable` until the updater has been exercised against real installs and the migration test harness has run cleanly across the previous N releases.
