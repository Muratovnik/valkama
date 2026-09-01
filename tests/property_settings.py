"""How property-based tests are configured in this repository.

Hypothesis is deliberately deterministic here. There is no CI, so the gate is a
person running a command, and a gate that fails on Tuesday and passes on
Wednesday against the same tree teaches that person to run it again rather than
to read it. `derandomize` fixes the seed, so a failure is reproducible from the
tree that produced it, and new cases arrive when the code or a strategy changes
rather than at random. That is the trade: these tests stop being a lottery that
occasionally finds something, and become an assertion about a fixed, wide set
of inputs.

`database=None` follows from the same decision. With a fixed seed the example
database can only replay what the seed already produces, so it would leave an
untracked directory in the repository and buy nothing.

Switching it off was not enough to keep that directory away, though, and this is
worth knowing before deleting the line below. Hypothesis also writes a constants
cache, which `database=None` does not govern, so `.hypothesis/` reappeared at the
repository root with several hundred files in it. `set_hypothesis_home_dir` moves
everything Hypothesis stores under the same `.cache/` the linters and the
coverage data now use, which is the one ignored place this repository keeps
machine-local state.

The deadline is off because these suites touch SQLite on Windows, where one
step can pause far longer than any per-example budget worth defending, and a
timing flake is the same lottery by another name.
"""

from __future__ import annotations

import os

from hypothesis import HealthCheck, settings
from hypothesis.configuration import set_hypothesis_home_dir

GATE_PROFILE = "valkama-gate"

# Relative to the repository root rather than the caller's directory, because
# the suite is discovered from the root and a relative path would otherwise
# depend on where the command was typed.
_REPOSITORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
set_hypothesis_home_dir(os.path.join(_REPOSITORY, ".cache", "hypothesis"))

settings.register_profile(
    GATE_PROFILE,
    derandomize=True,
    database=None,
    deadline=None,
    max_examples=200,
)


def use_gate_profile() -> None:
    """Run this module's properties under the profile described above."""
    settings.load_profile(GATE_PROFILE)


def machine_settings() -> settings:
    """The same profile, with a walk sized for a real SQLite file.

    Each step opens a transaction against a throwaway database rather than
    calling a pure function, so a case buys far less per second than it does
    for the contract laws. Thirty steps is long enough to reach a contested
    claim, a forced transition and a replaced checklist in one sequence, and
    the whole file still finishes in about five seconds.
    """
    use_gate_profile()
    return settings(
        max_examples=60,
        stateful_step_count=30,
        # Building a throwaway store per case is the point of the fixture, not
        # a slow strategy Hypothesis should warn about.
        suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
    )
