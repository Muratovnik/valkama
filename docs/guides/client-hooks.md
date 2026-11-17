# Client hooks

Claude Code and Codex tell Valkama about their sessions through hooks: small
commands the client runs on session events. They keep a session visible on the
work item it serves, record the subscription quota, tell a working agent what a
person did, and archive the session's transcript. What each hook keeps, and how
it is registered, is in [the client hook contract](../hook-contract.md).

## The hook command

`valkama hook <client> <event>` is the command Claude Code and Codex hooks run.
It reads the hook input from stdin and records the session event straight into
the store, so sessions stay visible while neither `serve` nor an MCP session is
running. When the store is busy, missing or at another schema version, the
event goes to a spool beside the store and lands later. The command exits 0 —
only `claude watch` exits 2, which is how it wakes its session — and a lifecycle
event prints nothing of its own, so it never blocks a client session. The one
exception is `session-start` after a resume or a compaction: it prints a short
note of the work the session holds
([details](../hook-contract.md#the-resume-note)).

```
valkama hook claude session-start   < hook-input.json
valkama hook codex stop             < hook-input.json
valkama hook claude pre-tool-use    < hook-input.json
```

The events are `session-start`, `session-end`, `subagent-start`,
`subagent-stop`, `stop`, `user-prompt-submit` and `pre-compact` for both
clients, plus `notification` and `post-tool-use` for Claude Code. Each one updates
the session row that `GET /api/session` and work-item context read.
`claude post-tool-use` names the agent an Agent tool call started. `claude
pre-tool-use` leaves, beside the store, the pair that tells the server which
session and agent make a Valkama tool call; it prints nothing and leaves the call
as it is ([details](../hook-contract.md#the-call-pair)). `session-start`
also records where the session is open — an IDE extension, its terminal, a
terminal, Claude Desktop or the Codex app — from a few named environment
variables and, on Windows, the names of the programs above the hook, which is
where a click on the session opens it. What is kept is the kind of place, the
product, the folder the session started in and Claude Desktop's own id for it,
never a variable's value
([details](../hook-contract.md#where-a-session-is-open)). Only an
allowlisted set of fields is kept: never the prompt, tool arguments other than an
Agent call's short description, or assistant text.

## The status line command

`valkama statusline` is the command Claude Code runs as its status line. It
records the `rate_limits` the status line input carries, the five-hour window
and the week, as quota samples of that session, through the same store-or-spool
path, and prints nothing of its own. A status line command the user already had
is passed as `--previous=<base64 of its UTF-8 text>`; it then runs with the same
input through the same shell, and its output is what the status line shows.
Only terminal sessions run a status line; the VS Code extension does not.
`valkama statusline --help` states the interface, and
[the hook contract](../hook-contract.md#the-status-line-command) says how to
write and restore the setting.

```
valkama statusline                       < statusline-input.json
valkama statusline --previous=Y2F0       < statusline-input.json
valkama statusline --source=mod          < mod-reading.json
```

## The Claude Code quota mod

The same quota comes from Valkama's Claude Code mod, `valkama-quota` in
`server/mod/valkama-quota`, in every session, the VS Code extension's included.
After each model response, and when a window moves during a turn, the mod hands
the session's reading to `valkama statusline --source=mod` through the managed
launcher, as the same JSON fields the status line sends; the reading is recorded
under the source `mod`. The hand-over runs after the hook has answered, one at a
time, and is stopped after 10 seconds, so a missing, slow or failing Valkama
costs the reading and never a turn. The repository is a Claude Code marketplace
named `valkama`. With the launcher installed from a release that has
`--source=mod` (`valkama statusline --help` lists it), install the mod at the
prompt of a Claude Code terminal session:

```
/plugin install valkama-quota --marketplace Muratovnik/valkama
```

or from a checkout, in a shell:

```
claude plugin marketplace add <checkout>
claude plugin install valkama-quota@valkama
```

`claude plugin disable valkama-quota@valkama` switches it off. Its own tests run
with `claude plugin test server/mod/valkama-quota`, and
[the hook contract](../hook-contract.md#the-mod) says what it hands over and
when.

## Telling the agent what a person did

The same hooks tell a working agent what a person did in the interface on the
work its session holds. `post-tool-use`, `user-prompt-submit` and `stop` answer
with a short notice when there is news: a comment, an answer, a status change, a
cancel. The notice goes to the model; in Claude Code the person also sees one
line per item, saying the agent was told what they did or what another agent
wrote there. The orchestrator hears about everything its session holds, a subagent
about the items where it holds the claim or a step and about replies in its own
threads and answers to its own questions, each event once. `claude watch`,
registered with Claude Code's `asyncRewake`, wakes an orchestrator that is idle,
for example while it waits for a background subagent. Codex is told at its
next prompt or tool call. `notify` switches this off (see
[Configuration](configuration.md)), and
[the hook contract](../hook-contract.md#telling-the-agent-what-a-person-did)
says who is told, what a notice holds and what it costs.

## The transcript archive

When a session ends, the hook also copies the session's transcript, and a
subagent's own transcript when the client reports one, into `transcripts/`
beside the store, and records the copy's sha256. The copy survives the client
deleting its original. A transcript too large to copy within the hook's time
budget is left for the transcript sweep to copy later. Copies stay on this
machine and never appear in an export. They are kept while an open work item
refers to the session, and for at least 90 days after the later of the
session's last activity and the closing of the last item that refers to it.
Transcripts can contain secrets and personal data, so treat the store's
directory accordingly. To delete copies when someone asks, without waiting for
retention:

```text
valkama transcripts purge --session <id> [--session <id> ...] [--dry-run]
valkama transcripts purge --before 2026-01-01 [--dry-run]
```

`--session` names sessions by exact id; `--before` takes the sessions whose
last activity is earlier than that date (UTC) or time. Given both, a session
must match both. The copies go even while an open work item refers to the
session, and the command says how many such items there were. A copy still
owed for those sessions is never made. The store keeps only the fact of each
deletion and the copy's hash, never its content, and the command prints counts
of sessions, files and bytes, never a session id or a path. `--dry-run`
prints the same counts and changes nothing.

## What doctor reports

`doctor` reports spool files still waiting, rejected spool files, the last
hook event from each client, and the transcript archive: copies kept, copies
still owed and files no record names. For the usage read from transcripts it
reports the models that spent tokens with no price, the requests met in more
than one run, how many runs are current, wait to be read again, were read
again, or were refused by reason, and what share of the usage segments, and of
their seconds, names the organization they ran for. The fields, the spool format, the session
rules and the archive's retention are in
[the client hook contract](../hook-contract.md).

## The Git commit hook

Valkama attaches each commit an agent's shell makes to the task that agent's
session holds. It learns of the commit from Git hooks it keeps in the global Git
configuration, the file `git config --global` writes:

```
valkama git-hook install
valkama git-hook status
valkama git-hook uninstall
```

`install` writes three hooks, `valkama-commit` for `post-commit`,
`valkama-rewrite` for `post-rewrite` and `valkama-merge` for `post-merge`, each
as `hook.<name>.command` and `hook.<name>.event`. It needs the stable launcher
and refuses without it: each command runs the launcher's shim on the
interpreter its manifest records, so the hooks follow the pinned release.
`launcher install` rewrites the command of each hook that is there; if that
fails, its answer names the failure in `git_hook_error` and the launcher stays
installed. Nothing else in the file is read for a decision or changed: not
`core.hooksPath`, not the hook directory, not another program's hooks.
`uninstall` removes the three sections whole, which leaves the file as it was
before the install when nothing else changed it. `launcher uninstall` takes the
same three out before it removes the launcher, so they never run a shim that is
gone; if that removal fails, its answer names the failure in `git_hook_error`
and the launcher is removed all the same.

Git runs these hooks in addition to the hook directory's scripts. Each command
first checks that the environment names a Claude Code or Codex session, so a
commit made outside one — yours, a build's — ends in the shell Git started and
never starts Python. Inside a session, a commit to a repository registered in
the [project registry](configuration.md#project-registry) leaves one small JSON record: the
repository and its project, each commit's hash, parents, subject and time, the
old and new hashes of an amend or a rebase, and the client's session ids;
never a file's content or a diff. The record goes to `commits/` beside the
store, or to `valkama/commits/` in the repository's Git directory when the
store's directory takes no file. The client's next hook takes it into the store
and deletes it; a record no hook took for an hour is taken by the planning
sweep. The hook prints nothing and always exits 0. To switch one hook off in
one repository: `git config hook.valkama-commit.enabled false`.

`status` reads each hook as `installed`, `missing`, `stale` (a command or event
other than the current launcher's), `disabled` (`hook.<name>.enabled` is false
in the global file) or `unsupported` (Git does not list it in `git hook list`:
this Git runs no hooks from its configuration), and counts the records waiting
with the directories they wait in; `--json` gives the fields `global_file`,
`hooks`, `records` and `record_directories`. `doctor` reports the hooks and the
records that waited for over an hour or were set aside in `commits/rejected/`,
and `setup` offers the install. Which task a commit goes to, and what the agent
is told, is in [the client hook contract](../hook-contract.md#commits).
