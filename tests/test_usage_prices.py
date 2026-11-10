"""Prices against the published tables: every expected value is worked out by hand here."""

from __future__ import annotations

import unittest

from server.telemetry import usage_prices
from server.telemetry.usage_prices import request_cost

ONE_OF_EACH = {
    "input": 1_000_000,
    "cached_read": 1_000_000,
    "cache_write_5m": 1_000_000,
    "cache_write_1h": 1_000_000,
    "output": 1_000_000,
}


class ClaudeTests(unittest.TestCase):
    def test_the_table_prices_each_kind_apart(self) -> None:
        for model, expected in (
            ("claude-opus-5-5", 4 + 0.20 + 5 + 8 + 20),
            ("claude-sonnet-5-5", 2 + 0.10 + 2.5 + 4 + 10),
            ("claude-fable-5-1", 10 + 0.25 + 12.5 + 20 + 50),
            ("claude-opus-5", 5 + 0.5 + 6.25 + 10 + 25),
        ):
            with self.subTest(model):
                self.assertAlmostEqual(expected, request_cost(model, ONE_OF_EACH))

    def test_fable_5_2_prices_each_kind_at_its_own_rate(self) -> None:
        # The pricing page, read 2026-11-10: $8 input, $0.20 cache hits, $10 and $16 for
        # five-minute and one-hour writes, $40 output, per million tokens. A different
        # count of each kind, so two rates swapped give another total.
        spent = {
            "input": 1_000_000,
            "cached_read": 2_000_000,
            "cache_write_5m": 3_000_000,
            "cache_write_1h": 4_000_000,
            "output": 5_000_000,
        }
        self.assertAlmostEqual(
            8 + 2 * 0.20 + 3 * 10 + 4 * 16 + 5 * 40, request_cost("claude-fable-5-2", spent)
        )

    def test_fable_5_2_in_fast_mode_pays_the_pages_fast_prices(self) -> None:
        # The page's fast-mode table: $16 input and $80 output per million tokens.
        self.assertAlmostEqual(
            16 + 80,
            request_cost("claude-fable-5-2", {"input": 10**6, "output": 10**6}, speed="fast"),
        )

    def test_a_write_for_an_hour_costs_more_than_one_for_five_minutes(self) -> None:
        self.assertAlmostEqual(5.0, request_cost("claude-opus-5-5", {"cache_write_5m": 10**6}))
        self.assertAlmostEqual(8.0, request_cost("claude-opus-5-5", {"cache_write_1h": 10**6}))

    def test_haiku_over_a_hundred_thousand_pays_the_higher_prices_for_all_of_it(self) -> None:
        # The prompt is 100,000 exactly: the lower prices.
        at_limit = {"input": 1_000, "cached_read": 90_000, "cache_write_5m": 9_000, "output": 2_000}
        self.assertAlmostEqual(
            (1_000 * 0.10 + 90_000 * 0.01 + 9_000 * 0.125 + 2_000 * 0.50) / 1e6,
            request_cost("claude-haiku-5-5", at_limit),
        )
        # One more cached token makes the whole request dearer, its cache reads included.
        over = {**at_limit, "cached_read": 90_001}
        self.assertAlmostEqual(
            (1_000 * 0.50 + 90_001 * 0.05 + 9_000 * 0.625 + 2_000 * 2.50) / 1e6,
            request_cost("claude-haiku-5-5", over),
        )

    def test_the_output_does_not_count_towards_the_prompt(self) -> None:
        self.assertAlmostEqual(
            (90_000 * 0.10 + 90_000 * 0.50) / 1e6,
            request_cost("claude-haiku-5-5", {"input": 90_000, "output": 90_000}),
        )

    def test_us_only_inference_costs_a_tenth_more_on_every_kind(self) -> None:
        self.assertAlmostEqual(
            (4 + 0.20 + 5 + 8 + 20) * 1.1, request_cost("claude-opus-5-5", ONE_OF_EACH, geo="us")
        )
        for geo in ("global", "not_available", None):
            with self.subTest(geo):
                self.assertAlmostEqual(
                    4 + 0.20 + 5 + 8 + 20, request_cost("claude-opus-5-5", ONE_OF_EACH, geo=geo)
                )

    def test_fast_mode_doubles_the_models_that_have_it(self) -> None:
        self.assertAlmostEqual(
            8 + 40, request_cost("claude-opus-5-5", {"input": 10**6, "output": 10**6}, speed="fast")
        )
        self.assertAlmostEqual(
            10.0, request_cost("claude-opus-5-5", {"cache_write_5m": 10**6}, speed="fast")
        )
        self.assertAlmostEqual(
            0.4, request_cost("claude-opus-5-5", {"cached_read": 10**6}, speed="fast")
        )

    def test_a_speed_no_page_prices_for_that_model_has_no_price(self) -> None:
        self.assertIsNone(request_cost("claude-sonnet-5-5", ONE_OF_EACH, speed="fast"))
        self.assertIsNone(request_cost("claude-opus-5-5", ONE_OF_EACH, speed="warp"))

    def test_a_search_is_charged_on_top_of_tokens(self) -> None:
        self.assertAlmostEqual(
            20.0 + 3 * 0.01, request_cost("claude-opus-5-5", {"output": 10**6}, searches=3)
        )

    def test_a_dated_or_suffixed_id_is_the_same_model(self) -> None:
        self.assertAlmostEqual(5.0, request_cost("claude-opus-4-5-20251101", {"input": 10**6}))
        self.assertAlmostEqual(4.0, request_cost("claude-opus-5-5[1m]", {"input": 10**6}))


