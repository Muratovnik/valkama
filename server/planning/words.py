"""The words a work item is found by: an SQLite FTS5 index of what it says.

One row per item holds three columns: its title, its description, and `notes` --
its labels, source and summary, and the text of its comments, their decisions and
its questions with their current answers. `search_work_items` matches every word
of a query anywhere in that row and ranks the hits with the title weighing three
times the rest; `similar` names the open items of a space whose title or
description share the words of a new item's title.

A word is cut to its first five letters and matched as a prefix, a crude stand-in
for Russian morphology that serves English too: `searching` and `search` meet at
`searc`, and a Russian noun meets its other cases the same way. The letter yo
(U+0451) is read as ie (U+0435), because a person types the one for the other and
the tokenizer folds neither into the other.

The index is derived: everything in it is read from rows the store keeps anyway,
so a lost index is rebuilt, never restored. It keeps no copy of that text (FTS5's
`content=''` with `contentless_delete=1`, SQLite 3.43 or later), which leaves it
about a quarter of the size a copy would add to the store.

What keeps it current is two things that never fail a write. Triggers on the item,
its comments and its questions mark the item stale in `work_item_search_rows`, a
plain table, so every writer marks it -- an older build, a hook, a cascade, a merge
-- whichever SQLite it runs on. `bring_current` then reads every stale item into the
index; every verb that writes an item's text calls it before it returns, and so does
the store's bring-up. A SQLite without FTS5, or one older than 3.43, cannot reach
the index, so there `bring_current` leaves the marks for one that can, and a search
falls back to the substring match that came before the index: the index lags until a
process with FTS5 next writes an item's text or opens the store. Such a SQLite
cannot dump the store either -- `Connection.iterdump` reads the index -- so it
cannot take a verified recovery point, and an upgrade that needs one is refused
there.

The stale mark's table also owns the index's row ids. An item's own id is text,
and the implicit rowid of its table may change in a VACUUM, so the index's rowid
is the `id` of the item's row here, an INTEGER PRIMARY KEY that VACUUM keeps.
"""

from __future__ import annotations

import json
import re
import sqlite3

#: The index itself, and the plain table that marks what it lags behind on.
INDEX = "work_item_search"
ROWS = "work_item_search_rows"

#: The plain half, created on every SQLite, with the triggers that feed it. An
#: item is marked when it is created, when any text it is found by changes, when a
#: comment or a question on it is written, moved or removed, and when it goes. A
#: mark on an item that is gone tells `bring_current` to drop its row.
SCHEMA = """
CREATE TABLE IF NOT EXISTS work_item_search_rows(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL UNIQUE,
    stale INTEGER NOT NULL DEFAULT 1 CHECK(stale IN (0,1))
);
CREATE INDEX IF NOT EXISTS work_item_search_rows_stale
    ON work_item_search_rows(id) WHERE stale = 1;
CREATE TRIGGER IF NOT EXISTS work_items_search_insert
AFTER INSERT ON work_items BEGIN
    INSERT INTO work_item_search_rows(work_item_id) VALUES (NEW.work_item_id);
END;
CREATE TRIGGER IF NOT EXISTS work_items_search_update
AFTER UPDATE OF title, description, labels, source, summary ON work_items BEGIN
    UPDATE work_item_search_rows SET stale = 1 WHERE work_item_id = NEW.work_item_id;
END;
CREATE TRIGGER IF NOT EXISTS work_items_search_delete
AFTER DELETE ON work_items BEGIN
    UPDATE work_item_search_rows SET stale = 1 WHERE work_item_id = OLD.work_item_id;
END;
CREATE TRIGGER IF NOT EXISTS work_item_comments_search_insert
AFTER INSERT ON work_item_comments BEGIN
    UPDATE work_item_search_rows SET stale = 1 WHERE work_item_id = NEW.work_item_id;
END;
CREATE TRIGGER IF NOT EXISTS work_item_comments_search_update
AFTER UPDATE OF work_item_id, body, report, resolution ON work_item_comments BEGIN
    UPDATE work_item_search_rows SET stale = 1
    WHERE work_item_id IN (OLD.work_item_id, NEW.work_item_id);
END;
CREATE TRIGGER IF NOT EXISTS work_item_comments_search_delete
AFTER DELETE ON work_item_comments BEGIN
    UPDATE work_item_search_rows SET stale = 1 WHERE work_item_id = OLD.work_item_id;
END;
CREATE TRIGGER IF NOT EXISTS work_item_requests_search_insert
AFTER INSERT ON work_item_requests BEGIN
    UPDATE work_item_search_rows SET stale = 1 WHERE work_item_id = NEW.work_item_id;
END;
CREATE TRIGGER IF NOT EXISTS work_item_requests_search_update
AFTER UPDATE OF work_item_id, prompt, fields_json, answers_json ON work_item_requests BEGIN
    UPDATE work_item_search_rows SET stale = 1
    WHERE work_item_id IN (OLD.work_item_id, NEW.work_item_id);
END;
CREATE TRIGGER IF NOT EXISTS work_item_requests_search_delete
AFTER DELETE ON work_item_requests BEGIN
    UPDATE work_item_search_rows SET stale = 1 WHERE work_item_id = OLD.work_item_id;
END;
"""

