# Mac M2 Fleet Setup — v1 Worker Hosts

> **Audience:** Anuj, doing the manual prep on the 2 spare Mac M2 machines that will host the `chai-worker` daemon for opted-in users. Do this **before** Phase 3 lands (`apps/server` + `apps/worker` skeletons). Phases 1–2 are pure code refactors and don't need the Macs.

## Context

These 2 Macs will be the v1 deployment target for the worker fleet described in `~/.claude/plans/eager-snuggling-nest.md` (and eventually in `docs/MOBILE_PWA.md`). They host Baileys WhatsApp sessions and on-device LLM inference for opted-in users. The control plane lives in Cloudflare (not on these Macs). The Macs connect outbound via Cloudflare Tunnel — they never need a public IP.

Migration target later: Linux containers when fleet capacity strains. The `chai-worker` binary stays Linux-portable from day one; these Macs are a launch platform, not a long-term commitment.

## Decisions already made (don't re-litigate)

- Both Macs in the same physical location (single failure domain accepted for v1; second location needed before B2B).
- Keep Mac fleet small — migrate to Linux containers at first sign of capacity strain.
- Cloudflare Tunnel for the outbound connection (not Tailscale Funnel; not self-hosted).
- Tailscale separately as the sysadmin SSH backdoor.

## Physical / power

1. **UPS per Mac** — CyberPower CP1500AVR or equivalent (~$130). Plug Mac + ethernet switch + modem all into the UPS. Without this, a momentary power blip drops every active WhatsApp session.
2. **Wired ethernet, not WiFi.** WiFi reconnects flap silently for 5–30s during AP roams and kill tunnels. Run a cable.
3. **Ventilation.** Mac Minis run cool, but if stacked, leave ~2cm gap or use a vented shelf. Sustained LLM inference can thermal-throttle in a sealed enclosure.
4. **Physical labels.** Sticker each Mac with hostname, MAC address, serial, location, purchase date. Future you debugging at 4am will thank you.

## macOS configuration

Run on each Mac (SSH or local terminal):

```bash
# Identity — pick distinct hostnames per Mac
sudo scutil --set HostName mac-worker-01
sudo scutil --set LocalHostName mac-worker-01
sudo scutil --set ComputerName mac-worker-01

# Power: never sleep, auto-restart after power loss, display can still sleep
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a powernap 0
sudo pmset -a hibernatemode 0
sudo pmset -a autorestart 1
sudo pmset -a displaysleep 10

# Verify
pmset -g
```

In **System Settings** on each Mac:

- **General → Sharing → Remote Login**: ON. After verifying SSH-by-key works (see Pre-flight Test), edit `/etc/ssh/sshd_config` to disable password auth (`PasswordAuthentication no`, `ChallengeResponseAuthentication no`) and `sudo launchctl kickstart -k system/com.openssh.sshd`.
- **Users & Groups → Auto-login**: ON for the worker user. Required so the Mac fully boots into a usable state after `autorestart` — without auto-login, the Mac sits at the login screen and `launchd` jobs never start.
- **General → Software Update → Automatic Updates**: turn OFF "Install macOS updates" (random restarts). Keep ON "Install Security Responses and system files". Major macOS updates happen manually, one Mac at a time, with users drained off it.
- **Lock Screen**: "Require password after screen saver" → Never. "Start Screen Saver when inactive" → Never.
- **Spotlight → Search Privacy**: add `/usr/local/var/chai-worker` once it exists (saves CPU on every message write).

### FileVault decision

- *On* = encrypted at rest, but blocks `pmset -a autorestart 1` from working after unplanned power loss without `fdesetup authrestart` set up beforehand.
- *Off* = autorestart "just works" after power loss, but disk is unencrypted.

**Recommendation: FileVault ON.** These Macs will hold users' WhatsApp encryption keys. Unencrypted disk is a worse risk than slightly worse unplanned-power-loss recovery. Set up `fdesetup authrestart` before any planned reboot; for unplanned outages, you'll need to manually unlock via SSH from another machine (acceptable for v1 scale).

## Networking

