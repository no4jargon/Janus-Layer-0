# Investment collection notifications through Chai

The investment collector can notify the user's WhatsApp group **Notes** when a
run needs mobile authentication. Chai is the local message transport; it does
not read iPhone SMS or collect investment balances.

## Installation and release distinction

Before the v0.1.13 publishing run on 2026-10-15, the latest published GitHub release was `v0.1.9`; `v0.1.10` and
`v0.1.11` were drafts. The published v0.1.9 code does not include the local agent
bridge. The v0.1.13 release adds it; v0.1.12 remains a superseded draft. Use a build that includes
`@chai/agent-bridge` for scripted notifications. Do not infer bridge availability
from an installer version alone.

The new pairing screen renders the QR locally. Builds using the external
`api.qrserver.com` image URL send the pairing payload to that service and should
not be used for this setup. The WhatsApp dependency is pinned to the patched
`7.0.0-rc12` release for this local build.

## Fresh local state

Quit Chai before resetting it. Reinstalling the app bundle alone preserves old
sessions. A complete local reset covers:

- `/Applications/Chai.app`
- `~/Applications/Chai.app`
- `~/Library/Application Support/Chai`
- `~/Library/Preferences/com.chai.app.plist`, if present
- `<repo>/.dev-data`, if present

Prefer moving existing state into a private timestamped backup instead of
irreversibly deleting it. Keep that backup closed; it contains old account
tokens and WhatsApp authentication keys. This resets the active local state but
does not revoke the old linked device on WhatsApp's servers.

On iPhone, open WhatsApp → Settings → Linked Devices and log out the old Chai
device, if present. In the fresh Chai installation, choose Connect WhatsApp,
then use Link a Device on the iPhone to scan the new QR. Pairing is manual.

## Configure the notification destination

Chai must be running on an awake Mac with WhatsApp paired. The local bridge
listens at `127.0.0.1:43124`; its token stays in
`~/Library/Application Support/Chai/data/agent-bridge.json`.

From the repository root:

```bash
python3 scripts/chai-notify.py status
python3 scripts/chai-notify.py configure --group Notes
python3 scripts/chai-notify.py send \
  --request-id investment-notifications-setup-test \
  --message 'Chai test: messages to Notes are working.'
```

Configuration must select exactly one exact-name WhatsApp group and pin its
`@g.us` identifier. It must not send to a partial name match or a direct chat.
The bearer token is read from Chai when needed, not copied into the destination
configuration or printed.

## Collector integration

When a collection run first enters the mobile-authentication waiting state,
send a notification such as:

> Investment snapshot needs mobile verification. Return to your Mac and open
> the collection panel when convenient.

Use a stable request ID based on the run and event, for example
`investment:<run-id>:mobile-verification`. Reuse it for retries. Request the bank
SMS only after the user continues the job at the Mac, so it does not expire
while they are away. Keep OTP entry in the local collection panel.

The notification adapter is a callable integration point. No investment
collector, quarterly schedule, bank login, or resume panel is created by this
Chai setup alone. A localhost link in a message opens the panel on the Mac;
on the iPhone, localhost refers to the phone.

## Delivery and recovery limits

- A healthy bridge does not prove the WhatsApp socket is connected.
- Inspect every nested send result, including the returned message ID; outer
  `ok: true` alone does not prove success.
- Chai's outbox retains request IDs, but a crash can leave an entry stuck in
  `sending`. A missing message ID must not be reported as successful delivery.
- Do not automatically retry a transport-uncertain send with a new request ID.
- A WhatsApp send result confirms submission through the connector, not that
  the iPhone displayed or the user read a notification.
- Closing Chai's window can leave the bridge running. Quitting Chai or sleeping
  the Mac stops transport availability; a logged-out session needs re-pairing.
- Keep the bridge bound to loopback. Its token permits more operations than
  sending to Notes; it is not a group-scoped credential.

Manual WhatsApp pairing and a live test message remain the final acceptance
checks for each new reset/install.
