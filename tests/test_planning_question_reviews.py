"""A review: a question whose rows are verdicts, with the steps and ways of a point under it.

Every expected value, refusal and line is the one `docs/connection-contract.md`
states under "Questions and decisions", "The difference between two answers" and
"Reading a question", written out here rather than read from the code under test.
The review case is a form of the size a real one had, 18 points and 7 fields under
them in six groups, with neutral wording. The stores are real ones; an agent's
calls go through `mcp_surface`, a person's through the HTTP handlers under
`calls.browser()`.
"""

from __future__ import annotations

import json
import string
import unittest

from server import mcp_surface
from server.planning import api, calls, model, person_events, request_model, service, tools
from tests.test_planning_questions import WEB_FIELD_KEYS, WEB_REQUEST_KEYS, QuestionCase

#: The two points of a review the contract shows, one with its steps and one with its way.
CONTRACT_REVIEW = [
    {
        "id": "p4",
        "label": "P4 Checks: false alarms",
        "type": "verdict",
        "required": False,
        "options": [],
        "group": "Checks",
        "recommended": "accept",
        "description": "Fourteen refusals last week were false alarms.",
    },
    {
        "id": "p4-steps",
        "label": "Steps",
        "type": "multi_choice",
        "required": True,
        "under": {"field": "p4", "option": "accept"},
        "options": [
            {
                "id": "p4a",
                "label": "Mark the 14 refusals, then narrow the rule",
                "recommended": True,
            },
            {
                "id": "p4b",
                "label": "Check the claim against the file it names",
                "recommended": True,
            },
            {"id": "p4c", "label": "Skip the check on an intermediate stop"},
        ],
    },
    {
        "id": "p13",
        "label": "P13 A 400-line limit for .vue files",
        "type": "verdict",
        "required": False,
        "options": [],
        "group": "Web code",
        "recommended": "accept",
    },
    {
        "id": "p13-way",
        "label": "How",
        "type": "choice",
        "required": True,
        "under": {"field": "p13", "option": "accept"},
        "options": [
            {"id": "per_block", "label": "vue/max-lines-per-block", "recommended": True},
            {"id": "css_file", "label": "Styles in CSS files"},
            {"id": "split_first", "label": "Split the files first"},
        ],
    },
]

#: The review case: the groups, which points have steps or ways under them, and how many.
GROUPS = (
    ("Hooks", (1, 2, 3)),
    ("Skills", (4, 5, 6)),
    ("Instructions", (7, 8, 9)),
    ("Service", (10, 11, 12, 13)),
    ("Lab", (14, 15, 16)),
    ("Minor", (17, 18)),
)
STEPS = {4: 3, 5: 5, 10: 13, 15: 5, 17: 4}
WAYS = {
    11: ("retry_once", "retry_backoff", "no_retry"),
    13: ("per_block", "css_file", "split_first", "lint_only"),
}
TOPICS = {
    1: "name the hook that refused a call",
    2: "stop a hook after ten seconds",
    3: "log a hook's refusal once",
    4: "false alarms in the checks",
    5: "split the long skill into references",
    6: "retire the unused skill",
    7: "one rule per topic file",
    8: "shorter start-up instructions",
    9: "labels on the tracker",
    10: "a line limit for source files",
    11: "retry a failed read",
    12: "a second store for archives",
    13: "a 400-line limit for `.vue` files",
    14: "repeat a benchmark three times",
    15: "freeze the shared batch helpers",
    16: "a dashboard of past runs",
    17: "rename the scratch directory",
    18: "a spelling check on commits",
}
RECOMMENDED = {12: "later", 16: "reject"}


