"""Pictures pasted into an item's text: kept, served, backed up, handed to an agent, deleted.

Every store here is a temporary one. The bytes are built in the test, so what is
read back is compared with what was sent, byte for byte, and never with what the
code under test computed from it.
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import os
import shutil
import socket
import sqlite3
import sys
import tempfile
import threading
import unittest
import zlib
from pathlib import Path
from unittest import mock

from server import http_surface, mcp_surface, store, store_backups
from server.ops import tray
from server.planning import api, images, model, service
from tests import schema9, schema13
from tests.test_mcp_surface import Stdin, Stdout, params


def png(seed: int, padding: int = 0) -> bytes:
    """A real one-pixel PNG, its colour from `seed`, with `padding` bytes of text chunk."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return len(data).to_bytes(4, "big") + body + zlib.crc32(body).to_bytes(4, "big")

    header = (1).to_bytes(4, "big") * 2 + bytes([8, 2, 0, 0, 0])
    pixel = zlib.compress(bytes([0, seed % 256, (seed * 7) % 256, (seed * 13) % 256]))
    extra = chunk(b"tEXt", b"x\x00" + b"a" * padding) if padding else b""
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + extra
        + chunk(b"IDAT", pixel)
        + chunk(b"IEND", b"")
    )


SIGNATURES = {
    "image/png": png(1),
    "image/jpeg": b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 32,
    "image/gif": b"GIF89a" + b"\x01\x00\x01\x00\x00\x00\x00" + b";",
    "image/webp": b"RIFF\x1a\x00\x00\x00WEBPVP8L" + b"\x00" * 14,
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pictures(folder: Path | str) -> list[str]:
    """The picture files in a directory, by name, leaving out the marker naming its store."""

    return sorted(name for name in os.listdir(folder) if name != images.MARKER)


class StoreCase(unittest.TestCase):
    """A temporary store holding one space and two items."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="pics", name="Pics", key="PIC")
        self.first = self.item("Shows a screenshot")
        self.second = self.item("Shows the same one")
        self.conn.commit()

    def item(self, title: str) -> str:
        return str(service.create_work_item(self.conn, space="PIC", title=title)["reference"])

    @property
    def folder(self) -> Path:
        return self.root / "images"

    def rows(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT i.number, m.sha256, m.media_type, m.size FROM work_item_images m"
                " JOIN work_items i ON i.work_item_id = m.work_item_id ORDER BY i.number, m.sha256"
            )
        ]


class KeepingTests(StoreCase):
    def test_a_picture_is_kept_by_its_hash_beside_the_store_and_read_back_whole(self) -> None:
        data = png(3)
        kept = images.store(self.conn, self.first, data)
        self.assertEqual(
            {"sha256": sha(data), "media_type": "image/png", "size": len(data)},
            {name: kept[name] for name in ("sha256", "media_type", "size")},
        )
        self.assertEqual(f"/api/images/{sha(data)}", kept["path"])
        self.assertEqual(data, (self.folder / sha(data)).read_bytes())
        self.assertEqual(data, images.read(self.conn, sha(data)).data)

    def test_each_signature_is_read_from_the_bytes(self) -> None:
        for kind, data in SIGNATURES.items():
            with self.subTest(kind):
                self.assertEqual(kind, images.store(self.conn, self.first, data)["media_type"])

    def test_what_is_no_picture_is_refused_whatever_it_is_called(self) -> None:
        for data in (
            b"<svg xmlns='http://www.w3.org/2000/svg'/>",
            b"%PDF-1.7",
            b"",
            b"RIFF1234WAVE",
        ):
            with self.subTest(data[:8]), self.assertRaises(images.ImageRefusedError) as caught:
                images.store(self.conn, self.first, data)
            self.assertEqual(
                (415, "not_an_image"), (caught.exception.status, caught.exception.code)
            )
        self.assertEqual([], self.rows())
        self.assertFalse(self.folder.exists())

    def test_a_picture_over_ten_megabytes_is_refused_and_one_at_the_limit_is_kept(self) -> None:
        limit = 10 * 1024 * 1024
        exact = png(4, padding=limit - len(png(4, padding=1)) + 1)
        self.assertEqual(limit, len(exact))
        self.assertEqual(limit, images.store(self.conn, self.first, exact)["size"])
        with self.assertRaises(images.ImageRefusedError) as caught:
            images.store(self.conn, self.second, exact + b"\x00")
        self.assertEqual((413, "too_large"), (caught.exception.status, caught.exception.code))
        self.assertEqual([(1, sha(exact), "image/png", limit)], self.rows())

    def test_one_picture_on_two_items_is_one_file_and_one_row_each(self) -> None:
        data = png(5)
        images.store(self.conn, self.first, data)
        images.store(self.conn, self.first, data)
        images.store(self.conn, self.second, data)
        self.assertEqual(
            [(1, sha(data), "image/png", len(data)), (2, sha(data), "image/png", len(data))],
            self.rows(),
        )
        self.assertEqual([sha(data)], pictures(self.folder))

    def test_a_picture_for_no_item_is_refused_and_leaves_no_file(self) -> None:
        with self.assertRaises(Exception):  # noqa: B017 - the refusal's class is the item lookup's
            images.store(self.conn, "PIC-99", png(6))
        self.assertEqual([], self.rows())
        self.assertFalse(self.folder.exists())

    def test_a_file_that_no_longer_holds_its_picture_is_not_served(self) -> None:
        data = png(7)
        images.store(self.conn, self.first, data)
        (self.folder / sha(data)).write_bytes(png(8))
        with self.assertRaises(images.ImageRefusedError) as caught:
            images.read(self.conn, sha(data))
        self.assertEqual(404, caught.exception.status)


#: An agent session, for a tool call made the way the stdio loop makes it.
AGENT = {"sessionId": "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"}


class DeletionTests(StoreCase):
    def delete(self, reference: str) -> None:
        """Delete as an agent does: the call, its commit and what follows the commit."""

        mcp_surface.run_tool_call(self.conn, "delete_work_item", {"id": reference}, meta=AGENT)

    def test_a_delete_rolled_back_after_it_freed_the_pictures_keeps_every_one(self) -> None:
        pictures = [png(14), png(15)]
        for data in pictures:
            images.store(self.conn, self.first, data)
        handled = api.handle_post(self.conn, "/api/planning/work-item/delete", {"id": self.first})
        assert handled is not None
        # Whatever fails between the delete and its commit takes the delete back whole.
        self.conn.rollback()
        self.assertEqual(2, len(self.rows()))
        for data in pictures:
            self.assertEqual(data, images.read(self.conn, sha(data), item=self.first).data)

    def test_a_file_that_cannot_be_removed_does_not_stop_the_delete(self) -> None:
        kept, held = png(16), png(17)
        images.store(self.conn, self.first, kept)
        images.store(self.conn, self.first, held)
        remove = os.remove

        def refuse(path: str) -> None:
            # Another process has the second picture open, as Windows refuses then.
            if os.path.basename(path) == sha(held):
                raise PermissionError(13, "in use", path)
            remove(path)

        with mock.patch.object(os, "remove", refuse):
            self.delete(self.first)
        self.assertEqual([], self.rows())
        self.assertFalse((self.folder / sha(kept)).exists())
        self.assertTrue((self.folder / sha(held)).exists())
        # The next open of the store takes the file nobody holds.
        reopened = store.connect()
        self.addCleanup(reopened.close)
        self.assertEqual([], pictures(self.folder))

    def test_a_delete_that_fails_before_its_commit_leaves_nothing_noted(self) -> None:
        images.store(self.conn, self.first, png(19))
        release = images.release

        def release_then_fail(conn: sqlite3.Connection, hashes: list[str]) -> list[str]:
            release(conn, hashes)
            raise RuntimeError("failed on the way to the commit")

        with (
            mock.patch.object(images, "release", release_then_fail),
            self.assertRaises(RuntimeError),
        ):
            self.delete(self.first)
        self.assertNotIn(id(self.conn), images._FREED)
        self.assertTrue((self.folder / sha(png(19))).exists())

    def test_an_upload_that_failed_and_could_not_take_its_file_back_leaves_it_to_the_sweep(
        self,
    ) -> None:
        data = png(18)
        remove = os.remove

        def refuse(path: str) -> None:
            if os.path.basename(path) == sha(data):
                raise PermissionError(13, "in use", path)
            remove(path)

        with (
            mock.patch.object(images.calls, "call_id", side_effect=RuntimeError("refused")),
            mock.patch.object(os, "remove", refuse),
            self.assertRaises(RuntimeError),
        ):
            images.store(self.conn, self.first, data)
        self.assertEqual([], self.rows())
        self.assertTrue((self.folder / sha(data)).exists())
        reopened = store.connect()
        self.addCleanup(reopened.close)
        self.assertEqual([], pictures(self.folder))

    def test_deleting_the_item_deletes_its_pictures(self) -> None:
        data = png(10)
        images.store(self.conn, self.first, data)
        self.delete(self.first)
        self.assertEqual([], self.rows())
        self.assertFalse((self.folder / sha(data)).exists())
        with self.assertRaises(images.ImageRefusedError):
            images.read(self.conn, sha(data))

    def test_a_picture_another_item_holds_stays_until_that_one_goes_too(self) -> None:
        shared, own = png(11), png(12)
        images.store(self.conn, self.first, shared)
        images.store(self.conn, self.first, own)
        images.store(self.conn, self.second, shared)
        self.delete(self.first)
        self.assertEqual(
            [shared], [(self.folder / name).read_bytes() for name in pictures(self.folder)]
        )
        self.delete(self.second)
        self.assertEqual([], pictures(self.folder))

    def test_a_merge_gives_the_survivor_the_pictures_its_threads_show(self) -> None:
        data = png(13)
        images.store(self.conn, self.second, data)
        handled = api.handle_post(
            self.conn,
            "/api/planning/work-item/merge",
            {"id": self.first, "items": [self.second]},
        )
        assert handled is not None
        self.conn.commit()
        self.assertEqual(
            [(1, sha(data), "image/png", len(data)), (2, sha(data), "image/png", len(data))],
            self.rows(),
        )
        self.delete(self.second)
        self.assertEqual(data, images.read(self.conn, sha(data), item=self.first).data)


class BackupTests(StoreCase):
    def test_a_backup_restored_into_a_fresh_store_gives_the_picture_back_byte_for_byte(
        self,
    ) -> None:
        data = png(20)
        images.store(self.conn, self.first, data)
        snapshot, _ = store_backups.verified_snapshot(
            self.conn, "manual", locate=store.backup_location
        )
        self.assertEqual(
            data, (Path(store_backups.images_beside(snapshot)) / sha(data)).read_bytes()
        )
        self.assertEqual(images.MARKER, store_backups.MARKER)
        self.assertEqual(
            (self.folder / images.MARKER).read_text(encoding="utf-8"),
            (Path(store_backups.images_beside(snapshot)) / images.MARKER).read_text(
                encoding="utf-8"
            ),
        )
        # The documented restore: the snapshot in place of the store, its pictures into
        # `images` beside it. A fresh directory stands for a machine that lost the store.
        fresh = self.root / "fresh"
        fresh.mkdir()
        shutil.copyfile(snapshot, fresh / "valkama.sqlite3")
        shutil.copytree(store_backups.images_beside(snapshot), fresh / "images")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(fresh / "valkama.sqlite3")}):
            restored = store.connect()
        self.addCleanup(restored.close)
        self.assertEqual(data, images.read(restored, sha(data), item=self.first).data)
        # The copy names its store, so the restored store still owns it and clears it.
        orphan = fresh / "images" / sha(png(29))
        orphan.write_bytes(png(29))
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(fresh / "valkama.sqlite3")}):
            store.connect().close()
        self.assertFalse(orphan.exists())
        self.assertTrue((fresh / "images" / sha(data)).exists())

    def test_a_restore_over_a_newer_store_keeps_no_picture_the_snapshot_does_not_hold(
        self,
    ) -> None:
        older, newer = png(25), png(26)
        images.store(self.conn, self.first, older)
        snapshot, _ = store_backups.verified_snapshot(
            self.conn, "manual", locate=store.backup_location
        )
        images.store(self.conn, self.second, newer)
        self.conn.close()
        # The snapshot in place of the store, its pictures copied in beside the newer one.
        for sidecar in ("-wal", "-shm"):
            Path(self.path + sidecar).unlink(missing_ok=True)
        shutil.copyfile(snapshot, self.path)
        shutil.copytree(store_backups.images_beside(snapshot), self.folder, dirs_exist_ok=True)
        restored = store.connect()
        self.addCleanup(restored.close)
        self.assertEqual([sha(older)], pictures(self.folder))
        self.assertEqual(older, images.read(restored, sha(older), item=self.first).data)
        with self.assertRaises(images.ImageRefusedError):
            images.read(restored, sha(newer))

    def test_no_upload_commits_between_the_rows_copied_and_the_pictures_copied(self) -> None:
        images.store(self.conn, self.first, png(27))
        other = sqlite3.connect(self.path, timeout=0.2)
        other.row_factory = sqlite3.Row
        self.addCleanup(other.close)
        copy = store_backups._copy_pictures
        attempts: list[str] = []

        def upload_meanwhile(source: str, destination: str) -> None:
            # Another process pastes a picture after VACUUM INTO and before the copy.
            try:
                images.store(other, self.second, png(28))
                attempts.append("committed")
            except sqlite3.OperationalError:
                attempts.append("waited")
            copy(source, destination)

        with mock.patch.object(store_backups, "_copy_pictures", upload_meanwhile):
            snapshot, _ = store_backups.verified_snapshot(
                self.conn, "manual", locate=store.backup_location
            )
        self.assertEqual(["waited"], attempts)
        self.assertEqual([sha(png(27))], pictures(store_backups.images_beside(snapshot)))
        self.assertEqual([sha(png(27))], pictures(self.folder))

    def test_a_snapshot_missing_a_picture_or_holding_a_wrong_one_is_refused(self) -> None:
        data = png(21)
        images.store(self.conn, self.first, data)
        snapshot = store_backups.snapshot(self.conn, store.backup_location(), "manual")
        copy = Path(store_backups.images_beside(snapshot)) / sha(data)
        copy.write_bytes(png(22))
        with self.assertRaisesRegex(RuntimeError, "does not hold"):
            store_backups.verify_pictures(snapshot, str(self.folder))
        copy.unlink()
        with self.assertRaisesRegex(RuntimeError, "lacks 1 picture"):
            store_backups.verify_pictures(snapshot, str(self.folder))

    def test_a_reused_snapshot_with_a_broken_picture_is_set_aside_for_a_fresh_one(self) -> None:
        data = png(23)
        images.store(self.conn, self.first, data)
        first, _ = store_backups.verified_snapshot(
            self.conn, "manual", locate=store.backup_location
        )
        (Path(store_backups.images_beside(first)) / sha(data)).write_bytes(b"torn")
        second, _ = store_backups.verified_snapshot(
            self.conn, "manual", locate=store.backup_location
        )
        self.assertNotEqual(first, second)
        self.assertTrue(os.path.exists(first + store_backups.UNVERIFIED_SUFFIX))
        self.assertEqual(data, (Path(store_backups.images_beside(second)) / sha(data)).read_bytes())

    def test_retention_takes_a_snapshot_s_pictures_with_it(self) -> None:
        images.store(self.conn, self.first, png(24))
        taken = [
            store_backups.snapshot(self.conn, store.backup_location(), "manual") for _ in range(6)
        ]
        self.assertFalse(os.path.exists(store_backups.images_beside(taken[0])))
        self.assertTrue(os.path.isdir(store_backups.images_beside(taken[-1])))


class SharedDirectoryTests(StoreCase):
    """A second store opened beside the first, in the same directory."""

    def open_other(self) -> sqlite3.Connection:
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.root / "other.sqlite3")}):
            other = store.connect()
        self.addCleanup(other.close)
        return other

    def test_opening_another_store_beside_this_one_removes_none_of_its_pictures(self) -> None:
        pictures = [png(60), png(61)]
        for data in pictures:
            images.store(self.conn, self.first, data)
        self.open_other()
        for data in pictures:
            self.assertEqual(data, images.read(self.conn, sha(data), item=self.first).data)

    def test_the_other_store_keeps_no_picture_in_a_folder_it_does_not_own(self) -> None:
        images.store(self.conn, self.first, png(62))
        other = self.open_other()
        service.create_planning_space(other, project_id="else", name="Else", key="ELS")
        item = str(service.create_work_item(other, space="ELS", title="Elsewhere")["reference"])
        other.commit()
        with self.assertRaises(images.ImageRefusedError) as refused:
            images.store(other, item, png(63))
        self.assertEqual(409, refused.exception.status)
        self.assertFalse((self.folder / sha(png(63))).exists())


class SchemaFourteenTests(unittest.TestCase):
    """A store at 13 gains the table under `preschema14`, and that point brings it back."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        schema13.build(self.path)
        conn = sqlite3.connect(self.path)
        schema9.populate(conn)
        conn.commit()
        self.before = self.dump(conn)
        conn.close()

    @staticmethod
    def dump(conn: sqlite3.Connection) -> list[str]:
        return [line for line in conn.iterdump() if line.startswith("INSERT")]

    def snapshots(self) -> list[Path]:
        return sorted((self.root / "backups").glob("*-preschema14-*.sqlite3"))

    def test_a_store_at_13_reaches_14_under_preschema14_keeping_every_row(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        # The chain runs on to this build's own schema in the same open.
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(
            ["work_item_id", "sha256", "media_type", "size", "created_at", "call_id"],
            [row[1] for row in conn.execute("PRAGMA table_info(work_item_images)")],
        )
        self.assertEqual(self.before, self.dump(conn))
        [snapshot] = self.snapshots()
        backup = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(13, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(self.before, self.dump(backup))

    def test_preschema14_restores_13_and_the_migration_runs_again(self) -> None:
        store.connect().close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        [snapshot] = self.snapshots()
        shutil.copyfile(snapshot, self.path)
        restored = sqlite3.connect(self.path)
        self.assertEqual(13, restored.execute("PRAGMA user_version").fetchone()[0])
        restored.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        # The chain runs on to this build's own schema in the same open.
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(self.before, self.dump(conn))
        self.assertEqual(1, len(self.snapshots()))

    def test_a_build_that_knows_only_13_refuses_a_store_at_14(self) -> None:
        store.connect().close()
        before = Path(self.path).read_bytes()
        with (
            mock.patch.object(store, "STORE_SCHEMA_VERSION", 13),
            self.assertRaises(store.StoreTooNewError) as refusal,
        ):
            store.connect()
        self.assertEqual(
            (store.STORE_SCHEMA_VERSION, 13),
            (refusal.exception.stored, refusal.exception.supported),
        )
        self.assertEqual(before, Path(self.path).read_bytes())

    def test_the_rows_hold_only_what_a_picture_is(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        item = conn.execute("SELECT work_item_id FROM work_items LIMIT 1").fetchone()[0]
        insert = "INSERT INTO work_item_images(work_item_id,sha256,media_type,size) VALUES(?,?,?,?)"
        conn.execute(insert, (item, "a" * 64, "image/png", 1))
        for row in (
            (item, "A" * 64, "image/png", 1),
            (item, "b" * 63, "image/png", 1),
            (item, "c" * 64, "image/svg+xml", 1),
            (item, "d" * 64, "image/png", 10 * 1024 * 1024 + 1),
            (item, "a" * 64, "image/png", 1),
            ("none", "e" * 64, "image/png", 1),
        ):
            with self.subTest(row=row), self.assertRaises(sqlite3.IntegrityError):
                conn.execute(insert, row)
        conn.rollback()


class HttpCase(StoreCase):
    """The listener on a free port, over the same temporary store."""

    def setUp(self) -> None:
        super().setUp()
        self.token_path = self.root / "installation-token"
        self.start()

    def start(self) -> None:
        server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.token_path
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.server = server

        def stop() -> None:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

        self.stop = stop
        self.addCleanup(stop)

    @property
    def authority(self) -> str:
        return f"127.0.0.1:{self.server.server_port}"

    def request(
        self, method: str, path: str, headers: dict[str, str], body: bytes | None = None
    ) -> tuple[int, dict[str, str], bytes]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        try:
            client.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            client.putheader("Host", self.authority)
            for name, value in headers.items():
                client.putheader(name, value)
            client.endheaders(body)
            response = client.getresponse()
            return (
                response.status,
                {name.casefold(): value for name, value in response.getheaders()},
                response.read(),
            )
        finally:
            client.close()

    def token(self) -> str:
        status, _, body = self.request(
            "GET", "/api/security/bootstrap", {"Sec-Fetch-Site": "same-origin"}
        )
        self.assertEqual(200, status)
        return str(json.loads(body)["session_token"])

    def upload(self, item: str, data: bytes, *, token: str | None = None) -> tuple[int, dict]:
        headers = {
            "Origin": f"http://{self.authority}",
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(data)),
            "X-Valkama-Session": token if token is not None else self.token(),
        }
        status, _, body = self.request("POST", f"/api/images?item={item}", headers, data)
        return status, json.loads(body)

    def fetch(self, path: str, site: str = "same-origin") -> tuple[int, dict[str, str], bytes]:
        return self.request("GET", path, {"Sec-Fetch-Site": site, "Sec-Fetch-Dest": "image"})


class HttpTests(HttpCase):
    def test_a_pasted_picture_is_served_as_itself_and_after_a_restart_too(self) -> None:
        data = png(30)
        status, kept = self.upload(self.first, data)
        self.assertEqual(200, status, kept)
        self.assertEqual(f"/api/images/{sha(data)}", kept["path"])
        status, headers, body = self.fetch(kept["path"])
        self.assertEqual((200, data), (status, body))
        self.assertEqual("image/png", headers["content-type"])
        self.assertEqual("nosniff", headers["x-content-type-options"])
        self.assertIn("sandbox", headers["content-security-policy"])
        self.assertEqual("no-store", headers["cache-control"])
        self.stop()
        self.start()
        status, _, body = self.fetch(kept["path"])
        self.assertEqual((200, data), (status, body))

    def test_another_site_neither_sees_a_picture_nor_learns_it_exists(self) -> None:
        data = png(31)
        _, kept = self.upload(self.first, data)
        for site in ("cross-site", "same-site", "none"):
            with self.subTest(site):
                status, _, body = self.fetch(kept["path"], site)
                self.assertEqual(403, status)
                self.assertNotIn(data, body)
        self.assertEqual(404, self.fetch(f"/api/images/{'0' * 64}")[0])
        self.assertEqual(404, self.fetch("/api/images/../valkama.sqlite3")[0])

    def test_the_server_refuses_what_is_no_picture_and_what_is_too_large(self) -> None:
        status, body = self.upload(self.first, b"MZ\x90\x00 not a picture")
        self.assertEqual((415, "not_an_image"), (status, body["error"]["code"]))
        # Refused from the declared length, before a byte of the body is read.
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=10) as raw:
            raw.sendall(
                (
                    f"POST /api/images?item={self.first} HTTP/1.1\r\nHost: {self.authority}\r\n"
                    f"Origin: http://{self.authority}\r\nSec-Fetch-Site: same-origin\r\n"
                    f"X-Valkama-Session: {self.token()}\r\n"
                    f"Content-Length: {11 * 1024 * 1024}\r\n\r\n"
                ).encode("ascii")
            )
            answer = raw.recv(4096).decode("latin-1")
        self.assertTrue(answer.startswith("HTTP/1.0 413"), answer)
        self.assertEqual([], self.rows())

    def test_a_delete_the_page_sends_takes_the_picture_once_it_has_committed(self) -> None:
        data = png(33)
        _, kept = self.upload(self.first, data)
        body = json.dumps({"id": self.first}).encode("utf-8")
        headers = {
            "Origin": f"http://{self.authority}",
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "X-Valkama-Session": self.token(),
        }
        status, _, answer = self.request("POST", "/api/planning/work-item/delete", headers, body)
        self.assertEqual(200, status, answer)
        self.assertFalse((self.folder / sha(data)).exists())
        self.assertEqual(404, self.fetch(kept["path"])[0])

    def test_a_delete_the_page_sends_that_fails_before_its_commit_leaves_nothing_noted(
        self,
    ) -> None:
        self.upload(self.first, png(34))
        before = set(images._FREED)
        release = images.release

        def release_then_fail(conn: sqlite3.Connection, hashes: list[str]) -> list[str]:
            release(conn, hashes)
            raise model.PlanningError("refused on the way to the commit")

        body = json.dumps({"id": self.first}).encode("utf-8")
        headers = {
            "Origin": f"http://{self.authority}",
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
            "X-Valkama-Session": self.token(),
        }
        with mock.patch.object(images, "release", release_then_fail):
            status, _, _ = self.request("POST", "/api/planning/work-item/delete", headers, body)
        self.assertEqual(400, status)
        self.assertEqual(before, set(images._FREED))
        self.assertTrue((self.folder / sha(png(34))).exists())

    def test_an_upload_without_the_browser_credential_is_refused(self) -> None:
        status, body = self.upload(self.first, png(32), token="x" * 64)
        self.assertEqual(401, status, body)
        self.assertEqual([], self.rows())


class AgentTests(StoreCase):
    def converse(self, name: str, arguments: dict) -> dict:
        message = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": params(name=name, arguments=arguments),
        }
        stdout = Stdout()
        with (
            mock.patch.object(sys, "stdin", Stdin(json.dumps(message).encode("utf-8") + b"\n")),
            mock.patch.object(sys, "stdout", stdout),
            mock.patch.object(tray, "start", return_value=None),
        ):
            mcp_surface.mcp_main()
        [line] = stdout.buffer.getvalue().decode("utf-8").splitlines()
        return json.loads(line)["result"]

    def test_an_agent_reads_the_item_s_pictures_and_sees_one(self) -> None:
        data = png(40)
        images.store(self.conn, self.first, data)
        read = self.converse("get_work_item", {"id": self.first})
        item = json.loads(read["content"][0]["text"])
        self.assertEqual(
            [{"sha256": sha(data), "media_type": "image/png", "size": len(data)}],
            [{k: entry[k] for k in ("sha256", "media_type", "size")} for entry in item["images"]],
        )
        self.assertEqual(f"/api/images/{sha(data)}", item["images"][0]["path"])
        shown = self.converse("read_work_item_image", {"id": self.first, "sha256": sha(data)})
        self.assertFalse(shown["isError"])
        picture, facts = shown["content"]
        self.assertEqual(("image", "image/png"), (picture["type"], picture["mimeType"]))
        self.assertEqual(data, base64.b64decode(picture["data"]))
        self.assertEqual(
            {"sha256": sha(data), "media_type": "image/png", "size": len(data)},
            json.loads(facts["text"]),
        )

    def test_an_agent_reads_only_a_picture_the_item_it_names_holds(self) -> None:
        data = png(41)
        images.store(self.conn, self.first, data)
        refused = self.converse("read_work_item_image", {"id": self.second, "sha256": sha(data)})
        self.assertTrue(refused["isError"])
        self.assertEqual("not_found", refused["structuredContent"]["error"]["code"])
        self.assertNotIn(base64.b64encode(data).decode("ascii"), json.dumps(refused))


if __name__ == "__main__":
    unittest.main()
