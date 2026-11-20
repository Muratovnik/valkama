"""Where the server may read session transcripts from: the `transcript_roots` setting.

Every transcript the server reads is one a row of the store names, wherever its
client said it was. When `transcript_roots` is set, `readable` answers no for a
file outside its directories, and each reader -- the archive (`transcripts`), the
usage reread (`telemetry.usage_targets`), session titles and a subagent's last
write (`planning.live_sessions`, `planning.agents`) -- leaves such a file unread.
A server on a copy of another installation's store sets it, since that store's
rows name the other installation's clients' files. Unset, nothing is bounded.

Its own module, beside rather than inside `transcripts`, because the readers in
`planning` must not import the store that `transcripts` brings with it.
"""

from __future__ import annotations

import os

from .hooks.normalize import normalize_path
from .ops import configuration

#: The setting that bounds where transcripts are read from.
SETTING = "transcript_roots"


def read_roots() -> tuple[str, ...]:
    """The directories transcripts may be read from, as `readable` compares them; none bounds nothing."""

    raw = configuration.configured(SETTING) or ""
    return tuple(
        os.path.normcase(os.path.abspath(os.path.expanduser(part.strip())))
        for part in raw.split(os.pathsep)
        if part.strip()
    )


def readable(path: str, roots: tuple[str, ...] | None = None) -> bool:
    """Whether a transcript at `path` may be read: always, unless `transcript_roots` is set.

    `roots` is `read_roots()` when a caller asks about many paths at once.
    """

    bounds = read_roots() if roots is None else roots
    if not bounds:
        return True
    if not path:
        return False
    candidate = os.path.normcase(os.path.abspath(normalize_path(path)))
    return any(
        candidate == root or candidate.startswith(root.rstrip(os.sep) + os.sep) for root in bounds
    )
