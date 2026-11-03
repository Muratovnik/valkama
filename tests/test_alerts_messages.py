"""What an alert says, built from the event and the owner's settings alone.

`messages.build` is a pure function: the event, the item and the settings in, the
toast the helper shows out. What this suite holds: the three `content` levels
reveal exactly what the owner chose, a long title or question is cut at its limit
with an ellipsis, text from the store cannot change the toast's markup, the
click opens the item through the `valkama://` scheme the desktop app registers,
and the language is the one stored with the settings. The wording is the
contract the settings screen describes, so it is stated here rather than read
from the module.
"""

from __future__ import annotations

import unittest
from xml.etree import ElementTree  # noqa: S405 - parses only what this module built

from server.alerts import messages

TITLE_RU = {"enabled": True, "content": "title", "locale": "ru"}
TITLE_EN = {**TITLE_RU, "locale": "en"}
GENERIC_RU = {**TITLE_RU, "content": "generic"}
PROMPT_RU = {**TITLE_RU, "content": "prompt"}


def parsed(message: messages.Message) -> ElementTree.Element:
    return ElementTree.fromstring(message["xml"])  # noqa: S314 - the module's own output


def texts(message: messages.Message) -> list[str]:
    return [element.text or "" for element in parsed(message).iter("text")]


def question(settings: dict, **fields: object) -> messages.Message:
    values: dict = {
        "reference": "MAIN-12",
        "title": "Pick the rollout order",
        "settings": settings,
        "kind": "question",
    }
    values.update(fields)
    return messages.build("question", **values)


class ContentTests(unittest.TestCase):
    def test_generic_names_nothing_about_the_item(self) -> None:
        message = question(GENERIC_RU, prompt="Which order?", open_questions=3)
        self.assertEqual(["Valkama: нужен ваш ответ"], texts(message))
        self.assertNotIn("Pick", message["xml"])
        self.assertNotIn("Which", message["xml"])

    def test_title_names_the_item_and_its_open_questions(self) -> None:
        self.assertEqual(
            ["Valkama: нужен ваш ответ", "MAIN-12 · Pick the rollout order"],
            texts(question(TITLE_RU, prompt="Which order?")),
        )
        self.assertEqual(
            [
                "Valkama: нужен ваш ответ",
                "MAIN-12 · Pick the rollout order",
                "Открытых вопросов по задаче: 3",
            ],
            texts(question(TITLE_RU, open_questions=3)),
        )

    def test_prompt_adds_the_first_line_of_the_question(self) -> None:
        self.assertEqual(
            ["Valkama: нужен ваш ответ", "MAIN-12 · Pick the rollout order", "Which order?"],
            texts(question(PROMPT_RU, prompt="Which order?\nDetails follow here.")),
        )

    def test_each_event_and_kind_has_its_heading(self) -> None:
        cases = {
            ("question", "question"): "Valkama: нужен ваш ответ",
            ("question", "decision"): "Valkama: нужно решение",
            ("review", None): "Valkama: задача на проверке",
            ("launchFailed", None): "Valkama: запуск не удался",
        }
        for (event, kind), heading in cases.items():
            with self.subTest(event=event, kind=kind):
                message = messages.build(
                    event, reference="MAIN-12", title="T", settings=TITLE_RU, kind=kind
                )
                self.assertEqual([heading, "MAIN-12 · T"], texts(message))

    def test_an_unknown_event_or_kind_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            messages.build("itemCompleted", reference="MAIN-12", title="T", settings=TITLE_RU)
        with self.assertRaises(ValueError):
            question(TITLE_RU, kind="poll")


class LanguageTests(unittest.TestCase):
    def test_english_is_used_when_stored(self) -> None:
        self.assertEqual(
            [
                "Valkama: your answer is needed",
                "MAIN-12 · Pick the rollout order",
                "Open questions on this item: 2",
            ],
            texts(question(TITLE_EN, open_questions=2)),
        )
        decision = question(TITLE_EN, kind="decision")
        self.assertEqual("Valkama: a decision is needed", texts(decision)[0])
        review = messages.build("review", reference="MAIN-12", title="T", settings=TITLE_EN)
        self.assertEqual("Valkama: work is ready for review", texts(review)[0])

    def test_an_unknown_language_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            question({**TITLE_RU, "locale": "de"})