class OpenAiTests(unittest.TestCase):
    def test_up_to_the_limit_is_short_and_past_it_the_whole_request_is_long(self) -> None:
        short = {"input": 72_000, "cached_read": 200_000, "output": 10_000}
        self.assertAlmostEqual(
            (72_000 * 2 + 200_000 * 0.10 + 10_000 * 10) / 1e6, request_cost("gpt-6.1-sol", short)
        )
        long_prompt = {**short, "input": 72_001}
        self.assertAlmostEqual(
            (72_001 * 4 + 200_000 * 0.20 + 10_000 * 15) / 1e6,
            request_cost("gpt-6.1-sol", long_prompt),
        )

    def test_the_flagship_is_priced(self) -> None:
        self.assertAlmostEqual(
            0.1 * 10 + 0.1 * 1 + 50,
            request_cost(
                "gpt-6-astra", {"input": 100_000, "cached_read": 100_000, "output": 10**6}
            ),
        )

    def test_long_prices_of_the_models_the_page_gives_them_for(self) -> None:
        over = {"input": 300_000, "output": 1_000_000}
        for model, expected in (
            ("gpt-6-astra", 0.3 * 20 + 75),
            ("gpt-6-luna", 0.3 * 0.20 + 0.75),
            ("gpt-5.6-sol", 0.3 * 8 + 30),
            ("gpt-6.1-terra", 0.3 * 2 + 7.5),
            ("gpt-6-sol", 0.3 * 4 + 15),
            ("gpt-5.6-terra", 0.3 * 4 + 18),
            ("gpt-5.6-luna", 0.3 * 0.40 + 1.80),
        ):
            with self.subTest(model):
                self.assertAlmostEqual(expected, request_cost(model, over))

    def test_a_model_with_no_long_prices_keeps_its_only_ones(self) -> None:
        self.assertAlmostEqual(
            0.3 * 1.75 + 14, request_cost("gpt-5.3-codex", {"input": 300_000, "output": 10**6})
        )

    def test_fast_is_twice_the_tier_it_falls_in(self) -> None:
        self.assertAlmostEqual(
            2 * (0.3 * 4 + 15),
            request_cost("gpt-6.1-sol", {"input": 300_000, "output": 10**6}, speed="priority"),
        )

    def test_a_tier_nobody_has_seen_has_no_price(self) -> None:
        self.assertIsNone(request_cost("gpt-6.1-sol", {"input": 1}, speed="flex"))

    def test_the_inference_geo_of_another_vendor_changes_nothing(self) -> None:
        self.assertAlmostEqual(0.2, request_cost("gpt-6.1-sol", {"input": 100_000}, geo="us"))

    def test_a_cache_write_with_no_listed_price_leaves_the_request_unpriced(self) -> None:
        self.assertIsNone(request_cost("gpt-5.3-codex", {"cache_write_5m": 1}))
        self.assertAlmostEqual(0.0, request_cost("gpt-5.3-codex", {"cache_write_5m": 0}))


class UnknownTests(unittest.TestCase):
    def test_a_model_on_neither_page_has_no_price_and_not_a_zero(self) -> None:
        for model in ("codex-auto-review", "gpt-99", "claude-opus-9-9", "<synthetic>", ""):
            with self.subTest(model):
                self.assertIsNone(request_cost(model, ONE_OF_EACH))

    def test_reasoning_costs_nothing_apart(self) -> None:
        self.assertAlmostEqual(
            20.0, request_cost("claude-opus-5-5", {"output": 10**6, "reasoning": 10**6})
        )

    def test_each_listing_holds_the_prices_a_request_pays(self) -> None:
        # The release check compares the listings with another list, so they must be
        # what requests are priced at, the long prices past their length included.
        for model, listing in usage_prices.listings().items():
            with self.subTest(model):
                for kind in usage_prices.PRICED_KINDS:
                    rate = getattr(listing.rates, kind)
                    # A thousand tokens stays under every length a long price starts at.
                    cost = request_cost(model, {kind: 1_000})
                    if rate is None or cost is None:
                        self.assertEqual(rate, cost, kind)
                    else:
                        self.assertAlmostEqual(rate, cost * 1_000, msg=kind)
                if listing.long is not None and listing.long_prompt is not None:
                    over = listing.long_prompt + 1
                    self.assertAlmostEqual(
                        listing.long.input * over / 1e6, request_cost(model, {"input": over})
                    )

    def test_the_book_is_a_date(self) -> None:
        self.assertRegex(usage_prices.PRICE_BOOK, r"^\d{4}-\d{2}-\d{2}$")


if __name__ == "__main__":
    unittest.main()