def review_case() -> list[dict]:
    """The 25-field form: a verdict per point, each point's steps or way right under it."""

    form: list[dict] = []
    for group, points in GROUPS:
        for n in points:
            form.append(
                {
                    "id": f"p{n}",
                    "label": f"P{n} {group}: {TOPICS[n]}",
                    "type": "verdict",
                    "required": False,
                    "options": [],
                    "group": group,
                    "recommended": RECOMMENDED.get(n, "accept"),
                    "description": (
                        f"Seen in MAIN-{20 + n} and MAIN-{40 + n}: {TOPICS[n]} came up in"
                        f" {n + 2} sessions last month.\n\n**Cost**: about {n} hours, and"
                        f" `checks/rule_{n}.py` changes with it. Leaving it costs a repeat of"
                        " the same correction in each session that meets it."
                    ),
                }
            )
            if n in STEPS:
                form.append(
                    {
                        "id": f"p{n}-steps",
                        "label": "Steps",
                        "type": "multi_choice",
                        "required": True,
                        "under": {"field": f"p{n}", "option": "accept"},
                        "options": [
                            {
                                "id": f"p{n}{letter}",
                                "label": f"Step {letter} of P{n}: change `rule_{n}_{letter}`",
                                "description": f"Touches MAIN-{60 + n}; one commit.",
                                "recommended": place < STEPS[n] - 1 or STEPS[n] == 5,
                            }
                            for place, letter in enumerate(string.ascii_lowercase[: STEPS[n]])
                        ],
                    }
                )
            if n in WAYS:
                form.append(
                    {
                        "id": f"p{n}-way",
                        "label": "How",
                        "type": "choice",
                        "required": True,
                        "under": {"field": f"p{n}", "option": "accept"},
                        "options": [
                            {
                                "id": way,
                                "label": way.replace("_", " ").capitalize(),
                                **({"recommended": True} if place == 0 else {}),
                            }
                            for place, way in enumerate(WAYS[n])
                        ],
                    }
                )
    return form


#: The owner's whole answer to the review case: the recommendations, one point
#: rejected against its recommendation with a comment, one with an own variant.
CASE_ANSWERS = {
    **{f"p{n}": RECOMMENDED.get(n, "accept") for n in range(1, 19) if n != 9},
    "p15": "reject",
    "p4-steps": ["p4a", "p4b"],
    "p5-steps": ["p5a", "p5b", "p5c", "p5d", "p5e"],
    "p10-steps": [f"p10{letter}" for letter in "abcdefghijkl"],
    "p11-way": "retry_once",
    "p13-way": "per_block",
    "p17-steps": ["p17a", "p17b", "p17c"],
}
CASE_OWN = {"p9": "Labels only, no filtering"}
CASE_NOTES = {"p12": "After the release", "p15": "Frozen until spring"}
CASE_NOTE = "Start with the hooks."


def size(item: object) -> int:
    return len(json.dumps(item, ensure_ascii=False))


class ReviewCase(QuestionCase):
    def refusal(self, fields: list[dict]) -> str:
        """What creating a question with these fields is refused with; nothing is written."""

        before = self.count()
        with self.assertRaises(model.PlanningError) as caught:
            self.ask(fields)
        self.assertEqual(
            (400, "invalid_request"),
            (api.error_response(caught.exception)[0], self.code(caught.exception)),
        )
        self.assertEqual(before, self.count())
        return str(caught.exception)

    def refused_answer(self, request: dict, answers: dict, **others: object) -> str:
        before = self.conn.execute(
            "SELECT revision, answers_json FROM work_item_requests WHERE request_id=?",
            (request["request_id"],),
        ).fetchone()
        with self.assertRaises(model.PlanningError) as caught:
            self.answer(request, answers, **others)
        self.assertEqual("invalid_request", self.code(caught.exception))
        self.assertEqual(
            tuple(before),
            tuple(
                self.conn.execute(
                    "SELECT revision, answers_json FROM work_item_requests WHERE request_id=?",
                    (request["request_id"],),
                ).fetchone()
            ),
        )
        return str(caught.exception)

    def stored(self, request: dict) -> dict:
        found = self.stored_answers(request)
        assert isinstance(found, dict)
        return found

    @staticmethod
    def code(error: BaseException) -> str:
        return str(api.error_response(error)[1]["error"]["code"])

    def count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0])

    def compact(self, request: dict) -> dict:
        [found] = [
            row
            for row in self.tool("list_work_item_requests", id=self.reference)["requests"]
            if row["id"] == request["request_id"]
        ]
        return found

    def as_person(self, operation: str, request: dict, **others: object) -> dict:
        # Bound to its own path, as the HTTP surface binds it: only Planning's paths
        # are a person's words to tell.
        path = f"/api/planning/request/{operation}"
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(
                self.conn,
                path,
                {
                    "id": request["request_id"],
                    "expected_revision": request["revision"],
                    "author": "user",
                    **others,
                },
            )
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def told(self, kind: str) -> dict:
        """The newest event of a kind a person's write left for the agents on the item."""

        identity = service.get_work_item(self.conn, self.reference)["work_item_id"]
        return [
            event
            for event in person_events.since_last_agent_write(self.conn, identity)
            if event["kind"] == kind
        ][-1]


