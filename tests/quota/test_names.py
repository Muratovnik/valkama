"""The owner's names for accounts, one per organization, in the store.

The contract held here, from the owner's decision: one name per account, kept in the store
by organization; Settings writes it through the API and every reader takes it from there.
A name is one line of at most 80 characters, the rule the web app writes it by, and the
server holds a write to it too: a bad name or id is refused with its reason and changes
nothing. A device moves the names it kept once, and that move never overwrites a name the
store already has. Other modules read names for many organizations in one call.

Every id and name is invented.
"""

from __future__ import annotations

import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, store
from server.quota import accounts, names

MAIN = "f0f0f0f0-1111-4222-8333-444455556666"
SIDE = "9c0de5b1-2222-4333-8444-555566667777"


class _Store(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)


class RuleTests(_Store):
    def test_a_name_is_one_line_with_its_spaces_collapsed(self) -> None:
        stored = names.write(self.conn, {"names": {MAIN: "  Main\n  account\t"}})
        self.assertEqual({MAIN: "Main account"}, stored)
        self.assertEqual({MAIN: "Main account"}, names.read(self.conn))

    def test_eighty_characters_are_a_name_and_eighty_one_are_refused_changing_nothing(
        self,
    ) -> None:
        names.write(self.conn, {"names": {MAIN: "Main"}})
        self.assertEqual({SIDE: "x" * 80, MAIN: "Main"}, names.write(
            self.conn, {"names": {SIDE: "x" * 80}}
        ))  # fmt: skip
        with self.assertRaises(names.NamesError) as refusal:
            names.write(self.conn, {"names": {MAIN: "y" * 81}})
        self.assertIn("at most 80", str(refusal.exception))
        # Collapsing comes first: 81 characters that collapse to 80 are a name.
        names.write(self.conn, {"names": {MAIN: "z" * 40 + "  " + "z" * 39}})
        self.assertEqual("z" * 40 + " " + "z" * 39, names.read(self.conn)[MAIN])

    def test_a_bad_entry_refuses_the_whole_write(self) -> None:
        names.write(self.conn, {"names": {MAIN: "Main"}})
        before = names.read(self.conn)
        refused = [
            ({"names": {SIDE: "Side", MAIN: "y" * 81}}, "at most 80"),
            ({"names": {SIDE: 7}}, "must be text"),
            ({"names": {SIDE: "a\x00b"}}, "control character"),
            ({"names": {SIDE: "bell\x07"}}, "control character"),
            ({"names": {"": "Nobody"}}, "1 to 512"),
            ({"names": {"o" * 513: "Long"}}, "1 to 512"),
            ({"names": {"a\x00b": "Nul"}}, "NUL"),
            ({"names": {"\ud800": "Half"}}, "surrogate"),
            ({"names": {SIDE: "Side"}, "replace": "no"}, "replace"),
            ({"names": {SIDE: "Side"}, "other": 1}, "unknown field: other"),
            ({"names": [SIDE]}, "names must be an object"),
            ({}, "names must be an object"),
            ([SIDE], "must be an object"),
        ]
        for payload, reason in refused:
            with self.subTest(payload=payload), self.assertRaises(names.NamesError) as refusal:
                names.write(self.conn, payload)
            self.assertIn(reason, str(refusal.exception))
            self.assertEqual(before, names.read(self.conn))
        self.assertFalse(self.conn.in_transaction)

    def test_the_table_itself_refuses_a_name_over_the_bound(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO quota_account_names(account, name, updated_at) VALUES (?,?,?)",
                (MAIN, "y" * 81, "2030-03-04T09:00:00.000Z"),
            )
        self.conn.rollback()
        self.assertEqual({}, names.read(self.conn))


class WriteTests(_Store):
    def test_a_name_replaces_the_one_there_and_an_empty_one_takes_it_away(self) -> None:
        names.write(self.conn, {"names": {MAIN: "Main", SIDE: "Side"}})
        self.assertEqual(
            {MAIN: "Work", SIDE: "Side"}, names.write(self.conn, {"names": {MAIN: "Work"}})
        )
        self.assertEqual({SIDE: "Side"}, names.write(self.conn, {"names": {MAIN: "   "}}))
        self.assertEqual({}, names.write(self.conn, {"names": {SIDE: ""}}))

    def test_a_move_names_only_an_unnamed_account_and_never_overwrites(self) -> None:
        names.write(self.conn, {"names": {MAIN: "Given since"}})
        stored = names.write(
            self.conn, {"names": {MAIN: "Kept on a device", SIDE: "Side"}, "replace": False}
        )
        self.assertEqual({MAIN: "Given since", SIDE: "Side"}, stored)
        # An empty name in a move takes nothing away.
        self.assertEqual(
            {MAIN: "Given since", SIDE: "Side"},
            names.write(self.conn, {"names": {MAIN: ""}, "replace": False}),
        )


