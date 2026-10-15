"""No real bridge calls, app changes, or notifications occur in this suite."""

import importlib.util
from http.client import IncompleteRead
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.error import HTTPError, URLError


SPEC = importlib.util.spec_from_file_location(
    "chai_notify", Path(__file__).resolve().parents[1] / "chai-notify.py")
notify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notify)
JID = "120363123456789@g.us"
MESSAGE_ID = f"whatsapp:{JID}|key-123|1|"


def candidate(address=JID, label="Notes", match="exact"):
    return {"channel": "whatsapp", "address": address, "label": label, "match": match}


def sent_result(status="sent", message_id=MESSAGE_ID):
    return {"ok": True, "results": [{"recipient": JID, "person": candidate(),
                                     "status": status, "messageId": message_id}]}


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Path(self.temp.name) / "private/config.json"
        self.client = Mock()

    def pin_group(self):
        self.client.rpc.return_value = {"ok": True, "candidates": [candidate()]}
        notify.configure(self.client, "Notes", self.config)
        self.client.reset_mock()

    def test_unique_exact_group_is_pinned_privately_without_token(self):
        self.client.rpc.return_value = {"ok": True, "candidates": [
            candidate(), candidate("15551234567@s.whatsapp.net"),
            candidate("120363999@g.us", "Meeting Notes", "partial")]}
        notify.configure(self.client, "Notes", self.config)
        saved = json.loads(self.config.read_text())
        self.assertEqual(saved["jid"], JID)
        self.assertNotIn("token", saved)
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.config.parent.stat().st_mode), 0o700)
        self.client.rpc.assert_called_once_with("resolve_person", {
            "query": "Notes", "channel": "whatsapp", "agentId": "chai-notify"})

    def test_ambiguous_groups_do_not_overwrite_existing_pin(self):
        self.pin_group()
        original = self.config.read_bytes()
        self.client.rpc.return_value = {"ok": True, "candidates": [
            candidate(), candidate("120363999@g.us")]}
        with self.assertRaisesRegex(notify.NotifyError, "Multiple"):
            notify.configure(self.client, "Notes", self.config)
        self.assertEqual(self.config.read_bytes(), original)

    def test_contact_and_partial_group_are_rejected(self):
        self.client.rpc.return_value = {"ok": True, "candidates": [
            candidate("15551234567@s.whatsapp.net"),
            candidate(label="Notes extra", match="partial")]}
        with self.assertRaisesRegex(notify.NotifyError, "No exact WhatsApp group"):
            notify.configure(self.client, "Notes", self.config)
        self.assertFalse(self.config.exists())

    def test_malformed_candidates_are_ignored(self):
        self.client.rpc.return_value = {"ok": True, "candidates": [
            None, "Notes", candidate(label=None), candidate(label=123), candidate()]}
        notify.configure(self.client, "Notes", self.config)
        self.assertEqual(json.loads(self.config.read_text())["jid"], JID)

    def test_case_mismatch_does_not_pin_group(self):
        self.client.rpc.return_value = {"ok": True, "candidates": [candidate(label="notes")]}
        with self.assertRaisesRegex(notify.NotifyError, "No exact WhatsApp group"):
            notify.configure(self.client, "Notes", self.config)
        self.assertFalse(self.config.exists())

    def test_send_uses_pinned_jid_and_unchanged_request_id(self):
        self.pin_group()
        self.client.rpc.return_value = sent_result()
        result = notify.send(self.client, "Ready", "quarter-123", self.config)
        self.assertEqual(result["message_id"], MESSAGE_ID)
        self.client.rpc.assert_called_once_with("send_message", {
            "recipients": [JID], "channel": "whatsapp", "text": "Ready",
            "clientRequestId": "quarter-123", "requestId": "quarter-123",
            "agentId": "chai-notify"})

    def test_nested_failed_status_is_failure_despite_outer_ok(self):
        self.pin_group()
        self.client.rpc.return_value = sent_result(status="failed", message_id=None)
        with self.assertRaisesRegex(notify.NotifyError, "notification failed") as raised:
            notify.send(self.client, "Ready", "quarter-123", self.config)
        self.assertTrue(raised.exception.uncertain)
        self.client.rpc.assert_called_once()

    def test_missing_message_id_and_stale_sending_are_uncertain(self):
        self.pin_group()
        for status, message_id in [("sent", None), ("sent", ""),
                                   ("sent", "whatsapp:"), ("sent", "whatsapp:||0|"),
                                   ("sent", f"whatsapp:{JID}||1|"),
                                   ("sent", "whatsapp:120363999@g.us|key-123|1|"),
                                   ("sent", f"whatsapp:{JID}|key-123|0|"),
                                   ("queued", None), ("sending", None),
                                   ("sending", MESSAGE_ID)]:
            with self.subTest(status=status, message_id=message_id):
                self.client.reset_mock()
                self.client.rpc.return_value = sent_result(status, message_id)
                with self.assertRaises(notify.NotifyError) as raised:
                    notify.send(self.client, "Ready", "quarter-123", self.config)
                self.assertTrue(raised.exception.uncertain)
                self.client.rpc.assert_called_once()

    def test_wrong_returned_group_is_uncertain(self):
        self.pin_group()
        result = sent_result()
        result["results"][0]["person"]["address"] = "120363999@g.us"
        self.client.rpc.return_value = result
        with self.assertRaises(notify.NotifyError) as raised:
            notify.send(self.client, "Ready", "quarter-123", self.config)
        self.assertTrue(raised.exception.uncertain)

    def test_tampered_non_group_pin_cannot_send(self):
        self.pin_group()
        self.config.write_text(json.dumps({"version": 1, "jid": "1555@s.whatsapp.net"}))
        with self.assertRaisesRegex(notify.NotifyError, "group JID"):
            notify.send(self.client, "Ready", "quarter-123", self.config)
        self.client.rpc.assert_not_called()


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.token_file = Path(self.temp.name) / "agent-bridge.json"
        self.write_token()
        self.client = notify.BridgeClient(self.token_file)
        self.client.opener = MagicMock()

    def write_token(self, host="127.0.0.1", token="secret-one"):
        self.token_file.write_text(json.dumps({"host": host, "port": 43124, "token": token}))

    def response(self, value):
        response = self.client.opener.open.return_value.__enter__.return_value
        response.read.return_value = json.dumps(value).encode()

    def test_remote_host_is_rejected_before_request(self):
        self.write_token(host="example.com")
        with self.assertRaisesRegex(notify.NotifyError, "loopback"):
            self.client.rpc("resolve_person", {"query": "Notes"})
        self.client.opener.open.assert_not_called()

    def test_numeric_host_is_rejected_before_request(self):
        self.write_token(host=2130706433)
        with self.assertRaisesRegex(notify.NotifyError, "loopback"):
            self.client.rpc("resolve_person", {"query": "Notes"})
        self.client.opener.open.assert_not_called()

    def test_token_is_read_fresh_and_rpc_envelope_is_unwrapped(self):
        self.response({"ok": True, "result": {"ok": True, "candidates": []}})
        for token in ["secret-one", "secret-two"]:
            self.write_token(token=token)
            self.assertEqual(self.client.rpc("resolve_person", {}),
                             {"ok": True, "candidates": []})
            request = self.client.opener.open.call_args.args[0]
            self.assertEqual(request.get_header("Authorization"), f"Bearer {token}")

    def test_send_transport_uncertainty_does_not_retry_or_expose_token(self):
        self.client.opener.open.side_effect = URLError("connection closed")
        with self.assertRaises(notify.NotifyError) as raised:
            self.client.rpc("send_message", {"clientRequestId": "stable-123"})
        self.assertTrue(raised.exception.uncertain)
        self.assertNotIn("secret-one", str(raised.exception))
        self.client.opener.open.assert_called_once()

    def test_http_500_after_send_is_uncertain(self):
        self.client.opener.open.side_effect = HTTPError(
            "http://127.0.0.1:43124/rpc", 500, "failure", {}, None)
        with self.assertRaises(notify.NotifyError) as raised:
            self.client.rpc("send_message", {})
        self.assertTrue(raised.exception.uncertain)
        self.client.opener.open.assert_called_once()

    def test_rpc_http_400_after_send_is_uncertain(self):
        self.client.opener.open.side_effect = HTTPError(
            "http://127.0.0.1:43124/rpc", 400, "secret-one", {}, None)
        with self.assertRaises(notify.NotifyError) as raised:
            self.client.rpc("send_message", {})
        self.assertTrue(raised.exception.uncertain)
        self.assertNotIn("secret-one", str(raised.exception))
        self.client.opener.open.assert_called_once()

    def test_http_401_is_pre_dispatch_failure(self):
        self.client.opener.open.side_effect = HTTPError(
            "http://127.0.0.1:43124/rpc", 401, "Unauthorized", {}, None)
        with self.assertRaises(notify.NotifyError) as raised:
            self.client.rpc("send_message", {})
        self.assertFalse(raised.exception.uncertain)
        self.client.opener.open.assert_called_once()

    def test_truncated_send_response_is_sanitized_and_uncertain(self):
        response = self.client.opener.open.return_value.__enter__.return_value
        response.read.side_effect = IncompleteRead(b"secret-one", 20)
        with self.assertRaises(notify.NotifyError) as raised:
            self.client.rpc("send_message", {})
        self.assertTrue(raised.exception.uncertain)
        self.assertNotIn("secret-one", str(raised.exception))
        self.client.opener.open.assert_called_once()

    def test_status_is_get_without_bearer_and_prints_no_credentials(self):
        self.response({"ok": True, "service": "chai-agent-bridge",
                       "rpcUrl": "http://127.0.0.1:43124/rpc"})
        result = self.client.health()
        request = self.client.opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.get_header("Authorization"))
        self.assertNotIn("secret-one", json.dumps(result))

    def test_redirects_are_not_followed(self):
        handler = notify.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, "redirect", {},
                                                   "https://example.com"))

    def test_cli_uncertain_failure_keeps_request_id_and_nonzero_exit(self):
        error = notify.NotifyError("Send is unconfirmed", uncertain=True)
        with patch.object(notify, "BridgeClient"), patch.object(notify, "send", side_effect=error), \
                patch("sys.stderr", new_callable=io.StringIO) as output:
            code = notify.main(["send", "--message", "Ready", "--request-id", "stable-123"])
        self.assertEqual(code, 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result["request_id"], "stable-123")
        self.assertTrue(result["uncertain"])
        self.assertFalse(result["automatic_retry"])


if __name__ == "__main__":
    unittest.main()