def verdict(identity: str, group: str | None = None, **extra: object) -> dict:
    field: dict = {
        "id": identity,
        "label": identity.upper(),
        "type": "verdict",
        "required": False,
        "options": [],
    }
    if group is not None:
        field["group"] = group
    return {**field, **extra}


def steps(identity: str, parent: str, option: str = "accept", **extra: object) -> dict:
    return {
        "id": identity,
        "label": "Steps",
        "type": "multi_choice",
        "required": True,
        "under": {"field": parent, "option": option},
        "options": [
            {"id": f"{identity[:2]}a", "label": "A"},
            {"id": f"{identity[:2]}b", "label": "B"},
        ],
        **extra,
    }


AREA_OPTIONS = [{"id": "api", "label": "The API"}, {"id": "web", "label": "The web"}]
AREAS = {
    "id": "areas",
    "label": "Areas",
    "type": "multi_choice",
    "required": False,
    "options": AREA_OPTIONS,
}
WEB_DETAIL = {
    "id": "web-detail",
    "label": "Which screens",
    "type": "text",
    "required": True,
    "under": {"field": "areas", "option": "web"},
    "options": [],
}


#: The contract's way under p13, standing on its own.
WAY = {name: value for name, value in CONTRACT_REVIEW[3].items() if name != "under"}


class SchemaRefusalTests(ReviewCase):
    def test_each_mistake_in_a_schema_is_refused_naming_the_field_and_the_way_out(self) -> None:
        text = {"id": "p4", "label": "P4", "type": "text", "required": False, "options": []}
        cases = [
            (
                [verdict("p1", options=[{"id": "yes", "label": "Yes"}])],
                "field p1: a verdict takes no options; put steps or ways in a field with"
                " under: {field: p1, option: accept}",
            ),
            (
                [steps("p4-steps", "p4"), verdict("p4")],
                "field p4-steps: under names p4, which no earlier field has;"
                " a parent stands before its children",
            ),
            (
                [text, steps("p4-steps", "p4")],
                "field p4-steps: under names p4, a text field;"
                " a parent is a verdict, choice or multi_choice field",
            ),
            (
                [verdict("p4"), steps("p4-steps", "p4", option="yes")],
                "field p4-steps: p4 is a verdict, so under.option is accept, later or reject",
            ),
            (
                [AREAS, {**WEB_DETAIL, "under": {"field": "areas", "option": "x"}}],
                "field web-detail: option x is not an option of areas",
            ),
            (
                [verdict("z"), steps("y", "z"), steps("x", "y", option="ya")],
                "field x: under names y, which stands under z; one level: put it under z",
            ),
            (
                [verdict("p4", "Checks"), steps("p4-steps", "p4", group="Web code")],
                "field p4-steps: a field under p4 stands in p4's group; leave group out",
            ),
            (
                [{**WAY, "id": "p11", "recommended": "accept"}],
                "field p11: recommended on a field is for a verdict; in a choice put it on the"
                " option",
            ),
            (
                [verdict("p1", "Checks"), verdict("p2", "Web code"), verdict("p3", "Checks")],
                "group Checks is split by Web code: fields of one group stand together",
            ),
            (
                [verdict("p1", "Checks"), verdict("p7"), verdict("p3", "Checks")],
                "group Checks is split by p7, which has no group: fields of one group stand"
                " together",
            ),
            (
                [verdict(f"p{n}") for n in range(41)],
                "fields must contain between 1 and 40 fields",
            ),
            (
                [verdict("p1", colour="red")],
                "each field requires id, label, type, required and options and may add"
                " description, group, under and recommended",
            ),
        ]
        for fields, refusal in cases:
            with self.subTest(refusal=refusal):
                self.assertEqual(refusal, self.refusal(fields))

    def test_forty_fields_are_the_most_and_a_group_may_hold_its_fields_under_it(self) -> None:
        created = self.ask([verdict(f"p{n}") for n in range(40)])
        self.assertEqual(40, len(created["fields"]))
        # The steps leave the group out or repeat it, and a field with no group after
        # the group has ended does not split it.
        fields = [
            verdict("p1", "Checks"),
            steps("p1-steps", "p1"),
            verdict("p2", "Checks"),
            steps("p2-steps", "p2", group="Checks"),
            verdict("p3"),
        ]
        self.assertEqual(fields, self.ask(fields)["fields"])

    def test_a_field_written_without_the_four_keys_is_what_it_always_was(self) -> None:
        plain = {"id": "path", "label": "Which", "type": "choice", "required": True}
        plain["options"] = [{"id": "keep", "label": "Keep"}]
        [stored] = self.ask([plain])["fields"]
        self.assertEqual(plain, stored)

    def test_the_review_case_is_written_whole_and_fits_in_64_kib(self) -> None:
        form = review_case()
        self.assertEqual(
            (25, 18),
            (len(form), sum(1 for field in form if field["type"] == "verdict")),
        )
        created = self.ask(form, prompt="Decisions on the review of the checks")
        self.assertEqual(form, created["fields"])
        read = self.tool("get_work_item_request", id=created["request_id"])
        self.assertEqual(form, read["fields"])
        stored = self.conn.execute(
            "SELECT fields_json FROM work_item_requests WHERE request_id=?",
            (created["request_id"],),
        ).fetchone()[0]
        self.assertLess(len(stored.encode("utf-8")), request_model.MAX_FIELDS_BYTES)


