"""What one request would cost at public API prices. An estimate, not a bill.

A subscription pays differently, so nothing computed here says what anyone paid. The
price depends on the size of each request, so it is worked out per request when a
transcript is read, and the row keeps `PRICE_BOOK` to say which table it came from.
A model neither page names has no price: the answer is None and never a guess.

Anthropic, read 2026-11-05 at https://platform.claude.com/docs/en/about-claude/pricing
and https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool:

- Claude Haiku 5.5 is priced by prompt length, over 100,000 tokens the whole request
  pays the higher prices, and the length counts cache reads and writes too.
- `inference_geo: "us"` multiplies every token price by 1.1.
- Fast mode (`speed: "fast"`) doubles Opus 5.5, Opus 5 and Opus 4.8, and the cache
  multipliers apply on top of it, which doubles those prices too.
- `server_tool_use.web_search_requests` costs $10 per 1,000 searches, on top of tokens.
- An advisor call is a sub-inference at the advisor model's own prices. The top-level
  usage leaves it out, and `usage.iterations` is where it is reported.

OpenAI, standard tier, read 2026-11-05 at https://developers.openai.com/api/docs/pricing
and the model pages under https://developers.openai.com/api/docs/models:

- A prompt over 272,000 input tokens pays the long prices for the full request. They
  are 2x input and cache and 1.5x output, listed here as the page lists them.
- Fast mode, formerly priority processing, is 2x the applicable rates. No rollout seen
  names any other tier, so another one has no price here.
- `gpt-5.6-sol` is at the page's promotional price, available until 2026-11-30.
- A cache write is priced for the 30-minute retention the page shows first.

Reasoning tokens are part of the output count at both, so they cost nothing apart.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

PRICE_BOOK = "2026-11-05"

#: Tokens per unit a price is stated in.
_MILLION = 1_000_000
_HAIKU_LONG_PROMPT = 100_000
_OPENAI_LONG_PROMPT = 272_000
_SEARCH_USD = 0.01
_US_ONLY = 1.1
_FAST = 2.0


@dataclass(frozen=True)
class Rates:
    """USD per million tokens. None where the page lists no price for that kind."""

    input: float
    cached_read: float
    cache_write_5m: float | None
    cache_write_1h: float | None
    output: float


_FABLE = Rates(10, 0.25, 12.5, 20, 50)
_FABLE_5 = Rates(10, 1, 12.5, 20, 50)
_OPUS_FORMER = Rates(5, 0.5, 6.25, 10, 25)
_OPUS_OLD = Rates(15, 1.5, 18.75, 30, 75)
_SONNET_FORMER = Rates(3, 0.3, 3.75, 6, 15)
_HAIKU_55 = Rates(0.10, 0.01, 0.125, 0.20, 0.50)
_HAIKU_55_LONG = Rates(0.50, 0.05, 0.625, 1, 2.50)

_ANTHROPIC: dict[str, Rates] = {
    "claude-fable-5-1": _FABLE,
    "claude-mythos-5-1": _FABLE,
    "claude-fable-5": _FABLE_5,
    "claude-mythos-5": _FABLE_5,
    "claude-opus-5-5": Rates(4, 0.20, 5, 8, 20),
    "claude-opus-5": _OPUS_FORMER,
    "claude-opus-4-8": _OPUS_FORMER,
    "claude-opus-4-7": _OPUS_FORMER,
    "claude-opus-4-6": _OPUS_FORMER,
    "claude-opus-4-5": _OPUS_FORMER,
    "claude-opus-4-1": _OPUS_OLD,
    "claude-opus-4": _OPUS_OLD,
    "claude-sonnet-5-5": Rates(2, 0.10, 2.50, 4, 10),
    "claude-sonnet-5": Rates(2, 0.20, 2.50, 4, 10),
    "claude-sonnet-4-6": _SONNET_FORMER,
    "claude-sonnet-4-5": _SONNET_FORMER,
    "claude-sonnet-4": _SONNET_FORMER,
    "claude-haiku-5-5": _HAIKU_55,
    "claude-haiku-4-5": Rates(1, 0.10, 1.25, 2, 5),
    "claude-haiku-3-5": Rates(0.80, 0.08, 1, 1.60, 4),
}
_ANTHROPIC_FAST = frozenset({"claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"})

#: `(short, long)` by model; a model the long table has no prices for has only one.
_OPENAI: dict[str, tuple[Rates, Rates | None]] = {
    "gpt-6-astra": (Rates(10, 1, 12.5, 25, 50), Rates(20, 2, 25, 50, 75)),
    "gpt-6.1-sol": (Rates(2, 0.10, 2.5, 5, 10), Rates(4, 0.20, 5, 10, 15)),
    "gpt-6.1-terra": (Rates(1, 0.05, 1.25, 2.5, 5), Rates(2, 0.10, 2.5, 5, 7.5)),
    "gpt-6-luna": (Rates(0.10, 0.01, 0.125, 0.25, 0.50), Rates(0.20, 0.02, 0.25, 0.5, 0.75)),
    "gpt-6-sol": (Rates(2, 0.20, 2.5, 5, 10), Rates(4, 0.40, 5, 10, 15)),
    "gpt-5.6-sol": (Rates(4, 0.40, 5, 10, 20), Rates(8, 0.80, 10, 20, 30)),
    "gpt-5.6-terra": (Rates(2, 0.20, 2.5, 5, 12), Rates(4, 0.40, 5, 10, 18)),
    "gpt-5.6-luna": (Rates(0.20, 0.02, 0.25, 0.5, 1.20), Rates(0.40, 0.04, 0.5, 1, 1.80)),
    "gpt-5.5": (Rates(5, 0.50, None, None, 30), Rates(10, 1, None, None, 45)),
    "gpt-5.4": (Rates(2.5, 0.25, None, None, 15), Rates(5, 0.50, None, None, 22.5)),
    "gpt-5.3-codex": (Rates(1.75, 0.175, None, None, 14), None),
}

_DATED = re.compile(r"-\d{8}$")


def _anthropic_name(model: str) -> str:
    """A model id without the date or the context suffix a client may give it."""

    return _DATED.sub("", model.partition("[")[0])


def prompt_tokens(tokens: Mapping[str, int]) -> int:
    """How long a request's prompt was: what it sent, read from the cache or not."""

    return sum(
        tokens.get(kind, 0) for kind in ("input", "cached_read", "cache_write_5m", "cache_write_1h")
    )


