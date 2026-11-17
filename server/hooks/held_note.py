"""The resume note: what a session start tells an agent of the work it holds.

After a resume or a compaction the agent goes on with work it holds, and its
context no longer carries what that work stood at. `valkama hook <client>
session-start` answers such a start with a short note: what the recipient holds,
each item's state and next condition, and a last line saying that the note
stands for a read of the item. The other starts (`startup`, `clear`, `fork`)
open a session with a new id, which holds nothing, and get no note.

Who is told. The orchestrator, a hook input without `agent_id`, is told what its
session holds, its agents' holds with it; a subagent only what its own label
holds. After the held items a line names the items the recipient lost to the
lease expiry since its last call (`planning.held.lost_since_last_call`), a
subagent only its own. The orchestrator is also told the items with an open
request asked of its session (`planning.requests.waiting_items`): a notice tells
of a request once, and the note neither reads nor moves the places notices keep,
so a request told before a compaction would otherwise not come back while it
still waits for the answer.

Where. Each item's first project root, the one a launch from it takes, stands
relative to the folder the session runs in, and not at all when it is that
folder; one line names it when every item shown has the same.

How long. At most `MOST_CHARACTERS` of text, by construction: the note tries up
to `MOST_TASKS` items and fewer, each at `LEVELS` of shorter fields, and takes
the first that fits. The last way of one item at `LAST_LEVEL` fits whatever the
fields hold, because every field is cut to its bound and every number past 999
is `999+`.

What it reads. The store, opened read-only and only at this build's schema;
`planning.held` takes the holds by the rule the held read keeps. Nothing is
written, and the places `notify` keeps are neither read nor moved, so the news
after a compaction still comes at the next tool call. The planning modules load
only for a start that gets a note.
"""

from __future__ import annotations

TYPE_CHECKING = False
if TYPE_CHECKING:
    import sqlite3
    from collections.abc import Mapping, Sequence

#: The session starts that keep the session's id, and so what it holds.
SOURCES = frozenset({"resume", "compact"})
HOOK_EVENT = "SessionStart"
#: The most characters of the text the client puts in the model's context.
MOST_CHARACTERS = 600
#: The most items the note names; the header counts all of them.
MOST_TASKS = 3
#: For each level of the fit: the most characters of an item's title and of its
#: next condition, and how many references a line of losses or requests names.
LEVELS = ((60, 72, 3), (44, 52, 2), (32, 36, 1))
#: The level tried after the others when one item is named.
LAST_LEVEL = (20, 24, 1)
MOST_STATE = 20
#: The most characters of a root, cut from the left; its `(+N)` adds at most 8.
MOST_ROOT = 40
MOST_COUNT = 999
CUT = "…"
#: The last line: the note is what a read of the held item would have told.
RULE = "Current: read an item only for what this note leaves out."


def answer(payload: dict, environ: Mapping[str, str] | None = None) -> bytes | None:
    """The answer to one `SessionStart` hook, or None when it has no note to give.

    No note when the start is not a resume or a compaction, notices are off, the
    store is protected, missing, at another schema or cannot be opened to read,
    or the recipient holds nothing, lost nothing and has no request waiting.
    """

    if payload.get("source") not in SOURCES or payload.get("hook_event_name") not in (
        None,
        HOOK_EVENT,
    ):
        return None
    session = _text(payload.get("session_id"))
    if session is None:
        return None
    from . import notify

    path, enabled = notify.settings(environ)
    if path is None or not enabled:
        return None
    conn = _open(path)
    if conn is None:
        return None
    cwd = payload.get("cwd")
    try:
        text = note(
            conn,
            session,
            _text(payload.get("agent_id")),
            cwd=cwd if isinstance(cwd, str) and cwd else None,
        )
    finally:
        conn.close()
    return None if text is None else notify.output(HOOK_EVENT, text)