class AnswerRefusalTests(ReviewCase):
    def test_a_hidden_field_takes_no_value_own_variant_or_comment(self) -> None:
        request = self.ask(CONTRACT_REVIEW)
        refusal = "answer p4-steps stands under p4=accept, and p4 is later; leave it out"
        for others in (
            {"answers": {"p4": "later", "p4-steps": ["p4a"]}},
            {"answers": {"p4": "later"}, "own": {"p4-steps": "My own steps"}},
            {"answers": {"p4": "later"}, "field_notes": {"p4-steps": "Not these"}},
        ):
            with self.subTest(others=others):
                answers = others.pop("answers")
                self.assertEqual(refusal, self.refused_answer(request, answers, **others))

    def test_the_parent_reads_as_what_it_was_given(self) -> None:
        request = self.ask([AREAS, WEB_DETAIL])
        for answers, own, reads in (
            ({"areas": ["api"]}, {}, "api"),
            ({}, {"areas": "Docs"}, "own variant"),
            ({}, {}, "unanswered"),
        ):
            with self.subTest(reads=reads):
                self.assertEqual(
                    f"answer web-detail stands under areas=web, and areas is {reads}; leave it out",
                    self.refused_answer(request, {**answers, "web-detail": "x"}, own=own),
                )
        # A verdict given an own variant holds none of the three.
        review = self.ask(CONTRACT_REVIEW)
        self.assertEqual(
            "answer p4-steps stands under p4=accept, and p4 is own variant; leave it out",
            self.refused_answer(review, {"p4-steps": ["p4a"]}, own={"p4": "Only the first"}),
        )

    def test_a_required_field_under_another_is_required_only_while_it_is_shown(self) -> None:
        request = self.ask(CONTRACT_REVIEW)
        refusal = (
            "answer p4-steps is required because p4 is accept;"
            " give an option or your own variant in own"
        )
        self.assertEqual(refusal, self.refused_answer(request, {"p4": "accept"}))
        self.assertEqual(refusal, self.refused_answer(request, {"p4": "accept", "p4-steps": []}))
        # Hidden, it is not asked for; an own variant answers it as any field's does.
        answered = self.answer(request, {"p4": "later"})
        self.assertEqual({"p4": "later"}, answered["answers"])
        other = self.ask(CONTRACT_REVIEW)
        own = self.answer(other, {"p4": "accept", "p4-steps": []}, own={"p4-steps": "Mine"})
        self.assertEqual({"p4-steps": "Mine"}, own["own"])

    def test_a_verdict_is_accept_later_or_reject_and_not_beside_its_own_variant(self) -> None:
        request = self.ask(CONTRACT_REVIEW)
        for value in ("maybe", True, ["accept"], ""):
            with self.subTest(value=value):
                self.assertEqual(
                    "answer p4 is accept, later or reject",
                    self.refused_answer(request, {"p4": value}),
                )
        self.assertEqual(
            "answer p4: an option or your own variant, not both",
            self.refused_answer(request, {"p4": "reject"}, own={"p4": "Half of it"}),
        )
        required = self.ask([verdict("p1", required=True)])
        self.assertEqual(
            "answer p1 is required; give an option or your own variant in own;"
            " a note no longer stands in for a field",
            self.refused_answer(required, {}, note="Yes"),
        )


