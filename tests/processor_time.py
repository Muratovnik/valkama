"""What a piece of work costs the thread that runs it, for the tests that hold work to a budget.

On the wall clock a budget fails whenever the machine is busy with anything else, another
suite or an agent's session, because the system then runs the measured thread for part of
the time only. The thread's own clock counts while the thread runs and stands still while
anything else does, so it reads what the work costs, however busy the machine is.

It fits work that runs in the calling thread and does not wait: time spent waiting on a lock,
a socket or another thread is not on it. On Windows it ticks in steps of 15.625 ms, so what
it measures must be long beside that; a short piece is timed over many runs at once.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def processor_seconds(work: Callable[[], T]) -> tuple[T, float]:
    """What `work` returns, and the seconds of processor time this thread spent on it."""

    began = time.thread_time()
    answer = work()
    return answer, time.thread_time() - began
