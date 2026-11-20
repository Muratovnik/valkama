# Upgrading the store and going back

Valkama keeps its data in a local SQLite store, `~/.valkama/valkama.sqlite3`
unless `store` or `VALKAMA_DB` names another file (see
[Configuration](configuration.md)). This guide says what happens when a newer
build opens an older store, how a snapshot is restored, and how to go back to an
earlier build.

## Migrating an older store

This build opens only a store at its own schema, 24, and migrates none as it opens
it. A store Valkama 2.9 left -- schema 18 with its word index, or 17 with it from a
2.9 build before schema 18 -- is refused with "run `valkama migrate work-model` once"
and left as it was. An older store, or one at 17 without the index, is refused with
"open it with Valkama 2.9 first" and left exactly as it was, with no snapshot and no
write. Open it with Valkama 2.9 once, which carries a store of any earlier schema
forward under its own snapshots as that release describes, and then come back.

## Migrating a 2.9 store

To carry a 2.9 store to the work model, first upgrade the project registry
(`projects upgrade`, which writes an empty one on a machine with no registry),
register and bind the projects its spaces hold (`projects add`,
`projects bind`), and write the file that gives each work item its projects:

```powershell
valkama projects map-items --output item-projects.json
```

`map-items` reads a copy of the store, the registry and the registered repositories,
and writes nothing else. It reads the text of each commit ref for the commits it
names: every hash of 7 to 64 hex digits, except the left end of a range `X..Y` and
the hash right after `base`, `from`, `onto` or `от`, which name where work started.
An address `…/<name>/commit/<hash>` (or GitLab's `…/<name>/-/commit/<hash>`) reads as
`<name>@<hash>`. A hash with a registered project's id before it (`project@hash`,
`project hash`, `project:hash`, `owner/project@hash`) belongs to that project;
otherwise it belongs to the one registered repository holding it, and with none or
several it is kept without a project. Another address becomes a `url` ref, and a
text naming no hash is dropped. The file holds one record of each commit ref under
`commit_refs`: its commits as project and hash, with the subject and time Git gave,
the hashes it skipped, and whether it becomes a `url` ref or is dropped. Set `drop`
on a record, or take a commit out of it, to carry less.

For each task its commits decide first: it takes the registered projects of its
commits. Without such a commit, a label equal to the id of a project bound to the
task's space names that project, and `--label LABEL=PROJECT`
carries another label in any space, provided its words are words of the project's
id. A task with neither keeps its space's project. A carried label leaves the task,
and the project's id still finds it in a search. The command prints the tasks it
counted by space and by source, each task whose label names another project than
its commits, and each task holding the label of a project of another space. Under
`commit_refs` it prints the commits by project and those without one, the refs that
become `url` refs, those dropped and those that skipped a hash, and each commit two
refs of one item label differently. Read the file before migrating, and add a
project where it is right. It refuses a file that already exists.

Then stop every process that holds the store -- the listener and every agent
client, since each one runs its own server -- and run:

```powershell
valkama migrate work-model --item-projects item-projects.json
```

It migrates the configured store (`store` or `VALKAMA_DB`). First it checks, only
reading, that the registry is format 4 and binds each space's project to it, that no
two spaces share a name, and that the file belongs to this store as it is now and
names registered projects only, holds a well-formed record of every commit ref, and
derives a task's project from commits only when it carries one of them; a store
holding work items needs the file. A refusal names what to run, and nothing is
written. Before its first write it takes a verified snapshot labelled `pre3.0` in `backups/` beside the store, with
the pictures in a `.images` folder beside it, and then runs every step and checks
every postcondition in one transaction: a step that fails or a postcondition that
does not hold rolls all of it back and leaves the store at the schema it had. The
command prints a JSON report with the time and result of each step and
postcondition and of the snapshot, and exits 1 when the run failed, naming what
failed. A second run finds the store current and changes nothing.

A store at 17 first takes the step Valkama 2.9.0 takes at schema 18, in the same
transaction: the owner's names for the quota accounts are keyed by account
(`quota_account_names.account`, `organization` before), keeping every name. A store
at 18 already has them so, and both reach the same store.

Among its steps, the migration attaches each commit a record carries to the ref's
item, marked as carried over, and adds the `url` refs; several refs of one item
naming one commit give one attachment, with the label, author and time of the first
of them that has a label. A label gets the ref's text after it when that text is an
address or a note rather than a hash. Every commit ref then leaves the store, and
the refs table is rebuilt to refuse the kind `commit`, as a fresh store's does.

`--dry-run` migrates a copy instead and only reads the store: `--into <directory>`
keeps the copy and its snapshot there, and without it the copy goes when the run
ends. To go back to Valkama 2.9 after the migration, stop every process that holds
the store, delete the `-wal` and `-shm` files beside it, put the `pre3.0` snapshot in
place of the database and its `.images` folder in place of `images`, as
[Restoring a snapshot](#restoring-a-snapshot) describes, and only then pin the 2.9
release with `launcher install --revision <commit>`; everything written since the
migration is lost. A 2.9 build refuses a store at 24.

The sections below describe the snapshots the earlier upgrades took and how to go
back from them.

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

The order set by hand took no migration of its own before 3.0. A placement was
written to the item's `position`, a column every schema-9 store already had, so no
snapshot was taken for it, and an earlier schema-9 build opened a schema-9 store
that held placements and listed its states in the placed order. From 3.0 the order
is computed, and `valkama migrate work-model` drops `position`: the `pre3.0`
snapshot is what keeps the placements.

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

## Snapshots

Before changing a store, an upgrade takes a clean SQLite snapshot in the
`backups/` directory beside the configured database. The generated filename
begins `valkama-` and includes a migration label such as `preschema9` or
`preproductmodel`. To check recovery without replacing your working store, copy
the snapshot to a separate path and set `VALKAMA_DB` to the copy. The database
path may differ from the default when `store` or `VALKAMA_DB` is configured.
Generated snapshots retain the last five files per
migration label. A snapshot that a retry would reuse but that cannot be read --
half a file left by a process killed while writing it -- is renamed with the
suffix `.unverified`, kept, and replaced by a fresh snapshot; remove it by hand
once you no longer need it.