class CompactReviewTests(ReviewCase):
    def test_the_contract_s_review_reads_as_the_contract_shows_it(self) -> None:
        fields = [
            verdict("p1"),
            *CONTRACT_REVIEW[:2],
            verdict("p9"),
            verdict("p12"),
            *CONTRACT_REVIEW[2:],
            verdict("p15"),
            verdict("p17"),
        ]
        # Without groups, so the verdicts around them split none.
        fields = [
            {name: value for name, value in field.items() if name != "group"} for field in fields
        ]
        request = self.ask(fields, prompt="Decisions on the review of the checks")
        self.answer(
            request,
            {
                "p1": "accept",
                "p12": "later",
                "p15": "reject",
                "p4": "accept",
                "p4-steps": ["p4a", "p4c"],
                "p13": "accept",
                "p13-way": "per_block",
            },
            field_notes={"p15": "Frozen until spring"},
            own={"p9": "Labels only, no filtering"},
        )
        compact = self.compact(request)
        self.assertEqual(
            {
                "verdicts": {"accept": ["p1", "p4", "p13"], "later": ["p12"], "reject": ["p15"]},
                "undecided": ["p17"],
                "answer": [
                    {
                        "field": "p4-steps",
                        "under": "p4",
                        "of": 3,
                        "value": ["p4a", "p4c"],
                        "label": None,
                    },
                    {
                        "field": "p9",
                        "value": None,
                        "label": None,
                        "own": "Labels only, no filtering",
                    },
                    {
                        "field": "p13-way",
                        "under": "p13",
                        "value": "per_block",
                        "label": "vue/max-lines-per-block",
                    },
                    {
                        "field": "p15",
                        "value": "reject",
                        "label": None,
                        "note": "Frozen until spring",
                    },
                ],
            },
            {name: compact[name] for name in ("verdicts", "undecided", "answer")},
        )
        self.assertEqual(
            ["id", "status", "question", "verdicts", "undecided", "answer"], list(compact)[:6]
        )
        self.assertNotIn("clipped", compact)
        self.assertEqual(
            "accept 3; later: p12; reject: p15 (comment: Frozen until spring);"
            " p9 own variant: Labels only, no filtering; p4-steps 2/3; p13-way: per_block;"
            " undecided: p17",
            request_model.answer_text(fields, self.stored(request)),
        )

    def test_the_whole_answer_to_the_review_case_reads_without_clipping(self) -> None:
        request = self.ask(review_case(), prompt="Decisions on the review of the checks")
        self.as_person(
            "answer",
            request,
            answers=CASE_ANSWERS,
            own=CASE_OWN,
            field_notes=CASE_NOTES,
            note=CASE_NOTE,
        )
        compact = self.compact(request)
        self.assertNotIn("clipped", compact)
        self.assertLessEqual(size(compact), request_model.MAX_COMPACT_JSON)
        accepted = [f"p{n}" for n in (1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14, 17, 18)]
        self.assertEqual(
            ({"accept": accepted, "later": ["p12"], "reject": ["p15", "p16"]}, []),
            (compact["verdicts"], compact["undecided"]),
        )
        self.assertEqual(
            [
                {
                    "field": "p4-steps",
                    "under": "p4",
                    "of": 3,
                    "value": ["p4a", "p4b"],
                    "label": None,
                },
                {
                    "field": "p5-steps",
                    "under": "p5",
                    "of": 5,
                    "value": CASE_ANSWERS["p5-steps"],
                    "label": None,
                },
                {"field": "p9", "value": None, "label": None, "own": "Labels only, no filtering"},
                {
                    "field": "p10-steps",
                    "under": "p10",
                    "of": 13,
                    "value": CASE_ANSWERS["p10-steps"],
                    "label": None,
                },
                {"field": "p11-way", "under": "p11", "value": "retry_once", "label": "Retry once"},
                {"field": "p12", "value": "later", "label": None, "note": "After the release"},
                {"field": "p13-way", "under": "p13", "value": "per_block", "label": "Per block"},
                {"field": "p15", "value": "reject", "label": None, "note": "Frozen until spring"},
                {
                    "field": "p17-steps",
                    "under": "p17",
                    "of": 4,
                    "value": ["p17a", "p17b", "p17c"],
                    "label": None,
                },
            ],
            compact["answer"],
        )
        # The person's answer reaches the agent as the summary a notice fits.
        self.assertEqual(
            "accept 14; later: p12 (comment: After the release);"
            " reject: p15 (comment: Frozen until spring), p16;"
            " p9 own variant: Labels only, no filtering; p4-steps 2/3; p5-steps 5/5;"
            " p10-steps 12/13; p11-way: retry_once; p13-way: per_block; p17-steps 3/4;"
            " Start with the hooks.",
            self.told("question_answered")["text"],
        )

    def test_a_question_not_yet_answered_has_every_shown_verdict_undecided(self) -> None:
        request = self.ask(CONTRACT_REVIEW)
        compact = self.compact(request)
        self.assertEqual(
            ({"accept": [], "later": [], "reject": []}, ["p4", "p13"], []),
            (compact["verdicts"], compact["undecided"], compact["answer"]),
        )

    def test_the_two_lists_are_never_cut_and_only_rows_are_lost(self) -> None:
        ids = [f"p{n:02}" + "x" * 61 for n in range(40)]
        request = self.ask([verdict(identity) for identity in ids])
        self.answer(
            request,
            dict.fromkeys(ids[:39], "accept"),
            field_notes=dict.fromkeys(ids, "c" * 40),
        )
        compact = self.compact(request)
        self.assertEqual(
            (ids[:39], [ids[39]], [], True),
            (
                compact["verdicts"]["accept"],
                compact["undecided"],
                compact["answer"],
                compact["clipped"],
            ),
        )

    def test_a_point_s_rows_lose_their_labels_before_any_row_is_lost(self) -> None:
        options = [{"id": f"o{n:02}", "label": "l" * 180} for n in range(4)]
        fields = [
            verdict("p1"),
            *(
                {
                    "id": f"p1-way{n}",
                    "label": "How",
                    "type": "choice",
                    "required": False,
                    "under": {"field": "p1", "option": "accept"},
                    "options": options,
                }
                for n in range(9)
            ),
        ]
        request = self.ask(fields)
        self.answer(request, {"p1": "accept", **{f"p1-way{n}": "o01" for n in range(9)}})
        compact = self.compact(request)
        self.assertIs(True, compact["clipped"])
        self.assertEqual(
            [
                {"field": f"p1-way{n}", "under": "p1", "value": "o01", "label": None}
                for n in range(9)
            ],
            compact["answer"],
        )


