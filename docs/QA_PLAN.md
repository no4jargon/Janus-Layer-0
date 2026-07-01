# Friends/Family QA Plan

Status: living document
Audience: people testing private beta builds; the maintainer running them.
Goal: every test below should be exercised on at least one macOS install **and** one Windows install before the build is shared.

## 0. Setup

- Tester downloads the platform installer (`.dmg` for macOS, `.exe` for Windows) from the private beta channel.
- Tester is on a network with outbound HTTPS (Google OAuth + Baileys + Ollama).
- A local Ollama instance is running (`ollama run llama3:8b`) if AI is being tested.

## 1. Install & first run

| # | Step | Expected | If broken |
|---|---|---|---|
| 1.1 | Install the package by double-clicking the installer | macOS: app drags into Applications; Windows: NSIS wizard completes | Capture the installer log |
| 1.2 | Launch the app | Onboarding modal appears titled "Welcome to Chai" | Diagnostics export → file a bug |
| 1.3 | Click **Get started** | Modal dismisses; main 3-pane workspace renders | Capture screenshot |
| 1.4 | Open Settings → Storage section | Data root path shows `~/Library/Application Support/Chai/data` (mac) or `%APPDATA%\Chai\data` (win) | Path mismatch = file a bug |

## 2. Connectors

### Gmail

| # | Step | Expected |
|---|---|---|
| 2.1 | Switch to Email tab → click **Connect Gmail** | System browser opens Google OAuth |
| 2.2 | Approve readonly + send scope | Browser shows "Gmail connected"; main window updates `email-sync` line to the user's email |
| 2.3 | Click **Sync now** | `Last sync …` timestamp appears within ~30s; recent threads populate the list |
| 2.4 | Open a thread → reply with "QA test reply" | Composer marks "Sending…", then "Queued for send."; thread refreshes |
| 2.5 | Toggle "Compose new email", send to `<personal>@gmail.com` | Receiving inbox shows the message |
| 2.6 | Click an attachment pill | Save dialog opens; chosen file is written and matches source |
| 2.7 | Click **Disconnect** | Email-sync line returns to "Email not connected"; threads disappear |

### WhatsApp

| # | Step | Expected |
|---|---|---|
| 2.8 | Switch to WhatsApp tab → click **Connect WhatsApp** | Sidebar shows QR image |
| 2.9 | Scan QR with phone (Linked Devices) | QR disappears; "WhatsApp connected" line; chats begin appearing |
| 2.10 | Wait 1 minute on a quiet account | Sidebar shows synced chats with last-message text + relative timestamp |
| 2.11 | Open a chat → send "QA test" | Message appears in thread on this device and on the phone |
| 2.12 | Send a message **to** the workspace from another device | New row appears in the open chat without manual refresh |
| 2.13 | Right-click cluster — N/A here | (not applicable in WhatsApp tab) |
| 2.14 | Click **Disconnect** | Session wiped, "WhatsApp disconnected" line shown; subsequent **Connect** issues a fresh QR |

## 3. Clusters

| # | Step | Expected |
|---|---|---|
| 3.1 | Cmd/Ctrl-click 2 chats in WhatsApp tab + 1 thread in Email tab | "3 selected (Shift-click range)" footer; **Create Cluster** enabled |
| 3.2 | Click **Create Cluster**, enter "QA Project" | Cluster appears in Clusters tab with random color dot |
| 3.3 | Right-click the cluster header → palette swatch | Color updates immediately |
| 3.4 | Right-click → **Rename…** → "QA Renamed" | Name updates everywhere |
| 3.5 | Right-click → **Delete cluster** | Member rows disappear from Clusters tab; selected items lose their cluster border in source tabs |
| 3.6 | Type `wipeclusters` anywhere in window | Confirm dialog → all clusters cleared |

## 4. AI insights

| # | Step | Expected |
|---|---|---|
| 4.1 | Create a cluster with at least 2 chats that have recent messages | Cluster created |
| 4.2 | In AI panel, pick the cluster + lookback `2h` | Cluster picker label updates |
| 4.3 | Click **For [cluster] over the last 2h** | Status: "Running on …"; output box fills with `TODO ITEMS` / `DEADLINES` etc. |
| 4.4 | Click **For all projects over the last 2h** | Progress bar advances 1/N → N/N; collated output renders |
| 4.5 | If Ollama is not running | Error in status line; no crash |

