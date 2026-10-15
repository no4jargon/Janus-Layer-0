#!/usr/bin/env python3
"""Send explicit WhatsApp notifications through a running local Chai app.

  python3 scripts/chai-notify.py status
  python3 scripts/chai-notify.py configure --group Notes
  python3 scripts/chai-notify.py send --message "Verification is ready" --request-id run-123

Configuration pins a group JID, not a bearer token. Chai must be running and paired.
A successful send means Chai returned a WhatsApp message ID, not phone delivery.
No command retries a send automatically. Keep its request ID when investigating
an uncertain result; do not issue a fresh ID for the same notification.
"""

import argparse
from datetime import datetime, timezone
from http.client import HTTPException
import ipaddress
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


CONFIG_PATH = Path.home() / ".config/chai-notify/config.json"
TOKEN_PATH = Path.home() / "Library/Application Support/Chai/data/agent-bridge.json"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 43124
AGENT_ID = "chai-notify"
GROUP_JID = re.compile(r"^[0-9]+(?:-[0-9]+)?@g\.us$")


class NotifyError(Exception):
    def __init__(self, message, *, uncertain=False):
        super().__init__(message)
        self.uncertain = uncertain


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_json(path, description):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise NotifyError(f"Cannot read {description}.") from None
    if not isinstance(value, dict):
        raise NotifyError(f"Invalid {description}.")
    return value


def is_group_jid(value):
    return isinstance(value, str) and GROUP_JID.fullmatch(value) is not None


class BridgeClient:
    def __init__(self, token_path=TOKEN_PATH):
        self.token_path = token_path
        # Never pass local bearer credentials through a system proxy or redirect.
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def connection(self, require_token):
        if not require_token and not self.token_path.exists():
            return f"http://{DEFAULT_HOST}:{DEFAULT_PORT}", None
        data = read_json(self.token_path, "Chai bridge token file; launch Chai first")
        host = data.get("host", DEFAULT_HOST)
        if host == "localhost":
            host = DEFAULT_HOST
        try:
            if not isinstance(host, str):
                raise ValueError("host must be a string")
            address = ipaddress.ip_address(host)
            valid_host = address.is_loopback
        except ValueError:
            valid_host = False
        port = data.get("port", DEFAULT_PORT)
        if (not valid_host or type(port) is not int or not 1 <= port <= 65535):
            raise NotifyError("Chai bridge must use a loopback IP and valid port.")
        token = data.get("token")
        if require_token and (not isinstance(token, str) or not token.strip()):
            raise NotifyError("Chai bridge token is missing; restart Chai.")
        url_host = f"[{host}]" if address.version == 6 else host
        return f"http://{url_host}:{port}", token

    def request(self, route, payload=None, *, sending=False):
        # Read the token for every call; never persist a copy in notification config.
        base_url, token = self.connection(require_token=payload is not None)
        headers = {"Accept": "application/json"}
        body = None
        if payload is not None:
            headers.update({"Authorization": f"Bearer {token}",
                            "Content-Type": "application/json"})
            body = json.dumps(payload).encode("utf-8")
        request = Request(base_url + route, data=body, headers=headers)
        try:
            with self.opener.open(request, timeout=15 if sending else 5) as response:
                raw = response.read(1_048_577)
            if len(raw) > 1_048_576:
                raise ValueError("response too large")
            result = json.loads(raw)
        except HTTPError as error:
            # Suppress response bodies and headers: neither is needed in logs.
            # RPC may fail after its connector submitted the message (including
            # HTTP 400). Only authentication/routing failures prove no dispatch.
            raise NotifyError(f"Chai bridge returned HTTP {error.code}.",
                              uncertain=sending and error.code not in
                              {401, 403, 404, 405}) from None
        except (HTTPException, URLError, OSError, ValueError):
            raise NotifyError("Chai bridge is unavailable or returned an invalid response.",
                              uncertain=sending) from None
        if not isinstance(result, dict):
            raise NotifyError("Invalid Chai bridge response.", uncertain=sending)
        return result

    def health(self):
        result = self.request("/health")
        if result.get("ok") is not True or result.get("service") != "chai-agent-bridge":
            raise NotifyError("The local service is not a healthy Chai agent bridge.")
        return {"ok": True, "service": "chai-agent-bridge", "running": True}

    def rpc(self, method, params):
        sending = method == "send_message"
        envelope = self.request("/rpc", {"method": method, "params": params},
                                sending=sending)
        if envelope.get("ok") is not True or not isinstance(envelope.get("result"), dict):
            raise NotifyError("Chai bridge rejected the RPC request.", uncertain=sending)
        return envelope["result"]


