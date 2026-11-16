# Upgrading the store and going back

Valkama keeps its data in a local SQLite store, `~/.valkama/valkama.sqlite3`
unless `store` or `VALKAMA_DB` names another file (see
[Configuration](configuration.md)). This guide says what happens when a newer
build opens an older store, how a snapshot is restored, and how to go back to an
earlier build.

## Migrating an older store

A store written by an older schema is upgraded the first time a newer build
opens it, after a verified snapshot (see below). From then on a build of the
older schema refuses the store rather than read it, so restart every agent
client after pinning the newer release with `launcher install`: each one
starts its own server, and the first to open the store upgrades it. Schema 9
dropped the extension registry's tables, the module rows and the integration
switches; its snapshot is labelled `preschema9`. Schema 10 lets a comment be a
reply under another one or under a question and carry a resolve mark, numbers a
question's answer and keeps the answers it replaced, records where a session
was last opened, and adds the owner's Windows notification settings
(`owner_alert_settings`, empty until they are saved); its snapshot is labelled
`preschema10`. A store older than 9 takes both steps in one open, under the
`preschema9` (or `preproductmodel`) snapshot. Schema 14 records the pictures
pasted into an item's text (`work_item_images`); the files themselves stand in
an `images` folder beside the database, one per content hash. Its snapshot is
labelled `preschema14`. Schema 15 admits the history event of a changed label
set (`labels_changed`) and rebuilds the event table for it, keeping every event;
its snapshot is labelled `preschema15`, and going back to a build at schema 14
means restoring that snapshot, its pictures included, as the next section
describes. Schema 16 counts each usage request once in the whole
store and records which reading wrote each usage run, so that the background
reader reads every older run again, and it adds the counts of how often each
Analytics surface was opened (`analytics_surface_uses`, empty until one is). Its
snapshot is labelled `preschema16`, and
beside it stands `<snapshot>.liveness`, a verified copy of the liveness file
the store had then. Going back to a build at schema 15 is the restore described
below with the `preschema16` snapshot, plus that copy put beside the store as
`<store>.liveness`. A store at 14 takes both steps in one open, under the one
`preschema15` snapshot, and that copy then stands beside it instead.

## Restoring a snapshot

Every snapshot taken from schema 14 on carries the pictures as well: a folder
with the snapshot's name and `.images` after it stands beside the snapshot file,
and a snapshot counts as verified only when that folder holds every picture the
store held, each file's SHA-256 equal to its name. To restore one, stop every
process that holds the store, delete the `-wal` and `-shm` files beside it, copy
the snapshot file in place of the database, delete the `images` folder beside it
and put a copy of the snapshot's `.images` folder there under the name `images`;
a snapshot with no `.images` folder held no pictures, and the store then has
none. The folder's `.store` file names the store it belongs to, and a snapshot's
`.images` carries it, so the restored folder is still its store's. Every open of
the store also removes a picture file that no item holds, so a picture written
after the snapshot does not outlive the restore even when the folder was not
replaced; a store neither clears nor writes into a folder whose `.store` names
another store, as one opened from a second database file in the same directory
would find it. Going back to a build at schema 13 is the same with
the `preschema14` snapshot, which has no `.images` folder, before pinning the
earlier release as described below for schema 9: everything written since is
lost, pictures included.

## Changes that took no migration

The order of work took no migration of its own. A placement is written to the
item's `position`, a column every schema-9 store already has, so no snapshot was
taken for it, and an earlier schema-9 build opens a schema-9 store that holds
placements and lists its states in the placed order. Such a build still puts a
moved item last in its new state, and a later placement works from there.

Notes on answers and option descriptions took no migration either. A schema-9
build from before them opens a schema-9 store that holds them, and its tools read
and answer those questions, with the note among the `answers` as `_note`. Its web
interface is strict about what it reads, so it reports that it could not update
the questions: on the card of a question with a note or a described option, and for
the whole "waiting for my answer" list while a pending question has a described
option. Everything else in that build works.

## Going back to a build at schema 8

To go back to a build at schema 8, first stop every process that holds the
store: the listener and every agent client, since each one runs its own server.
Pin the earlier release with `launcher install --revision <commit>`. Then
either stamp the store back with `PRAGMA user_version=8`, which keeps
every row including those written since the upgrade (a schema-8 build creates
the dropped tables again, empty), or put the `preschema9` snapshot in its place,
which loses everything written since. Before replacing the file, delete the
`-wal` and `-shm` files beside it: a write-ahead log left behind would be
applied to the snapshot on the next open.

## Going back to a build at schema 9

Going back to a build at schema 9 has one way, and its order matters. Stop every
process that holds the store, delete the `-wal` and `-shm` files, put the
`preschema10` snapshot in place of the store, and only then pin the earlier
release with `launcher install --revision <commit>`. Pinned first, the release
reaches every running session through its stdio front within seconds and
refuses the store that is still at 10, so the board disappears from all of
them. Everything written since the upgrade is lost. Stamping the store back to
9 is not a way back here: a schema-9 build would show a reply as a comment of
its own and misread the new keys in an answer.

The hook spool changed in the same release. A session start that has to wait in
the spool is written as spool version 2, which carries where the session is open;
every other event keeps version 1. After going back, the earlier build delivers a
version-1 file left in the spool and sets a version-2 one aside as `*.rejected`,
which `doctor` counts until the file is deleted. That session start belonged to
the upgraded store going back discards, so nothing more is lost.

## Converting a Board-era store

A store that still contains the Board-era model refuses to open until you
authorize its one-way conversion. Inspect the conversion first, then apply it:

```bash
python valkama.py migrate planning-model --dry-run
python valkama.py migrate planning-model
```

The dry run converts a temporary copy. Before changing the actual store, the
migration takes a clean SQLite snapshot in the `backups/` directory beside the
configured database. The generated filename begins `valkama-` and includes a
migration label such as `preschema9`, `preproductmodel` or `preupgrade`. To
check recovery without replacing your working store, copy the snapshot to a
separate path, set `VALKAMA_DB` to the copy, and run the same dry run and
migration there. The database path may differ from the default when `store` or
`VALKAMA_DB` is configured. Generated snapshots retain the last five files per
migration label. A snapshot that a retry would reuse but that cannot be read --
half a file left by a process killed while writing it -- is renamed with the
suffix `.unverified`, kept, and replaced by a fresh snapshot; remove it by hand
once you no longer need it.
