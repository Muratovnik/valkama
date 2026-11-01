from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from contextlib import closing
from unittest import mock

from server import store
from server.planning import chain, service


class PlanningScaleTests(unittest.TestCase):
    def test_large_list_keeps_containment_and_comment_counts_with_bounded_work(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.dict(os.environ, {"VALKAMA_DB": os.path.join(directory, "valkama.sqlite3")}),
            closing(store.connect()) as conn,
        ):
            space = service.create_planning_space(conn, project_id="test", name="Scale", key="SC")
            state = space["workflow"]["states"][0]["state_id"]
            identities = [str(uuid.uuid4()) for _ in range(1200)]
            conn.executemany(
                "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,title,parent_id,position)"
                " VALUES(?,?,?,?,?,?,?,?)",
                [
                    (
                        identity,
                        space["planning_space_id"],
                        index + 1,
                        space["workflow"]["workflow_id"],
                        state,
                        f"Task {index + 1}",
                        identities[0] if index == 1 else None,
                        index,
                    )
                    for index, identity in enumerate(identities)
                ],
            )
            conn.executemany(
                "INSERT INTO work_item_comments(work_item_id,body) VALUES(?,?)",
                [(identity, "A recorded result. " * 50) for identity in identities],
            )
            conn.commit()
            batches = 0

            def bound_work() -> int:
                nonlocal batches
                batches += 1
                return int(batches > 1500)

            conn.set_progress_handler(bound_work, 1000)
            try:
                items = service.list_work_items(conn, space="SC", limit=None)
            finally:
                conn.set_progress_handler(None, 0)
            self.assertEqual(1200, len(items))
            self.assertTrue(items[0]["container"])
            self.assertFalse(items[0]["ready"])
            self.assertEqual(identities[0], items[1]["parent_id"])
            self.assertTrue(items[2]["ready"])
            self.assertEqual({1}, {item["comment_count"] for item in items})

    def test_an_item_read_costs_the_same_however_many_links_it_has(self) -> None:
        """Each link names its other end's state without a query of its own.

        The read used to look each other end up separately, two statements a
        link; naming that end's state as well must not make it three.
        """

        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.dict(os.environ, {"VALKAMA_DB": os.path.join(directory, "valkama.sqlite3")}),
            closing(store.connect()) as conn,
        ):
            service.create_planning_space(conn, project_id="test", name="Links", key="LK")
            few = service.create_work_item(conn, space="LK", title="Few links")["reference"]
            many = service.create_work_item(conn, space="LK", title="Many links")["reference"]
            for number in range(150):
                other = service.create_work_item(conn, space="LK", title=f"Other {number}")
                service.link_work_items(conn, other["reference"], many, "blocks")
                if number < 2:
                    service.link_work_items(conn, other["reference"], few, "blocks")
            conn.commit()

            def statements(reference: str) -> tuple[int, int]:
                count = 0

                def trace(_statement: str) -> None:
                    nonlocal count
                    count += 1

                conn.set_trace_callback(trace)
                try:
                    links = len(service.get_work_item(conn, reference)["links"])
                finally:
                    conn.set_trace_callback(None)
                return links, count

            (few_links, few_cost), (many_links, many_cost) = statements(few), statements(many)
            self.assertEqual((2, 150), (few_links, many_links))
            self.assertEqual(few_cost, many_cost)

    def test_a_chain_read_costs_the_same_however_many_blockers_reach_it(self) -> None:
        """A chain names each blocker of its members without a query per edge.

        The blockers live in another space, so every edge names a source the
        chain's own items do not hold; naming it must not cost a read of its own.
        """

        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.dict(os.environ, {"VALKAMA_DB": os.path.join(directory, "valkama.sqlite3")}),
            closing(store.connect()) as conn,
        ):
            roots = {}
            for key, blockers in (("FEW", 2), ("MANY", 150)):
                service.create_planning_space(conn, project_id=key.lower(), name=key, key=key)
                roots[key] = service.create_work_item(conn, space=key, title="Root", kind="epic")
                member = service.create_work_item(
                    conn, space=key, title="Member", parent=roots[key]["reference"]
                )
                roots[key]["blockers"] = blockers
                roots[key]["member"] = member["work_item_id"]
            service.create_planning_space(conn, project_id="out", name="Outside", key="OUT")
            for key, root in roots.items():
                for number in range(root["blockers"]):
                    other = service.create_work_item(conn, space="OUT", title=f"{key} {number}")
                    service.link_work_items(conn, other["reference"], root["member"], "blocks")
            conn.commit()

            def statements(reference: str) -> tuple[int, int]:
                count = 0

                def trace(_statement: str) -> None:
                    nonlocal count
                    count += 1

                conn.set_trace_callback(trace)
                try:
                    edges = len(chain.chain(conn, reference)["edges"])
                finally:
                    conn.set_trace_callback(None)
                return edges, count

            (few_edges, few_cost), (many_edges, many_cost) = (
                statements(roots["FEW"]["reference"]),
                statements(roots["MANY"]["reference"]),
            )
            self.assertEqual((2, 150), (few_edges, many_edges))
            self.assertEqual(few_cost, many_cost)