5. **DHCP reservation** for each Mac on your router → stable internal IP per Mac. Makes debugging much easier.
6. **Outbound 443 unblocked** on your firewall (Cloudflare Tunnel needs this). Almost always fine on home/office ISPs.
7. **Check upload bandwidth.** Steady-state per active user is small (~5–50 KB/s for WhatsApp text + extraction results). One-time bootstrap upload during a user's opt-in pushes 10–200 MB. Confirm your link can sustain it without saturating.
8. **Tailscale on each Mac** (`brew install --cask tailscale`) — separate from Cloudflare Tunnel. This is *your* sysadmin SSH backdoor for getting into the Macs from anywhere without exposing any ports. Free for personal use up to 100 devices.

## Software prereqs

Run on each Mac as the worker user:

```bash
# Xcode Command Line Tools (needed for node-llama-cpp Metal compilation)
xcode-select --install

# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node via mise (cleaner than nvm for launchd-managed processes)
brew install mise
mise use --global node@20

# Cloudflare Tunnel client
brew install cloudflared

# System monitoring (small menubar widget showing CPU/RAM/network)
brew install --cask stats
```

**Do NOT install the `chai-worker` binary yet — it doesn't exist.** The Phase 3/7 worker installer will fetch the model and wire up `launchd`. This step gets you to "the moment we have the worker binary, it deploys in 10 minutes per Mac."

## User account

9. **Dedicated `chai` user** on each Mac, member of `staff` only (NOT admin). The worker daemon runs under this user. Keep a separate admin user for system maintenance.
10. **Worker data directory:**
    ```bash
    sudo mkdir -p /usr/local/var/chai-worker
    sudo chown chai:staff /usr/local/var/chai-worker
    ```
    The worker will write session blobs, model files, and logs here.

## Pre-flight test (do this before declaring a Mac ready)

For each Mac, verify in this order:

1. **SSH by key works.** From your laptop: `ssh chai@<mac-internal-ip>` succeeds. Password auth refused (`PasswordAuthentication no`).
2. **Auto-restart works.** Unplug Mac's power for 30 seconds → plug back in. Mac auto-boots, auto-logs-in, SSH reachable within ~2 minutes. (Note: with FileVault on, you'll need to `fdesetup authrestart` first or unlock from another machine.)
3. **No sleep overnight.** Close lid (skip if Mini), let it sit overnight without interaction. Next morning, `uptime` shows no reboot.
4. **Cloudflared installed cleanly.** `cloudflared tunnel --help` runs.
5. **Node 20 under chai user.** `sudo -u chai node --version` shows v20.x.
6. **Tailscale reach from off-network.** From your laptop on a different network (coffee shop, phone tether), `ping <mac-tailscale-ip>` succeeds.

Only after **all 6 pass** is the Mac "ready". Don't skip — debugging worker-deploy issues later is much harder if the underlying Mac has a flaky network jack or sleep bug.

## Documentation

11. **Worker inventory.** Maintain a private note (1Password / private repo) with: hostname, serial, internal IP, Tailscale IP, location, UPS model, purchase date, macOS version. Update on every change.
12. **macOS version pinning.** Write down each Mac's macOS version. Don't let one auto-update to a new major version without testing `node-llama-cpp` Metal performance on it first; point releases can regress.

## Cost summary (per Mac, year 1)

- Mac Mini M2 8GB: ~$600 (one-time, amortize over 3 years → ~$17/mo)
- CyberPower CP1500AVR UPS: ~$130 (one-time)
- Power: ~$5/mo
- Internet: assume sunk cost
- Cloudflare Tunnel: $0
- Tailscale (free tier): $0

Break-even vs Fly.io shared-1x at $5/mo/user: ~5 active users per Mac.

## What you don't need to do yet

- Install Node modules / `node-llama-cpp` — done by the Phase 3/7 worker installer.
- Download Gemma 3 4B GGUF model — installer fetches from R2.
- Configure Cloudflare Tunnel credentials — generated per-worker in Phase 3.
- Set up `launchd` plists — shipped by the worker installer in Phase 9.
- Decide on model upgrade path — Phase 9 operator runbook question.

## Migration triggers (numerical, so you don't panic-migrate)

When any of these tips for 3 consecutive days, start the Linux migration:

| Signal | Threshold |
|---|---|
| Worker queue p95 extraction latency | > 30s sustained for 1 hour |
| Worker memory pressure | > 80% for > 1 hour/day on any Mac |
| Baileys reconnect rate | > 1/hour/user on any worker |
| Active users per Mac | > 150 |

Gives you ~2–4 weeks of runway before things actually break.
