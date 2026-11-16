# Launching agents from a card

A work item can start the agent that works on it. Each launch is one execution:
an attempt with a delivery contract and a typed outcome, recorded on the item
together with the session it ran in.

## Turn on the Execution tab

The launch dialog opens from the card's Execution tab, which is off by default.
Turn it on under Settings → General → Interface, on each device you use; it takes
effect at once. With the tab off, a card does not offer launching and does not read
attempts, and launching itself keeps working as described here.

## The delivery contract and the outcome

The launch dialog records a delivery contract, not just a command: an
`expected_effect` (`change_required`, `no_change_acceptable` or
`read_only_finding`), an optional review mode, and an interface version.

Both clients get an enforced JSON result schema. The persisted outcome is one of
`launch_failed`, `refused`, `expected_no_change`, `unexpected_no_change`,
`partial` or `complete` — **exit code zero is not delivery.** Only `complete`, or
an `expected_no_change` the contract allows, moves Dev to Review. A spawn failure
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
`work_item`, `space_root`, `status`, `detail`, and `at`. Missing or ambiguous
identity returns `resolved: false` with the corresponding status. This endpoint
does not return an event feed.

Planning owns `POST /api/ingest`, which accepts only `session_start`,
`session_end`, `attention`, and `turn_end` lifecycle events. The standalone
session fleet, inbox, tool stream, `/api/sessions`, `/api/session-seen`, and
Sessions SSE view are retired. The flow-metrics Analytics dashboards and
exports, Improvements, and the Skills catalogue and activation API are also
retired; the Analytics module that stands in the navigation now is for the usage
of agent work. This does not
change installed skill files or agent-client settings.

How sessions reach Valkama in the first place is in [Client hooks](client-hooks.md).