#: The FTS5 half, which only a SQLite built with FTS5 can create or read.
_INDEX_DDL = (
    "CREATE VIRTUAL TABLE work_item_search USING fts5("
    "title, description, notes, content='', contentless_delete=1, tokenize='unicode61')"
)

#: An item's text as the index holds it. Its reference is a word of its notes, so a
#: query for a space's key still finds the space's items. A summary and a report are
#: read as the text of their fields, not their names; a question as its prompt, the labels,
#: descriptions and reasons of its fields, and its current answer's text. The
#: letter yo becomes ie in every column.
_REFILL = """
INSERT INTO work_item_search(rowid, title, description, notes)
SELECT d.id,
    replace(replace(i.title, char(1105), char(1077)), char(1025), char(1045)),
    replace(replace(i.description, char(1105), char(1077)), char(1025), char(1045)),
    replace(replace(
        p.key || '-' || i.number || ' ' || i.labels || ' ' || i.source || ' '
        || CASE WHEN json_valid(i.summary) THEN coalesce((
            SELECT group_concat(s.atom, ' ') FROM json_tree(i.summary) s WHERE s.type = 'text'
        ), '') ELSE i.summary END
        || ' ' || coalesce((
            SELECT group_concat(
                c.body || ' '
                || CASE WHEN json_valid(c.report) THEN coalesce((
                    SELECT group_concat(r.atom, ' ') FROM json_tree(c.report) r
                    WHERE r.type = 'text'
                ), '') ELSE c.report END
                || ' ' || c.resolution, ' ')
            FROM work_item_comments c WHERE c.work_item_id = i.work_item_id
        ), '')
        || ' ' || coalesce((
            SELECT group_concat(
                q.prompt || ' ' || coalesce((
                    SELECT group_concat(f.atom, ' ')
                    FROM json_tree(CASE WHEN json_valid(q.fields_json) THEN q.fields_json END) f
                    WHERE f.key IN ('label', 'description', 'why')
                ), '') || ' ' || coalesce((
                    SELECT group_concat(a.atom, ' ')
                    FROM json_tree(CASE WHEN json_valid(q.answers_json) THEN q.answers_json END) a
                    WHERE a.type = 'text'
                ), ''), ' ')
            FROM work_item_requests q WHERE q.work_item_id = i.work_item_id
        ), ''),
        char(1105), char(1077)), char(1025), char(1045))
FROM work_item_search_rows d JOIN work_items i ON i.work_item_id = d.work_item_id
JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id
WHERE d.stale = 1
"""

