# Local agent bridge

Chai v0.1.13 includes a bridge for trusted agents running on the same computer.
Launch Chai once, then open Settings → Local agent bridge to see its status,
endpoints, token-file path, and recent activity.

The defaults are `http://127.0.0.1:43124/mcp` (MCP Streamable HTTP) and
`http://127.0.0.1:43124/rpc` (JSON RPC). `GET /health` is an unauthenticated
liveness check; it does not prove Gmail or WhatsApp is connected. All message
and task operations require `Authorization: Bearer <token>` from the private
`agent-bridge.json` file. Read that file locally; do not paste its token into
chat, commit it, or include it in logs. The token authorizes every bridge tool.

## First local check

From the repository root, run:

```bash
python3 scripts/chai-notify.py status
```

To inspect the installed bridge without printing its token or message bodies:

```python
import json
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

token_file = Path.home() / "Library/Application Support/Chai/data/agent-bridge.json"
config = json.loads(token_file.read_text())
request = Request(
    "http://127.0.0.1:43124/mcp",
    data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode(),
    headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
             "Authorization": "Bearer " + config["token"]},
)
with build_opener(ProxyHandler({})).open(request) as response:
    tools = json.load(response)["result"]["tools"]
print([tool["name"] for tool in tools])
```

For a full MCP client, initialize the connection and send the returned protocol
version in `MCP-Protocol-Version` on subsequent requests. The server is
stateless and returns JSON responses; it does not require a session ID or an
SSE connection. Browser origins and non-local hosts are rejected.

On Windows the token is below `%APPDATA%\Chai\data`; on Linux it is below
`~/.config/Chai/data`. Settings shows the exact path on every platform.

## Tools and delivery

- Resolve contacts/groups, list conversations, and read mirrored messages.
- Send Gmail or WhatsApp messages with an explicit `clientRequestId`.
- Create response watches, list/pause/resume them, list pending tasks, and mark
  handled tasks completed. Tasks include the watch instructions and selected
  local context files. Chai never sends replies on its own.

Recipients must resolve unambiguously before sending begins. Reuse the same
request ID and unchanged content when investigating or retrying a notification;
do not create another ID for an uncertain attempt. A completed send requires a
provider message ID. It confirms provider submission, not device delivery or
read status. Check every recipient result even when the RPC envelope succeeds.

WhatsApp pairing and Gmail OAuth stay in the desktop UI. An agent cannot bypass
phone pairing. The [Notes notification helper](INVESTMENT_NOTIFICATIONS.md)
pins one exact-name group before any notification can be sent.

## Runtime and configuration

Closing the window keeps the bridge available. Quitting Chai or sleeping the
computer stops availability. Startup migrations add bridge audit/watch/task
tables while preserving existing messages and sessions. Restarting Chai
recovers watches and discovers mirrored messages; it does not run an external
agent or schedule investment collection.

Environment overrides: `CHAI_AGENT_BRIDGE_PORT`, `CHAI_AGENT_BRIDGE_HOST`
(loopback IP only), `CHAI_AGENT_BRIDGE_TOKEN`, and
`CHAI_AGENT_BRIDGE_DISABLED=1`. The effective token is stored with private file
permissions. No message bodies or bearer tokens are included in bridge
diagnostics metadata.