class OldFormTests(ReviewCase):
    """A question with no verdict field: the form a review took before verdicts."""

    def old_form(self) -> list[dict]:
        executors = ("Hooks", "Skills", "Instructions", "Service", "Lab", "Minor")
        fields = [
            {
                "id": name.lower(),
                "label": f"{name}: what to take",
                "type": "multi_choice",
                "required": False,
                "options": [
                    {"id": f"{name.lower()[:3]}{n}", "label": f"P{n} {name}: " + "w" * 150}
                    for n in range(1, 5)
                ],
            }
            for name in executors
        ]
        fields += [
            {
                "id": f"way{n}",
                "label": f"Way {n}",
                "type": "choice",
                "required": False,
                "options": [{"id": "keep", "label": "Keep as it is " + "k" * 120}],
            }
            for n in (1, 2)
        ]
        fields.append({"id": "reject", "label": "What to reject and why", "type": "text"})
        fields[-1] |= {"required": False, "options": []}
        fields.append({"id": "sure", "label": "Sure", "type": "boolean", "required": False})
        fields[-1]["options"] = []
        return fields

    def test_its_answer_reads_as_before_with_every_field_and_no_review_keys(self) -> None:
        fields = self.old_form()
        request = self.ask(fields)
        answers: dict = {
            field["id"]: [option["id"] for option in field["options"]]
            for field in fields
            if field["type"] == "multi_choice"
        }
        answers |= {"way1": "keep", "way2": "keep", "reject": "P7, for now", "sure": True}
        self.answer(request, answers)
        compact = self.compact(request)
        self.assertNotIn("verdicts", compact)
        self.assertNotIn("undecided", compact)
        # Past 2000 characters the labels go before any field: all ten stay.
        self.assertEqual(
            [
                {"field": field["id"], "value": answers[field["id"]], "label": None}
                for field in fields
            ],
            compact["answer"],
        )
        self.assertIs(True, compact["clipped"])
        self.assertLessEqual(size(compact), request_model.MAX_COMPACT_JSON)
        line = request_model.answer_text(fields, self.stored(request))
        self.assertTrue(line.startswith("Hooks: what to take: P1 Hooks: "), line)
        self.assertTrue(line.endswith("; What to reject and why: P7, for now; Sure: True"), line)

    def test_a_changed_answer_loses_its_previous_before_its_labels(self) -> None:
        fields = self.old_form()[:6]
        request = self.ask(fields)
        first = self.answer(request, {"hooks": ["hoo1"]})
        self.answer(
            first,
            {field["id"]: [option["id"] for option in field["options"]] for field in fields},
            change=True,
        )
        compact = self.compact(request)
        self.assertNotIn("previous", compact)
        self.assertEqual([None] * 6, [row["label"] for row in compact["answer"]])
        self.assertIs(True, compact["clipped"])