def select_group(result, group):
    if result.get("ok") is not True or not isinstance(result.get("candidates"), list):
        raise NotifyError("Chai could not resolve the requested group.")
    # Exact label matching deliberately excludes substring matches and named contacts.
    matches = {candidate["address"]: candidate for candidate in result["candidates"]
               if isinstance(candidate, dict)
               and candidate.get("channel") == "whatsapp"
               and isinstance(candidate.get("label"), str)
               and candidate.get("label", "").strip() == group
               and candidate.get("match") == "exact"
               and is_group_jid(candidate.get("address"))}
    if not matches:
        raise NotifyError(f"No exact WhatsApp group named {group!r}; pair and sync Chai first.")
    if len(matches) != 1:
        raise NotifyError(f"Multiple WhatsApp groups named {group!r}; refusing to choose.")
    return next(iter(matches))


def write_config(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".config-", dir=path.parent)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2)
            output.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def configure(client, group, path=CONFIG_PATH):
    group = group.strip()
    if not group:
        raise NotifyError("Group name cannot be empty.")
    result = client.rpc("resolve_person", {"query": group, "channel": "whatsapp",
                                          "agentId": AGENT_ID})
    jid = select_group(result, group)
    value = {"version": 1, "group": group, "jid": jid,
             "configured_at": datetime.now(timezone.utc).isoformat()}
    write_config(path, value)
    return {"ok": True, "group": group, "jid": jid, "config_path": str(path)}


def send(client, message, request_id, path=CONFIG_PATH):
    if not message.strip() or not request_id.strip():
        raise NotifyError("A nonempty message and stable request ID are required.")
    config = read_json(path, "notification config; run configure --group Notes first")
    jid = config.get("jid")
    if type(config.get("version")) is not int or config["version"] != 1 or not is_group_jid(jid):
        raise NotifyError("Notification config must pin a WhatsApp group JID.")
    result = client.rpc("send_message", {"recipients": [jid], "channel": "whatsapp",
                                        "text": message, "clientRequestId": request_id,
                                        "requestId": request_id, "agentId": AGENT_ID})
    if result.get("ok") is not True:
        raise NotifyError("Chai refused the notification recipient or input.")
    recipients = result.get("results")
    if not isinstance(recipients, list) or len(recipients) != 1:
        raise NotifyError("Chai returned an unexpected send result.", uncertain=True)
    recipient = recipients[0]
    if not isinstance(recipient, dict):
        raise NotifyError("Chai returned an invalid recipient result.", uncertain=True)
    person = recipient.get("person")
    if (recipient.get("recipient") != jid or not isinstance(person, dict)
            or person.get("channel") != "whatsapp" or person.get("address") != jid):
        raise NotifyError("Chai send result does not match the pinned group.", uncertain=True)
    if recipient.get("status") == "failed":
        raise NotifyError("Chai reports that the WhatsApp notification failed; submission is unconfirmed.",
                          uncertain=True)
    message_id = recipient.get("messageId")
    # The bridge wraps the persisted WhatsApp key as
    # whatsapp:<remoteJid>|<providerMessageId>|<fromMe>|<participant>.
    # Validate the actual provider ID and destination, rather than accepting a
    # prefix, an empty provider key, or a cached send to a different chat.
    key = message_id.removeprefix("whatsapp:").split("|") if (
        isinstance(message_id, str) and message_id.startswith("whatsapp:")) else []
    if (recipient.get("status") != "sent" or not isinstance(message_id, str)
            or len(key) != 4 or key[0] != jid or not key[1].strip() or key[2] != "1"):
        raise NotifyError("Send is unconfirmed (possibly still sending); no retry was made.",
                          uncertain=True)
    return {"ok": True, "group": config.get("group"), "jid": jid,
            "request_id": request_id, "message_id": message_id, "status": "sent"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status", help="Read local bridge health without changing app state")
    setup = commands.add_parser("configure", help="Pin one exact-name WhatsApp group")
    setup.add_argument("--group", required=True)
    notify = commands.add_parser("send", help="Send once to the pinned group; no automatic retry")
    notify.add_argument("--message", required=True)
    notify.add_argument("--request-id", required=True,
                        help="Stable unique ID for this notification; retain it on uncertainty")
    args = parser.parse_args(argv)
    client = BridgeClient()
    try:
        if args.command == "status":
            result = client.health()
        elif args.command == "configure":
            result = configure(client, args.group)
        else:
            result = send(client, args.message, args.request_id)
    except (NotifyError, OSError) as error:
        failure = {"ok": False,
                   "error": str(error) if isinstance(error, NotifyError)
                   else "Cannot write private notification configuration.",
                   "uncertain": getattr(error, "uncertain", False)}
        if args.command == "send":
            failure["request_id"] = args.request_id
            failure["automatic_retry"] = False
        print(json.dumps(failure), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