def note(
    conn: sqlite3.Connection, session: str, agent: str | None = None, *, cwd: str | None = None
) -> str | None:
    """The note for `session`, or one `agent` of it, run in `cwd`; None when it has nothing to tell."""

    from ..planning import held, requests

    return compose(
        held.held_for_note(conn, session, agent),
        agent=agent is not None,
        cwd=cwd,
        lost=held.lost_since_last_call(conn, session, agent),
        # A request is asked of the session, which its orchestrator answers for.
        waiting=requests.waiting_items(conn, session) if agent is None else (),
    )


def compose(
    items: Sequence[dict],
    *,
    agent: bool,
    cwd: str | None = None,
    lost: Sequence[str] = (),
    waiting: Sequence[str] = (),
) -> str | None:
    """The note's text from `held.held_for_note` items, or None when it has nothing to say.

    `cwd` is the folder the session runs in: each item's root stands relative to
    it, and an item whose root it is names none. `lost` names the items the recipient no longer holds and `waiting` those with
    a request waiting for its answer, each newest first. A subagent is not told
    `waiting`: a request is addressed to its session, which the orchestrator
    answers for.
    """

    if agent:
        waiting = ()
    if not items and not lost and not waiting:
        return None
    text = ""
    roots = [_root(item["roots"], cwd) for item in items[:MOST_TASKS]]
    for shown, (title, condition, references) in _ways(len(items)):
        lines = [_header(len(items), shown, agent)]
        named = roots[:shown]
        shared = named[0] if shown > 1 and named[0] and len(set(named)) == 1 else None
        lines.extend(
            _task_line(item, title, condition, None if shared else root)
            for item, root in zip(items[:shown], named, strict=True)
        )
        if shared:
            lines.append(f"Root of these items: {shared}.")
        if lost:
            lines.append(_references_line("No longer held by you", lost, references))
        if waiting:
            lines.append(_references_line("Waiting for your answer", waiting, references))
        lines.append(RULE)
        text = "\n".join(lines)
        if len(text) <= MOST_CHARACTERS:
            break
    # The last way fits by construction, so the loop never ends past the bound.
    return text


def _ways(held: int) -> list[tuple[int, tuple[int, int, int]]]:
    """How many items to name and at which level, in the order they are tried."""

    if held == 0:
        return [(0, level) for level in LEVELS]
    ways: list[tuple[int, tuple[int, int, int]]] = []
    for shown in range(min(held, MOST_TASKS), 0, -1):
        levels = (*LEVELS, LAST_LEVEL) if shown == 1 else LEVELS
        ways.extend((shown, level) for level in levels)
    return ways


def _header(held: int, shown: int, agent: bool) -> str:
    holder = "this agent" if agent else "this session"
    if held == 0:
        return f"Valkama now: {holder} holds no open item."
    if shown == held:
        return f"Valkama now: {holder} holds {_counted(held, 'open item')}:"
    return f"Valkama now: {holder} holds {_count(held)} open items; the {shown} it wrote to last:"


def _task_line(item: dict, most_title: int, most_condition: int, root: str | None) -> str:
    """One held item: its reference, title, state, next condition, counts, containers and root."""

    from ..planning import held

    head = f"- {item['reference']} «{_cut(item['title'], most_title)}»"
    state = item["state"]
    if state is not None:
        head += ", " + _cut(state["name"], MOST_STATE)
    if item["held_as"] == held.STEP:
        head += ", held by a condition"
    parts = [head + "."]
    following = item["next_condition"]
    total = item["steps"]["total"]
    if following is not None:
        parts.append(
            f"Next condition {_count(following['done'])}/{_count(following['total'])}:"
            f" «{_cut(following['text'], most_condition)}»"
            + (" (to confirm)." if following["flagged"] else ".")
        )
    elif total:
        parts.append(f"All {_counted(total, 'condition')} ticked.")
    else:
        parts.append("No conditions.")
    counts = [
        _counted(item[name], noun)
        for name, noun in (
            ("open_threads", "open thread"),
            ("pending_questions", "open question"),
            ("new_answers", "new answer"),
        )
        if item[name]
    ]
    if item["to_confirm"]:
        counts.append(f"{_count(item['to_confirm'])} to confirm")
    if counts:
        parts.append("; ".join(counts) + ".")
    if item["stage"]:
        parts.append(f"Stage {item['stage']} of goal {item['goal']}.")
    elif item["goal"]:
        parts.append(f"Goal {item['goal']}.")
    if root:
        parts.append(f"Root {root}.")
    return " ".join(parts)