#: A search over every column, the title weighing three times the rest; the newest
#: change breaks a tie, as it ordered every substring hit.
_SEARCH = """
SELECT i.* FROM work_item_search
JOIN work_item_search_rows d ON d.id = work_item_search.rowid
JOIN work_items i ON i.work_item_id = d.work_item_id
JOIN workflow_states s ON s.state_id = i.state_id
JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id
WHERE work_item_search MATCH ? AND (? IS NULL OR i.planning_space_id = ?)
ORDER BY bm25(work_item_search, 3.0, 1.0, 1.0), i.updated_at DESC, i.work_item_id
LIMIT ? OFFSET ?
"""

#: The open items of a space reading like one item, by title and description only:
#: what was said under an item is not what it is about. The item itself, its parent
#: and the items it is linked with are left out, since the caller knows them.
_SIMILAR = """
SELECT p.key, i.number, i.title FROM work_item_search
JOIN work_item_search_rows d ON d.id = work_item_search.rowid
JOIN work_items i ON i.work_item_id = d.work_item_id
JOIN workflow_states s ON s.state_id = i.state_id
JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id
WHERE work_item_search MATCH ? AND i.planning_space_id = ? AND s.is_terminal = 0
  AND i.work_item_id != ? AND i.work_item_id IS NOT ?
  AND i.work_item_id NOT IN (
    SELECT to_id FROM work_item_links WHERE from_id = ?
    UNION SELECT from_id FROM work_item_links WHERE to_id = ?
  )
ORDER BY bm25(work_item_search, 3.0, 1.0, 0.0), i.updated_at DESC
LIMIT ?
"""


def _unreachable(error: sqlite3.OperationalError) -> bool:
    """Whether an error says the index cannot be reached here, rather than that it failed.

    A SQLite without FTS5 says `no such module`, one older than 3.43 refuses the
    index's options, and a store this build has not brought up says `no such table`:
    each is the plain SQLITE_ERROR. A busy, locked, full or failing store is another
    code, and is raised.
    """

    return getattr(error, "sqlite_errorname", "") == "SQLITE_ERROR"


def migration_needed(conn: sqlite3.Connection) -> bool:
    """Whether a populated store is about to gain the index's tables and triggers."""

    names = {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
            " AND name IN ('work_items', 'work_item_search_rows')"
        )
    }
    return names == {"work_items"}


def migrate(conn: sqlite3.Connection) -> None:
    """Give the store the index and bring it current. Idempotent; the caller commits.

    Run inside the bring-up's transaction, after every step that adds a column the
    triggers name. A store opened by a SQLite without FTS5 still gets the marks and
    the triggers, with every item marked, and the first open by one with FTS5
    creates the index and reads them all.
    """

    statement = ""
    for character in SCHEMA:
        statement += character
        if character == ";" and sqlite3.complete_statement(statement):
            conn.execute(statement.strip())
            statement = ""
    # Every item the triggers have not seen: all of them in a store gaining the
    # index, none afterwards, since from then on the triggers see every write.
    conn.execute(
        "INSERT INTO work_item_search_rows(work_item_id) SELECT work_item_id FROM work_items"
        " WHERE work_item_id NOT IN (SELECT work_item_id FROM work_item_search_rows)"
    )
    absent = (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_item_search'"
        ).fetchone()
        is None
    )
    if absent:
        try:
            conn.execute(_INDEX_DDL)
        except sqlite3.OperationalError as error:
            if not _unreachable(error):
                raise
            return
        # A new index holds nothing, whatever the marks say.
        conn.execute("UPDATE work_item_search_rows SET stale = 1 WHERE stale = 0")
    bring_current(conn)


