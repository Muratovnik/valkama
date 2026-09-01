"""Adopting a store an earlier generation of this product wrote.

The product has been renamed twice, so what is on a workstation's disk is not
necessarily one rename behind: a machine that sat out the middle rename still
has a real board under the oldest name. Adoption therefore walks the chain of
layouts newest-first rather than assuming whatever it finds is the immediate
predecessor.

The names below are deliberately still spelled the old way. They are not names
in this product any more -- they name directories and file prefixes that earlier
generations wrote on real disks, and finding exactly those is what adoption is
for.
"""

from __future__ import annotations

import os
from collections.abc import Callable

# Every store layout this product has written, newest first. Two renames have
# now happened, and a workstation that sat out the middle one still has a real
# board under the oldest name, so adoption walks the chain rather than assuming
# whatever it finds is exactly one rename behind.
LEGACY_LAYOUTS = ((".agent-hub", "hub"), (".agent-kanban", "kanban"))


def _rename_legacy_names(root: str, legacy_prefix: str, current_prefix: str) -> None:
    """Give the moved files the names this version looks for.

    Everything a layout wrote is prefixed with the product name of its day: the
    database, its sidecar module stores, and every backup. One rule covers all
    three because the prefix is the only part that changed.
    """
    for directory in (root, os.path.join(root, "backups")):
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            if not name.startswith(legacy_prefix):
                continue
            os.rename(
                os.path.join(directory, name),
                os.path.join(directory, current_prefix + name[len(legacy_prefix) :]),
            )


def adopt(
    *,
    current_root: str,
    current_prefix: str,
    refuse_a_store_from_the_future: Callable[[str], None],
) -> str | None:
    """Move a store written before the product was renamed, once.

    The whole directory is renamed rather than copied file by file. With WAL
    journaling the newest commits may still live in the `-wal` sidecar, so
    copying the three files one at a time can tear a transaction in half; a
    directory rename is atomic on one volume and cannot.

    A failure here is loud on purpose. The alternative -- falling through to
    `connect()` -- would create an empty database at the new path and present
    it as the board, which looks exactly like losing every card.

    The schema ratchet is applied through `refuse_a_store_from_the_future`
    rather than read here: the version this build understands, and the refusal
    it raises, belong to the store module the rest of the product reads them
    from.
    """
    if os.environ.get("VALKAMA_DB"):
        return None  # an explicit path is the caller's business, not ours
    if os.path.exists(current_root):
        return None
    home = os.path.expanduser("~")
    for root_name, legacy_prefix in LEGACY_LAYOUTS:
        legacy = os.path.join(home, root_name)
        if not os.path.isdir(legacy):
            continue
        legacy_db = os.path.join(legacy, f"{legacy_prefix}.sqlite3")
        if os.path.isfile(legacy_db):
            refuse_a_store_from_the_future(legacy_db)
        try:
            os.rename(legacy, current_root)
        except OSError as error:
            raise RuntimeError(
                f"the store at {legacy} predates the rename and could not be adopted: {error}."
                " Close anything still holding it open and start again;"
                " nothing has been moved."
            ) from error
        _rename_legacy_names(current_root, legacy_prefix, current_prefix)
        # Appended, not overwritten: a store that has been through both renames
        # keeps both hops, and the oldest path stays readable.
        with open(os.path.join(current_root, "MOVED-FROM.txt"), "a", encoding="utf-8") as note:
            note.write(f"{legacy}\n")
        return current_root
    return None
