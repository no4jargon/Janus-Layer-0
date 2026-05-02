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

## 3. Publish to the update feed

The in-app updater reads `WORKSPACE_UPDATE_FEED_URL` (env or `.env`) to find the release feed.

```jsonc
// example feed JSON used by @workspace/core's createUpdateChecker
{
  "latestVersion": "0.2.1",
  "minSupportedVersion": "0.2.0",
  "channel": "beta",
  "releasedAt": "2026-05-12T18:30:00Z",
  "downloadUrl": "https://updates.example.com/workspace-app/beta/Workspace-App-0.2.1-arm64.dmg",
  "releaseNotesUrl": "https://github.com/.../releases/tag/v0.2.1"
}
```

Independently, `electron-updater` reads `latest-mac.yml` / `latest.yml` / `latest-linux.yml` from the same `publish.url` configured in `apps/desktop/package.json`. To upload everything in one shot:

```bash
WORKSPACE_RELEASE=1 WORKSPACE_PUBLISH=1 pnpm --filter @workspace/desktop release
```

This passes `--publish=always` to electron-builder, which uploads installers + the appropriate `latest-*.yml` to the configured generic provider URL.

You're responsible for hosting both the `latest-*.yml` (electron-updater feed) and the JSON metadata feed (`createUpdateChecker`). They can live at the same URL prefix; the JSON feed enables required-update enforcement (the `minSupportedVersion` field), which electron-updater alone can't express.

## 4. Required update enforcement

When `decideUpdate` returns `kind: 'required'` (i.e. local version is below `minSupportedVersion` from the JSON feed), the renderer renders `RequiredUpdateScreen` instead of the workspace. Users can:

1. Click **Download update** — main calls `autoUpdater.checkForUpdates()` then `autoUpdater.downloadUpdate()`.
2. Watch download progress via the `workspace:update:event` channel.
3. Click **Install & restart** — main calls `autoUpdater.quitAndInstall()`.

The screen is full-window and there is no way to bypass it.

## 5. Optional update banner

When `decideUpdate` returns `kind: 'optional'`, a banner appears at the top of the sidebar with a Download / Install button and a Dismiss option. Same flow as above, but non-blocking.

## 6. Channel discipline

The plan calls for `dev` / `beta` / `stable` channels. For now the beta channel is the only one wired:

- `mac.publish.channel`, `WORKSPACE_UPDATE_FEED_URL`, and `createUpdateChecker`'s `channel` option default to `beta`.
- Don't move to `stable` until the updater has been exercised against real installs and the migration test harness has run cleanly across the previous N releases.