def bring_current(conn: sqlite3.Connection) -> None:
    """Read every item marked stale into the index, and drop the rows of items gone.

    Writes nothing when nothing is marked, and nothing at all where the index cannot
    be reached: the marks wait there for a SQLite that has FTS5.
    """

    try:
        marked = conn.execute(
            "SELECT 1 FROM work_item_search_rows WHERE stale = 1 LIMIT 1"
        ).fetchone()
        if marked is None:
            return
        conn.execute(
            "DELETE FROM work_item_search"
            " WHERE rowid IN (SELECT id FROM work_item_search_rows WHERE stale = 1)"
        )
    except sqlite3.OperationalError as error:
        if not _unreachable(error):
            raise
        return
    conn.execute(_REFILL)
    conn.execute(
        "DELETE FROM work_item_search_rows WHERE stale = 1"
        " AND work_item_id NOT IN (SELECT work_item_id FROM work_items)"
    )
    conn.execute("UPDATE work_item_search_rows SET stale = 0 WHERE stale = 1")


# -- reading -------------------------------------------------------------------

_WORD = re.compile(r"[^\W_]+")
#: Words too common to tell items apart, dropped from a query that has others.
_STOP = frozenset(
    {
        # Russian words, not lookalikes of Latin letters.
        *"и в на по для с из не к от что как при это или до без за".split(),  # noqa: RUF001, SIM905
        *"the a an of to in for and is on with".split(),  # noqa: SIM905
    }
)
#: How many of a query's words are matched; a pasted paragraph is not a query.
MAX_WORDS = 24
#: How long a stem is: the first five letters of a word.
STEM = 5
#: How many words of a title make a query of their own; a shorter title takes the
#: first words of the description after its own.
_TITLE_WORDS = 5
#: How many similar items a new item's answer names.
SIMILAR_LIMIT = 3


def _fold(text: str) -> str:
    return text.lower().replace("ё", "е")  # noqa: RUF001 - the Cyrillic letters


def stems(text: str, *, shortest: int = 1) -> list[str]:
    """The stems a query matches: each word's first five letters, in order, once.

    Common words, and words shorter than `shortest`, go when the query has others, so
    `fix the search` asks for `fix` and `searc`, while `the` alone still asks for `the`.
    """

    words = _WORD.findall(_fold(text))
    meaningful = [word for word in words if word not in _STOP and len(word) >= shortest] or words
    return list(dict.fromkeys(word[:STEM] for word in meaningful))[:MAX_WORDS]


def _expression(found: list[str], joiner: str) -> str:
    """An FTS5 query matching each stem as a prefix. A stem is letters and digits
    only, so quoting it is all the escaping it needs."""

    return joiner.join(f'"{stem}"*' for stem in found)


def _strings(value: object, keys: frozenset[str] | None = None) -> list[str]:
    """Every string in a JSON value, as `json_tree` reads its text atoms; with `keys`,
    only the strings held under one of those keys."""

    if isinstance(value, str):
        return [value] if keys is None else []
    inner = (
        value.items()
        if isinstance(value, dict)
        else enumerate(value)
        if isinstance(value, list)
        else ()
    )
    found: list[str] = []
    for key, child in inner:
        if isinstance(child, str):
            if keys is None or key in keys:
                found.append(child)
        else:
            found.extend(_strings(child, keys))
    return found


def _json(text: object) -> object:
    try:
        return json.loads(str(text or "null"))
    except ValueError:
        return None


def _plain(text: str) -> str:
    """A summary or a report as the index reads it: the text of its fields."""

    if not text.startswith(("{", "[")):
        return text
    value = _json(text)
    return text if value is None else " ".join(_strings(value))


def holds(text: object, found: list[str]) -> bool:
    """Whether a text has a word beginning with each of the stems, as the index reads it."""

    words = set(_WORD.findall(_fold(_plain(str(text or "")))))
    return all(any(word.startswith(stem) for word in words) for stem in found)


#: The keys of a question's fields and options whose text the index reads.
_FIELD_TEXT = frozenset({"label", "description", "why"})


def _question_text(request: sqlite3.Row) -> str:
    """A question as the index reads it: its prompt, the labels, descriptions and
    reasons of its fields and their options, and the text of its current answer."""

    return " ".join(
        [
            str(request["prompt"]),
            *_strings(_json(request["fields_json"]), _FIELD_TEXT),
            *_strings(_json(request["answers_json"])),
        ]
    )


