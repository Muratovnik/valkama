-- The word index as Valkama 2.9 writes it: `SCHEMA` and `_REFILL` of its
-- server/planning/words.py, captured once from that release. Read by
-- tests/schema17.py: the statements above the refill line are the schema, the
-- one statement below it the refill.
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
-- refill
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
WHERE d.stale = 1;