class KeyTests(_Store):
    """A name is given to an account by its key, or to an organization by its id."""

    ORG = "org-key"
    UUID_KEY = f"{ORG}/{MAIN}"
    WEEKLY_KEY = f"{ORG}/weekly:4T13:00Z"

    def test_an_account_and_its_organization_are_named_side_by_side(self) -> None:
        given = {self.UUID_KEY: "Work", self.WEEKLY_KEY: "Thursday", self.ORG: "Team"}
        self.assertEqual(given, names.write(self.conn, {"names": given}))
        self.assertEqual(
            {self.WEEKLY_KEY: "Thursday", self.ORG: "Team"},
            names.names_of(self.conn, [self.WEEKLY_KEY, self.ORG, f"{self.ORG}/other"]),
        )

    def test_a_key_with_a_slash_that_is_no_account_s_is_refused_changing_nothing(self) -> None:
        names.write(self.conn, {"names": {self.ORG: "Team"}})
        for key in (
            f"{self.ORG}/",
            f"/{MAIN}",
            f"{self.ORG}/{MAIN}/more",
            f"{self.ORG}/two words",
            f"{self.ORG}/{'u' * 129}",
            f"{self.ORG}/weekly:",
            f"{self.ORG}/weekly:8T13:00Z",
            f"{self.ORG}/weekly:4T24:00Z",
            f"{self.ORG}/weekly:4T13:05Z",
            f"{self.ORG}/weekly:4T13:00",
        ):
            with self.subTest(key=key), self.assertRaises(names.NamesError) as refusal:
                names.write(self.conn, {"names": {self.UUID_KEY: "Work", key: "Bad"}})
            self.assertIn("neither an organization nor an account", str(refusal.exception))
            self.assertEqual({self.ORG: "Team"}, names.read(self.conn))
        for key in (f"{self.ORG}/{'u' * 128}", f"{self.ORG}/weekly:7T23:50Z", "org.with:dots"):
            with self.subTest(key=key):
                names.write(self.conn, {"names": {key: "Good"}})
                self.assertEqual("Good", names.read(self.conn)[key])

    def test_an_account_s_own_name_is_under_its_key_or_its_weekly_reset_s(self) -> None:
        account = accounts.Account(self.ORG, MAIN, "4T13:00Z")
        self.assertEqual((self.UUID_KEY, self.WEEKLY_KEY, self.ORG), names.keys_of(account))
        weekly = accounts.Account(self.ORG, None, "4T13:00Z")
        self.assertEqual((self.WEEKLY_KEY, self.ORG), names.keys_of(weekly))
        # The organization's name is no account's own.
        self.assertIsNone(names.own_name({self.ORG: "Team"}, account))
        # A name given the weekly reset before the UUID turned up stays with the account.
        self.assertEqual("Thursday", names.own_name({self.WEEKLY_KEY: "Thursday"}, account))
        # Its own key comes first.
        both = {self.WEEKLY_KEY: "Thursday", self.UUID_KEY: "Work"}
        self.assertEqual("Work", names.own_name(both, account))
        self.assertEqual("Thursday", names.own_name(both, weekly))


class ReaderTests(_Store):
    def test_names_of_many_organizations_in_one_call(self) -> None:
        many = {f"org-{index:04}": f"Account {index}" for index in range(0, 1200, 2)}
        names.write(self.conn, {"names": many})
        asked = [f"org-{index:04}" for index in range(1200)]
        found = names.names_of(self.conn, asked)
        self.assertEqual(many, found)
        self.assertEqual({}, names.names_of(self.conn, []))
        self.assertEqual(
            {"org-0002": "Account 2"}, names.names_of(self.conn, iter(["org-0002", "org-0003"]))
        )


class _Listener(_Store):
    """A listener on a free port over the test's own store."""

    def setUp(self) -> None:
        super().setUp()
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        port = mock.patch.dict(os.environ, {"VALKAMA_PORT": str(self.server.server_port)})
        port.start()
        self.addCleanup(port.stop)

    def call(
        self, method: str, payload: object = None, *, browser: bool = True
    ) -> tuple[int, dict]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        headers = {
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{self.server.server_port}",
            "Sec-Fetch-Site": "same-origin",
        }
        if browser:
            headers["X-Valkama-Session"] = self.server.security_context.browser_session_token
        body = None if payload is None else json.dumps(payload)
        try:
            client.request(method, "/api/quota/account-names", body=body, headers=headers)
            response = client.getresponse()
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
        finally:
            client.close()


class RouteTests(_Listener):
    def test_the_read_and_the_write(self) -> None:
        self.assertEqual((200, {"names": {}}), self.call("GET"))
        self.assertEqual(
            (200, {"names": {MAIN: "Main account"}}),
            self.call("PUT", {"names": {MAIN: " Main  account "}}),
        )
        self.assertEqual((200, {"names": {MAIN: "Main account"}}), self.call("GET"))
        self.assertEqual(
            (200, {"names": {MAIN: "Main account", SIDE: "Side"}}),
            self.call("PUT", {"names": {MAIN: "Device", SIDE: "Side"}, "replace": False}),
        )
        self.assertEqual((200, {"names": {SIDE: "Side"}}), self.call("PUT", {"names": {MAIN: ""}}))

    def test_a_bad_name_or_id_is_a_400_with_its_reason_and_writes_nothing(self) -> None:
        self.call("PUT", {"names": {MAIN: "Main"}})
        for payload, reason in (
            ({"names": {MAIN: "y" * 81}}, "at most 80"),
            ({"names": {"o" * 513: "Long"}}, "1 to 512"),
            ({"names": {SIDE: "Side"}, "interval": 1}, "interval"),
        ):
            with self.subTest(reason=reason):
                status, answer = self.call("PUT", payload)
                self.assertEqual(400, status)
                self.assertEqual("invalid_request", answer["error"]["code"])
                self.assertIn(reason, answer["error"]["message"])
                self.assertEqual((200, {"names": {MAIN: "Main"}}), self.call("GET"))

    def test_a_write_without_the_browser_s_credential_is_refused(self) -> None:
        status, _ = self.call("PUT", {"names": {MAIN: "Main"}}, browser=False)
        self.assertIn(status, (401, 403))
        self.assertEqual((200, {"names": {}}), self.call("GET"))


if __name__ == "__main__":
    unittest.main()