def hits(conn: sqlite3.Connection, row: sqlite3.Row, found: list[str]) -> dict[str, object]:
    """Where an item a word search found holds every word, as a phrase hit says it.

    `comment_hit` is the newest comment or report holding them, else the newest
    decision; `question_hit` the prompt of the newest question; `summary_hit` whether
    the summary does. The item may hold the words only between them, and then none is
    named. An attached store is read as it is, so a missing table or column names
    nothing there.
    """

    answer: dict[str, object] = {}
    identity = str(row["work_item_id"])
    comments = conn.execute(
        "SELECT * FROM work_item_comments WHERE work_item_id = ? ORDER BY id DESC", (identity,)
    ).fetchall()
    said = next(
        (
            comment["report"] or comment["body"]
            for comment in comments
            if holds(comment["body"], found) or holds(comment["report"], found)
        ),
        None,
    ) or next(
        (
            comment["resolution"]
            for comment in comments
            if "resolution" in comment.keys()  # noqa: SIM118 - a Row has no __contains__ by name
            and comment["resolution"]
            and holds(comment["resolution"], found)
        ),
        None,
    )
    if said:
        answer["comment_hit"] = str(said)[:240]
    asked = (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_item_requests'"
        ).fetchone()
        is not None
    )
    if asked:
        question = next(
            (
                request["prompt"]
                for request in conn.execute(
                    "SELECT prompt, fields_json, answers_json FROM work_item_requests"
                    " WHERE work_item_id = ? ORDER BY created_at DESC",
                    (identity,),
                )
                if holds(_question_text(request), found)
            ),
            None,
        )
        if question:
            answer["question_hit"] = str(question)[:240]
    if holds(row["summary"], found):
        answer["summary_hit"] = True
    return answer


def search_rows(
    conn: sqlite3.Connection,
    found: list[str],
    *,
    space_id: str | None,
    limit: int,
    offset: int,
) -> list[sqlite3.Row] | None:
    """The items holding every stem, best first, or None when the index cannot be read."""

    try:
        return conn.execute(
            _SEARCH, (_expression(found, " "), space_id, space_id, limit, offset)
        ).fetchall()
    except sqlite3.OperationalError as error:
        if not _unreachable(error):
            raise
        return None


def similar(
    conn: sqlite3.Connection, work_item_id: str, *, limit: int = SIMILAR_LIMIT
) -> list[dict]:
    """The open items of an item's space that read most like it: reference and title.

    The words are its title's, and the description's first words after them when the
    title is short; any of them counts, and the rank weighs a candidate's title three
    times its description. A hint, not a guard: nothing is refused on it, and where
    the index cannot be read it names nothing. Measured on pairs of items a person
    later merged as duplicates, description words added to a title of five words or
    more found fewer of the pairs, not more.
    """

    row = conn.execute(
        "SELECT title, description, planning_space_id, parent_id FROM work_items"
        " WHERE work_item_id = ?",
        (work_item_id,),
    ).fetchone()
    if row is None:
        return []
    # A two-letter word is noise in a query any of whose words counts.
    found = stems(str(row[0]), shortest=3)
    if len(found) < _TITLE_WORDS:
        found = stems(f"{row[0]} {row[1]}", shortest=3)[:_TITLE_WORDS]
    if not found:
        return []
    match = "{title description} : (" + _expression(found, " OR ") + ")"
    try:
        rows = conn.execute(
            _SIMILAR, (match, row[2], work_item_id, row[3], work_item_id, work_item_id, limit)
        ).fetchall()
    except sqlite3.OperationalError as error:
        if not _unreachable(error):
            raise
        return []
    return [{"reference": f"{key}-{number}", "title": str(title)} for key, number, title in rows]


__all__ = [
    "INDEX",
    "ROWS",
    "SCHEMA",
    "bring_current",
    "hits",
    "holds",
    "migrate",
    "migration_needed",
    "search_rows",
    "similar",
    "stems",
]