class TruncationTests(unittest.TestCase):
    def test_a_title_is_cut_at_eighty_characters(self) -> None:
        exact = "x" * 80
        self.assertEqual(f"MAIN-12 · {exact}", texts(question(TITLE_RU, title=exact))[1])
        cut = texts(question(TITLE_RU, title="y" * 81))[1].removeprefix("MAIN-12 · ")
        self.assertEqual(80, len(cut))
        self.assertEqual("y" * 79 + "…", cut)

    def test_a_question_line_is_cut_at_one_hundred_twenty_characters(self) -> None:
        exact = "q" * 120
        self.assertEqual(exact, texts(question(PROMPT_RU, prompt=exact))[2])
        cut = texts(question(PROMPT_RU, prompt="w" * 200))[2]
        self.assertEqual("w" * 119 + "…", cut)

    def test_line_breaks_and_runs_of_space_in_a_title_become_one_space(self) -> None:
        self.assertEqual(
            "MAIN-12 · Two lines here",
            texts(question(TITLE_RU, title="  Two\r\nlines \t here "))[1],
        )

    def test_a_question_that_starts_with_blank_lines_shows_its_first_text(self) -> None:
        self.assertEqual(
            "Real start", texts(question(PROMPT_RU, prompt="\n\n  Real start\nmore"))[2]
        )

    def test_an_empty_question_adds_no_line(self) -> None:
        self.assertEqual(2, len(texts(question(PROMPT_RU, prompt=" \n "))))


class MarkupTests(unittest.TestCase):
    HOSTILE = '</text></binding><binding template="X"><text>&amp; "quoted" \'single\' <b>'

    def test_markup_in_a_title_or_question_stays_text(self) -> None:
        message = question(PROMPT_RU, title=self.HOSTILE, prompt=self.HOSTILE)
        root = parsed(message)
        self.assertEqual(1, len(root.findall("./visual/binding")))
        self.assertEqual(f"MAIN-12 · {self.HOSTILE}", texts(message)[1])
        self.assertEqual(self.HOSTILE, texts(message)[2])

    def test_characters_xml_cannot_carry_are_dropped(self) -> None:
        message = question(TITLE_RU, title="bell\x07 null\x00 tab\tend\ufffe")
        self.assertEqual("MAIN-12 · bell null tab end", texts(message)[1])

    def test_the_reference_cannot_leave_its_attribute(self) -> None:
        message = question(TITLE_RU, reference='MAIN-1" activationType="foreground')
        root = parsed(message)
        self.assertEqual("protocol", root.get("activationType"))
        self.assertEqual('valkama://open/MAIN-1" activationType="foreground', root.get("launch"))


class EnvelopeTests(unittest.TestCase):
    def test_the_toast_opens_the_item_through_the_desktop_scheme(self) -> None:
        message = question(TITLE_RU)
        root = parsed(message)
        self.assertEqual("toast", root.tag)
        self.assertEqual("valkama://open/MAIN-12", root.get("launch"))
        self.assertEqual("protocol", root.get("activationType"))
        self.assertEqual("ToastGeneric", root.find("./visual/binding").get("template"))
        self.assertEqual(
            {"aumid": "local.valkama", "tag": "MAIN-12", "group": "valkama", "expires_at": None},
            {key: value for key, value in message.items() if key != "xml"},
        )

    def test_an_expiry_is_carried_in_utc_seconds(self) -> None:
        cases = {
            "2026-11-04T10:00:00.000000Z": "2026-11-04T10:00:00Z",
            "2026-11-04T13:00:00.5+03:00": "2026-11-04T10:00:00Z",
        }
        for given, carried in cases.items():
            with self.subTest(given=given):
                self.assertEqual(carried, question(TITLE_RU, expires_at=given)["expires_at"])
        for wrong in ("tomorrow", "2026-11-04T10:00:00"):
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                question(TITLE_RU, expires_at=wrong)

    def test_a_logo_is_placed_only_when_given(self) -> None:
        self.assertIsNone(parsed(question(TITLE_RU)).find(".//image"))
        logo = "file:///C:/Valkama/windows/valkama.ico"
        image = parsed(question(TITLE_RU, logo=logo)).find("./visual/binding/image")
        assert image is not None
        self.assertEqual({"placement": "appLogoOverride", "src": logo}, dict(image.attrib))


class SummaryTests(unittest.TestCase):
    def test_several_items_become_one_toast_that_opens_the_newest(self) -> None:
        message = messages.summary(["MAIN-12", "MAIN-15", "MAIN-20"], settings=TITLE_RU)
        self.assertEqual(
            ["Valkama: ждут вашего ответа: 3", "MAIN-12, MAIN-15, MAIN-20"], texts(message)
        )
        self.assertEqual("valkama://open/MAIN-20", parsed(message).get("launch"))
        self.assertEqual(messages.SUMMARY_TAG, message["tag"])
        self.assertEqual("valkama", message["group"])

    def test_generic_summary_names_no_item(self) -> None:
        message = messages.summary(["MAIN-12", "MAIN-15"], settings={**GENERIC_RU, "locale": "en"})
        self.assertEqual(["Valkama: waiting for your answer: 2"], texts(message))

    def test_a_summary_needs_items(self) -> None:
        with self.assertRaises(ValueError):
            messages.summary([], settings=TITLE_RU)


if __name__ == "__main__":
    unittest.main()
