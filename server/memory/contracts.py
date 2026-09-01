"""What a memory reference is, and what it deliberately is not.

A `MemoryRef` is a pointer with a label. It names the connection that can
resolve it, an id opaque to Valkama, and enough metadata to render a row — and
it stops there. §16.6 forbids the alternative in as many words: no embeddings,
no ranking, no copy of the content, and no universal schema laid over a
provider's internals.

The reason is ownership rather than tidiness. A memory tool indexes, searches,
expires and rewrites its own records; a product that copies the content holds a
stale second copy that its own users will read, and the moment those two
disagree the copy is the one nobody knows to distrust.

So the label is a label. It is what the provider said this record was called at
the moment it was attached, kept so a row is readable when the provider is
unavailable, and never treated as the record's content.
"""

from __future__ import annotations

import re

#: A pointer's own id. Opaque on purpose: providers mint these and Valkama
#: parses none of them. Bounded so a row cannot carry a document.
EXTERNAL_ID = re.compile(r"^[\w.:@/=+-]{1,256}$")

MAX_LABEL = 200
MAX_SNIPPET = 500


class KnowledgeError(ValueError):
    """A reference this build cannot express, named rather than silently dropped.

    Not `MemoryError`. That name is a builtin about running out of memory,
    and a module that shadows it raises something whose meaning depends on
    whether the shadow is in scope — which is a bug that only shows up in
    the one file that forgot to qualify it.
    """


def memory_ref(
    *,
    connection_id: str,
    resource_type: str,
    external_id: str,
    label: str = "",
    observed_at: str = "",
    metadata: dict | None = None,
) -> dict:
    """One validated pointer, in the shape MEM-001 names.

    The connection travels with the id because an id alone answers nothing: two
    providers may both mint `note-14`, and resolving one against the other is
    the failure mode this whole layer exists to keep out of the store.
    """

    identifier = str(external_id or "").strip()
    if not EXTERNAL_ID.fullmatch(identifier):
        raise KnowledgeError(f"memory external id is not a bounded opaque pointer: {external_id!r}")
    connection = str(connection_id or "").strip()
    if not connection:
        raise KnowledgeError("a memory reference names the connection that can resolve it")
    return {
        "connection_id": connection,
        "resource_type": str(resource_type or "memory-entry").strip() or "memory-entry",
        "external_id": identifier,
        # Kept so a row stays readable when the provider is unavailable, and
        # never treated as the record itself.
        "label": _bounded(label, MAX_LABEL),
        "observed_at": str(observed_at or ""),
        "metadata": _metadata(metadata),
    }


def _bounded(value: object, limit: int) -> str:
    text = "" if value is None else str(value)
    return "".join(character for character in text if character >= " ")[:limit]


def _metadata(value: dict | None) -> dict:
    """Small, flat and stringly typed: a row's supporting facts, not a payload.

    Nested structure is where a copy of the record starts, so nothing but
    scalars survives, and a provider with more to say says it in its own tool.
    """

    if not isinstance(value, dict):
        return {}
    bounded: dict[str, str] = {}
    for key, item in list(value.items())[:16]:
        if isinstance(item, str | int | float | bool):
            bounded[_bounded(key, 64)] = _bounded(item, MAX_SNIPPET)
    return bounded


__all__ = ["EXTERNAL_ID", "MAX_LABEL", "MAX_SNIPPET", "KnowledgeError", "memory_ref"]
