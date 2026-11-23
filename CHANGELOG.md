# Changelog

Notable changes to Valkama, newest release first. Each release says what changed for
its users since the release before it: a few highlights, what broke where something did,
then features, bug fixes and performance improvements, each line linked to the commits
that made it. The layout is
[conventional-changelog](https://github.com/conventional-changelog/conventional-changelog)'s,
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The MCP server reports itself as `<release>+<build>`, where the build is a digest
over the modules the running process started with. Two servers from different
checkouts are therefore distinguishable even at the same version.

## [Unreleased]

### Added

- **`valkama migrate work-model` carries a store Valkama 2.9 left to schema 25.** Run
  once with every session stopped, it takes a verified `pre3.0` snapshot with the
  pictures beside it, then gives the workflows their eight categories and the service
  state, the history their renamed keys and every item its kind, acceptance and start,
  releases what a container or a task outside work still holds and takes the open
  children out of a closed container, all in one transaction with every postcondition
  checked before it commits. A store at 17, from a 2.9 build before 2.9.0, first
  takes 2.9.0's own step in the same transaction: its quota account names are keyed
  by account. It prints a JSON report with the time of each step;
  `--dry-run` migrates a copy, kept with `--into`. A store that is not one 2.9 left is
  refused and left as it was.
- **`valkama projects map-items` gives each work item its projects for the migration.**
  It reads a copy of the store, the registry and the registered repositories and
  writes a file: a task takes the projects of its commits, else those of its labels
  that name a project of its space (or one `--label` maps), else its space's project.
  `migrate work-model --item-projects <file>` writes those projects, takes off the
  labels a project now carries and refuses to start, before any write, on a registry
  that is not format 4, a space whose project is not bound to it, two spaces of one
  name or a file of another store or state.
- **`valkama migrate work-model` refuses to start while a Valkama server may still
  hold the store.** When the store's liveness file shows a server running less than
  three minutes ago, it exits 1 with a `refused` report naming the seconds since and
  the seconds to wait, before the snapshot and before any write; `--dry-run` migrates
  its copy as before.
- **`valkama migrate work-model` refuses to start on a SQLite older than 3.47.1.** The
  migration has crashed on SQLite 3.45.1, so a Python whose SQLite is older exits 1
  with a `refused` report naming the version it found, before the snapshot, before any
  write and, under `--dry-run`, before the copy. The service itself still runs on
  SQLite 3.43 or newer.
- **The migration carries commit refs over as commits.** `map-items` reads each commit
  ref's text — a hash, `project@hash`, a commit address, or a note naming several
  hashes, of which the start of a range and the hash after `base` or `from` are
  skipped — and records its commits with their projects in the file's `commit_refs`;
  a task's projects from commits come from the same records. The migration attaches
  those commits to the ref's item, makes another address a `url` ref, drops a text
  without a hash and removes every commit ref, refusing first a file whose records do
  not match the store's refs.
- **The owner's participation setting is stored and read.** For all spaces and for
  one, it says at which points an agent's decision waits for the owner (`human`) and
  at which it goes ahead (`agent`), whether the queue hands out work and the reminder
  to triage shows, and four numbers beside them; a label may carry a rule and a
  description. A space overrides single values and inherits the rest; with nothing
  written every space stands at the default set. `GET /api/planning/participation`
  reads one scope with the set it stands at; `POST` writes a value, one of the sets
  `minimal`, `default`, `maximal` and `manual`, or a label's rule, and refuses an
  agent with `owner_only`.
- **The decisions an agent takes on its own can be read back.** A decision an agent
  took without asking, at a point where the owner's setting let it go ahead, is
  marked on the history event that recorded it, with its point and a short line of
  what was decided; the mark goes with its event. `GET /api/planning/decisions` lists
  the marks newest first, by `space`, `project`, `point` (repeatable), `from` and
  `to` (a UTC day or a timestamp, both ends included), in pages of up to 200
  (`limit`, `offset`), each with its item, session and time. In an item's full
  record a marked event carries its `point`. A migrated store starts with no marks.
- **Work can be put off until new comments come.** `defer` and the owner's answer
  `later` take, beside a day, a time and an item's close, a count of new comments
  (`until: "3 comments"`) and a count with a day or time, whichever comes first
  (`"2026-12-01 or 3 comments"`). Every comment and reply written on the item after it
  was put off counts, a person's or an agent's; the comment that reaches the count
  brings the work back in its own write, and under accepted goals the owner is asked
  once. The record's `deferred` carries `until_comments`, and `returned` says
  `comments`. The card's «Put off» and a question's «Later…» take the count too. The
  store moves to schema 25.

### Changed

- **A fresh store holds the work model, at schema 25.** A new space's workflow has a
  state for each of eight categories — Triage, Deferred, Ready, Dev, Review, Done,
  Blocked and Cancelled — and new work starts in Triage; `backlog` and `queued` are no
  longer categories. A goal or a stage is stored as a container, which the store keeps
  out of ready, active, review and blocked, and a service state beside the eight holds
  an accepted open one. A store Valkama 2.9 left is refused with "run `valkama migrate
  work-model` once" and left as it was, and a 2.9 build refuses a store at 25.
- **A close ends the questions on its item and says how.** Closing an item writes
  every question, decision and list still pending on it `expired`, with
  `expired_reason` `item_completed` or `item_cancelled` in place of `task_closed`,
  and a `request_expired` event; reopening brings none back. A change of an answer
  on a closed item is refused with `[item_closed]`, a question or list in the call
  that closes its item is refused as one that would end unanswered in the same
  write, and a request record carries `purpose`. The migration ends the requests
  2.9 left pending on closed items the same way, with no event. A request whose
  deadline or execution had already ended it keeps that reason, `deadline` or
  `execution_closed`, and the close tells nobody of it.
- **The service state stays out of reach.** `get_planning_space` lists the eight category
  states and the moves between them only. `container` named as a state, in a transition
  or a list filter, or as a category is refused with the text that says what replaces
  it, and `list_work_items(kind=goal)` keeps the containers under no parent while
  `kind=stage` keeps those under one.
- **An orchestrator hears its subagents' work.** A state change, a summary, a release,
  a takeover or a question to the owner that a subagent writes, on any item its session
  wrote to, reaches the orchestrator at its next tool call as one line, `by your agent
  <id>`, that quotes nothing and never wakes it, the call that took and closed an item
  at once included. Nobody hears its own writes, and a subagent still hears nothing of
  its session; the person sees "what a subagent of this session wrote".
- **Valkama's own records reach the work they touch.** A release of a claim whose
  lease ran out, and the move of its task back to the queue, come as `by Valkama`
  lines to the holders and followers of the item, once more to the session whose
  claim lapsed, and through the tree to whoever works under the goal; the person
  sees "what Valkama recorded". They wake nobody: a record wakes only when its kind
  asks for a session, and no kind does yet. A notice's two blocks each have one
  heading now, the second "news on work this session holds, follows or works on,
  from other agents and from Valkama".

### Removed

- **A store older than Valkama 2.9 left it is no longer brought up.** Opening one now
  refuses with "open it with Valkama 2.9 first" and leaves it exactly as it was, with no
  snapshot and no write; Valkama 2.9 still carries a store of any earlier schema forward.
  With that, the Board-era conversion is gone, and with it `migrate planning-model`,
  the `VALKAMA_CUTOVER` permission and the step that gave an old default workflow its
  Cancelled state.

## [2.9.0](https://github.com/Muratovnik/valkama/compare/v2.8.0...v2.9.0) (2026-11-16)

### Highlights

- The Analytics page is rebuilt as a monitor: a rail of tiles for the overview and each
  dimension beside one panel, a live hour «Now», periods set between moments, a split by
  a second dimension, and the subscription quota of each account.
- The quota comes from three sources — Claude Code's status line, the `valkama-quota`
  mod and an opt-in poll of the usage endpoint — and quota alerts warn before a window
  runs out.
- The MCP catalogue falls from 33 tools to 21, one per capability; see Breaking Changes.
- Search reads a query as words, best match first, and a task's card opens over
  Analytics and Settings instead of moving to the board.
- From 2.9.0 Valkama is licensed under the Apache License 2.0 with the Commons Clause
  condition; releases up to 2.8.0 stay under the MIT License
  ([0cb735b](https://github.com/Muratovnik/valkama/commit/0cb735bdb68d9d1b5d9195b0feb0db3a92918098)).
  The README is now an entry page, and the user guides live under `docs/guides`
  ([1caf2b0](https://github.com/Muratovnik/valkama/commit/1caf2b0e33b2804fc7ec2ff4d8bf420a0a80a5db),
  [757899a](https://github.com/Muratovnik/valkama/commit/757899ae690aaaba180cccf458729e0ebbad5773)).
- Upgrading: the store moves to schema 18 behind the recovery point `preschema17`, and a
  2.8 build refuses it afterwards. The same first open fills the search index and folds
  duplicate `relates-to` links, after a verified recovery point.

### Breaking Changes

Twelve planning tools that each made one write are removed: make those writes through
`apply_work_item_changes`, which agents already used for nearly every such write
([ad5cff6](https://github.com/Muratovnik/valkama/commit/ad5cff6fa1c54881d8a14b501c487522643df027)).
Restart running client sessions after installing this release, because a session keeps
the tool list it started with. A call to a removed name is refused with the code
`removed_tool` and a message naming the call that does its work; it is a refusal, not an
alias, and writes nothing. The HTTP writes behind these tools are unchanged.

| Removed tool | Call instead |
| --- | --- |
| `update_work_item` | `apply_work_item_changes` with `update` |
| `transition_work_item` | `apply_work_item_changes` with `transition` |
| `set_work_item_checklist` | `apply_work_item_changes` with `checklist` |
| `tick_work_item_checklist_item` | `apply_work_item_changes` with `checklist_ticks` |
| `link_work_items` | `apply_work_item_changes` with `links` |
| `attach_work_item_ref` | `apply_work_item_changes` with `refs` |
| `set_work_item_summary` | `apply_work_item_changes` with `summary` |
| `comment_work_item` | `apply_work_item_changes` with `comment` or `comments` |
| `resolve_work_item_comment` | `apply_work_item_changes` with `resolutions` |
| `report_work_item` | `apply_work_item_changes` with `summary`; a report is published in the card |
| `select_work_item_summary` | `apply_work_item_changes` with `summary`; a report is selected as the outcome in the card |
| `decline_work_item_request` | `expire_work_item_request` to withdraw a question; the owner declines one in the card |

The argument spellings those tools read besides their own (`from`, `to`, `target` and
`type` for a link, `to` and `to_state` for a state, `ref` for a ref's value) went with
them.

### Features

- **analytics:** rebuild the page as a monitor: a rail with a tile for the overview and for each of ten dimensions, and a panel with the overview's period chart against the period before, ranked bars, small charts and a sortable table that downloads as CSV ([4a3c4dd](https://github.com/Muratovnik/valkama/commit/4a3c4dd0581beed69fbaee1f6a3d1d364f432683), [dc3059c](https://github.com/Muratovnik/valkama/commit/dc3059ceb4ec28e7e57ef1edeaebf8b0bf7479ff), [382d041](https://github.com/Muratovnik/valkama/commit/382d0414ef83f3c5661075b838b672a65be85ad3))
- **analytics:** add the token kinds section, and break work with no task down by project and launch class ([b3d69a2](https://github.com/Muratovnik/valkama/commit/b3d69a274452229ba4a0497a5fd75ed50918f0eb), [7cfe9a2](https://github.com/Muratovnik/valkama/commit/7cfe9a2c76766b4634392a9f2953d14be0c160fd))
- **analytics:** show the tokens and the cost an hour of agent time took, and each figure's trend beside it ([c776b94](https://github.com/Muratovnik/valkama/commit/c776b9439cd3d354a15e350625294585077eaa23), [0b90308](https://github.com/Muratovnik/valkama/commit/0b90308f64afc591b9ad8f52ed8846248f67cc9c))
- **analytics:** give every chart mark a hint and its table row's action: a task opens its card, any other value narrows the view, and let a cut table heading say its words whole ([80c9538](https://github.com/Muratovnik/valkama/commit/80c95388814f2893a838f9472e049e9fe38cf44c), [ee4d654](https://github.com/Muratovnik/valkama/commit/ee4d654e4168b7ebfebb8b6a37ddafaef5268fff))
- **analytics:** say what a section's figures leave out once, in the «ⓘ» of its heading, and name the cost «Cost» ([9e33190](https://github.com/Muratovnik/valkama/commit/9e331901e85f15e11f43ebea2d514c61e76d6d99))
- **analytics:** add the live period «Now», the last hour by the minute, read again every 30 seconds while the tab is visible ([24c658d](https://github.com/Muratovnik/valkama/commit/24c658d7f13c615373b6b9f399ab1d630810272e), [43e540e](https://github.com/Muratovnik/valkama/commit/43e540e4aac09dc2c8b7d493e1ddcfd963b9a4b3))
- **analytics:** add «Today» by the hour against the same hours of yesterday ([e97b92d](https://github.com/Muratovnik/valkama/commit/e97b92dfef7059f475e1a7bffd427244d7078d85))
- **analytics:** let your own period run between two moments, and set it by dragging a frame on a chart or pressing an hour or a minute ([05570cc](https://github.com/Muratovnik/valkama/commit/05570cc40e4c0640774a7cafc41815e62126a41a), [1f77c8c](https://github.com/Muratovnik/valkama/commit/1f77c8c0a3e73362ac5c902bcff8490398b723f3))
- **analytics:** say how fresh the figures are in the bar, «● 15 s ago», and keep the bar within its width at every size, the retry of a failed refresh and the buttons whose words it hides still there and named ([608aaac](https://github.com/Muratovnik/valkama/commit/608aaac39e83d6e695471d1eb1927a59a9f8fe53), [070e3c2](https://github.com/Muratovnik/valkama/commit/070e3c21d3567b06863ecb9c4982634a8803d7be), [eafbacd](https://github.com/Muratovnik/valkama/commit/eafbacd7a400123b8211308e4f2d266c44dd4f35), [cbd1811](https://github.com/Muratovnik/valkama/commit/cbd1811e413e1017dc0ec22814eb93fa0e7573ea))
- **analytics:** split a section by a second dimension from its heading, with every chart, the table and the download showing the pairs ([692101f](https://github.com/Muratovnik/valkama/commit/692101f1ffe7f6d22dbc39394c0ad1ce9a803b35), [61c597d](https://github.com/Muratovnik/valkama/commit/61c597d8bd4a05465fcf358231a931cd4019ebfa))
- **analytics:** keep each value's colour when a filter takes another value away ([56cb77b](https://github.com/Muratovnik/valkama/commit/56cb77baf556d7085b335384fbf6f9c8b44fd912))
- **analytics:** open a task's card over Analytics and Settings, and from «Go to a task», the questions and any reference, keeping the page under it ([e171f18](https://github.com/Muratovnik/valkama/commit/e171f18bdd4f5854489902694041402406883302), [33bb7fa](https://github.com/Muratovnik/valkama/commit/33bb7fa1d94010ec01dc6bac80774d374a5c6382))
- **analytics:** name executors by their session title and accounts by the owner's names, instead of hex ids ([927e1b9](https://github.com/Muratovnik/valkama/commit/927e1b97c5174d18f9a4fc5ed33506a121a43922), [10a8abc](https://github.com/Muratovnik/valkama/commit/10a8abcaac08800bf42e4ca0cccd341703519888))
- **analytics:** show each account's subscription quota: the five-hour, week and model windows with forecast, reset, readings as a step line and a table ([7262625](https://github.com/Muratovnik/valkama/commit/7262625c837728e763ee87ad6760f3f2ef9ca1ca), [57cfe60](https://github.com/Muratovnik/valkama/commit/57cfe6005b3a9340022f064130120fe9a7ff0bc7), [ef7d7d1](https://github.com/Muratovnik/valkama/commit/ef7d7d1fda41ab2326f578559a1ff30c059e09d4))
- **analytics:** break work down by account and by organization apart, each with its tile, section and filter, and say an account by the owner's name for it or by its organization and what tells it apart; the day chart marks a change of account and the quota panel adds an account to the filter by account ([ef247b3](https://github.com/Muratovnik/valkama/commit/ef247b37c80aaca3f62133a00eeb11d70c957213))
- **analytics:** say where each quota window went, ranking the work on that account by its API price estimate ([bc105c8](https://github.com/Muratovnik/valkama/commit/bc105c816c56908055be328f0f92d037039748b5))
- **api:** add `GET /api/analytics/quota`, each account's quota windows as they stand now, with a forecast; a week's forecast is a range, and each entry is keyed by its account ([ef247b3](https://github.com/Muratovnik/valkama/commit/ef247b37c80aaca3f62133a00eeb11d70c957213), [33fd536](https://github.com/Muratovnik/valkama/commit/33fd53676cebf0ea3c0e542890ae355e5f3819d0), [ce15ac8](https://github.com/Muratovnik/valkama/commit/ce15ac8067b35b594a55bfb48fc80e3835fdf78b))
- **api:** break `GET /api/analytics/usage` down by `seat`, the account a stretch of work was spent on: by its UUID, or by when its week resets where no reading names one, the same account from week to week, with an organization's work on no known account apart ([ef247b3](https://github.com/Muratovnik/valkama/commit/ef247b37c80aaca3f62133a00eeb11d70c957213), [0a64f61](https://github.com/Muratovnik/valkama/commit/0a64f6166bc0c43ec39d55fea4eea8e3bc6f93db))
- **api:** answer `GET /api/analytics/usage` by the minute with `step=minute`, up to 2,400 steps a period ([3903717](https://github.com/Muratovnik/valkama/commit/3903717fd5e15c67d50749ee71d9eed7016699f5))
- **api:** break each step of a two-dimension `group_by` down by the pair of both ([0efae2f](https://github.com/Muratovnik/valkama/commit/0efae2fc1586d1b2dc24db1a6f9ea6d02cd3e609))
- **quota:** record Claude Code's status line as a quota source with `valkama statusline`, keeping a status line you had through `--previous`, and name it in `valkama capabilities` ([5752fcc](https://github.com/Muratovnik/valkama/commit/5752fccc39b8b2eb90ac7abaacd1d45ff49783e9), [cecd8bb](https://github.com/Muratovnik/valkama/commit/cecd8bbcfdb157dec49ae164b7126388a6d6facc))
- **quota:** add the Claude Code mod `valkama-quota`, which reads the quota in every session, the VS Code extension's included; the repository is now the marketplace `valkama` ([99ba9e5](https://github.com/Muratovnik/valkama/commit/99ba9e5ec7ebed5ffc59b21ea20e34ab54b2d981), [9a62f67](https://github.com/Muratovnik/valkama/commit/9a62f673cf72732f5576b2c9a76a0bc09b6b21da))
- **quota:** add the quota source `poll`, off until the owner switches it on in Settings, with a warning that the usage endpoint is undocumented; it sends Claude Code's sign-in only to `api.anthropic.com` and keeps it nowhere ([8cbac76](https://github.com/Muratovnik/valkama/commit/8cbac7664a4bec1750fb47ea47507011c3d23723), [49c72cf](https://github.com/Muratovnik/valkama/commit/49c72cf6d4053c4155bda3cfaa9c763f732b4281))
- **quota:** warn before a window runs out: a week at 75 and 90 percent, five hours when its forecast runs out before the reset, as a new alert event on by default ([c8fa6d8](https://github.com/Muratovnik/valkama/commit/c8fa6d8b52db250c97a117ae59413728c88d955b), [c8d586d](https://github.com/Muratovnik/valkama/commit/c8d586d1e7e5db81a4301bcbbe72557280215321))
- **quota:** keep quota samples and accounts in the store at schema 17, the owner's names by account at schema 18, and import history with `valkama quota import --source FILE` ([14a1e46](https://github.com/Muratovnik/valkama/commit/14a1e4649b1fbcdea54d85e5155962360ba2aa05), [e8157c1](https://github.com/Muratovnik/valkama/commit/e8157c14c8988fd16db78d81b7924fa4ccd4ca6b))
- **doctor:** report each quota source as off, silent or working ([53dbb0f](https://github.com/Muratovnik/valkama/commit/53dbb0ffa09556c7ba3a0756ab01ef5ed3616bf1))
- **settings:** name each organization and each of its accounts the past year or the quota saw, in Settings → General → Accounts and `GET`/`PUT /api/quota/account-names` ([5fce3cc](https://github.com/Muratovnik/valkama/commit/5fce3cc85f3e699cfe529cbcd9dd05d774cdb706), [f33d191](https://github.com/Muratovnik/valkama/commit/f33d19135a7991ee8103217d9b079acfcd2a8c5c), [d2681f5](https://github.com/Muratovnik/valkama/commit/d2681f5777b3cb53b7a63fd6195677d4c913bb75), [8fcc08a](https://github.com/Muratovnik/valkama/commit/8fcc08ab2442945adeda10a0fe452cd1f1790161), [28fab94](https://github.com/Muratovnik/valkama/commit/28fab9459927aab94b82b93f37a4d819a0a299a4))
- **planning:** find work items by every word of a query, in any order, best match first, through a word index; a store without FTS5 searches by phrase as before ([2389a9d](https://github.com/Muratovnik/valkama/commit/2389a9d8a851879668fdb3a478e9b8f11ad9267f))
- **planning:** name up to three open items that read like a new one in the answer of `create_work_item` ([0253c2f](https://github.com/Muratovnik/valkama/commit/0253c2f4a32311caa6104c9dac53820ddaf805fb))
- **planning:** take a checklist group as the bare list of steps as well as `{"items": [...]}` ([52459a8](https://github.com/Muratovnik/valkama/commit/52459a82be90fd43856621b7866061a03ff43cb0))
- **web:** find in every row of the work list with Ctrl+F, the rows the list does not draw included ([1b76599](https://github.com/Muratovnik/valkama/commit/1b765995da4eadad951a9d9230099f77e998f7ab))
- **web:** give a card's chain a tab of its own and fold groups of more than five links in Relations ([1058933](https://github.com/Muratovnik/valkama/commit/105893380bdad3bc9846f0ab16779b289d483fc3))
- **web:** shorten a card's Agents tab to its totals and a link to the same work on Analytics ([f727f39](https://github.com/Muratovnik/valkama/commit/f727f39b14ad8d63df4b38b199f5fb7e1cff352a))
- **web:** show every hint and a reference's card through one hint manager, so they come and go by one rule: one at a time and none outside an open menu or a pinned help, fading in on the first show alone, held while the pointer heads for one, and saying their words once ([66cfc2b](https://github.com/Muratovnik/valkama/commit/66cfc2ba08675369ed769bf2786a82d4817e07e2), [4564342](https://github.com/Muratovnik/valkama/commit/45643426a1f09c716403623f9c7c852a73926149), [718d64b](https://github.com/Muratovnik/valkama/commit/718d64b49913ed74c28830102416df53afe12d9e), [f5a4859](https://github.com/Muratovnik/valkama/commit/f5a485962fb8b1b553618418c9deda10d8c62fd2), [6a539da](https://github.com/Muratovnik/valkama/commit/6a539da720202a9087c50e821319f3b599b73a34), [93bfbb6](https://github.com/Muratovnik/valkama/commit/93bfbb6cc75ff0a51d37c92303d73b4ece4fa1a0), [2d3337b](https://github.com/Muratovnik/valkama/commit/2d3337bd8c3f5d8c20d0932f7d9b6aa1eee87916), [3b648f9](https://github.com/Muratovnik/valkama/commit/3b648f9c996e34a6fabaccf789646c04e0a1e202), [7392a28](https://github.com/Muratovnik/valkama/commit/7392a28f5236f7b9c78a7484097aca467fe71f84))
- **web:** stand a hint by its list: past the rails, a ranking or the list view's table, clear of their rows; beside a setting or a checklist step inside its own row; on one side along a period chart; and inside its own small chart ([b13534b](https://github.com/Muratovnik/valkama/commit/b13534bcb4f2dbdb2b2d279370b3d8b6c0c0ffc0), [d537a71](https://github.com/Muratovnik/valkama/commit/d537a71b6b1753478d32430f180ba0e74ed0c080), [d485301](https://github.com/Muratovnik/valkama/commit/d485301c9f941d6771855b021af8cd2356ada324), [f81ef2a](https://github.com/Muratovnik/valkama/commit/f81ef2aeb8eacd8f5c910dadaad4d6395965089f), [9cda049](https://github.com/Muratovnik/valkama/commit/9cda049d53187034efc5539708a83b121c3557d0))
- **web:** lay a cut text's whole words over it, from the same point and in the same font, over every line a clamp shows and moving with the graph's camera, instead of a hint above it, a board tile's title, an outcome preview and a task finder row among them, the tile's only while the pointer rests on the title; a control whose label is hidden is named by its hint instead, and the chain's branch map names the task under the pointer whole ([f4fd484](https://github.com/Muratovnik/valkama/commit/f4fd4849625143fe7982342db0bc9e7299f327c0), [6bf04a4](https://github.com/Muratovnik/valkama/commit/6bf04a4d85a0890aedd635da18404bcf361865de), [e8418d1](https://github.com/Muratovnik/valkama/commit/e8418d172d99c20d4e817fcb16d013b662a24506), [5737d9d](https://github.com/Muratovnik/valkama/commit/5737d9d66b65b9c80af8fab67f1cf3ebd7c380eb), [5fd961f](https://github.com/Muratovnik/valkama/commit/5fd961f9e6cdc298048fc1826a371ed26faf03f4), [e6cb46e](https://github.com/Muratovnik/valkama/commit/e6cb46e5d54ac5802613070feaee7661248d1078), [3aa6c45](https://github.com/Muratovnik/valkama/commit/3aa6c451ee4b4486defb7ac14beb12cad8047f8c))
- **web:** show a loading mark after half a second and keep it at least 200 ms, in every read wait ([e2068b2](https://github.com/Muratovnik/valkama/commit/e2068b207bd07ac5b3449c7f4c1428b90aad4646), [1bcbb5d](https://github.com/Muratovnik/valkama/commit/1bcbb5db5064bcf687cb149148c2665e23b3bb10))
- **desktop:** open on the shell's own skeleton instead of a line of text on black, and keep the rail's width for the next start ([179edca](https://github.com/Muratovnik/valkama/commit/179edcaf30c3e3bcd58d1f3be7dd305c1ed5cb30), [0c5596a](https://github.com/Muratovnik/valkama/commit/0c5596a246cba229c7998370eb0939fcf0d6aa23))
- **hooks:** show you a line in Claude Code when the agent was told your news about its work items ([f033b38](https://github.com/Muratovnik/valkama/commit/f033b3860745c320f3fd46529b2b6d5b8613a127))

### Bug Fixes

- **hooks:** stop a Valkama call in Claude Code's auto mode from failing the calls sent beside it, and warn in `valkama doctor` when agent writes found no confirmed session ([811c916](https://github.com/Muratovnik/valkama/commit/811c9169aa5208f97c9b6a74670ed207422ecc15), [1cbae28](https://github.com/Muratovnik/valkama/commit/1cbae28a1b026467f5005f5123e3d0d08b1455af))
- **mcp:** read `request_id`, `work_item_id` and a `changes` wrapper as the arguments they mean instead of refusing them ([a367e22](https://github.com/Muratovnik/valkama/commit/a367e22402126ae0085d9b8ebda81ba450092d5d))
- **planning:** describe the object groups of `apply_work_item_changes` with their JSON, so a client stops refusing a bare-text `comment`, `summary` or `transition` ([12b6845](https://github.com/Muratovnik/valkama/commit/12b68455358da4f3b21b8a57ba9d3c438c4f0329))
- **planning:** let a batch's checklist tick take `force` to complete a step another session holds ([ed2c129](https://github.com/Muratovnik/valkama/commit/ed2c12992568786bb53ccdec239556d306d8a756))
- **planning:** release a checklist step's claim when its session lapses, and send an item nobody holds any more back to the queue; the take-next queue keeps the caller's own claim ([867b2b0](https://github.com/Muratovnik/valkama/commit/867b2b0e63d1f38ea7248c4dcaf5a3756057f0c0), [e9b0411](https://github.com/Muratovnik/valkama/commit/e9b041139a42860095b521adc6acfbfa921e0b21))
- **planning:** record a forced write that overrode a refusal as an `overridden` event ([ff5e3fb](https://github.com/Muratovnik/valkama/commit/ff5e3fb090a3fc63c0170f202a773016631e1a6a))
- **planning:** keep a `relates-to` link as one record whichever end writes it, and fold existing pairs after a verified recovery point ([0b332a9](https://github.com/Muratovnik/valkama/commit/0b332a91268ca4c96f914883e6afd30fb548629e))
- **planning:** show one valid field to copy when a question's field shape is refused ([79e2bf0](https://github.com/Muratovnik/valkama/commit/79e2bf08d0370c61cf2f8dc075de61dba265d19e))
- **web:** keep the chrome empty at launch until it can show its final values, instead of the module id and «Global» ([a5d9fe3](https://github.com/Muratovnik/valkama/commit/a5d9fe3cc200274cbf574bf3a6d08582859c0129), [65597dd](https://github.com/Muratovnik/valkama/commit/65597dd12abceed16cbd7e110cf3ece357bb3a23))
- **web:** show the hint of what a scroll brings under a resting pointer ([b4e3bbb](https://github.com/Muratovnik/valkama/commit/b4e3bbb171712b88626c13fc5af3ba8b42e3b21d))
- **web:** keep the space between a cut name and its share in a hint's text ([3bcdfd4](https://github.com/Muratovnik/valkama/commit/3bcdfd458840d9036a1d93330ffc5f5449700d9c))
- **web:** start no selection from a press on a reference card's ground, so a drag from its edge no longer holds the card up ([5128bd9](https://github.com/Muratovnik/valkama/commit/5128bd983c25cb36cf6c6c47d694d3c8e3424fd3))
- **graph:** draw a discovery from the work it was found in to the work that grew out of it, so a chain's root stands before what was found from it and the arrow lands on the new work ([1fb8717](https://github.com/Muratovnik/valkama/commit/1fb8717c800b139189d5f3bdbb2f211498316003))
- **web:** give every heading its level's size, and nest the headings of Analytics and Settings ([82ab1f4](https://github.com/Muratovnik/valkama/commit/82ab1f42b5a0b918d8f5523a8437cf95a2f58459), [35e639a](https://github.com/Muratovnik/valkama/commit/35e639a44213d55c5ac13fa7e3ecd4c5fc175e30), [3f07613](https://github.com/Muratovnik/valkama/commit/3f076132a7b709435a88490ae33d892b394de910))
- **quota:** decide which account a seat is from every sample of it, so the readings of a session that changed its login go to the account that made them ([98e2938](https://github.com/Muratovnik/valkama/commit/98e29383121d18e815dd6e462613253f4086e505))
- **analytics:** count the agent-time axis in one round unit ([4b11dca](https://github.com/Muratovnik/valkama/commit/4b11dcaf3a49a2e90ed2c4a3580d055f3ae38f90))
- **settings:** accept a doctor report with fractional values in the installation checks ([19be15e](https://github.com/Muratovnik/valkama/commit/19be15e7aa802dbc848e2a0c4348e49c42062f52))
- **doctor:** name the client hooks guide in the advice about the quota mod ([13c1522](https://github.com/Muratovnik/valkama/commit/13c15228e73216d20f9ac3de047e670a6288e785))
- **store:** wait up to a minute for a long first open of the store, so open sessions still move to the new release ([9fe737a](https://github.com/Muratovnik/valkama/commit/9fe737abe9ebecc2668431b074ae9f31870c4f0f))

### Performance Improvements

- **server:** answer the reads a page sends at once without queueing on the store's bring-up, opening Analytics in about half the time ([9f57b78](https://github.com/Muratovnik/valkama/commit/9f57b7814f714bb87ba2d7393e821601f96c2d41), [5c4f51f](https://github.com/Muratovnik/valkama/commit/5c4f51f1d9391c8df92a6c8d4368a637ea94c75a))
- **planning:** open a space's stream after its read with `since=<revision>`, so it does not send the space just read ([26ecd5a](https://github.com/Muratovnik/valkama/commit/26ecd5a1b5d78e12bf60ac20f8ab3553dec9341e))
- **web:** download the card and the questions list on demand, about an eighth less for the first screen ([3862b4c](https://github.com/Muratovnik/valkama/commit/3862b4c94cbbed289542957f7ab015f48a7f25fa))
- **web:** draw only the window of a work list from 300 rows ([396d0e0](https://github.com/Muratovnik/valkama/commit/396d0e0ba3313cfeae3fcc443e32abe3beaab500))

## [2.8.0](https://github.com/Muratovnik/valkama/compare/v2.7.0...v2.8.0) (2026-11-11)

### Highlights

- A new Analytics module says what agent work spent in a period — agent time, tokens and
  a cost estimated at API prices — by account, project, task, executor, role, launch
  class, model, effort and environment, with a CSV download.
- Usage is counted more exactly: a request counts once in the whole store, each stretch
  records the organization, client, effort and adviser it ran under, and stale runs are
  read again in the background.
- «Work» in the rail follows running work, items and sessions alike, with one session
  sign everywhere; a session works while its turn runs.
- Screenshots can be pasted into a card's text, and `@` mentions offer the project's
  Markdown files.
- Upgrading: the store moves through schemas 14, 15 and 16 behind the verified snapshots
  `preschema14`, `preschema15` and `preschema16`, and a 2.7 build refuses it afterwards;
  going back means restoring the snapshot. The first passes after the upgrade read the
  whole usage history again.

### Breaking Changes

- **planning:** the live-work frame and the `live_work` map have new shapes: a waiting state carries `long` and `asks`, a row carries `since`, `long`, `asks`, `updated_at` and `executor`, each space lists its `sessions`, `elsewhere` is a list of sessions and `unplaced` is gone; a client that validates the frame strictly needs the build that ships with this server ([53cdae1](https://github.com/Muratovnik/valkama/commit/53cdae172eb06e16f3fc79f3c4fc202509f4bee0))

### Features

- **analytics:** add the Analytics module, under «Understand» in the navigation and named by `GET /api/modules` and `list_platform_modules` ([1bdda44](https://github.com/Muratovnik/valkama/commit/1bdda44a3c6f611a1e99088e82404a3a5606cbd6))
- **analytics:** show agent time, tokens and the API-price cost estimate of a period against the period before, ranked by a dimension and day by day, with filters on every dimension kept in the address ([e119ad9](https://github.com/Muratovnik/valkama/commit/e119ad96f99e9b122108500630aa1ae242044ffa), [461c029](https://github.com/Muratovnik/valkama/commit/461c0293a2e37700aa92518d32846aefb846ee05), [c731160](https://github.com/Muratovnik/valkama/commit/c731160107539b0fc28de7278657df8014930a57), [f33fc1a](https://github.com/Muratovnik/valkama/commit/f33fc1a5fdf285e1b8c7e9ca241785daadaa08ff))
- **analytics:** table every value of the breakdown beside the period before and download it as CSV, writing a cell a spreadsheet would run as a formula so that it is shown instead ([64001a6](https://github.com/Muratovnik/valkama/commit/64001a6f0018f718e14e9ea63e022c2f9dd517b9), [f504d75](https://github.com/Muratovnik/valkama/commit/f504d75dc1666ead49e255e818b0e1933372cb79))
- **analytics:** open a task in two presses from any bar, row or day, with Back returning the view before ([b4f39c2](https://github.com/Muratovnik/valkama/commit/b4f39c26510b6a09ad9f2eae2a0f04fad3972966))
- **analytics:** count each opening of an analytics surface by day and kind on this machine, through `POST` and `GET /api/analytics/uses` ([5b2588e](https://github.com/Muratovnik/valkama/commit/5b2588e8488ab4bd30a719e5f6f25598a1a65edc), [7ea0017](https://github.com/Muratovnik/valkama/commit/7ea0017a2eed450fbab2dea2dc1987b2d135ced9), [57500b6](https://github.com/Muratovnik/valkama/commit/57500b6d0891446a541e7e44456e5d0bb85bb08e))
- **api:** read what agent work spent between two moments with `GET /api/analytics/usage`, by up to two dimensions, with the period before beside it ([5aef433](https://github.com/Muratovnik/valkama/commit/5aef4330f7e0e106fd03de5588ff3eba49d657e6), [45548ee](https://github.com/Muratovnik/valkama/commit/45548eec1e1192e26e185816a09d2f9484727fac), [b6cba56](https://github.com/Muratovnik/valkama/commit/b6cba562f29d93da2d9fdd777df50f2eebc66bbb))
- **planning:** say in a card's Agents tab which organization the work ran under and in what role, with a link to Analytics ([107bb08](https://github.com/Muratovnik/valkama/commit/107bb08d77fb0f72eca3f6cd3a8594fba3ee9909), [4c30be9](https://github.com/Muratovnik/valkama/commit/4c30be9c4948ba933597f9c59507e47a2ba21b6a), [41bfe74](https://github.com/Muratovnik/valkama/commit/41bfe7430429a50c15fdab15785a027ea6cb8582), [183999c](https://github.com/Muratovnik/valkama/commit/183999ce4bead3fe48cdb98435994fe74933b859))
- **telemetry:** price Claude Fable 5.2 and Claude Mythos 5.2, and carry `unpriced_tokens` beside every cost; `valkama doctor` names each model that spent tokens with no price ([d993691](https://github.com/Muratovnik/valkama/commit/d9936916b90ab25b171fc7664521e7944bd480d9), [3fb925c](https://github.com/Muratovnik/valkama/commit/3fb925c7bd8fd14a082262dc23683c4948bbfb51), [a195299](https://github.com/Muratovnik/valkama/commit/a1952997794828b25a67fcd6aaed3b337868b33d), [8b24e58](https://github.com/Muratovnik/valkama/commit/8b24e58f67213e6c646e48f125f7459607b783d5))
- **telemetry:** record the organization, client, effort and adviser of each usage segment, and a subagent's launch class, keeping only ids and short labels ([8bbe2d2](https://github.com/Muratovnik/valkama/commit/8bbe2d2ab4afbd46ba695e1a3d1f1f47306f87ff), [e23649b](https://github.com/Muratovnik/valkama/commit/e23649b69b0ccaac6489471ead8881433a99cd0d), [29d3d85](https://github.com/Muratovnik/valkama/commit/29d3d85950023796138f994494fbedf28d3c1ead))
- **telemetry:** read stale usage runs again in the background, behind a verified snapshot, and report the reading in `valkama doctor` ([98181f9](https://github.com/Muratovnik/valkama/commit/98181f9d81116b25886681f28e91a2a8afd87b0e), [c910fcc](https://github.com/Muratovnik/valkama/commit/c910fcc02e4c24ee7110e37ff2c3737a613df2eb))
- **cli:** add `valkama usage rebuild`, which reads runs again from their transcripts; `--all` first takes a verified `usagerebuild` snapshot and `--dry-run` rebuilds nothing ([20ab47f](https://github.com/Muratovnik/valkama/commit/20ab47f62ced21ef89013d53d904735b7bb63b30), [51ca2ef](https://github.com/Muratovnik/valkama/commit/51ca2efa5273bd48065661e9fe4233a56004b641))
- **store:** count a usage request once in the whole store, at schema 16 ([23934dc](https://github.com/Muratovnik/valkama/commit/23934dcc244862b11aedc2214584e879801b9afc))
- **planning:** add or remove a label with `labels_add` and `labels_remove` without sending the rest ([dd667fc](https://github.com/Muratovnik/valkama/commit/dd667fc711c4c5262f90033f01b142163e617f0c))
- **planning:** record a change of an item's labels in its history as a `labels_changed` event, at store schema 15 ([c15e3ea](https://github.com/Muratovnik/valkama/commit/c15e3eac28586c8c487c7927ef3dfa4289032021), [ea6778d](https://github.com/Muratovnik/valkama/commit/ea6778d614dd061c579f07dfe031408642b1d5bf), [046fa04](https://github.com/Muratovnik/valkama/commit/046fa04290e51a0a57b9ca6dee7f024d7e4be66d))
- **planning:** paste or drop a picture of up to 10 MB into a card's text, kept beside the store at schema 14, listed in `images` and read by the new tool `read_work_item_image` ([81e5244](https://github.com/Muratovnik/valkama/commit/81e52445d3c7920111d13f74347198be54da931e), [826af2c](https://github.com/Muratovnik/valkama/commit/826af2c95bcba8eb27519c74412b31d83e59858f))
- **planning:** list the open work items an agent session holds with `GET /api/planning/held?session=<id>` ([dfb16aa](https://github.com/Muratovnik/valkama/commit/dfb16aa3055cdfa0959369eeed12131f90420d9f))
- **planning:** mention with `@` instead of `#`, offer the project's Markdown files there, and tell the tasks a comment, reply, description or outcome mentions ([d52c80a](https://github.com/Muratovnik/valkama/commit/d52c80a850606bf49de24a4f27208bb89d13a217), [f76850d](https://github.com/Muratovnik/valkama/commit/f76850dbbca539ff96e58d000a70fa3de3174586), [fbfa409](https://github.com/Muratovnik/valkama/commit/fbfa409ad455660abee72cc7d0ae219d0e8daaae), [20f40f1](https://github.com/Muratovnik/valkama/commit/20f40f1d14958d9900f97a07bf72a05f39eed66d), [c3d476d](https://github.com/Muratovnik/valkama/commit/c3d476debe908046181e4b25e2f8ee4e54261b71))
- **planning:** show where an item was mentioned in its discussion and its history ([aecf5a0](https://github.com/Muratovnik/valkama/commit/aecf5a0d17b4e105b7ae40b2c166aec2b26076fb), [ff3a20c](https://github.com/Muratovnik/valkama/commit/ff3a20ce3552c5ac34d6909a405130d9b90ca74d))
- **planning:** read a session at work while its turn runs, moving only the item it named last, instead of from its first write ([53cdae1](https://github.com/Muratovnik/valkama/commit/53cdae172eb06e16f3fc79f3c4fc202509f4bee0))
- **web:** let «Work» in the rail follow running work, items and sessions alike, on two lines, with quiet work folded and «Open session» on each row ([a62fd5e](https://github.com/Muratovnik/valkama/commit/a62fd5ebce510686359ab9914e2f320f9d60e84a), [758560b](https://github.com/Muratovnik/valkama/commit/758560b973406b563c7e81dfd6d82669b92bdf88), [0ff4c00](https://github.com/Muratovnik/valkama/commit/0ff4c006536a8ee9c84f73a2371e08ebbb73b824))
- **web:** draw one sign for what a session does on the rail, the tiles and the graph ([2c536f5](https://github.com/Muratovnik/valkama/commit/2c536f5e4a14b50893effa87ebecb23970d5405c), [1e068b7](https://github.com/Muratovnik/valkama/commit/1e068b79c49a526cc51d4cf4db3afeaa7e588965), [cd724e4](https://github.com/Muratovnik/valkama/commit/cd724e44cdfd4e7d8162fa628799e7cc03768968))
- **web:** name a tile's executor by its client's sign and its session's state ([22f84b6](https://github.com/Muratovnik/valkama/commit/22f84b67f9bfffd5201609d9399eb50a510ed648))
- **web:** show workflow state names in the interface's language, with «As in the workflow» in Settings ([7caec4b](https://github.com/Muratovnik/valkama/commit/7caec4b433b4ab5573720ac66eb0279a077f4ae1))
- **web:** keep named views in Work's header and move «Workable» and «Assigned» into the filter, «Assigned» as «Has an assignee» ([c00ef8c](https://github.com/Muratovnik/valkama/commit/c00ef8c264f0fa3f13996f500a1f1dde547bb03c))
- **web:** read a review as a list of decisions, with one «Comment» in place of «Your own option» ([35c3421](https://github.com/Muratovnik/valkama/commit/35c342138fc17385951225783af1a96718756fd8), [2db5249](https://github.com/Muratovnik/valkama/commit/2db5249f79d8a7d9b2298514e58d3ecae3bf2d9c), [eb57605](https://github.com/Muratovnik/valkama/commit/eb57605a83f769c6905830949ecf34b74ca3c7c3))
- **web:** say «Question N of M» in «Needs my answer», step between questions and gather answered blocks at the end ([630bd7a](https://github.com/Muratovnik/valkama/commit/630bd7a25f408d3c31cd3328c76d63e45ccb764b), [42d83b3](https://github.com/Muratovnik/valkama/commit/42d83b32f3e622d07117eea81ed150fcadef5f97), [bb1b2e9](https://github.com/Muratovnik/valkama/commit/bb1b2e9ed005d8c3e91a30b41a85edd3539bdbb2))
- **web:** change a card's labels in the new-task dialog's picker, and ask in the card's order in that dialog ([92c71bf](https://github.com/Muratovnik/valkama/commit/92c71bf52c4ed76da422bb8274eae933c8ba4f04), [ed92295](https://github.com/Muratovnik/valkama/commit/ed922956c3c2aea955f15eb727bf1728c72d0b64))
- **web:** draw each menu value as its button draws the chosen one ([888734c](https://github.com/Muratovnik/valkama/commit/888734c448f02489a0c176ea85abda17c8b2aaab))
- **web:** move a card's chain to Relations, the pin into a «…» menu, and show «Answer» and the epic as links in its facts ([6ccca12](https://github.com/Muratovnik/valkama/commit/6ccca1243cad6ad7f856ee0b8dd7c31993d3c398), [1d0ba47](https://github.com/Muratovnik/valkama/commit/1d0ba4735d2cac0f8c0d16d285eb1d3771433c0b), [f0f8081](https://github.com/Muratovnik/valkama/commit/f0f80817a9bf943152a46f5e503cbb902f5043db), [e68ce26](https://github.com/Muratovnik/valkama/commit/e68ce2610ad4d1ad2b2e772068cf8177b747663d))
- **web:** name the parent «Parent» on the card, the board, the branch map and the graph ([08a7571](https://github.com/Muratovnik/valkama/commit/08a7571978ba6c5820096db1021838f4476608d9), [b0e280c](https://github.com/Muratovnik/valkama/commit/b0e280c009ab70d7c76609817ed85e9de0016d01))
- **web:** stand Settings at the foot of the rail ([a3d4bf2](https://github.com/Muratovnik/valkama/commit/a3d4bf294584bf32c6327a3c5e619e9843d82739))
- **web:** state each hint's kind, so a hint never says what is already on screen ([aa9f2af](https://github.com/Muratovnik/valkama/commit/aa9f2af40cf3616e51d9cd3833c9f4264bfe9d4e))

### Bug Fixes

- **telemetry:** keep an advisor's usage apart from the executor's of the same model, which turned input and output negative ([37519a2](https://github.com/Muratovnik/valkama/commit/37519a2417f9d5e3a79442c464f664995bccee1e))
- **telemetry:** stop counting a subagent transcript copied into a forked session twice ([4f7bd81](https://github.com/Muratovnik/valkama/commit/4f7bd811dd3f207c98623c6cede45e9d49131539))
- **telemetry:** keep a subagent's time out of its parent's run after its transcript is deleted ([1506a64](https://github.com/Muratovnik/valkama/commit/1506a64533a2fabf6f7b68cfa406f5f190f986f8))
- **telemetry:** place a turn with no item on the same item however the reader's passes fell ([5bbe261](https://github.com/Muratovnik/valkama/commit/5bbe2619ac80cb8c0dae4e3a605a4f42c2b66dc1))
- **web:** keep icons at their size and end one-line labels in an ellipsis, whole on hover while cut ([d49533f](https://github.com/Muratovnik/valkama/commit/d49533f782b48412350837ee3297d0ebd006db10), [4408368](https://github.com/Muratovnik/valkama/commit/440836873ccc03d50f9240de41f161971f263274), [65975ed](https://github.com/Muratovnik/valkama/commit/65975edcd0ed31449f2b5aa789e364823197af1c))
- **web:** keep controls of one row at one height ([4b54472](https://github.com/Muratovnik/valkama/commit/4b54472b57d89ceb8036723fb593906cae0ed1b4))
- **web:** stand every sign on the middle of its line's capitals ([260a4ef](https://github.com/Muratovnik/valkama/commit/260a4efe5c83e5e7ac18def477d99edc44eba9b1))
- **web:** show the next hint when the pointer moves straight onto it ([495fc66](https://github.com/Muratovnik/valkama/commit/495fc6680149b34792e67d1134eab27747f99185))
- **web:** keep all of a focus ring's room when it is scrolled into view ([6f89ebc](https://github.com/Muratovnik/valkama/commit/6f89ebce7faa63aaccc1964411c9352264faed77))
- **web:** open a card's History, Executions and Settings without a standing explanation over them ([60c6852](https://github.com/Muratovnik/valkama/commit/60c685222915580702f88837af793ad1086bf5eb), [bec6442](https://github.com/Muratovnik/valkama/commit/bec644205295d06254adf6f927a8b72758a6a46f), [a168deb](https://github.com/Muratovnik/valkama/commit/a168deb0116b0b1357c1a3c02eadfbf00495019d))

## [2.7.0](https://github.com/Muratovnik/valkama/compare/v2.6.0...v2.7.0) (2026-11-08)

### Highlights

- Every hint in the interface is one card, shown on hover and on keyboard focus, in place
  of the browser's tooltip.
- The rail is as wide as you drag it, and the Work filter steps from a facet into its
  values, with «is not» on a chip.
- A recommendation carries its reason, and a summary its process friction.
- Rolling back: a 2.6.0 server refuses to read an item whose summary carries `friction`
  («work_item.summary has unknown field(s): friction»), while lists and search still work.
  Remove the field from such summaries before pinning 2.6.0.

### Features

- **web:** drag the rail's edge between 200 and 480 px, or step it with the arrow keys, Home and End; the width is kept on the device, and the refresh button shows only when the connection is lost ([d17bcce](https://github.com/Muratovnik/valkama/commit/d17bcceb5d35f4b24a401f7bc3147086c068ca75))
- **web:** show every hint as one card on hover and keyboard focus, closed by Escape, in place of the browser's tooltip ([56c84c7](https://github.com/Muratovnik/valkama/commit/56c84c71c1d3128e90877c6776769f3f407f4077))
- **planning:** take `why` beside `recommended`, shown on the «recommended» mark, and `friction` in a summary, up to 4000 characters, shown last in the card ([aed4b4e](https://github.com/Muratovnik/valkama/commit/aed4b4e01f2f158b111e67a34d49a196fe519b10), [1c67ef9](https://github.com/Muratovnik/valkama/commit/1c67ef9b18680f62f831fed13efc0af35110ae4c))
- **web:** open the Work filter on presets and facets that step into their values, keep a value out with «≠», and offer «Search for "…" in all projects»; «Find a task» is now «Go to a task» ([0e7231a](https://github.com/Muratovnik/valkama/commit/0e7231aa5daf27401236d85bb38ffed15dde5b1b), [29a584c](https://github.com/Muratovnik/valkama/commit/29a584c218047052f9aa382c8b2b19480eb2e4d3))
- **web:** keep each block's head in view in the questions dialog, with a rail of bars to any question ([446b2ad](https://github.com/Muratovnik/valkama/commit/446b2ad471830a4b33caf040e11d3dddcee01e74))
- **web:** stand the card's facts on named rows, changing the priority and labels where they stand ([457431e](https://github.com/Muratovnik/valkama/commit/457431ef5a82f8891b4666ed88269b1181fc17cc))
- **web:** draw every empty state as one component, and say why a memory source is unavailable with a link to Settings → Diagnostics ([b3247ef](https://github.com/Muratovnik/valkama/commit/b3247ef36ef3b39d35c8f815878a19f9a70cf3b1), [dc9ec5b](https://github.com/Muratovnik/valkama/commit/dc9ec5b436e07cc0cfa92f87bea1e0e4b1108460))
- **web:** draw obvious actions as icons with their words in the hint ([88fdac4](https://github.com/Muratovnik/valkama/commit/88fdac42a46ed17a62922aa2cca7ce122be5889e))
- **web:** draw VS Code's, Codex's and Cursor's own icons wherever a place to open in is drawn ([926c772](https://github.com/Muratovnik/valkama/commit/926c772f9f2fb72c6e77f749b88a151192feae51), [01f25e3](https://github.com/Muratovnik/valkama/commit/01f25e36284aa3cefbbaf94dcacaf134e36b02d0))

### Bug Fixes

- **graph:** stop dimming everything else under a hovered node ([490254b](https://github.com/Muratovnik/valkama/commit/490254b1dd16aaaf3bf74094d8d59c11cacd860e))
- **web:** read a work item's marks in one order everywhere, its kind, its number, then the rest, with a tile's holder as a glyph ([341f1f2](https://github.com/Muratovnik/valkama/commit/341f1f2aa6913eec5e4cccbbe246ca72099c3c5d), [ddb1f21](https://github.com/Muratovnik/valkama/commit/ddb1f2167f0154c7163d4fe0e3911210f697ca1d))
- **web:** say what each comment button of the questions dialog comments on, and link the task's number in a block's head ([3ebfc84](https://github.com/Muratovnik/valkama/commit/3ebfc84d7b601725538622a37787cd7542a63181))
- **web:** show where and how a step's session runs as glyphs beside its name ([eb727d5](https://github.com/Muratovnik/valkama/commit/eb727d555fe6c03757b4e82b5456fa8a3d8aa065))
- **web:** keep a field's hint from flickering as the pointer crosses from its label ([c2c5959](https://github.com/Muratovnik/valkama/commit/c2c59597bb04f35802d0a9fa7b2c12eab079289b))
- **web:** drop the explanatory lines under Settings' section switch, and count a discussion's threads once ([5788e1e](https://github.com/Muratovnik/valkama/commit/5788e1e8f2abbc3aea5cd0ac5cfb4d16b350d998), [8218dba](https://github.com/Muratovnik/valkama/commit/8218dba64528c0f678e3e877658573111d24d4cb))

## [2.6.0](https://github.com/Muratovnik/valkama/compare/v2.5.0...v2.6.0) (2026-11-08)

### Highlights

- Valkama reads the clients' transcripts and says how much work an item, a chain or a
  session took, with its cost estimated at API prices.
- Agent sessions hear each other: mentions, another session's writes on held or
  followed work, comments that wait for a reply, and wakes bounded per hour.
- A question can be a review of many points answered row by row, and an agent can put a
  list under its comment for the owner to tick.
- The rail lists the work going on now under «Work», across every space, and a person can
  pin an item.
- Upgrading: the store moves through schemas 11, 12 and 13, each under a snapshot taken
  before it, and a build of the previous release refuses the upgraded store. The hook's
  `.marks` files are now headed `v4`; an earlier build reads them as empty and tells the
  current news once more.

### Breaking Changes

- **alerts:** the address of a question's notification changed: install the new desktop app before the new server, because an older app refuses the new address and the click does nothing ([839b01b](https://github.com/Muratovnik/valkama/commit/839b01b6ae0394635f540d50f694766508b0bf7e))

### Features

- **telemetry:** read the clients' transcripts into usage rows in the background, telling work from waiting for a person, a subagent, a failed service or a machine that was off; schema 11 holds the rows and no message or command text is kept ([3c50855](https://github.com/Muratovnik/valkama/commit/3c50855afb78b0956abc82d7240e6a8caf4b1358), [9382c9a](https://github.com/Muratovnik/valkama/commit/9382c9a2be9d09e4619cc55c7abfbfbb190ceb3c), [ca2f3f6](https://github.com/Muratovnik/valkama/commit/ca2f3f63f22a60fafadbe2fdf0ee39914d246230))
- **telemetry:** estimate a request's cost at published API prices, and count a background command as work for three hours at most ([1b39050](https://github.com/Muratovnik/valkama/commit/1b39050feb62ccaf40ee329f226d5d8d6d42bd69), [a2c9866](https://github.com/Muratovnik/valkama/commit/a2c986653368d799529455bf2c7ede3b64438761))
- **api:** read what work took with `GET /api/planning/work-item/usage`, for an item or its whole chain, and `GET /api/planning/session/usage` ([040d477](https://github.com/Muratovnik/valkama/commit/040d4779a39658a8e8329f7df125574d0fe399ab))
- **web:** say on a card how much work its item took, and break it down by kind, model, agent and session on the card's «Agents» tab ([3e0afe6](https://github.com/Muratovnik/valkama/commit/3e0afe68d2f850dbe3723202d01b5b72ecb44ad2), [963b2fc](https://github.com/Muratovnik/valkama/commit/963b2fce31356e9b3d8656f3be90ea839085b625), [fa258b4](https://github.com/Muratovnik/valkama/commit/fa258b42c0a3000d018265bb94fc1de3ac0c2c24), [90c3211](https://github.com/Muratovnik/valkama/commit/90c32115c895daeffe89355a15017c0c97465981))
- **planning:** edit an item, write up to 100 comments and ask up to 100 questions in one `apply_work_item_changes` call, through the groups `update`, `comments` and `questions` ([002ac68](https://github.com/Muratovnik/valkama/commit/002ac681a2d5bf7a0232e2d9edb446956f043c9d))
- **planning:** ask a review as `verdict` fields the owner accepts, puts off or rejects, with groups, descriptions and fields shown `under` an answer; a question holds up to 40 fields ([d57c3b2](https://github.com/Muratovnik/valkama/commit/d57c3b281fd0c306a807e04ec843f7f71b540133))
- **planning:** tell a changed answer as what it changed, row by row, and keep every field a compact question can past 2000 characters ([1c21509](https://github.com/Muratovnik/valkama/commit/1c215099fb22be929a96e3c83a4f9ebc8eb4d363))
- **web:** answer a review row by row in its thread, with «Accept recommended», and read an answered review as one line of counts ([9db93ce](https://github.com/Muratovnik/valkama/commit/9db93ce6bf5081260d7f433c925e4a0514c234c3), [c11b688](https://github.com/Muratovnik/valkama/commit/c11b6882b70128b84d9f8c74f85f3004ed011adb), [e4fe069](https://github.com/Muratovnik/valkama/commit/e4fe069b3452d7cc684dfab2065bdb442d137ca5))
- **planning:** let an agent put a list the owner ticks under its own comment, ticked right under the comment and sent with «Send marks» ([67eb826](https://github.com/Muratovnik/valkama/commit/67eb826137f2d59279a1f6ee8c66840da35e746a), [cab841b](https://github.com/Muratovnik/valkama/commit/cab841bc2743f157517f36cf2337e930d5906ac3))
- **web:** make the points of a list in the discussion steps of the task in one action ([e97e4ba](https://github.com/Muratovnik/valkama/commit/e97e4ba76c5cc558542ec9f22367a97951bc90b6))
- **planning:** take `mentions` on a comment, telling the holders of the items it names, with limits per session and hour ([2520fd8](https://github.com/Muratovnik/valkama/commit/2520fd82417aee6136591480aba9180f9b0615e2), [1a54122](https://github.com/Muratovnik/valkama/commit/1a54122801492f31f138d48f4d422ebff200afec))
- **hooks:** tell a session what other agent sessions write on work it holds, and let it follow an item it does not hold with `subscribe`, at store schema 13 ([907c443](https://github.com/Muratovnik/valkama/commit/907c443391fe97785456852d5fed6edc61748f3f), [2b925b2](https://github.com/Muratovnik/valkama/commit/2b925b2373ad19ee773b15c0c9dab990141e4a31), [4532ef6](https://github.com/Muratovnik/valkama/commit/4532ef67b4636606811e7ee1b1f7409b0b2e4333))
- **planning:** let a comment ask with `awaits_reply: true`, and wake the holders and the asker once for it and its first reply ([7af06f1](https://github.com/Muratovnik/valkama/commit/7af06f1c3a0b4e69d7a2194fb01fce4e5aa6667a), [e7e78c3](https://github.com/Muratovnik/valkama/commit/e7e78c30036b778d63ec04cabbc6d4806637f4da), [8a4be52](https://github.com/Muratovnik/valkama/commit/8a4be5209a49721e29fda7a52da47c95a805f843))
- **hooks:** wake a holder once when another session or a person closes a blocker of its item ([d792b87](https://github.com/Muratovnik/valkama/commit/d792b8723c7670bfda7bf09c812f22162211a6a3))
- **hooks:** let other agents wake a session at most six times an hour, and fold an item's news into one line after three notices an hour ([247a23e](https://github.com/Muratovnik/valkama/commit/247a23ee84188d573126dfe50745364f48e94435), [205250b](https://github.com/Muratovnik/valkama/commit/205250bb8a324defcb10f4d54d30a79d3d07926c))
- **web:** name the sessions that follow an item under the card's holder, and say on a comment that it still waits for a reply ([ea27520](https://github.com/Muratovnik/valkama/commit/ea2752093f3d2e288fc142d8aef2aa2af48268b3), [0e8ec85](https://github.com/Muratovnik/valkama/commit/0e8ec85a1fe64982cf03b32d4108ac2414046a21))
- **planning:** carry one live-work frame across every space as `event: live` in the stream a page already has, or alone with `view=live` ([1508562](https://github.com/Muratovnik/valkama/commit/150856268ee953d24e961ef906ec2f49f5a0d117), [e6069e7](https://github.com/Muratovnik/valkama/commit/e6069e777dd64e1483c3920c93240f11a998d2ff))
- **web:** list the work going on now under «Work» on the rail, and pin an item from its card to keep it there ([5695210](https://github.com/Muratovnik/valkama/commit/5695210e9b11ccd8a4c5020c90cf001b79eb4893), [6165709](https://github.com/Muratovnik/valkama/commit/6165709b2c292e84e40596584c1d6950009d4df3), [98ee02d](https://github.com/Muratovnik/valkama/commit/98ee02d958643f38fde8f2e1735587fb27789fc4))
- **web:** colour task types, and change a type's colour in Settings → General → Task type colors ([a3bea6c](https://github.com/Muratovnik/valkama/commit/a3bea6c92526aee514795a70203d5373745fbb7c))
- **planning:** say what each priority level means, on hover and in the tool schema and the skill ([fa5c9b0](https://github.com/Muratovnik/valkama/commit/fa5c9b07fc3aeca4d8c12f7544161a46877407bf))
- **web:** open the filter's menu in its field or with `/`, and combine labels with «all» or «any» ([3c75457](https://github.com/Muratovnik/valkama/commit/3c7545761f95d10ffdadb811ecf7b3d69fb2aee0), [b035623](https://github.com/Muratovnik/valkama/commit/b035623410e612c9785c8825af4229ba030c2dc5))
- **web:** choose a new task's epic and labels by searching what the space has ([4dd4b7a](https://github.com/Muratovnik/valkama/commit/4dd4b7a65aedf07e8fcbdaec52d1a6a4804a781a))
- **web:** act on a discussion's entries through icons on their first line, with one Reply for every thread ([e117139](https://github.com/Muratovnik/valkama/commit/e11713992ccd87f41bd4a3a910aa0a928fddd8c8))
- **web:** set a card's head out as three rows, with its one action as bare text, and say «Next step · 3 of 9» ([2fba764](https://github.com/Muratovnik/valkama/commit/2fba764e712a62f0519f1d6a8db0928a70754ddf), [1c28349](https://github.com/Muratovnik/valkama/commit/1c283499d383b5d3b5245fb4911face944019688), [fb0fd01](https://github.com/Muratovnik/valkama/commit/fb0fd011fff491db0a887c4f0311fab0dd1c39d9))
- **graph:** open an epic by pressing its frame's ground from afar, and stop zooming out where the whole graph fits ([e236013](https://github.com/Muratovnik/valkama/commit/e236013a9588e2aba30f1e058f4af86913abecf5), [44e4b4b](https://github.com/Muratovnik/valkama/commit/44e4b4b45ceaf5d4c56b7ea0d69b373e1bf0b2d2))
- **web:** let the card a number shows copy the number and a link, and be selected ([68a4629](https://github.com/Muratovnik/valkama/commit/68a46290b70cf47a2fe7403e1243e719c55c1f54))
- **skill:** ask agents to send Valkama calls in a response of their own in Claude Code's auto mode ([a9e949b](https://github.com/Muratovnik/valkama/commit/a9e949b1c81d18fbf9ef6f0ca0619e822680fca5))

### Bug Fixes

- **planning:** let an answer given in the interface reach the agent as a notice, `from_person` and the `person_spoke` refusal ([e68e3d8](https://github.com/Muratovnik/valkama/commit/e68e3d87666fe53b8eba9809092fbb8e22b99aea))
- **planning:** accept a checklist step of 513 to 1000 characters, which was refused as a control character ([4a039a3](https://github.com/Muratovnik/valkama/commit/4a039a32024a68b2c790bd292293fe927bdc2b50))
- **planning:** stop reading a compacted context as a client restart, so a running turn and its subagents stay at work ([d25d3e5](https://github.com/Muratovnik/valkama/commit/d25d3e5d875e7ba4b6208f0e480e4bb0d9bc2a45))
- **sessions:** keep what a session waits for across a compaction ([165ab6d](https://github.com/Muratovnik/valkama/commit/165ab6d4148c69f6242a0930969dc4057ff98f1f))
- **planning:** move an item a live subagent is seen working on for as long as it runs, or the one item its coordinator holds when it names none, and stop counting a subagent whose transcript went silent for two hours ([953f261](https://github.com/Muratovnik/valkama/commit/953f26173916d692486aee5ffcc039ca91a1260c), [17192d1](https://github.com/Muratovnik/valkama/commit/17192d1d487ccff73c653e156f3bb7234287da57), [65d46e4](https://github.com/Muratovnik/valkama/commit/65d46e4ffd4f8f3137bfd9adb44fd2211ad1ef11))
- **telemetry:** read Codex token counts where a rollout actually puts them ([100409f](https://github.com/Muratovnik/valkama/commit/100409f2d7d40e3785be67705a007aff8982a4ce))
- **sessions:** open a session in the folder it was started from, not the one its shell had reached ([b3c3e9e](https://github.com/Muratovnik/valkama/commit/b3c3e9e23817bd51d781dab0fbad7d60d124c2b0))
- **open:** open a session from VS Code or another editor with one press in the app ([04c1557](https://github.com/Muratovnik/valkama/commit/04c1557ca33e9a1c706fce3e128f4a4b226aeec8))
- **notice:** let a notice of what worked go after five seconds, and say what it is about ([ae5eab9](https://github.com/Muratovnik/valkama/commit/ae5eab902a330e0d36e411daa628df8437d66486))
- **board:** open a card on the first click after a drag ([51e2318](https://github.com/Muratovnik/valkama/commit/51e23182cbd5e1dd6597dba76ac9e77dbe497d7b), [07167c1](https://github.com/Muratovnik/valkama/commit/07167c14d54d11182bfebaabf0b4f39e11509956))
- **web:** keep the view and the board's grouping when the space changes, with the bar in place while the next space is read ([9c77203](https://github.com/Muratovnik/valkama/commit/9c77203a117a07a0dca89f607e26234d4a576074), [400b706](https://github.com/Muratovnik/valkama/commit/400b706b011c9bb5a849b6c0e2438a398ec24741))
- **web:** leave focus where you put it while an action waits on the server, and draw no focus ring where focus moves after a mouse or touch action ([d924870](https://github.com/Muratovnik/valkama/commit/d924870a198c4fbb388b4f59dfb7353556b5cc1c), [ae626df](https://github.com/Muratovnik/valkama/commit/ae626dfa1e73f97d9fb65331517588a4c5751490), [3df73ff](https://github.com/Muratovnik/valkama/commit/3df73ff6c8bee7907dac5a7c88b52288ce8a8167), [32c6794](https://github.com/Muratovnik/valkama/commit/32c6794cc18148b4912ca97a275886b7015aba78))
- **web:** stop «Loading» flashing: a read that answers within 300 ms shows nothing, and a mark stays at least 400 ms ([c726bd6](https://github.com/Muratovnik/valkama/commit/c726bd6fe2b32e7c22b115ab466377ee8e309a12))
- **web:** keep the screen from blinking as a document opens over a card or the questions ([9b49e5f](https://github.com/Muratovnik/valkama/commit/9b49e5f04709459a456ab0484375d195b0f41ff3))
- **web:** break a long title after a `/` instead of in the middle of a word ([c42b8c8](https://github.com/Muratovnik/valkama/commit/c42b8c8cb6b582fd229bab825c519e87aa146fe1))
- **web:** keep a time whole inside a sentence ([f793007](https://github.com/Muratovnik/valkama/commit/f793007d7aa82dbad489a866cfb5d2df50c8fc50))
- **web:** keep tiles, columns, chips and the connection dot visible in a Windows contrast theme, and give phone toolbar icons 44 px targets ([2123f68](https://github.com/Muratovnik/valkama/commit/2123f688cd187eb07528e3017f92b74b4fd471fd), [6cdb16a](https://github.com/Muratovnik/valkama/commit/6cdb16a2c2ac769a024ead518238d5e06abb9f21), [3f82134](https://github.com/Muratovnik/valkama/commit/3f82134dac2cf23872e770760e099c9f782bedd0), [6065d99](https://github.com/Muratovnik/valkama/commit/6065d996124b4b7f152e0f3988caf0b67f9451bf))
- **board:** draw a held epic row's card and chain as two icons that cover neither its title nor its counts ([7edd06f](https://github.com/Muratovnik/valkama/commit/7edd06f0f2e92a1bce752de0dd5981ee39f42555), [237ff28](https://github.com/Muratovnik/valkama/commit/237ff28f0820bff3fe2147022daadfec36fad128))
- **web:** line up dialogs' titles, the task finder's results, a card's lists, chain rows and disclosures on their edges ([2f3df86](https://github.com/Muratovnik/valkama/commit/2f3df86955dba69a2e51aa4d0631189d4beffc91), [a1ca14c](https://github.com/Muratovnik/valkama/commit/a1ca14c68361d3c51f7c4e6991143aa9b23f7c35), [7792939](https://github.com/Muratovnik/valkama/commit/77929396eea8128366558f658952f4e07c45dcd6), [7c05918](https://github.com/Muratovnik/valkama/commit/7c0591820d33b9f49bf839ab01a9afbf03862ae7), [6e50dc2](https://github.com/Muratovnik/valkama/commit/6e50dc2d71c6f4b0615994cdee8e335ca8b0dd58))
- **web:** fade a card's section row only where a section is cut, and let a press there choose the section the first time ([f378816](https://github.com/Muratovnik/valkama/commit/f3788161c71b607dfca19ea0cb4f333327bfe31a), [96101d5](https://github.com/Muratovnik/valkama/commit/96101d5095bc858519daa98439abcda39ea0794d))
- **web:** print the start of an agent's session in an entry's head and in system events, with the whole id in the hint ([fa47154](https://github.com/Muratovnik/valkama/commit/fa47154d89229da88425312fe034e66c8e5b1df7), [69463e1](https://github.com/Muratovnik/valkama/commit/69463e1d11f126b1b6c24ebb34cda9d7b6b9b954))
- **web:** keep the questions' buttons, comment presses and own-option field to their lines, and ring a question as a whole ([d57a563](https://github.com/Muratovnik/valkama/commit/d57a56350626513e2da416b6044ec205df016a47), [77b647f](https://github.com/Muratovnik/valkama/commit/77b647fa8adb43d96c11820c1dcd160447184e16), [eb4ee25](https://github.com/Muratovnik/valkama/commit/eb4ee250d4344d737b80c4606d8603798dd61f1f), [13e6e6d](https://github.com/Muratovnik/valkama/commit/13e6e6df37a2f59d4884a10b8bb5a20fb06116ee))
- **web:** show code in a question's option labels as code ([f750cc7](https://github.com/Muratovnik/valkama/commit/f750cc737b413d4efa7ebc50d840f5634067ca83))
- **web:** set Diagnostics, Settings' Readiness and the mark-resolved form on the page's grid, with the primary button last ([cbf912f](https://github.com/Muratovnik/valkama/commit/cbf912fd8a564da8c1a2d81418be396b25bf12ad), [0054a94](https://github.com/Muratovnik/valkama/commit/0054a94e85c7394eff8ec43bdfdf9cdb324fc5a0), [92aa73e](https://github.com/Muratovnik/valkama/commit/92aa73e40ec6ab50ed28cff2db44b3b1addc0fa1))
- **web:** keep entry heads, answered questions, option descriptions and the list of waiting questions from moving or wasting room, and give a phone's icons 44 px targets ([6bc964f](https://github.com/Muratovnik/valkama/commit/6bc964ffffa1a53158851326586ec030c297b5b0), [7f2c3cb](https://github.com/Muratovnik/valkama/commit/7f2c3cb0ff7d508434adb8aa96300ac239424a3f), [1ae1cab](https://github.com/Muratovnik/valkama/commit/1ae1cabc7e1bb37341a75abd63310b63e75031be), [1374ca9](https://github.com/Muratovnik/valkama/commit/1374ca908ccc029e636cff48a54b0f8322f75e1c), [460f5cc](https://github.com/Muratovnik/valkama/commit/460f5cc6a6a11824e42746caf9b3aff1337cf933), [43ae2eb](https://github.com/Muratovnik/valkama/commit/43ae2eb5bdcb1e1430573d3ae5f9d95893b497de), [01ed023](https://github.com/Muratovnik/valkama/commit/01ed023a20c9cb284f7bb5126f7cc3f6f76ff5b8), [9339e41](https://github.com/Muratovnik/valkama/commit/9339e4120bc0754296e8f4aad2121737e1f7ca8b))
- **web:** say an ambiguous agent link once for its group, and drop a chain's key and filter when there is nothing to tell apart ([6bf451e](https://github.com/Muratovnik/valkama/commit/6bf451e0ff6bf561f3cebfff2bb590b3275cfc80), [ff071bb](https://github.com/Muratovnik/valkama/commit/ff071bbe6331b4e902f3d8cc77dbb56a8da62d8a))
- **web:** keep a field's hint out of its label, so pointing at the hint lights nothing ([8a29806](https://github.com/Muratovnik/valkama/commit/8a29806a1ff787d7cc5597321533dec9acb3be2e))
- **web:** say «Answered by user» of an answer recorded before Valkama told who gave it ([c54c3ec](https://github.com/Muratovnik/valkama/commit/c54c3ecc22f3e9d3388ae8069076828ab264d989))
- **graph:** stop flashing the field as the pointer passes from card to card, and enter it by keyboard on a target wholly in sight ([e52ae40](https://github.com/Muratovnik/valkama/commit/e52ae406fdf9d6c88dc9065128d4aa7bf491f00d), [38c4603](https://github.com/Muratovnik/valkama/commit/38c460341e36ed225743b5a16d30e88322cba53f))
- **graph:** read cleanly zoomed out: epic headers of one height that say what a fold hides, «No tasks», «5 working», a card's number whole, and a moving mark of one length and speed ([e5671e7](https://github.com/Muratovnik/valkama/commit/e5671e7cf96c369c3aa506bb7ce4c17cf5e1961b), [cc1dcc2](https://github.com/Muratovnik/valkama/commit/cc1dcc21b8f69301cb6356b52262a16dc6a349d5), [4f3ff95](https://github.com/Muratovnik/valkama/commit/4f3ff95a163b497222674491ded02d44783f33e7), [f47a905](https://github.com/Muratovnik/valkama/commit/f47a9050a4badfc9565c944ffcd76d36bd42016e), [87201ce](https://github.com/Muratovnik/valkama/commit/87201cecb0683ec84c529a17e9fbb8e044ec7283), [97239a6](https://github.com/Muratovnik/valkama/commit/97239a6dbf6d84078a50681d3ed50d1d2c4d2651), [a46f7e3](https://github.com/Muratovnik/valkama/commit/a46f7e3986ad51865809d8ec092ee3f2215ba1f8))
- **graph:** give an epic's header the height of its title, up to three lines, and its chevron a 28 px target, 44 px under a finger ([f0844ee](https://github.com/Muratovnik/valkama/commit/f0844ee7d6c4c061bd2767399a9516c1aedc3b21), [bef4b9a](https://github.com/Muratovnik/valkama/commit/bef4b9acb68015702573070d45f3c1e20bae736e))
- **graph:** keep the zoom buttons in sight on a short window and a phone held on its side ([ea71064](https://github.com/Muratovnik/valkama/commit/ea71064e866306e3c9f736a862d8ad08ae90e61d), [73f72c9](https://github.com/Muratovnik/valkama/commit/73f72c90cf9694aa831ca02307fb38717baa253a))

## [2.5.0](https://github.com/Muratovnik/valkama/compare/v2.4.0...v2.5.0) (2026-11-05)

### Highlights

- Comments form threads that can be marked resolved, and an answer can carry an own
  option and comments, and be changed.
- A path or a work item's number in a text opens what it names: a Markdown file in
  Valkama's document viewer, beside a card or in a window of its own, another file in
  the editor, an item's card on hover.
- A session opens where it was last open, by a plan the server makes, and Windows
  notifications say when an agent needs you.
- The graph draws each epic as a frame round its work and shows the work an agent is
  doing now.
- Security: nine fixes harden how the desktop app starts terminals and programs, how
  documents are read from a project, and how pages may be framed.
- Upgrading: see Breaking Changes for store schema 10, its `preschema10` snapshot and
  the way back. The hook spool now writes a session start as version 2; an earlier build
  sets such a file aside as `*.rejected`, which `doctor` counts until it is deleted.

### Breaking Changes

- **store:** the first open by this build migrates the store to schema 10 after a verified snapshot labelled `preschema10`, and every existing row keeps its values; a schema-9 build then refuses the store with `StoreTooNewError`, so restart every agent client after pinning this release with `launcher install` ([4d46dde](https://github.com/Muratovnik/valkama/commit/4d46ddee732262626fdd4625a179490dd6444f04))

  To go back, stop every process that holds the store, delete the `-wal` and `-shm` files
  beside it, put the `preschema10` snapshot in its place, and only then pin the earlier
  release; everything written since the upgrade is lost. Pinned first, the earlier
  release reaches every running session within seconds and refuses the store still at 10.
  [Upgrading the store and going back](docs/guides/store-upgrades.md#migrating-an-older-store)
  has the details.

- **requests:** a note no longer stands in for a required field: `answer_work_item_request` and the interface refuse an answer that leaves a required field without a value or an own variant, naming the field; an earlier answer stays as written ([3b9bf97](https://github.com/Muratovnik/valkama/commit/3b9bf973e083f574e3c06ce9581f6c28eebcbabc))
- **planning:** `get_work_item` reads by default the roots of the 5 threads with the latest activity, each with `replies` and `last_reply`, where it gave the 5 newest comments; `comments_after` and `full` still read every comment flat ([d344d20](https://github.com/Muratovnik/valkama/commit/d344d203ca5f0644ba51e6fd572f077669408755))

### Features

- **planning:** thread comments one level deep with `reply_to` and `reply_to_request`, read one thread whole with `thread`, and move a comment with its thread on a merge ([d344d20](https://github.com/Muratovnik/valkama/commit/d344d203ca5f0644ba51e6fd572f077669408755), [0d53af4](https://github.com/Muratovnik/valkama/commit/0d53af4d7f49ddf1b65fd3fa9d84763e6bc7b149), [bb42a7e](https://github.com/Muratovnik/valkama/commit/bb42a7eb0742a74b1fb8b0158122e5810002b380))
- **planning:** mark a thread resolved with a one-line decision through `resolve_work_item_comment` or the `resolutions` group, and read the threads still open with `unresolved: true` ([c538d0a](https://github.com/Muratovnik/valkama/commit/c538d0af2bb013e4fbe6da58820691ca03390dc2))
- **requests:** take `own` and `field_notes` in an answer, and change an answer with `change: true` or «Change answer», keeping the replaced ones ([3b9bf97](https://github.com/Muratovnik/valkama/commit/3b9bf973e083f574e3c06ce9581f6c28eebcbabc), [13755b2](https://github.com/Muratovnik/valkama/commit/13755b25484f4c7dfa2f431a7ca65fa4675a68a0))
- **documents:** make a path in a text a link that opens a Markdown file in Valkama, another file in the editor Settings names and a folder there, inside a registered project only ([ea770e1](https://github.com/Muratovnik/valkama/commit/ea770e1b49fc7d1cd3b5f4b8f18276841bdf64dd), [56ead08](https://github.com/Muratovnik/valkama/commit/56ead086b070f60c1815af021be0ba984ab728f7), [4063e61](https://github.com/Muratovnik/valkama/commit/4063e6124d0c3c3f2691f5cd1fa651abe27748b6), [dc18ea2](https://github.com/Muratovnik/valkama/commit/dc18ea237e88e20b0e902ad0c75817a829ff26cc))
- **documents:** read a project's Markdown file in a read-only viewer at the anchor, heading or line a path names, up to 512 KiB ([67703fd](https://github.com/Muratovnik/valkama/commit/67703fd8b063b0b825ceb994f1110695f5387750))
- **documents:** stand a document beside the card or questions it was opened from where the window holds both ([9b6d508](https://github.com/Muratovnik/valkama/commit/9b6d5088282a35b0e5bb68874181b3c70a9d20db), [eaf5c27](https://github.com/Muratovnik/valkama/commit/eaf5c27c9e330f085888ff37d9b0b51b42509bc8))
- **documents:** give a document a window of its own at `/doc`, in a browser tab or a second window of the desktop app ([425694a](https://github.com/Muratovnik/valkama/commit/425694af887d1c4b58f9b09ae8161fb566116185), [6e0c027](https://github.com/Muratovnik/valkama/commit/6e0c02721362de98c1e328ed50a12f8fbec733b4), [751d8ab](https://github.com/Muratovnik/valkama/commit/751d8ab6032c256856e4235a5a3b6c2e67ce5f17))
- **documents:** open a document's file in the editor from its head, and an item's plan anchor in the viewer ([70ab517](https://github.com/Muratovnik/valkama/commit/70ab517f20900a179c9542c25d6f12c2b539229a), [75359c9](https://github.com/Muratovnik/valkama/commit/75359c99fc8762ef07153e9baffafa0d8ff31465))
- **web:** show a work item's card when the pointer rests on its number in a text, or Tab reaches it ([898504e](https://github.com/Muratovnik/valkama/commit/898504e976750d0e74247e50d015b43920b661bb), [a024912](https://github.com/Muratovnik/valkama/commit/a0249129a21ed2633485ac796ce981fdbc3b6575), [9471f23](https://github.com/Muratovnik/valkama/commit/9471f23b53b2222f47a4dfd76bee6ce553f0af3a))
- **sessions:** record where a session is open and open it there with one press: the Claude Code extension, Claude Desktop, the Codex app or a terminal that resumes it ([bc238a3](https://github.com/Muratovnik/valkama/commit/bc238a3009695028879ae2ec4bfbb7e8f4b20830), [f11570f](https://github.com/Muratovnik/valkama/commit/f11570f786baef66d365e575d1d8018b3a9ac132), [95c3aed](https://github.com/Muratovnik/valkama/commit/95c3aed3f56fda1686d3e1941b037c8e3e5a0f67), [bc1722b](https://github.com/Muratovnik/valkama/commit/bc1722bbb6c505c3babc5dbaad749fefd8ad48d9), [386a166](https://github.com/Muratovnik/valkama/commit/386a1661e6e858c8ba33e0191a2119057d49e520))
- **sessions:** offer to resume a terminal session silent for more than a day ([efdc561](https://github.com/Muratovnik/valkama/commit/efdc5614d7b53cb22ddbffae305560268c234e86))
- **web:** follow the server's open plan from Settings → Opening sessions and files; VS Code and Cursor now open a session in their extension, and Codex's stored terminal gives way to VS Code ([4664e08](https://github.com/Muratovnik/valkama/commit/4664e086b0266e3b8ebd0de8e2e81177994aa704), [89c4154](https://github.com/Muratovnik/valkama/commit/89c41547566ea793a68edca10064bee71411f96b), [fa0becb](https://github.com/Muratovnik/valkama/commit/fa0becbddd82d9cc9fd7efe6313b08575ea30793))
- **planning:** name each holder on a card with the session a click would open, where it was opened and whether it is live, as `executor` ([939c42f](https://github.com/Muratovnik/valkama/commit/939c42feecce5fe9413bc6b4dd081cb33333d9e5), [31ce58b](https://github.com/Muratovnik/valkama/commit/31ce58b5bf0dcd6a1d6870463b1ed9362ce66d93))
- **planning:** tell the agent working an item what a person did there in `from_person`, and refuse its close with `person_spoke` until an agent writes there ([48b8fe7](https://github.com/Muratovnik/valkama/commit/48b8fe7ea22ca67a042f23ab0e3514ccc9f6dfcd))
- **hooks:** bring that news through Claude Code's and Codex's hooks, wake an idle orchestrator with `claude watch`, and tell a thread's author and a question's asker too; `VALKAMA_NOTIFY=off` switches it off ([813481b](https://github.com/Muratovnik/valkama/commit/813481b18680ff0387266de7e8532d2c6ddf7427), [d01dd69](https://github.com/Muratovnik/valkama/commit/d01dd69c7a197f25aaba70be6fe7121cd4b51380))
- **hooks:** show work item numbers as links in Claude Code through its `MessageDisplay` hook ([6682604](https://github.com/Muratovnik/valkama/commit/668260411ddfdf530b2959e81cbd42800ceb31c4))
- **alerts:** show a Windows notification when an agent asks a question, moves work to review or a launch fails, with Valkama's window closed too ([1946475](https://github.com/Muratovnik/valkama/commit/1946475d1cc786923ef31ed76f0361d709945225), [68b4378](https://github.com/Muratovnik/valkama/commit/68b43784ecbd6b2592d8c36860ac203879c77f15), [5f5739a](https://github.com/Muratovnik/valkama/commit/5f5739a7599a3698d4202bbc6d78f70f69f4c3c3), [db877d6](https://github.com/Muratovnik/valkama/commit/db877d627eba54051ab8f3fb7b35a6a521b078d5))
- **settings:** choose the Windows notifications' events and text in Settings and keep them in the store, replacing the browser-stored settings no code obeyed ([213e6b0](https://github.com/Muratovnik/valkama/commit/213e6b0942c25f744017049773252c733584e975))
- **alerts:** open the panel of open questions at `/open/questions`, and the app from a notification through the `valkama:` scheme ([08df5ae](https://github.com/Muratovnik/valkama/commit/08df5ae89b85fe1100435741f7a6727a8961ae44))
- **planning:** say in the space's read model which items an agent is at work on now, as `live_work` ([e76c795](https://github.com/Muratovnik/valkama/commit/e76c7951359c9714c8ac1cd3e0aed6dce2604f76), [6d8f2f9](https://github.com/Muratovnik/valkama/commit/6d8f2f98555778eba731cba0671fd6300ee9ac5b), [09aaaeb](https://github.com/Muratovnik/valkama/commit/09aaaeb1d94e1f26a6227abfd12ecaaae5a85f40))
- **graph:** draw an epic as a frame round its work, with its counts over an edge in the board's hues, and lay the whole space out by epic ([5dc0e56](https://github.com/Muratovnik/valkama/commit/5dc0e56427658e1359f3b25ba8f258ea5f860c13), [d769cb1](https://github.com/Muratovnik/valkama/commit/d769cb12a6a512ec667546e6cf1130531767b875), [749e2c8](https://github.com/Muratovnik/valkama/commit/749e2c8db61a4fd837c53bc20881639418fb74b5), [e9f539a](https://github.com/Muratovnik/valkama/commit/e9f539afff68823fc518d396eace8b554c5c6df9), [abf5fb3](https://github.com/Muratovnik/valkama/commit/abf5fb3e95239928291792cadcf015e365ea9b6a))
- **graph:** show the work an agent is doing now: a card's «working», «held» or «waiting», a comet on a live line, and «Stop the motion» ([3cf5e84](https://github.com/Muratovnik/valkama/commit/3cf5e843044a679d035d0f2a08bdc0a74567151c), [bf589ee](https://github.com/Muratovnik/valkama/commit/bf589eebeaa5a3093e5c4b6f866d04502470f7cd), [9c5eb38](https://github.com/Muratovnik/valkama/commit/9c5eb3859bfacc8698fe7fdb7476f2d87595af2a))
- **graph:** remove the «Unlinked» switch, since every open item now stands in a frame, and count epics in «Open» and «All» ([cba689e](https://github.com/Muratovnik/valkama/commit/cba689eb4dec22aaee2590ec1f4afc584d5160c5))
- **graph:** lay the graph out again only when what it draws changes, and walk and frame it by its frames from the keyboard ([a85a9fe](https://github.com/Muratovnik/valkama/commit/a85a9fe79e1b9d03fd8457913dd0082a50a88056), [7386020](https://github.com/Muratovnik/valkama/commit/7386020c5933e376ecbb3e434bd09c5c6c877639))
- **web:** copy an item's short address `/open/<number>` from the card's head ([e3edfe1](https://github.com/Muratovnik/valkama/commit/e3edfe1a3d243a584f0d74625170c74953180cd0))
- **desktop:** offer a context menu for links, selected text and fields ([d06cd81](https://github.com/Muratovnik/valkama/commit/d06cd81b449de93f3b4620d1e2d6c75bbc281de9))
- **desktop:** remove the app's own way to open a plan anchor in VS Code, the `valkama:open-source` bridge ([8f41d80](https://github.com/Muratovnik/valkama/commit/8f41d80c9c80083e7ec134b001897c8f558d79e0))
- **web:** turn the card's Execution tab off by default, with a switch under Settings → General → Interface ([56c8271](https://github.com/Muratovnik/valkama/commit/56c8271f12a1b04847530a82026776560ba898da))
- **web:** name the question a history event is about, and say in words what a record id stood for ([bbb4d9f](https://github.com/Muratovnik/valkama/commit/bbb4d9fe58e38a6ed6ec9a17425ce3910b6f275e), [33ed81c](https://github.com/Muratovnik/valkama/commit/33ed81c7c4c20280bbdaab6e81c00f2d51f5a300))
- **web:** make segmented choices radio groups and panel switches tabs, one Tab stop walked by the arrow keys ([fdb0032](https://github.com/Muratovnik/valkama/commit/fdb0032d18b79476a90f00f8da8e99b0d2712575), [e257d5d](https://github.com/Muratovnik/valkama/commit/e257d5db3a2e6907ff5094239a869a7f41434f0e))
- **brand:** replace the mark with the spark in two flat colours, with a Windows icon frame for every size ([07302fa](https://github.com/Muratovnik/valkama/commit/07302fa8b2f639d219dd2c59b926b95c0af04989), [b532918](https://github.com/Muratovnik/valkama/commit/b532918822d5f2b3af7aff3d548767fc6fa979bc))

### Bug Fixes

- **desktop:** refuse a session id led by a dash, which reached `claude --resume` as a flag, and a terminal folder holding a `;` ([c38f52b](https://github.com/Muratovnik/valkama/commit/c38f52b2029f5343e11a336b0a64bb451e5dc18d), [09118ee](https://github.com/Muratovnik/valkama/commit/09118eefe41636b210bd37a965824de9399a9d3a))
- **desktop:** resume in a terminal by the full paths of `cmd.exe` and the client's CLI, so a `claude.cmd` in the repository no longer runs ([23f30d2](https://github.com/Muratovnik/valkama/commit/23f30d23a280096dbb087b13d088ee49564835fa))
- **desktop:** find the owner's command's program on the `PATH`, never in the session's folder, and give it no folder holding a `;` ([efb4824](https://github.com/Muratovnik/valkama/commit/efb482441c72cfec8f66d5d2d6ce487cfe0b8810), [72d4d98](https://github.com/Muratovnik/valkama/commit/72d4d985ae6c3fae1eb45aaa29a0021512a29274))
- **desktop:** hand the system only `http:`, `https:` and `mailto:` addresses from a window ([a14bbee](https://github.com/Muratovnik/valkama/commit/a14bbee7fe5468ab1c32dd8b0521a1d4b385f3f7))
- **http:** forbid framing every page the listener answers, with `frame-ancestors 'none'` and `X-Frame-Options: DENY` ([72355dc](https://github.com/Muratovnik/valkama/commit/72355dc793fa21be34f38731fe60dbc8cb6fdec3))
- **documents:** compare a path with its project's root as the disk spells both, so a folder named in another case is not read as the project ([d87b9db](https://github.com/Muratovnik/valkama/commit/d87b9db1a61ba1851ff87ef8e0c3477191cee931))
- **documents:** check the opened file again before reading it, so a junction swapped in on the way reads nothing outside the project ([56685ed](https://github.com/Muratovnik/valkama/commit/56685ed4fcea61184a3504a6d6da3d781ad7aabd))
- **sessions:** offer only a folder the desktop app takes, instead of failing a whole click ([3a7edee](https://github.com/Muratovnik/valkama/commit/3a7edeecbdd9e6ab8e527438788cd6a2a3ca7367))
- **planning:** read an item under the write lock its write takes, so a write that names no revision is no longer refused for one and a merge no longer drops a step ([8993a50](https://github.com/Muratovnik/valkama/commit/8993a50e6653deeb40ccf7796d05ef723f192d78), [ad3dcff](https://github.com/Muratovnik/valkama/commit/ad3dcff3353912228f1e50ced35b7752eb006bbd))
- **planning:** check a transition's reason before the item moves, refusing it by its own name ([e912101](https://github.com/Muratovnik/valkama/commit/e912101eddd57df7adf59bba18922f586a686939))
- **web:** let a press in the instant a question's buttons move write nothing, instead of declining the question ([85cf2d2](https://github.com/Muratovnik/valkama/commit/85cf2d2a5a251794ae9ef8b6a47f1dc05a3db549))
- **web:** say what a choice not sent was when its question closes elsewhere ([3cbb34b](https://github.com/Muratovnik/valkama/commit/3cbb34b61aa26ae9bbd28c25aae4e7699d6f1a67), [83b8cd6](https://github.com/Muratovnik/valkama/commit/83b8cd6cb5067866ec5efa7fb508abee280c3050))
- **web:** read a long card and a large space past 500 comments, 1000 events or 1 MiB of answer ([44c0ec7](https://github.com/Muratovnik/valkama/commit/44c0ec7a1c7090f58fbe1bc8b9bbe4e1240a5a0e), [dc094cf](https://github.com/Muratovnik/valkama/commit/dc094cf2afcc7d904dfedfaf22b3f4b7472da105))
- **launches:** record a launch from Valkama that ended, with its status, comment and move to review ([83f9df1](https://github.com/Muratovnik/valkama/commit/83f9df1f1b5d162ebc4a39a41f97a4ee6a5c66ad))
- **requests:** read an answer no call gave as `by_person: null`, not an agent's ([0e06b86](https://github.com/Muratovnik/valkama/commit/0e06b86516745b860930d2c8f0e137a4b20f26bb))
- **planning:** say why a card of an attached store another build wrote cannot be read, as 409 `store_schema_mismatch` ([1dd6abc](https://github.com/Muratovnik/valkama/commit/1dd6abc282f06452f72f31233804d8d72e9f070c))
- **web:** read a card's Memory source as the card opens ([e2482dc](https://github.com/Muratovnik/valkama/commit/e2482dc57148c228c4f17c363bb45ebbf9ea3b44))
- **web:** draw a reference in text as an inline link that wraps with the words ([014caab](https://github.com/Muratovnik/valkama/commit/014caab70daef461a915f6ea010b5deb07c9e672))
- **web:** show the notice in the corner over cards and dialogs, and announce it ([57ce93b](https://github.com/Muratovnik/valkama/commit/57ce93b8c49431bb631786313b9a14e9d20964c4))
- **web:** let Tab go on from where a card was pressed, and keep a link Tab reaches in a folded text in sight ([ab37e87](https://github.com/Muratovnik/valkama/commit/ab37e87b5fd8860c8c4b5a2fe4c84a2d20d85836), [c2b2129](https://github.com/Muratovnik/valkama/commit/c2b2129dbbfb016ee66faeade82eda8367ede544))
- **web:** ring focus only where the keyboard or the app put it, and take no press on what the card's bar fades ([de6949b](https://github.com/Muratovnik/valkama/commit/de6949b0443a3b8f0fa567016bb4147d7a5f632d), [07f649d](https://github.com/Muratovnik/valkama/commit/07f649da3535a7cabd05a230ac7e730b270aff19), [7862e47](https://github.com/Muratovnik/valkama/commit/7862e474796a61f306b420cbd14026833ec1b4dd))
- **web:** keep a switch, a button, a chip, the current page and a failed read's disc legible in a forced palette ([4e2ebc9](https://github.com/Muratovnik/valkama/commit/4e2ebc9f6966c40a53db7a80f9f21f1622159b0d), [30adf32](https://github.com/Muratovnik/valkama/commit/30adf3296bd3c6996257fb702c61c90883456bed), [f2fcd0c](https://github.com/Muratovnik/valkama/commit/f2fcd0c887c5ac5f16698fa08839a6dba427d5ac), [f0d24bd](https://github.com/Muratovnik/valkama/commit/f0d24bd8c6a24e386b09872f376e81e4a154235c), [68b7ce4](https://github.com/Muratovnik/valkama/commit/68b7ce4531178212229afbfa6c51c07a8e2fd369))
- **web:** mark an error and a refused choice with a glyph and a doubled edge, not colour alone ([55b378e](https://github.com/Muratovnik/valkama/commit/55b378e4c36464273669eb5d5ba5b168957f625d), [1ce7264](https://github.com/Muratovnik/valkama/commit/1ce72645f43ccb176ff3c605147971b9112dbace))
- **web:** give disclosures the bare weight apart from actions, and lift a failed read a step above its ground ([d0cc862](https://github.com/Muratovnik/valkama/commit/d0cc8623543d5f332cb47d47a4330f07b93e7383), [ae76bd6](https://github.com/Muratovnik/valkama/commit/ae76bd60f63f67f63700ce85290ba6ba88cadc71), [ef7d11d](https://github.com/Muratovnik/valkama/commit/ef7d11d13ae025428e7ca7c909c4eb9f3cd08fd4), [766a44a](https://github.com/Muratovnik/valkama/commit/766a44a536ca61a65db6f296b856d66303bbbdb0))
- **web:** keep a name, a time, a span of two units and a card head's note whole on their lines ([a72c098](https://github.com/Muratovnik/valkama/commit/a72c098ddb9054273b903da7b54d35b76b78e904), [094bb60](https://github.com/Muratovnik/valkama/commit/094bb6095fc780005f6ed779df625f8bc1e594ae), [13cfc6b](https://github.com/Muratovnik/valkama/commit/13cfc6bb23f50aab7678dc6884fa63c40a77c4f7), [7386136](https://github.com/Muratovnik/valkama/commit/7386136c51648dc2755a22b801ea0809b5294534), [4fdc7d0](https://github.com/Muratovnik/valkama/commit/4fdc7d0a352da5eb7d188266cf3b8cdb7aca91a3), [74b7e0c](https://github.com/Muratovnik/valkama/commit/74b7e0c6405cd898a43d0fee79e109bbb9895168))
- **web:** let a dialog take a phone's whole width ([f140fdd](https://github.com/Muratovnik/valkama/commit/f140fdd5fa902e6ccdd71b29f7da570501eea4e7))
- **web:** say a missing program once on a card, draw editors and apps apart in Settings and name a setting at its controls' top ([524d4de](https://github.com/Muratovnik/valkama/commit/524d4de1b1b2d21c1cbc98b22a11ebd247209dcf), [f3b9538](https://github.com/Muratovnik/valkama/commit/f3b95387c53fb5007f24c9c2747e65abbf96aeaa), [776c2dd](https://github.com/Muratovnik/valkama/commit/776c2dd2513c66bc775babdae4658cd90011e3f9))
- **web:** keep a state word on the branch map's tip readable ([f1bd37a](https://github.com/Muratovnik/valkama/commit/f1bd37a9a063d35c4b303ea0388c3d731f014e22))
- **web:** say no question waits without saying there are none above closed questions ([4b47f6b](https://github.com/Muratovnik/valkama/commit/4b47f6bc83f402f92d1a5fbf343f49f62a5588cb))

### Performance Improvements

- **web:** keep one ELK layout worker while the graph is open, and start it before the space is read ([f8f5fb2](https://github.com/Muratovnik/valkama/commit/f8f5fb2f8515d454e76edc6b74f5fce21184713e), [6fd1c18](https://github.com/Muratovnik/valkama/commit/6fd1c18b11e10578efaa4ef1402ffe942567c4f9))
- **launcher:** start a client hook without `runpy` and `pathlib` ([96f9540](https://github.com/Muratovnik/valkama/commit/96f95406c75bab90b6d8d7cf219cf20c5f3f455f))

## [2.4.0](https://github.com/Muratovnik/valkama/compare/v2.3.0...v2.4.0) (2026-11-03)

### Highlights

- A question is answered in the task's discussion, in one form for every kind of field,
  and the card's «Questions and decisions» section is gone.
- An agent reads a question's answer from `get_work_item` without reading the
  discussion, and a person can answer in a note of their own words.
- A link to a work item followed from an agent client's chat opens the card in the
  desktop app.
- The editor is one frame with a toolbar, and a card's head scrolls with its content.
- Upgrading: the store stays at schema 9, but install the server and the web interface of
  this release together, and reinstall the desktop app with them: an earlier web interface
  cannot update the questions on a card holding a note or a described option, and an
  older desktop app opens without moving to the card.

### Features

- **card:** answer a question in the discussion, where it reads as a comment, and remove the card's «Questions and decisions» section; «Needs my answer» shows the same form ([4b767bd](https://github.com/Muratovnik/valkama/commit/4b767bd36d2cc0e90bac61c0d2c12e541c9c9482))
- **planning:** let an option carry a markdown `description` and be `recommended`, and an answer a `note` of up to 8000 characters that stands in for required fields; carry an item's `questions` in `get_work_item`, record `by_person` from the call that closed a question, find items by a question's text, export every question and keep a merged item's questions open on the survivor ([cc7915f](https://github.com/Muratovnik/valkama/commit/cc7915f12c2d9d2e8b626e13f0fb1babff5a64e3))
- **planning:** answer `list_work_item_requests` in a compact form by default, `full: true` for whole records, with `offset`, `truncated` and `next_offset` ([27238d4](https://github.com/Muratovnik/valkama/commit/27238d4197c58ff5fc4376d687853e5231830f8c))
- **card:** let «Don't answer» take two steps and no press on a question holding nothing write, whatever comes to stand under the pointer ([a8ed598](https://github.com/Muratovnik/valkama/commit/a8ed598d79b573645456ce51fc793e95cd189a9d), [d2f9269](https://github.com/Muratovnik/valkama/commit/d2f926989ead43a3814a796dec396732b212501b))
- **card:** keep the choices in sight when options have long descriptions, and show a chosen option's description whole before Send ([4072fb2](https://github.com/Muratovnik/valkama/commit/4072fb21dbf9540f40efc0559849b4d51dfc08ac))
- **server:** open a work item link followed from outside a browser page in the desktop app, on that card ([3b0ffb2](https://github.com/Muratovnik/valkama/commit/3b0ffb2272f28a55e98384bdafd2cd7bf49fd228), [9fc7eab](https://github.com/Muratovnik/valkama/commit/9fc7eab664fc45c92029361cc116ad2f56429288), [7079261](https://github.com/Muratovnik/valkama/commit/707926172f4a67947a7dbda465da85ea83bddd22))
- **web:** draw the editor as one frame with a toolbar for a task link, bold, italic, inline code, a link and a list; `rows` sets a field's height again, and a person writes comments while reports stay the agents'; a comment and a description reach the server as typed, untrimmed ([3d200bf](https://github.com/Muratovnik/valkama/commit/3d200bf5ad2a6e0c759aceb135aad172816cf74f))
- **card:** let a card's head scroll with its content under a slim bar, keep the panel from card to card, and play the close ([32b0a65](https://github.com/Muratovnik/valkama/commit/32b0a65107516920d16917c555c027fba5a69186), [6ad545e](https://github.com/Muratovnik/valkama/commit/6ad545e6e481b2263c1bc99b02b1eaa0a4403e15), [ebb0f95](https://github.com/Muratovnik/valkama/commit/ebb0f9521e97bd9cd0bb534c94d49a94687e267c))
- **card:** leave out a section with nothing in it, and let a chain's section reach its list sooner ([ce55975](https://github.com/Muratovnik/valkama/commit/ce55975124843146845a62980073b8d24a228fc7), [2482223](https://github.com/Muratovnik/valkama/commit/2482223750715312b9223ad81ef1d6d8606759cd))
- **board:** let the title lead a tile with the labels as quiet words, make an epic's row one line, and «By epics» a toggle like its neighbours that keeps its word down to a phone ([bdc94ba](https://github.com/Muratovnik/valkama/commit/bdc94ba5a474c525d0313be00a4d5546ef4528ca), [d9b6f5a](https://github.com/Muratovnik/valkama/commit/d9b6f5aa8c5d4e77efab709ef2401f801a2f3ef9), [e522de9](https://github.com/Muratovnik/valkama/commit/e522de9c12ddd0e2830df3fe48a6df931d23208e), [57d5a3f](https://github.com/Muratovnik/valkama/commit/57d5a3f52809e0fa43f70dac68c6fbb2f11ab9eb))

### Bug Fixes

- **planning:** take the write lock before deciding an item's number, a space's key or a call row, so agents creating items at once no longer fail on `UNIQUE constraint failed` or `database is locked` ([cd638de](https://github.com/Muratovnik/valkama/commit/cd638ded068be051d79509aa4a1ee1640f63e28d))
- **web:** keep a press on the board from crashing the tab in Chromium 156 ([2736abe](https://github.com/Muratovnik/valkama/commit/2736abe4d2c5527d330a9e57b20749ce3ae1f8e7))
- **web:** open a task whose description is longer than 8192 characters, and one whose discussion outgrew 256 KiB ([66c96ca](https://github.com/Muratovnik/valkama/commit/66c96ca6775985c8951d9fb7c851cdab236be53d), [2a3bd8d](https://github.com/Muratovnik/valkama/commit/2a3bd8dc3402d443a92d14bfabfae7b30c12d5a1))
- **web:** keep a second press from reaching what rose under a still pointer, or what a closing drawer leaves under it ([a73909e](https://github.com/Muratovnik/valkama/commit/a73909ef392490ab8d1b353d0431bf472cffa7e4), [a9c9cd2](https://github.com/Muratovnik/valkama/commit/a9c9cd289d642d2e37d0f24bb19a4f06c41ac9ac), [7b5e94b](https://github.com/Muratovnik/valkama/commit/7b5e94b2a7c8b3a7bba0957396cac744e314a2b1))
- **web:** let the reading keys scroll a card as soon as it opens, and keep the place along its stuck sections and back on Overview ([977a3e7](https://github.com/Muratovnik/valkama/commit/977a3e7add9b7853291b1816cbc74b84dfb39b93), [19caf59](https://github.com/Muratovnik/valkama/commit/19caf598b8e0765293596cd2c715d7cd3651514f), [f32befe](https://github.com/Muratovnik/valkama/commit/f32befe292d1bc02efab402b2a5071adb0dc22a8), [d113034](https://github.com/Muratovnik/valkama/commit/d113034bd82460a2b081cf8e999faad21d2fe9db))
- **web:** show a card soon when its chain is slow, and land Back once ([4d0b927](https://github.com/Muratovnik/valkama/commit/4d0b927d5aa3643e5d3c64f024e13fe773868f2e), [b7f28ad](https://github.com/Muratovnik/valkama/commit/b7f28adffa7ea2765df3111c96ffb067742efb60))
- **web:** keep focus in the card through a takeover, a write, a retried read and an outcome sent ([450f06f](https://github.com/Muratovnik/valkama/commit/450f06fb46716fe8e2316384da92a3ddf7de0141), [3e22e51](https://github.com/Muratovnik/valkama/commit/3e22e51c1cd416076e4f714fc4f66984ae4d24be), [fc37358](https://github.com/Muratovnik/valkama/commit/fc37358304fa54dc401de2b73c4d317d01bc5493))
- **web:** ask before an outcome stepped back from is lost ([9b8bd3e](https://github.com/Muratovnik/valkama/commit/9b8bd3eea952ce4b1fe0f3122ca0c0fc9b718dbb))
- **web:** draw no ring on Close of a card opened by its address ([27c8c50](https://github.com/Muratovnik/valkama/commit/27c8c50b6e7ef9a6262888d29007317873378f3c))
- **web:** give a fact the item does not have no place among the facts, and stand a checklist step's text level with its box ([3a030b5](https://github.com/Muratovnik/valkama/commit/3a030b5200b8537dc0ac27fe9e7da592aaf85f65), [b3b7acf](https://github.com/Muratovnik/valkama/commit/b3b7acf9a95d62b4c270c1f2ea96f66b2aeb3050))
- **web:** shorten a holder signed with no brackets as one signed with them ([9487aa8](https://github.com/Muratovnik/valkama/commit/9487aa869c91b8cf8ef432849d2c359d0a26db44))
- **editor:** keep marks inside a list item's marker and take a mark around a selection off as one, and show the start of a long text opened for editing ([d3ecff0](https://github.com/Muratovnik/valkama/commit/d3ecff015a65ad1ac893cfbf1ebaef6ec32f96da), [16c95ad](https://github.com/Muratovnik/valkama/commit/16c95adf6c0a127444abfcf609728c6be3fe5c10), [7402c3b](https://github.com/Muratovnik/valkama/commit/7402c3b35b4854dd0bdb40859cc7868225352557))
- **web:** bring the checklist into view from another section's «Go to the checklist» ([550f8d4](https://github.com/Muratovnik/valkama/commit/550f8d4f140f23e8ca37950ca7951c98b8a09b51))
- **web:** make a pressed chip plain in a forced palette ([afc463c](https://github.com/Muratovnik/valkama/commit/afc463cee8b164959a8689c368600349b187f663))
- **list:** give a phone's sort choice its whole name, and stand the Memory search level with its field ([c5a5c3a](https://github.com/Muratovnik/valkama/commit/c5a5c3ab8c45551441f5e8810a8f0876f64d3482), [78e968f](https://github.com/Muratovnik/valkama/commit/78e968f59861f90cb827c1bddc79cd4aea980548))

## [2.3.0](https://github.com/Muratovnik/valkama/compare/v2.2.0...v2.3.0) (2026-11-02)

### Highlights

- A work item has a short address, `/open/MAIN-12`, which MCP answers carry as `url`,
  and a listener can hold the port from login so the address works without starting
  anything.
- A card lists the Claude Code agents working on its item.
- A client restart no longer costs a session its claims: an ended session keeps them for
  12 hours.
- `valkama released` finds open work whose commits already went into a release range.

### Features

- **planning:** give a work item the short address `GET /open/MAIN-12`, carry it as `url` in the full record and every write acknowledgement, and say why an address led nowhere; the skill and the server's instructions ask agents to link the numbers they write to the owner, and the instructions now fit the 4096 characters Claude Code reads ([a934da0](https://github.com/Muratovnik/valkama/commit/a934da0d4cf19efd4ebab02dfe4915e7213b01b6), [8e8ca87](https://github.com/Muratovnik/valkama/commit/8e8ca877a0770aafaf2520833c88bf2806e33dc1))
- **launcher:** add `serve --on-demand`, which holds the port at about 15 MB and becomes the server on the first connection, and `launcher autostart enable|disable|status` to start it at login ([cf08fbc](https://github.com/Muratovnik/valkama/commit/cf08fbc8009d3dcb6e75319af68b9ec94fb8a4e1))
- **planning:** list the Claude Code agents on a work item's card, with what each was started for, its step and its last activity ([5b0a0a0](https://github.com/Muratovnik/valkama/commit/5b0a0a05a979915f97650fb38991078469f30011), [65c7c77](https://github.com/Muratovnik/valkama/commit/65c7c775ea7e2f988a6e36e9a9f9fe840d386ecc), [72434aa](https://github.com/Muratovnik/valkama/commit/72434aa93576f9cf04cde669d4aed3b5bb09a6eb))
- **hooks:** name an agent from the call that started it with `valkama hook claude post-tool-use`, registered for `PostToolUse` with the matcher `^(Agent|Task)$` ([91d7fff](https://github.com/Muratovnik/valkama/commit/91d7fff663b53d5958052c52e079c9e76c779216))
- **cli:** add `valkama released --space KEY --repo PATH --range A..B`, which lists the open items whose commit refs went into a release range, matched by hash, patch-id or subject ([943558e](https://github.com/Muratovnik/valkama/commit/943558e4d7df97c6321e3d88fc9b4087f1d034c5), [f6bb12c](https://github.com/Muratovnik/valkama/commit/f6bb12c86b448bf2b94a54c981bc278cfe99254f))
- **planning:** read a work item's comments after a given id with `comments_after` ([45cdc42](https://github.com/Muratovnik/valkama/commit/45cdc42d56b5b0d6ee4ddef64b4271808027883d))

### Bug Fixes

- **planning:** give an ended session 12 hours before its claims are released, and say in the history why a claim was released: `session-ended`, `session-missing` or `lease-expired` ([92f6687](https://github.com/Muratovnik/valkama/commit/92f66871307ef726f6a4dc1e543840a61fc8fc71))
- **board:** land a tile dragged quickly where it is let go, and on top of a column let go over its header ([617cff4](https://github.com/Muratovnik/valkama/commit/617cff4dece6fdf873b2ef46e6d7fa2d84ff32f6), [f814444](https://github.com/Muratovnik/valkama/commit/f81444429dad39647321b8dcecb31a5dba0484b3))
- **tray:** move the icon to the release its session switched to after `launcher install` ([8c90644](https://github.com/Muratovnik/valkama/commit/8c906447a80b094db7d9aa05ce65f2d5e38f44b8))
- **store:** wait out a scanner or an indexer that holds a file when adopting an older store or pinning a release ([bf5e406](https://github.com/Muratovnik/valkama/commit/bf5e406a745ae0e4687a7ef5a0eb64a3981869fc), [f9780a3](https://github.com/Muratovnik/valkama/commit/f9780a30e9ab06a5045382f52f6f9ed3502a910e))
- **web:** give a state panel's buttons their own row on a phone, so its message stays readable ([503cd32](https://github.com/Muratovnik/valkama/commit/503cd32255fb577566618f9e5c4e5616650fd28a))

## [2.2.0](https://github.com/Muratovnik/valkama/compare/v2.1.0...v2.2.0) (2026-11-02)

### Highlights

- One Work filter stands above the board, the list and the graph, and is kept in the
  address.
- Free text is drawn as Markdown and written in a Markdown editor.
- A close ends the claims on the item, and every link names the state of its other end.
- The store is unchanged at schema 9, so the upgrade runs no migration, and the server
  lists the same 31 tools with the same schemas. Several existing MCP and HTTP calls
  return more than before: an agent or integration written for 2.1.0 should read
  Breaking Changes first.

### Breaking Changes

- **planning:** a space's view and its live stream now carry every `blocks` link into the space from another space, so a link's `from` can name an item the view's `work_items` or `nodes` do not hold; every link names its source's `reference`, `state_name`, `state_category`, `is_terminal` and `state_unavailable`, and a reader that looked `from` up among the space's items reads these instead ([81f118e](https://github.com/Muratovnik/valkama/commit/81f118e5afe022e23450d58b7568e5a733bfe8b8))
- **planning:** a chain's `edges` now hold every `blocks` link into the root or a member wherever its source lives, so `from` need not be a member ([bf3de39](https://github.com/Muratovnik/valkama/commit/bf3de39bac7f5fd94b9015fdf2d4f81f202d00da))

### Features

- **planning:** filter the board, the list and the graph through one Work filter of state, kind, priority, label and holder, kept in the address, in place of the queue and the search field ([4cf5514](https://github.com/Muratovnik/valkama/commit/4cf5514dcf3751476d6c9688dfb0fafcf7b6291c), [a98e4d7](https://github.com/Muratovnik/valkama/commit/a98e4d769beb7e08d54969791cdf596db83b7c7a), [3a2efee](https://github.com/Muratovnik/valkama/commit/3a2efee31ca74b65dc66bf85eb28b778005f2c75), [fefcbe4](https://github.com/Muratovnik/valkama/commit/fefcbe4ade5d631cf66db117d310a616c343bdc5), [fc1eb3e](https://github.com/Muratovnik/valkama/commit/fc1eb3e8bc6564fb31893ad4f09a91a6106c8187))
- **web:** draw free text as Markdown with its references linked, keeping raw HTML as text and links to `http`, `https` and `mailto` only, and write it in a Markdown editor ([afd1b0a](https://github.com/Muratovnik/valkama/commit/afd1b0a975a149a48f78cd886874437d8ae7a64b), [846c9c2](https://github.com/Muratovnik/valkama/commit/846c9c2bf25e38f5dbbc7c851f3438900b6736e0), [5bed232](https://github.com/Muratovnik/valkama/commit/5bed2327772d2e938b095eb1264ae336fd40bf5a), [2054d39](https://github.com/Muratovnik/valkama/commit/2054d39f70ba6af89a821cd65cc01b983f35bc2e))
- **planning:** end the claims on an item in the write that closes it, and name who held a closed item as `last_claim_ref` with `closed_at` ([7f86420](https://github.com/Muratovnik/valkama/commit/7f86420890a39c69f72f9248ca3db875b951c769), [aaaa407](https://github.com/Muratovnik/valkama/commit/aaaa4075d9226b460a5793d0dd0d483a8e978257))
- **planning:** name the other end's state on every link of a full record, and mark cross-project search results with kind, priority and state ([8cb8b9c](https://github.com/Muratovnik/valkama/commit/8cb8b9c2870ce362880cf17cb0b0d23841da531b), [329c79d](https://github.com/Muratovnik/valkama/commit/329c79d1d237044d838f3be53244db944313c462))
- **work-item:** print a work item's exceptions, not its defaults, the same way on the board, the list, the graph, the card and the finder, with marks that filter ([853fa59](https://github.com/Muratovnik/valkama/commit/853fa5905cdd36db1812999c3fe2b90b53fc0639), [92372fe](https://github.com/Muratovnik/valkama/commit/92372fed6f349a2f17122f9963a8173a50c2eed3), [8484cb4](https://github.com/Muratovnik/valkama/commit/8484cb4f6f5cbbd2008829cb4a61df824e84df52), [f9a25ca](https://github.com/Muratovnik/valkama/commit/f9a25ca9fa88d685174bbf0b68cc86e52d6a7a65), [da1da44](https://github.com/Muratovnik/valkama/commit/da1da440ffb648eca9be687731accc70bf134d04))
- **board:** keep a tile's labels on one line and count the rest, and stand the Done column newest closed first ([179108b](https://github.com/Muratovnik/valkama/commit/179108b1adb8c60fa7109628fb97dad4deca3803), [f29518e](https://github.com/Muratovnik/valkama/commit/f29518e6980a830a069e0960e7529991e93f068d))
- **card:** lead the card's head with who the item is, its facts and one action ([4a669aa](https://github.com/Muratovnik/valkama/commit/4a669aa248b8d6587d258998c5e449247d41f3e1))
- **graph:** leave the camera to the operator: a refresh, a filter, a switch or a resize no longer moves it ([7d0f905](https://github.com/Muratovnik/valkama/commit/7d0f9059c6a58eb0e3ea117a4f163749ab13e497))
- **desktop:** open the window at once on a starting page and start the server behind it, offering «Restart the server» instead of restarting it unasked ([6776c74](https://github.com/Muratovnik/valkama/commit/6776c749efb6e3cbf402597227d991c2d5cb605b))
- **nav:** say a lost connection in the rail instead of pushing the views down, with «Refresh» on a narrow rail's dot ([b4a6697](https://github.com/Muratovnik/valkama/commit/b4a66971971cd5b976f604652a93b5185ca3a1ba), [3e4973e](https://github.com/Muratovnik/valkama/commit/3e4973ee4da9e6080b2a967933e13a5519d4d6ff))

### Bug Fixes

- **server:** hand git only a commit revision when resolving a commit ref, so a value such as `--output=<path>` no longer makes git write a file and `rev:path` no longer prints one ([9649d5e](https://github.com/Muratovnik/valkama/commit/9649d5e755bbf763fbba8bfd6617325247bcb346))
- **server:** look a commit up in every registered project and by the project a value names, where most commits read as not found ([63e06a7](https://github.com/Muratovnik/valkama/commit/63e06a7bbc717749248f430837964fdd2ea9527a), [49340f9](https://github.com/Muratovnik/valkama/commit/49340f92056765d4e18702cc28eb969f3b029b30))
- **server:** refuse a second listener on a port another server holds on Windows ([df4a4aa](https://github.com/Muratovnik/valkama/commit/df4a4aadb1a1f444bb6fbcde7cf5fe6ff763d0d1))
- **card:** list only the blockers that are still open, and name a blocker in another space or outside the chain ([39c0239](https://github.com/Muratovnik/valkama/commit/39c0239569158bc8f9d43f93d02f7bcffc1e6c2f), [9467588](https://github.com/Muratovnik/valkama/commit/9467588d04fc7dc3ea6e2f8bf1cf8d550eb7c115))
- **planning:** rank the item a bare number names first in a search ([77851c3](https://github.com/Muratovnik/valkama/commit/77851c330593e7a5da42ff9c0931cb59f257d262))
- **palette:** separate card, lane and panel by contrast, and give each hue one meaning: in progress and held work blue, done green ([1ae1ffe](https://github.com/Muratovnik/valkama/commit/1ae1ffe3af168d92220115f5a0656d13647a630e))
- **ui:** let a button's variant keep its own hover colours, so a hovered primary button no longer looks disabled ([2fdeb07](https://github.com/Muratovnik/valkama/commit/2fdeb07d9d229913f839046df6b838838b56b789))
- **card:** condense the card's head at the first scroll of its body ([286f6ce](https://github.com/Muratovnik/valkama/commit/286f6ce39bda79cb23064e39b7edf9170ec82781), [ca5fd29](https://github.com/Muratovnik/valkama/commit/ca5fd29adab4843e212f28c0288970155423f16f))
- **tray:** start the installed app at once and leave the startup decision to it ([5413c24](https://github.com/Muratovnik/valkama/commit/5413c2450b6fc7b935489f06fa509e0c6ae5569a))
- **graph:** keep background work from taking a line above the drawing ([f2a1e20](https://github.com/Muratovnik/valkama/commit/f2a1e209bc9348c08bd63fb5c723b9b88bc30f3e))
- **planning:** name a failed Work read by its cause, not a raw code ([65d8e87](https://github.com/Muratovnik/valkama/commit/65d8e87fe8fc42bc62664fca32a5d23a294ce180))
- **board:** draw an empty lane cell's ground only while a tile can land there ([5ba14e4](https://github.com/Muratovnik/valkama/commit/5ba14e40426dd263f5a216d66dc08a4167494961))
- **card:** name a checklist step's discuss button by its words ([9d548f1](https://github.com/Muratovnik/valkama/commit/9d548f16ab8fa4271fafccb38d5a5baf6127dcd3))
- **shell:** drop the sentence describing each module under its name ([ef4b1d2](https://github.com/Muratovnik/valkama/commit/ef4b1d2a86a2e3a81fc15c2a148fd7d374ed5ec0))

### Performance Improvements

- **launcher:** answer `runtime` and the launcher's status questions before loading the command line, and read listener ownership from Windows directly ([7482044](https://github.com/Muratovnik/valkama/commit/7482044d5b66ad3ca6c892c0756fb57ad734e083), [4102b6d](https://github.com/Muratovnik/valkama/commit/4102b6d7b07abb4f7d8f67f230672a62940a5b1a))
- **planning:** paint a long list's first screen at once and the rest right after; the whole list of about 1,200 rows finishes painting 1.4 to 2 times later than in 2.1.0 ([1f57252](https://github.com/Muratovnik/valkama/commit/1f57252637495fc00086ac0b9c3603bc42f7df27))
- **board:** leave a tile out of sight unlaid until it is reached; the board's first tile comes some 20 to 130 ms later ([1393c6d](https://github.com/Muratovnik/valkama/commit/1393c6d106241f63751a388824d70fa08eaa3a3e))

## [2.1.0](https://github.com/Muratovnik/valkama/compare/v2.0.0...v2.1.0) (2026-11-01)

### Highlights

- A chain of work says what one item's work grew into and whether it converges, in a
  tool, a branch map on the card and a scope for every view.
- Agents and the board share one order of work, and the board can be grouped by epic.
- Items that are one change can be merged, and an item can be created with its claim,
  steps and links in one call.
- A Valkama skill ships with the server, and `launcher install` reaches running
  sessions through a stdio front. The server lists 31 tools, up from 29:
  `get_work_item_chain` and `merge_work_items` are new.
- The store is unchanged at schema 9, so the upgrade runs no migration. Existing MCP and
  HTTP calls behave differently in the ways Breaking Changes lists: an agent or
  integration written for 2.0.0 should read them first.

### Breaking Changes

- **planning:** a claim starts the work it takes, moving a `backlog` or `queued` item to the first reachable `active` state, and a release puts work under way back in the queue; the answers add `started` and `requeued`, and an agent takes the next `expected_revision` from the claim's answer ([029c008](https://github.com/Muratovnik/valkama/commit/029c00877bd8f1f0a5590f50acf52d5357e62ca6))
- **planning:** a confirmed session holds its claims and steps as `codex (session <id>)` or `claude (session <id>)` whatever `author` the call signs with, and `list_work_items` with `owner` matches the holder exactly ([48c5715](https://github.com/Muratovnik/valkama/commit/48c5715e2fd4c1253c7e360dfdcd023caeaf9592))
- **planning:** a checklist write keeps the `item_id`, claim and tick of a step it repeats, and refuses to leave out a claimed or completed step without `force` ([6a8e8e3](https://github.com/Muratovnik/valkama/commit/6a8e8e3131e5c62ec6d48b9aedcc098464a22950))
- **planning:** a work item that does not exist is `not_found` (404), where it was `invalid_request` (400) ([d107776](https://github.com/Muratovnik/valkama/commit/d10777610c12184b268639ca3edfccef3b19910b))
- **planning:** `claim_ready_work_item` takes the first ready item in the order of work, a `queued` state before a `backlog` one, and priority only breaks a tie ([7e6ba1e](https://github.com/Muratovnik/valkama/commit/7e6ba1e1f707ff21bfc0a5fe73800d0049409a81))

### Features

- **planning:** read a work item's chain, what it grew into and whether it converges, with `get_work_item_chain` and `GET /api/planning/work-item/chain`, and filter lists by `parent` ([40557b2](https://github.com/Muratovnik/valkama/commit/40557b2fb4a04384319412e975e3ec8a2a8058ca))
- **card:** show a work item's chain as a branch map coloured by progress, with a forecast of when its open part closes ([9f460e3](https://github.com/Muratovnik/valkama/commit/9f460e32b897283136e7ef06ec09c401e791fd89), [22b3765](https://github.com/Muratovnik/valkama/commit/22b3765f87dff0eeec5ea32783a37558f5647cfc), [56f672c](https://github.com/Muratovnik/valkama/commit/56f672c44cce03a6a4c4b2fa9bec85c52d7b39ae))
- **graph:** narrow every view to a chain kept in the address, opening the graph on its open part or the branch chosen on the map; the whole-space graph leaves out items no drawn link touches behind an «Unlinked · N» switch ([52bc999](https://github.com/Muratovnik/valkama/commit/52bc99914ccd8bceb52dee88738beeba601909de), [4372fa2](https://github.com/Muratovnik/valkama/commit/4372fa27beed36c990719688ca9e9db9d381492f))
- **planning:** order work by a placement agents and the board share, through `rank` on updates and transitions, and by drag or Alt+↑ and Alt+↓ on the board ([7e6ba1e](https://github.com/Muratovnik/valkama/commit/7e6ba1e1f707ff21bfc0a5fe73800d0049409a81))
- **board:** group the board by epic, one lane per epic with its counts and fold, and work under no epic last; a board move sends the revision it read, so one made after an agent changed the item is refused with `409` instead of overwriting it ([c1e6e39](https://github.com/Muratovnik/valkama/commit/c1e6e39b90ca41a0268915873ba81ff3db2e3d09), [c897fd6](https://github.com/Muratovnik/valkama/commit/c897fd6d5278ec70488dab26ccca955652fdafc7))
- **planning:** merge 1 to 20 items that are one change into the one that survives with `merge_work_items` ([0719392](https://github.com/Muratovnik/valkama/commit/07193927f9712f48462b265da35d26c54296d5d2))
- **planning:** create an item with its `claim`, `checklist` and `links` in one transaction, and set checklist steps in a batch, a done step as the caller's tick ([292f168](https://github.com/Muratovnik/valkama/commit/292f16897395167c49c17c065f483b91a13cb751), [253cc1b](https://github.com/Muratovnik/valkama/commit/253cc1bb6c49a9300348bc5c0b273d94b6d0c69f))
- **planning:** read a state category such as `active` or `completed` as the one state that has it ([1012856](https://github.com/Muratovnik/valkama/commit/10128568d8fa6f53aea93f269beb4a847e377c18))
- **skill:** ship the Valkama skill and install it where Claude Code and Codex find it with `valkama skill install | status | uninstall` ([a22481b](https://github.com/Muratovnik/valkama/commit/a22481bd1adf8cca5d49aaa04ed9bc2277dfbe35), [5a5395b](https://github.com/Muratovnik/valkama/commit/5a5395b560dfa0c69dd6b9329ef6471e27adf18b))
- **mcp:** follow a `launcher install` in a running session through a stdio front that switches the server behind the client's pipe ([116893e](https://github.com/Muratovnik/valkama/commit/116893ee75ea8b55160cc8daa22db414d3cf000b), [6984795](https://github.com/Muratovnik/valkama/commit/6984795e429bf052bcdce1243d788ddb8198628a))
- **graph:** make the field one Tab stop walked by the arrows, and draw a zoomed-out field as a state overview ([71cf0e6](https://github.com/Muratovnik/valkama/commit/71cf0e6293fde60bd2a77bdc73ecdd1fcc1235eb), [6d7159a](https://github.com/Muratovnik/valkama/commit/6d7159adae607559ad0949d257c9ff874ce4a438))
- **shell:** let a notice carry an action and be dismissed, name only the Settings sections in its subtitle, and rest a text action on the control fill ([863eac1](https://github.com/Muratovnik/valkama/commit/863eac198dbcd28ea09d4d7cc390e1fa301ef874), [d63cda3](https://github.com/Muratovnik/valkama/commit/d63cda34e343c4361a87af1376eb3bd8a0cbb898), [d062c46](https://github.com/Muratovnik/valkama/commit/d062c4607d95964c39b5860a521e9f9ae53d56c7))
- **desktop:** build the desktop app on Electron 45 (Chromium 156), up from Electron 43 ([cf48b93](https://github.com/Muratovnik/valkama/commit/cf48b938285a37f89dbe1ba5460afb800ef2896a))

### Bug Fixes

- **planning:** answer a search whose query is a work-item reference with that item first, and say why a search skipped a source ([e560556](https://github.com/Muratovnik/valkama/commit/e5605563c7f7fbaa4408f829982281dfacb7b551), [2d1ffd1](https://github.com/Muratovnik/valkama/commit/2d1ffd17ee06a4fc9ca45883fed02d61fddc9042))
- **web:** open the finder's first result on Enter, or say a typed reference was not found ([9c57163](https://github.com/Muratovnik/valkama/commit/9c57163ee2c4d20726d8b307fe4e1b858f35586e), [f4e13b4](https://github.com/Muratovnik/valkama/commit/f4e13b4de0cd4bc2767b3572d5eaa7136b8bf676))
- **planning:** refuse a checklist write that completes a step someone else holds ([4a698eb](https://github.com/Muratovnik/valkama/commit/4a698ebd52420dc94bf719c8f3e3c758e8d5bc7f))
- **board:** fit the board to its width with finished columns last, and walk a column and the list's rows as one Tab stop each ([f5d4b18](https://github.com/Muratovnik/valkama/commit/f5d4b18021accbda9e4eee823592562228c93cbf), [3294b6d](https://github.com/Muratovnik/valkama/commit/3294b6d33f933c5898648ee6bee8d815bc48b825))
- **list:** open a card from anywhere in its row ([f9cf9a1](https://github.com/Muratovnik/valkama/commit/f9cf9a1aa6413d6d096096337456261d5715f2ee))
- **planning:** put the work bar on two compact rows, and count one population above the stage in every view ([a204180](https://github.com/Muratovnik/valkama/commit/a204180d21f47c5cb7397d0fb46ff9ff31786d11), [566f91a](https://github.com/Muratovnik/valkama/commit/566f91af9ce50bff515d21ecbbb3248549ad476d))
- **card:** pin only the title and the sections in the card's head, and bring Back to where the parent was read ([2bc7e37](https://github.com/Muratovnik/valkama/commit/2bc7e37faf99f773ecaa08821312ead99512bdf3), [2fdde4d](https://github.com/Muratovnik/valkama/commit/2fdde4df35a77a0e69cc12b3a2a10a5b7c653f3e))
- **requests:** keep focus, place and count after an answer, and answer short choices with radio buttons ([03f1867](https://github.com/Muratovnik/valkama/commit/03f186728cde205cfd660cea96b49039ce2de847), [05c84d0](https://github.com/Muratovnik/valkama/commit/05c84d03b27ec2c4e5d91d95f624a50a2ae347cc))
- **nav:** name the rail's entries by what they show, and mark a questions count that could not be read ([e52fd55](https://github.com/Muratovnik/valkama/commit/e52fd5573268445a5eeb49c522931430e00dc73d), [d6b5e86](https://github.com/Muratovnik/valkama/commit/d6b5e860acb55d0f2105079a7c068043b9f385a4))
- **server:** answer an address that names no page with the app shell and 404, and say a missing record is not there with no Retry ([2fa2daf](https://github.com/Muratovnik/valkama/commit/2fa2daf673fcaba8379fb99760fe4b9e75af7969), [f56a3c0](https://github.com/Muratovnik/valkama/commit/f56a3c0d5793443d797523d9d606d85f9eb78b58))
- **overlay:** close the top overlay on Escape even when focus fell out of it ([16e5306](https://github.com/Muratovnik/valkama/commit/16e5306305f034d032e78ba73d861fe5deaf98e5))
- **web:** never print the unknown-failure sentence with its code left empty ([d1f01b0](https://github.com/Muratovnik/valkama/commit/d1f01b0d441986c7987b91f3ec4c4255dc09b5b7))
- **server:** send every file type the web build ships with its own content type ([d143e2b](https://github.com/Muratovnik/valkama/commit/d143e2b8c8fd6828116daeca869d6173b3670a3f))
- **processes:** never kill the caller's own process group on POSIX, and start a launch and an adapter in a session of their own ([a49a9cf](https://github.com/Muratovnik/valkama/commit/a49a9cf520b5f8ddf4646d5db50c49958f573b42), [8455426](https://github.com/Muratovnik/valkama/commit/845542678772e3bcb560f6696b9e301be13de425))

### Performance Improvements

- **web:** download the graph and Settings on demand, with the libraries in a `vendor` chunk that keeps its hash across releases ([67d9b08](https://github.com/Muratovnik/valkama/commit/67d9b088aa883e3125f25757dbb175aa7c07c72a))
- **web:** print the finder shortcut as «Ctrl K» without the glyph that fetched a fallback font ([59efc60](https://github.com/Muratovnik/valkama/commit/59efc60670a0e3bf6ba3c6cc7685d23435478795))

## [2.0.0](https://github.com/Muratovnik/valkama/compare/v1.0.2...v2.0.0) (2026-10-31)

### Highlights

- The workspace focuses on agent work: Work and Settings remain, and the Analytics,
  Improvements, Skills and Sessions screens and the extension registry are removed.
- Every Planning write records who made it, and a claim is a lease held by the session
  that took it; client hooks record session lifecycle events straight into the store.
- `apply_work_item_changes` applies several writes to one item in one call, and the
  write tools answer with a short acknowledgement.
- `launcher install` pins a release instead of running the working tree: run it once
  after updating.
- Upgrading: see Breaking Changes for store schema 9 and its `preschema9` snapshot. The
  first open also takes a `preidentity` snapshot before it adds the identity columns.
  The web reads records strictly, so serve the `web/dist` built with this release; an
  earlier one refuses every item.

### Breaking Changes

- **store:** the first open by this build takes a verified snapshot labelled `preschema9`, then drops the extension registry's tables, `platform_modules` with `platform_registry_audit`, and `integration_settings`; a schema-8 build refuses the upgraded store with `StoreTooNewError`, so restart every agent client after pinning this release with `launcher install` ([7dab0c6](https://github.com/Muratovnik/valkama/commit/7dab0c65f0b44d6676ebaec1351fa8191e5fcf18))

  Going back to a schema-8 build is described in
  [Upgrading the store and going back](docs/guides/store-upgrades.md#going-back-to-a-build-at-schema-8).

- **mcp:** the work-item write tools answer with a short acknowledgement — reference, revision, state, holder and what changed — instead of the whole item; pass `verbose: true` for the full item, and every tool result is one line of JSON ([bf92e95](https://github.com/Muratovnik/valkama/commit/bf92e952e2a0019c88da16ce5610fce2df0b5780))
- **mcp:** `list_work_items` and `search_work_items` answer one compact row per item, at most 50 without a `limit`, with `truncated`; Planning tools refuse an argument their schema lacks and read the stand-in names agents reach for ([c47abe6](https://github.com/Muratovnik/valkama/commit/c47abe60221b2cb77c42ebd29e2951fa801affa8))
- **export:** an export carries only the `planning` section; `--section relations` and `--section settings` are refused as unknown ([9bfd82d](https://github.com/Muratovnik/valkama/commit/9bfd82d797e93ad2687dcc825a474c52b128a10d))
- **platform:** the extension registry is gone, and `/api/platform/registry`, `/relations`, `/actions`, `/assignments` and `/grants` answer 404; an external adapter's manifest has exactly four fields, so check and install such an adapter again ([9bfd82d](https://github.com/Muratovnik/valkama/commit/9bfd82d797e93ad2687dcc825a474c52b128a10d))
- **platform:** the module list is declared in code, and turning a module on or off is gone: `POST /api/modules/state` answers 404 ([5e39356](https://github.com/Muratovnik/valkama/commit/5e393566bcdfb8fd88419a22ba465aef17d4b97c))
- **web:** the Analytics dashboard, Improvements, the Skills catalogue and the Sessions fleet are removed with their APIs and MCP tools, and `/api/sessions` and `/api/session-seen` answer 404; `/api/session` answers stored context rather than an event feed, and installed skill files and client settings are unchanged ([5a68928](https://github.com/Muratovnik/valkama/commit/5a689282d8fbd58f499df2da342a1f88a71696a2))
- **launcher:** `launcher install` copies one commit of the checkout into the releases directory and the stable command runs that copy, so uncommitted edits no longer reach new client sessions; an earlier `--revision` is the rollback ([7d40c92](https://github.com/Muratovnik/valkama/commit/7d40c9296f1862085b597331fb2ab4e70c0cee5b))

### Features

- **planning:** apply a claim, ticks, refs, links, a comment, the summary and a transition to one item in one call with `apply_work_item_changes`, all or nothing; `get_work_item` answers with the newest part of the history unless `full: true` ([aa5497c](https://github.com/Muratovnik/valkama/commit/aa5497c6e819eaf707df191658be8091f571712c))
- **planning:** record who made every Planning write call, `confirmed` when the client proved the session, and carry it as `identity` on history events; `valkama hook claude pre-tool-use` adds the `_identity` that confirms a Claude Code call, and `get_work_item` lists the `sessions` that wrote to the item, so agents no longer attach their session id as a ref ([5214204](https://github.com/Muratovnik/valkama/commit/521420431d63cdb3a4c4667f9173898c940e2e25), [218b252](https://github.com/Muratovnik/valkama/commit/218b252ececf545a1a6877e2183c6610ccb842e7))
- **planning:** hold a claim as a lease on the session that took it, `live`, `stale` or `unconfirmed`, so a stale claim is taken over without `force` and two sessions signing with one `author` no longer take each other's claims; `stale_claims` follow the lease, and starting an item under an unconfirmed or stale claim warns ([2d69b8c](https://github.com/Muratovnik/valkama/commit/2d69b8c3eeb3783c433e391d7663bca6c3d44da6), [fc9377f](https://github.com/Muratovnik/valkama/commit/fc9377f3d7c4a524183424bbbae40ba315ef6f84), [e1da308](https://github.com/Muratovnik/valkama/commit/e1da308abef802c8d57a55ecd4a596fecbc5c3cf))
- **hooks:** record client hook events from stdin straight into the store with `valkama hook <client> <event>`, spooling them when the store is busy, and report the spool and the last events in `doctor` ([f97a3fe](https://github.com/Muratovnik/valkama/commit/f97a3fe0e9a3945fc7c5d3589eff40a12bc7c7b8))
- **hooks:** archive session transcripts beside the store, keep them while an open item refers to the session and for 90 days after, and delete them on request with `valkama transcripts purge` ([c9552ad](https://github.com/Muratovnik/valkama/commit/c9552adacfe260949f5283ccdb023ae439d914bc), [6b83649](https://github.com/Muratovnik/valkama/commit/6b83649346cf4d5c9bf27f135dee8d71483eed03), [2a39072](https://github.com/Muratovnik/valkama/commit/2a3907283f31cf036c55d197ddd3676bd4298cb7))
- **planning:** add a task's discussion and grouped relations to the card ([2396304](https://github.com/Muratovnik/valkama/commit/2396304b118b1578cec346f031055aeeb88dc72c))
- **planning:** add the task finder and human input requests, the questions agents ask a person ([527ca4d](https://github.com/Muratovnik/valkama/commit/527ca4df400485bf9b63daafa49ef46938025d17))
- **planning:** close work that is not needed, duplicated or superseded in a terminal Cancelled state, which a workflow still shaped like the earlier default gains ([07bd226](https://github.com/Muratovnik/valkama/commit/07bd226cfe0db12d5a092b356a71a10a419f60f3))
- **planning:** accept a confirmed session's write as evidence when an item moves to Review ([d09233f](https://github.com/Muratovnik/valkama/commit/d09233f73ac9ebebd3a9d02537d663b06e1bb92f))

### Bug Fixes

- **http:** give the browser session token only to a same-origin browser fetch, so another local process can no longer obtain it and write as the owner ([5dfeef3](https://github.com/Muratovnik/valkama/commit/5dfeef31155f15ef26a7ff26a870bf03cefa3a63))
- **export:** export every work item, where it stopped at 1000 per space, and write the export to a file or for chosen spaces with `--output` and `--space` ([f909713](https://github.com/Muratovnik/valkama/commit/f9097133a801d0d26d41ac9e719c38bb3a70bb89))
- **planning:** page work item lists with `offset` and `next_offset` instead of cutting them silently at 1000, or 200 for a search ([2cfba45](https://github.com/Muratovnik/valkama/commit/2cfba450c66fcc172957ba3c22877d877b2ab252))
- **planning:** keep every work item of a space with more than 1000 items in the board, the list, the graph and the queues ([9ff41d3](https://github.com/Muratovnik/valkama/commit/9ff41d304c6088a16e76cf6cbc5abc35d1de9459))
- **launcher:** answer a hook with silence when the pinned release has no hooks, so a rollback cannot block every prompt in Claude Code ([8b09bbc](https://github.com/Muratovnik/valkama/commit/8b09bbcc11c84ed6d646a74196830088e7ae2180))
- **store:** set aside an unreadable reusable snapshot as `*.unverified` instead of failing every open ([94f0b41](https://github.com/Muratovnik/valkama/commit/94f0b410e1f9ee497214bbec4bb306cc3238f0b7))
- **federation:** skip an attached scope that cannot be searched and name it, instead of failing the whole search ([ecf7888](https://github.com/Muratovnik/valkama/commit/ecf7888fd413c862ba5a5d486ff178d8a17279c5))
- **launcher:** find a listener by its empty remote end, not its TCP state, so the desktop app starts on Windows builds that report `Closed` ([1546aa0](https://github.com/Muratovnik/valkama/commit/1546aa07a37cb16d974892058171fd724d09e175))
- **mcp:** warn about a stale build a few times, not on every tool result ([d73aff4](https://github.com/Muratovnik/valkama/commit/d73aff4bbb80f1242024d62ef717c19e16c00db1))
- **mcp:** answer a refused tool argument with its error code in `structuredContent` ([b8a8ee7](https://github.com/Muratovnik/valkama/commit/b8a8ee7ad45857406bb8d994c3dbd11f5a682f85))
- **planning:** sign a browser write that names no author as `user`, and check parents on a reparent ([5eacfba](https://github.com/Muratovnik/valkama/commit/5eacfba15e9a17d096bb6d351c04a591ee1de0a0))
- **store:** name the two ways out when a build older than the store refuses it: restart the client for the release the launcher pins, or pin a newer one ([2e772b1](https://github.com/Muratovnik/valkama/commit/2e772b1f1abd8800dea61d97dc7a62937e5dbcc6))
- **ui:** improve work discovery, planning updates and the graph's usability, and wrap filters and Settings controls in narrow windows ([c45fe2a](https://github.com/Muratovnik/valkama/commit/c45fe2a0e8566c9b7f1e6c35144b9c01d8548c69), [0af6a4f](https://github.com/Muratovnik/valkama/commit/0af6a4f3009821fd6cc7b55e303b46d9855f886d))

### Performance Improvements

- **store:** open a store that is already current without the full `PRAGMA integrity_check`, which still runs whenever an open migrates and on every snapshot and restore ([5a68928](https://github.com/Muratovnik/valkama/commit/5a689282d8fbd58f499df2da342a1f88a71696a2))

## [1.0.2](https://github.com/Muratovnik/valkama/releases/tag/v1.0.2) (2026-09-27)

### Highlights

- The first public release. There is no earlier public version to compare against, so
  this entry describes what the repository contains rather than what changed in it, and
  its lines link the commit that brought the product into this repository.
- The source archive contains the Python service and the built web UI. The Windows
  installer contains the desktop window; it uses the Python service and managed launcher
  installed from the source archive.

### Features

- **platform:** a local modular control surface for agent work, where Planning, Sessions, Analytics, Improvements, Skills, Memory and Settings share one Kernel vocabulary, a persisted module registry and normalized integration records ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **planning:** a Planning module agents use over MCP, with a Kanban view of six fixed columns, competing claims refused by `claim_work_item`, epics as parent work items and transition guards that refuse a move the workflow could not honestly report ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **planning:** an activity trace on every card — creations, moves, claims, takeovers, releases, checklist completions and link changes, each with its author — beside typed refs for commits, sessions and memory entries ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **planning:** checklists with stable ids that agents claim and complete one step at a time ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **web:** a live Planning UI in Vue 3, served from a committed build and updated over Server-Sent Events, in English and Russian, where a concurrent move is refused with a `409` naming who moved the card where ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **executions:** agent sessions launched from a Planning card, with an explicit delivery contract and an enforced JSON result schema; a process exit code is not taken as delivery, and resume works only against the client's own stored session identity ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **analytics:** a dashboard of flow, throughput, cycle, reopen and blocked figures that reports its coverage as `confirmed`, `inferred`, `partial` or `unknown` and never fabricates a duration across missing history ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **improvements:** a module for working through recurring failures, with its own database scope, a job supervisor and evaluation runs bound to canonical pack snapshots ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **platform:** a skills inventory over registered projects, and registry views for Modules, Adapters, Services, Connections and Assignments ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **projects:** local project registration owned by Valkama: the `projects` command adds existing roots, binds Planning spaces, publishes a fixed schema-v3 projection, can restore the preceding inventory and projection bytes, and imports an existing schema-1 TOML inventory on request ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **desktop:** an Electron desktop window and a Windows tray icon that appears while an agent holds a session, where a click always produces a visible outcome ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **mcp:** a dual-era MCP surface: one process serves revision 2026-07-28 and the `initialize` handshake it replaced, choosing from how the client opens ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **server:** two guards against version skew, `static_assets.SourceWatch` for a process that went stale while it ran and `store.STORE_SCHEMA_VERSION` for a build that was already old when it started ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **cli:** a CLI for the Planning lifecycle and product diagnostics: `serve`, `mcp`, `summary`, `runtime`, `export`, `migrate`, `attach`, `detach`, `scopes`, `purge-stream`, `config`, `setup`, `doctor`, `adapter`, `capabilities`, `status`, `launcher` and `projects` ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
- **store:** migration recovery points: migrations take clean SQLite snapshots before changing existing data, and the Board-to-Planning conversion is explicit, with `migrate planning-model --dry-run` converting a temporary copy first ([3816056](https://github.com/Muratovnik/valkama/commit/3816056d39c5a4e7f105647dc43133af9b0da3ad))
