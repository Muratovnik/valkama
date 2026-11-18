# Launching agents from a card

A work item can start the agent that works on it. Each launch is one execution:
an attempt with a delivery contract and a typed outcome, recorded on the item
together with the session it ran in.

## Turn on the Execution tab

The launch dialog opens from the card's Execution tab, which is off by default.
Turn it on under Settings → General → Interface, on each device you use; it takes
effect at once. With the tab off, a card does not offer launching and does not read
attempts, and launching itself keeps working as described here.

The dialog suggests the directory a launch runs in by the space's launch place,
`space` by default. With `space` it is the space's root, the root of its default
project. With `item_project` it is the root of the card's project when the card
names exactly one, even a project of another space; with none or several it is
the space's root, since a set of projects has no first one. A goal or stage
always takes the space's root. The launch place is the owner's setting,
written through `POST /api/planning/space/settings` with `{space, launch_place}`;
no planning tool writes it. The attempt records the project of that root as its
`project_id`. Each claim answers with the root of every project the card changes
(`project_roots`), so the agent reads each one's instructions before editing there.
The capabilities read names the suggested directory as `repository`, with
`repository_project` and `repository_status`, which uses the words of
`project_roots` with the same meaning: `mapped` (the root is registered and its directory is there),
`missing` (its directory is not there), `unregistered` (the card's project is
no longer in the registry) and `unavailable` (the registry could not be read,
one that does not parse included). Two cases only the launch root has:
`unbound`, the card's space binds no project, and `no_item`, the read names no
card or one that does not exist. With `missing` the suggested directory is the
registered root that is not there; with every other word but `mapped` it is
empty.

A launch also gets the roots of the other projects it may touch, as directories
beside the one it runs in: the root of every project of the card's space and of
every other project the card names, whose directory is there, except the launch
root and the roots inside it. The card's own come first, in the order of
`project_roots`, then the space's other projects by id. The card's projects do
not narrow this: a launch may edit every root of its space's projects that lies
outside its own. Claude Code receives
each as `--add-dir` on a fresh run and on a resume. Codex receives them as
`--add-dir` on `codex exec`; `codex exec resume` takes none, and Valkama does not
pass `sandbox_workspace_write.writable_roots` through `-c`, which would replace
the owner's own list, so a resumed Codex run has only its working root. Neither
client reliably reads the instructions of an added directory, which is why the
claim names every root. The capabilities read
(`GET /api/execution/capabilities?work_item=…`) lists them as `added_roots`, and
each client's `added_dirs` says on which runs it takes them (`fresh_and_resume`,
`fresh_only` or `none`). The attempt reads every root it passed: its
`base_artifact` and `final_artifact` carry `added`, one entry per root with its
project, its root and the same Git reading the working directory gets, so a
change made only beside the working directory is evidence too.

## The delivery contract and the outcome

The launch dialog records a delivery contract, not just a command: an
`expected_effect` (`change_required`, `no_change_acceptable` or
`read_only_finding`), an optional review mode, and an interface version.

Both clients get an enforced JSON result schema. The persisted outcome is one of
`launch_failed`, `refused`, `expected_no_change`, `unexpected_no_change`,
`partial` or `complete` — **exit code zero is not delivery.** A launch moves
nothing: the launched agent moves the item to Review with what the owner is to
check when its work is done. A spawn failure
restores the pre-launch lane and claim while they still belong to that launch.
If someone changed the item meanwhile, their state is preserved and the failed
attempt records why compensation was skipped.

## Resume

Resume works only with the client's own stored session identity: a generated
UUID for fresh Claude launches, the thread id from Codex's JSON event stream.
The runner never guesses which task to continue from a title, a directory, a
timestamp or `--last`.

## Worktree launches

Worktree launches run a preflight before mutating anything: the path must be a
repository top level and not a submodule, and the sibling target must not
escape, traverse a symlink or junction, or already exist without a real worktree
registration.

## Session context on a work item

Execution history, launch, stop, resume, and native session opening belong to
work-item context. A session reference retains the client's exact stored
identity; resume never chooses a session by title, directory, time, or recency.

`GET /api/session?id=<id>` resolves compact session context by exact identity
or a unique stored prefix. A successful
response has `resolved: true` and includes `session`, `client_family`,
`work_item`, `space_root`, `status`, `detail`, and `at`. `space_root` is the
root of the default project of the space the session's work item lives in: a
space may have several projects, and the registry names one of them its default.
Missing or ambiguous identity returns `resolved: false` with the corresponding
status. This endpoint does not return an event feed.

Planning owns `POST /api/ingest`, which accepts only `session_start`,
`session_end`, `attention`, and `turn_end` lifecycle events. The standalone
session fleet, inbox, tool stream, `/api/sessions`, `/api/session-seen`, and
Sessions SSE view are retired. The flow-metrics Analytics dashboards and
exports, Improvements, and the Skills catalogue and activation API are also
retired; the Analytics module that stands in the navigation now is for the usage
of agent work. Volumes, a module of its own, reads how much work stands in each
state and what it took; it brings none of the retired dashboards back. This does not
change installed skill files or agent-client settings.

How sessions reach Valkama in the first place is in [Client hooks](client-hooks.md).