class BatchAndSchemaTests(ReviewCase):
    def test_a_review_asked_in_a_batch_is_held_to_the_same_rules(self) -> None:
        applied = mcp_surface.run_tool_call(
            self.conn,
            "apply_work_item_changes",
            {
                "id": self.reference,
                "questions": [{"kind": "decision", "prompt": "Review", "fields": review_case()}],
            },
        )
        self.conn.commit()
        assert isinstance(applied, dict)
        [asked] = applied["applied"]["questions"]
        self.assertEqual(
            review_case(), self.tool("get_work_item_request", id=asked["request_id"])["fields"]
        )
        before = self.count()
        wrong = [verdict("p1", options=[{"id": "yes", "label": "Yes"}])]
        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.run_tool_call(
                self.conn,
                "apply_work_item_changes",
                {
                    "id": self.reference,
                    "questions": [{"kind": "decision", "prompt": "R", "fields": wrong}],
                },
            )
        self.conn.commit()
        self.assertEqual(
            "questions[0]: field p1: a verdict takes no options; put steps or ways in a field"
            " with under: {field: p1, option: accept}",
            api.error_response(caught.exception)[1]["error"]["message"],
        )
        self.assertEqual(before, self.count())

    def test_the_http_read_of_a_review_stays_what_the_web_schema_accepts(self) -> None:
        request = self.ask(CONTRACT_REVIEW)
        self.answer(request, {"p4": "accept", "p4-steps": ["p4a"], "p13": "reject"})
        listed = api.handle_get(self.conn, "/api/planning/requests", {"space": ["QST"]})
        detail = api.handle_get(self.conn, "/api/planning/request", {"id": [request["request_id"]]})
        assert listed is not None and detail is not None
        [read] = listed[1]["requests"]
        self.assertEqual(WEB_REQUEST_KEYS, set(read))
        self.assertEqual(WEB_FIELD_KEYS, {name for field in read["fields"] for name in field})
        self.assertEqual(CONTRACT_REVIEW, detail[1]["request"]["fields"])

    def test_the_tool_schema_names_every_key_a_field_takes(self) -> None:
        schema = {tool["name"]: tool for tool in tools.TOOLS}["create_work_item_request"]
        fields = schema["inputSchema"]["properties"]["fields"]
        self.assertEqual(request_model.MAX_FIELDS, fields["maxItems"])
        field = fields["items"]
        self.assertEqual(WEB_FIELD_KEYS, set(field["properties"]))
        self.assertIn("verdict", field["properties"]["type"]["enum"])
        self.assertEqual(["accept", "later", "reject"], field["properties"]["recommended"]["enum"])
        self.assertEqual(["field", "option"], field["properties"]["under"]["required"])


if __name__ == "__main__":
    unittest.main()