def _rates(model: str, prompt: int) -> tuple[Rates, bool] | None:
    name = _anthropic_name(model)
    rates = _ANTHROPIC.get(name)
    if rates is not None:
        if name == "claude-haiku-5-5" and prompt > _HAIKU_LONG_PROMPT:
            return _HAIKU_55_LONG, True
        return rates, True
    tiers = _OPENAI.get(model)
    if tiers is None:
        return None
    short, long_prompt = tiers
    return (
        long_prompt if long_prompt is not None and prompt > _OPENAI_LONG_PROMPT else short
    ), False


def _speed_factor(model: str, anthropic: bool, speed: str | None) -> float | None:
    """What a request's speed does to its price, or None when no page says."""

    if anthropic:
        if speed in (None, "standard"):
            return 1.0
        return _FAST if speed == "fast" and _anthropic_name(model) in _ANTHROPIC_FAST else None
    if speed in (None, "default", "auto", "standard"):
        return 1.0
    return _FAST if speed in ("priority", "fast") else None


def request_cost(
    model: str,
    tokens: Mapping[str, int],
    *,
    geo: str | None = None,
    speed: str | None = None,
    searches: int = 0,
) -> float | None:
    """The estimated API cost in USD of one request, or None when no price is known.

    `tokens` holds non-overlapping kinds: `input`, `cached_read`, `cache_write_5m`,
    `cache_write_1h`, `output`. `reasoning` may be there and costs nothing apart.
    """

    found = _rates(model, prompt_tokens(tokens))
    if found is None:
        return None
    rates, anthropic = found
    factor = _speed_factor(model, anthropic, speed)
    if factor is None:
        return None
    if anthropic and geo == "us":
        factor *= _US_ONLY
    total = 0.0
    for kind, price in (
        ("input", rates.input),
        ("cached_read", rates.cached_read),
        ("cache_write_5m", rates.cache_write_5m),
        ("cache_write_1h", rates.cache_write_1h),
        ("output", rates.output),
    ):
        count = tokens.get(kind, 0)
        if count:
            if price is None:
                return None
            total += count * price
    return total * factor / _MILLION + searches * _SEARCH_USD