## 5. Settings

| # | Step | Expected |
|---|---|---|
| 5.1 | Open Settings → cycle Theme | Cycles through `system → dark → light → system` |
| 5.2 | Set Ollama Base URL `http://invalid:1` and run AI extraction | Status shows fetch error; URL persisted across restart |
| 5.3 | Clear Ollama overrides (leave blank) → save | Defaults back to `http://127.0.0.1:11434` / `llama3:8b` |
| 5.4 | Click **Export diagnostics** | Save dialog → JSON file written with `app`, `paths`, `schemaMigrations`, `connectors`, `logTail`, `backups` keys |
| 5.5 | Open the exported JSON in a text editor | No tokens, no message bodies present |

## 6. Updates

The app is distributed unsigned, so there is no in-app auto-update — the Required Update screen and optional banner both link to the GitHub Releases page for manual download.

By default the app reads the JSON feed from this repo's GitHub Releases (`https://github.com/no4jargon/Janus-Layer-0/releases/latest/download/latest.json`). To test against a staged feed without cutting a real release, host a `latest.json` somewhere reachable and launch the app with `CHAI_UPDATE_FEED_URL=<staged-url>`.

The default release flow forces every prior version to update (see `docs/RELEASE.md`). Section 6 covers both the forced and optional paths.

| # | Step | Expected |
|---|---|---|
| 6.1 | Stage a feed where `latestVersion = currentVersion` | Settings → **Check for updates** → "Up to date"; no banner; workspace loads normally |
| 6.2 | Stage a feed where `latestVersion > currentVersion` and `minSupportedVersion <= currentVersion` | Optional update banner appears at the top of the sidebar with the new version number, a **Download** link, and a **Dismiss** button |
| 6.3 | Click **Download** in the optional banner | System browser opens the GitHub release page (`/releases/tag/v<version>`); the app remains usable |
| 6.4 | Manually download the installer from GitHub, install over the running app, relaunch | New version launches; banner is gone; workspace loads normally |
| 6.5 | Stage a feed where `minSupportedVersion > currentVersion` | App opens directly into the full-window **Update required** screen on next launch; sidebar / thread / AI panel are inaccessible; only **Download installer from GitHub** is available |
| 6.6 | Click **Download installer from GitHub** on the required screen | System browser opens the release page; the desktop app stays on the blocking screen |
| 6.7 | Manually install the new build over the existing one, relaunch | New version launches; required screen is gone; workspace loads normally |
| 6.8 | While on the required screen, try to bypass via window menus / DevTools | No code path exits the screen short of installing the new version; verify by inspecting React tree / IPC calls |

Notes for testers:
- macOS: first launch of an unsigned build needs **right-click → Open** the first time, or `xattr -d com.apple.quarantine "/Applications/Chai.app"`. Document this in the release notes when you ship.
- Windows: first launch shows SmartScreen warning. Click **More info → Run anyway**.
- The blocking screen polls `latest.json` only on launch, so updating the feed mid-session does not unblock a running app — the user must relaunch (the same way they would after installing a new version).

## 7. Migration recovery

| # | Step | Expected |
|---|---|---|
| 7.1 | Manually corrupt `<data>/app.db` (e.g. `printf '0' >> app.db`) | App opens with "Database update needed" screen and a backup-file path |
| 7.2 | Restore the backup over `app.db` and click **Retry migration** | Workspace opens normally |

## 8. Diagnostics for bug reports

When filing a bug:

1. Reproduce the issue.
2. Open Settings → **Export diagnostics** → save JSON.
3. Attach the JSON to the bug report.
4. If the issue is sync-related, also attach the relevant section of `<data>/logs/app.log`.

## 9. Regressions to watch

Carry these over for every new build until they stay green ≥3 builds in a row:

- WhatsApp QR scan + first-history populate
- Gmail OAuth round-trip
- Cluster persistence across restart
- AI run-for-all completes with mixed cluster sizes
- Required-update screen blocks the workspace
- Migration runs cleanly + creates `backups/app-pre-migration-<ts>.db` before applying

## 10. Out of scope (v1)

- Multi-account WhatsApp / Gmail.
- Mobile companion.
- Encrypted cross-device sync.
- Channels other than Gmail + personal WhatsApp.
- Stable channel — beta only for now.