def _root(roots: Sequence[Mapping[str, object]], cwd: str | None) -> str | None:
    """The first of `roots` as the note names it, with how many others follow, or None.

    A `mapped` root stands relative to `cwd`, and is not named when it is `cwd`;
    any other is `<project_id> (<status>)`, its id cut to fit. At most 48
    characters with the `(+N)`.
    """

    if not roots:
        return None
    first = roots[0]
    status = str(first["status"])
    if status == "mapped":
        root = str(first["root"])
        if cwd is not None and _folder(root) == _folder(cwd):
            return None
        shown = _cut_left(_relative(root, cwd), MOST_ROOT)
    else:
        mark = f" ({status})"
        shown = _cut(first["project_id"], MOST_ROOT - len(mark)) + mark
    others = len(roots) - 1
    return shown + (f" (+{_count(others)})" if others else "")


def _folder(path: str) -> str:
    import os

    return os.path.normcase(os.path.normpath(path))


def _relative(root: str, cwd: str | None) -> str:
    """`root` from `cwd`, with `/` between its parts; as it is when no way leads there."""

    import os

    shown = root
    if cwd is not None:
        try:
            shown = os.path.relpath(root, cwd)
        except ValueError:
            # Another drive: no relative way leads there.
            shown = root
    # A path keeps its spaces; only a line break or a tab would split the note's line.
    shown = "".join(" " if char.isspace() else char for char in shown)
    return shown.replace(os.sep, "/")


def _cut_left(path: str, most: int) -> str:
    """`path` cut from the left at a `/` to `most` characters, after `…/`."""

    if len(path) <= most:
        return path
    kept = ""
    for part in reversed(path.split("/")):
        longer = f"{part}/{kept}" if kept else part
        if len(CUT) + 1 + len(longer) > most:
            break
        kept = longer
    if not kept:
        # Its last part alone is too long: that part's end, after the mark.
        return CUT + path[-(most - len(CUT)) :]
    return f"{CUT}/{kept}"


def _references_line(lead: str, references: Sequence[str], most: int) -> str:
    named = [str(reference) for reference in references[:most]]
    rest = len(references) - len(named)
    if rest:
        return f"{lead}: {', '.join(named)} and {_count(rest)} more."
    if len(named) == 1:
        return f"{lead}: {named[0]}."
    return f"{lead}: {', '.join(named[:-1])} and {named[-1]}."


def _cut(value: object, most: int) -> str:
    """`value` on one line, its whitespace runs one space each, cut to `most` with `CUT`."""

    text = " ".join(str(value).split())
    if len(text) <= most:
        return text
    return text[: most - 1].rstrip() + CUT


def _count(number: int) -> str:
    return f"{MOST_COUNT}+" if number > MOST_COUNT else str(number)


def _counted(number: int, noun: str) -> str:
    return f"{_count(number)} {noun}" + ("" if number == 1 else "s")


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and 0 < len(value) <= 128 else None


def _open(path: str) -> sqlite3.Connection | None:
    """The store read-only, at this build's schema, or None."""

    import os
    import sqlite3

    from .. import store
    from . import light

    if not os.path.isfile(path):
        return None
    try:
        conn = sqlite3.connect(
            light.uri(path, mode="ro"), uri=True, timeout=light.BUSY_TIMEOUT_SECONDS
        )
    except sqlite3.Error:
        return None
    try:
        current = int(conn.execute("PRAGMA user_version").fetchone()[0])
    except sqlite3.Error:
        current = None
    if current != store.STORE_SCHEMA_VERSION:
        conn.close()
        return None
    conn.row_factory = sqlite3.Row
    return conn
