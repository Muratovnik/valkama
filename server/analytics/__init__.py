"""Read-only analytics projections for the planning store.

The planning tables remain the source of truth. This package deliberately has no
write path and does not add tables: a dashboard is rebuilt from work items, events,
refs, and the optional local session journals, with a process-owned cache keyed
by the SQLite snapshot, journal stat identities, and complete query scope.
Unknown data is represented by ``None`` (and a coverage state), never by a
fabricated zero.

One responsibility per module. `timeline` rebuilds what happened from lane
events, `journal` reads the local session journals the operator pointed at, and
`cache` owns the process-lifetime memory and the keys that invalidate it. The
dashboard itself is a sequence: `scope` resolves the request, `reading` reads
the store once, `selection` decides which cards and session rows are in scope,
`flow` and `evidence` say what those two sets add up to, and `projection`
assembles the answer a client receives.

This file re-exports what the surfaces and tests already name, so the package
boundary is the same one the module had.
"""

from __future__ import annotations

from .cache import _CACHE as _CACHE
from .cache import clear_analytics_cache as clear_analytics_cache
from .journal import LocalJournalUsageProvider as LocalJournalUsageProvider
from .projection import project_space as project_space
from .timeline import coverage_rollup as coverage_rollup
from .timeline import iso_time as iso_time
from .timeline import parse_time as parse_time
from .timeline import reconstruct_status_history as reconstruct_status_history
