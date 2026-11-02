# Changelog

Notable changes to Valkama. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The MCP server reports itself as `<release>+<build>`, where the build is a digest
over the modules the running process started with. Two servers from different
checkouts are therefore distinguishable even at the same version.

## [Unreleased]

### Added

- **A question is answered in the task's discussion.** It reads as a comment: one still
  waiting stands right under the comment form however old it is, and one that has ended
  takes its place by time, folded to its prompt with the reply under it. Selecting only
  selects and Send sends, the same for every kind of field; nothing is chosen for you,
  and a recommended option only says so. "Your own answer" is always there and stands in
  for what is required.
- **Options with long descriptions keep the choices in sight.** A description of one line
  stands under its label, a longer one shows its first words, past six described options
  only the labels stand, and each opens on its own press without selecting anything. What
  is chosen stands whole under the options and above Send, so nothing folded is sent
  unread, and choosing moves no row.
- **A mark in the card's facts** says a question is waiting and brings it into view from
  any section.
- **An agent reads an answer without reading the discussion.** `get_work_item` carries
  `questions`: `total`, `open`, up to 5 items with the open ones first and the newest
  closed after them, and `truncated`. An item names the question's start, its status and
  the answer with the labels chosen, with no options or descriptions.
  `list_work_item_requests` filters by item (`id`) and `answered_after`, and takes `full`.
- A question's options can carry a markdown `description` and be `recommended`. The fields
  of one question fit in 64 KiB.
- `answer_work_item_request` and the HTTP answer take a `note` of up to 8000 characters,
  which stands in for required fields, so a person can answer in their own words.
- `by_person` says whether an answer came through Valkama's interface. It is read from the
  call that wrote the answer, so no caller can set it.
- `search_work_items` finds an item by a question's text, answers and note, and a row found
  that way carries `question_hit`.
- An export carries every question in `planning.requests`.
- **A link to a work item opens in the desktop app.** On Windows with the app
  installed, `GET /open/MAIN-12` followed from outside a browser page, such as a link
  in an agent client's chat, starts the app on that card and answers a page that closes
  its own tab where the browser allows it, with a link to open the item in the browser
  instead (`?in=browser`). The app takes `--open-path=<card route>` at first start and
  on a second launch, and ignores any other shape; a window already showing Valkama
  moves without a reload, and asks first if a draft would be lost. Every other request keeps the
  redirect: a request made by any page, a prerender, a machine without the app, a
  listener on another port, a launch that fails. Reinstall the desktop app along with
  the server: an older build opens without moving to the card.
- **The editor's toolbar:** link a task, bold, italic, inline code, link and a
  bulleted list, on the selection or at the caret. Ctrl+B and Ctrl+I work on any
  keyboard layout, and Ctrl+Z takes back a toolbar action as it takes back typing.
  The link button writes a `#`, which opens the same list a typed one does; a `#`
  with nothing after it now offers what is being worked on in the space.

### Changed

- **A card's head scrolls with its content.** A slim bar stays above it with the
  item's identity, Back and Close, and the tabs stick to the top of the content.
  Once the big title has passed under the bar the bar shows the title in one line,
  and once the facts have gone the card's action stands beside Close. Reading down
  no longer moves anything but the text: the head had two layouts, flipped at the
  first scrolled pixel, and elements left and came back at once.
- **Going from a card to a card keeps the panel.** A link and Back change what the
  panel shows; the slide belongs to the first open and to the close. The new card's
  head waits for its read, so no half of it shows and then moves.
- **Closing plays.** A card slides out and its scrim fades, whichever way it closes,
  and a dialog toggled by its host closes the same way. Under reduced motion it goes
  at once.
- The facts stand in rows of one height, with the action level with the first row
  however they wrap. A takeover asks in the band under the bar, where a refusal
  stands, wherever its button was pressed.
- **A section with nothing in it is absent.** A card with no steps has no Checklist
  section until a step arrives. A failed read of the questions shows as a line over the
  discussion, because not knowing is not having none.
- "Needs my answer" shows the same form as the card, with "Send" and "Don't answer", and an
  answer given in a card lowers the count in the navigation at once.
- `list_work_item_requests` answers in a compact form by default; pass `full: true` for
  whole records. `get_work_item_request` adds `note` and `by_person`. The HTTP request reads
  add only `note`, and `answers` no longer shows a note among them.
- `merge_work_items` moves a merged item's questions to the survivor, where a pending one
  stays open, instead of closing them with the merged item. The warning now says they wait
  on the survivor.
- The store stays at schema 9. An earlier build opens it and its tools work, but its web
  interface reports it could not update the questions on a card holding a note or a
  described option, and for the waiting list while a pending question has a described
  option. Install the server and the web interface of this release together.
- **The board reads by its titles.** A title on a tile or a list row no longer stands
  in a heavier weight than everything around it, and a label is a quiet word instead
  of a chip. Short titles no longer sit in a taller box than they need, and a closed
  tile steps back.
- **An epic's row is one line** on the board, with its state only once it has moved.
- **«By epics» is a toggle like its neighbours,** beside the view switch. It keeps its
  word down to a phone, and pressing a toggle moves nothing beside it: the pressed
  state is a fill and a bar under the word, where a check used to widen the chip.
- **The work bar takes the phone's form earlier,** and a form between the two below
  a window of 996 px with the sidebar, so the search field stays wide enough to use.
- **A chain's section reaches its list sooner.** The groups are named once, the map's
  key gives their counts, a forecast shows only with a verdict, and the chart and the
  pace stand one action away.
- **The editor is one object.** A comment, a description, a new task's description
  and a text answer are written in one frame holding a toolbar, the text and, where
  the host has its own action, a foot with the hint or the reason a write was
  refused at its start and that action at its end. The switch between writing and
  preview moved into the toolbar, and a label a heading already says is gone from
  the eye and stays for a screen reader.
- **`rows` means something again.** A field starts at the lines it asks for (a
  comment at five), grows with its text to 60% of the window or 30 lines, and then
  scrolls inside. Fitting the box to its content had made the browser ignore
  `rows`, so every field started at two lines. The preview keeps the field's height,
  and coming back from it keeps the caret and the undo history.
- **A person writes comments.** The composer no longer offers a work report as a
  second kind of entry; reports are what agents publish, and they show in the
  discussion as before, with their action to make one the outcome. Closing a task
  with no outcome opens a form of its own, from the refusal that asks for it, with
  the two fields the server needs and a way back to the comment. Saving it carries
  the refused move on, and once that move is over the form only saves.

### Removed

- The card's "Questions and decisions" section. A question stands in the discussion.

### Fixed

- **A press on the board no longer crashes the tab.** Chromium 156 crashes the renderer on
  a press that takes focus out of a `content-visibility: auto` element just back in view,
  in Chrome and in the desktop app. A tile out of sight is now laid out like any other, and
  a press on one just back in view reaches it. A lane still skips its layout, which a space
  of many lanes needs, and keeps the focus of a press inside it.
- **A double click on a tile leaves its card open.** The second press reached the scrim that
  had just appeared, and closed the card as it arrived.
- **The keys that read work as soon as a card opens.** PageDown, PageUp, Home, End and the
  arrows scroll a card just opened, by address or from the board, and from its top bar; they
  did nothing until focus reached a control inside it. No ring appears on Close, and the
  dialog's name is still read.
- **Walking a card's stuck sections from the keyboard keeps the place.** Tab and Shift+Tab
  along the sections moved the card up half a window at each step, and four steps unfolded
  the head again.
- **Back does not wait long for a slow chain.** A chain that was slow or never answered left
  an empty panel with no sign of waiting. The card now shows after about what a normal read
  takes, as far down as it can go, and a chain that answers later moves it once to its place,
  unless the reader has scrolled, pressed or typed by then.
- **Back lands once.** The place landed and then moved 20 px, because the chain's map first
  laid out at a guessed width.
- **A press while a drawer or dialog leaves lands on nothing.** A double click on Close opened
  whatever stood under it, and one on the scrim over a tile opened that tile's card. The first
  press after the leave reaches the page.
- Retrying a failed read keeps focus in the card, while it waits and whatever the answer. It
  fell to the page, and Tab then left the card.
- A pressed chip is plain in forced colors, in light and dark palettes. Its bar kept the
  theme's ink, nearly invisible in a light palette; the chip now takes the palette's highlight
  pair.
- Escape from a card opened by a press on a tile's mark leaves no ring around the whole board.
- A task whose description is longer than 8192 characters opens again. The service
  stores 20,000, and the web client refused to read anything over 8192, so such a
  task showed a message about this build instead of its card.
- A task with a long discussion opens again, up to 1 MiB of card. The web client
  refused any answer over 256 KiB, and the service does not limit a discussion.
- Going back to Overview from another section, and Shift+Tab into the tabs, keep the
  reader's place. A section went to the top with the tabs leaving from under the pointer.
- A card opened by its address draws no focus ring on Close: the dialog holds focus
  until the first input, and the first Tab reaches its first control.
- A card with no epic no longer keeps an empty row for it among the facts.
- A checklist step's text stands level with its box and the line naming who holds or
  closed it right under that text. The box stayed 40 px tall in a row of 28.
- A holder signed as `name session <id>` with no brackets is shortened as a holder
  signed `name (session <id>)` is, on the card, the board and the chain, with the
  whole value in the card's tooltip.
- The list of tasks closes when focus leaves the field.
- Choosing a task from the list no longer clears the field's undo history.
- Editing a long description opens with the toolbar and the start of the text in
  view, where the card's own scroller used to run to the end of the text.
- The editor's marks go after a list item's marker, so the line stays a list. A mark around
  a whole selection, on one line or several, comes off as one, and a mark over words that
  already carry it replaces it.
- An outcome stepped back from is kept and asked about before it goes, where closing
  the card dropped it with no question.
- Focus stays in the card after a takeover, after an outcome is sent and after sending
  or saving from the editor by its button, where it used to fall to the page.
- A comment and a new task's description reach the server as they were typed; the
  web client no longer trims them first.
- «Go to the checklist» from another section brings the checklist into view.
- On a phone the list's sort choice shows its whole name, and the Memory section's
  search button stands level with its field.

## [2.3.0](https://github.com/Muratovnik/valkama/compare/v2.2.0...v2.3.0) - 2026-11-02

### Added

- **Agents on the card.** The Overview of a work item lists the Claude Code agents
  on it: what each was started for, the step it holds, when it started, its last
  sign of activity and the time between, and how it is known to be there. An agent
  is on the item when it wrote there or holds a step, or when the session that
  started it held the item at that moment; a session holding several items puts it
  on each and the row says how many, unless the agent wrote to some item, which
  places it there alone. An agent whose parent held nothing and that wrote nothing
  is on no card. The list updates on its own through the existing event stream.
  While an agent has no recorded end, its last activity also takes the time its
  transcript file was last written, read when the card is read; the file's content
  is never read. The section is absent while no agent is on the item, and a long
  list folds to the three most recent.
- **`valkama hook claude post-tool-use`** names an agent from the call that started
  it, reading only the short description of that call and the agent's id from one
  hook input, never its prompt. Register it for `PostToolUse` with the matcher
  `^(Agent|Task)$`. Without it, and for every agent recorded earlier, a row shows the
  agent's type and short id. The label stays out of the append-only history, the
  installation export, `doctor` and logs, and MCP tool answers do not change.
- **A work item has a short address**: `GET /open/MAIN-12` opens its card in the
  web UI, in any case and from any space a project binds, by redirecting to the
  card's own route, so the address bar, Reload and Back behave as usual. A number
  nobody filed, a key no project binds, an address that names no number and a store
  that cannot answer each get a page saying so in the interface's language, with
  the next step; a retry that fails again leaves keyboard focus on Retry. The route
  obeys the loopback rules of every other, and only ever redirects to a card on this
  origin.
- **`url` in MCP answers.** A work item's full record and every write
  acknowledgement carry the address as `url`. This is an addition: list and search
  rows, tool schemas and the HTTP records are unchanged.
- **`serve --on-demand` and `launcher autostart`.** A listener can hold the port from
  login with no part of the server loaded, which costs about 15 MB instead of about
  40 MB, and become the server on the first connection, in the same process and on
  the same socket, so the address of a work item works without starting anything. On
  Windows `launcher autostart enable|disable|status` keeps it in the current user's
  Run key; it is off until enabled and `doctor` shows it. A busy port is retried
  every 30 seconds, a server that cannot load answers with a page and logs why, and
  `launcher install` restarts such a listener from the new release.
- **`valkama released --space KEY --repo PATH --range A..B`** lists the open
  work items whose commit refs went into a release range, so work that shipped
  can be found while it still reads as open. A ref holds the hash from the branch
  the work was done on, and integrating that branch rewrites it, so each ref is
  compared in steps and the answer names the step: `hash`, `patch-id` for the
  same change under another hash, and two weak matches, `changed-patch` for a
  commit outside the range whose subject a commit in the range has with another
  patch, and `subject` for an object that is gone but whose label has the subject
  of a commit in the range. Each item says how many of its commit refs match, so
  partly released work reads as such. It is a hint to check by hand: it opens the
  store read-only and changes no state, and an item with no commit ref cannot show.
  The server's tools are unchanged.
- **`get_work_item` takes `comments_after`**, and the HTTP read the same parameter:
  every comment after that id and none before it. An item with a long history
  offered only the newest five comments or everything at once, and everything
  could be too long for a tool answer to carry.

### Changed

- **A client restart no longer costs a session its claims.** A restart ends the
  session and resumes it under the same id seconds later, and any server started
  in between released all of its claims and put its work back in the queue. Now
  an ended session keeps its claims for 12 hours after its end. A server start
  and `claim_ready_work_item` leave them alone until then, and the session coming
  back makes them `live` again with no write. The claim reads `stale` meanwhile,
  so the board marks it and `claim_work_item` from anyone else still takes it at
  once without `force`. A `failed` session, and an end with no time recorded, get
  no such wait. The price is that work of a session that really is gone reaches
  the take-next queue up to 12 hours later.
- **The history says why a claim was released.** A release by Valkama now reads
  `session-ended: <holder>`, `session-missing: <holder>` or, for a session quiet
  for 14 days, `lease-expired: <holder>`, and the move back to the queue carries
  the same reason (`todo: session-ended`). All three used to read
  `lease-expired`, and the records already written stay as they are. See
  [Claims are leases](docs/connection-contract.md#claims-are-leases).
- **Agents link the numbers they write to the owner.** The skill and the server's
  instructions say to write a number as a markdown link in a message to the owner,
  and not in a Valkama comment or description, where the UI links numbers itself.
- The server's instructions are tightened from 4397 to about 4040 characters
  without dropping a rule. Claude Code 2.1.314 cuts them at 4096, so their last
  rules were not reaching its sessions; a test now holds them under that limit.

### Fixed

- A tile dragged quickly and let go over a column or a lane's cell lands there.
  The drop library reads the pointer every 50ms, so a release between two
  readings put the tile in the column the pointer had only passed. Let go over a
  column's header, it lands on top of that column.
- `launcher install` reaches the tray icon too. It is a process of one release,
  and it stayed on the release its session started from, so a click ran the old
  script until the client restarted. The session now restarts it from the release
  it has switched to, once the switch has succeeded; if the new tray will not
  start, the working icon stays, and an icon hidden from its menu stays hidden.
  This needs a session started on this release or later, so sessions already open
  keep their icon until they restart.
- Adopting a store written under an earlier product name, and `launcher install`
  pinning a release, wait about a second when Windows refuses a rename with access
  denied or a sharing violation, which is what it answers while a scanner or an
  indexer has just opened a file there. Adoption used to refuse at once and ask the
  operator to close something they had no way to find, and an install could fail
  and have to be repeated. A holder that does not let go gets that refusal, and any
  other failure gets it straight away.
- A state panel with its buttons in a narrow column no longer squeezes its message
  into a few letters wide: on a phone the buttons take their own row.

## [2.2.0](https://github.com/Muratovnik/valkama/compare/v2.1.0...v2.2.0) - 2026-11-02

The bold entries at the top of **Changed** alter what existing MCP and HTTP
calls return; an agent or integration written for 2.1.0 should read them first.
The store is unchanged at schema 9, so the upgrade runs no migration, and the
server lists the same 31 tools with the same schemas.

### Added

- **One Work filter** above the board, the list and the graph, in one row of
  controls with the view switch, the board's «By epic» switch and «New work
  item». One field matches a reference or a title and, as it is typed,
  searches the «Filter» menu of facet values: state, kind, priority, label and
  holder. The «Workable» and «Assigned» quick filters stand beside it, and the
  picked values show as removable chips on the line beneath, beside counts
  that answer the filter («12 of 42 open · Reset»), on the board by epic also
  how many epics stand as rows, and closed matches only when no open work
  matches. Facets combine with AND and
  the values of one facet with OR, except labels, which an item must all carry.
  `/` focuses the field; Escape closes the menu, then clears the text, then
  leaves, one step per press. It replaces the queue (All, Ready, Assigned, Blocked,
  Review) and the search field, neither of which reached the address. The
  filter does, through the Planning route keys `ready`, `held`, `cat`, `kind`,
  `pri`, `labels` and `holder` beside the text in `query`, which the Planning
  manifest (`GET /api/modules`, `list_platform_modules`) now admits: a reload
  or Back keeps it, an address too short for the whole filter says so, and
  switching space clears it.
- **Markdown in free text.** Descriptions, comments, work reports, summaries,
  questions and their answers, attempt results, activity details, ref labels
  and checklist steps are drawn as markdown — paragraphs, lists, code, links,
  emphasis, quotes and tables — and a single line break stays one. Raw HTML
  stays the text it was, an image becomes a link to it, and a link keeps only
  an `http`, `https` or `mailto` address and opens outside the app. A reference
  in the text links where it resolves: a task of the open space or of another
  known space, a session the server knows, a commit or memory id the card
  carries as a ref; anything else stays text. Pressing a checklist step's text
  still ticks it, and pressing a reference in it opens that card instead. A long
  text ends on its last whole line and opens when a link below the cut takes
  focus.
- **A markdown editor** writes a card's description, a comment or work report,
  a new task's description and a text answer to a question: one Write | Preview
  switch, `#` and a number or a word to link a task of the space, and
  Ctrl+Enter to send. A question's answer offers no `#` suggestions; in the
  new-task dialog Ctrl+Enter is Create, held back until there is a title.

### Changed

- **A close ends the claims on the item.** A transition into a completed or
  cancelled state releases the item's claim and every step claim in the same
  write, through `transition_work_item`, the `transition` of
  `apply_work_item_changes`, the HTTP transition, the board and the card alike.
  The history records `released` (and `checklist_released`) after
  `transitioned`, and the answer names the holder it released as `released`, in
  `applied.transition` for a batch. Reopening restores no claim. A closed item
  still says who held it: item records, the view's items and the nodes of
  `GET /api/planning/graph` add `closed_at` and `last_claim_ref`, both `null`
  for open work, and the board, the list, the graph and the card print that
  holder as the previous one. A release sent after the close,
  as agents used to send one, still succeeds and leaves that holder named.
  See [A close ends the claims](docs/connection-contract.md#a-close-ends-the-claims).
- **A work item's links name the state of their other end.** Every link in the
  full record (`get_work_item`, `GET /api/planning/work-item`) adds
  `state_name`, `state_category` and `is_terminal` of the item at its other
  end, whichever space that item is in, so a finished blocker can be told from
  an open one without another read. When the store cannot resolve that state,
  the three are `null` and `state_unavailable` is `state_missing`: that end is
  unknown, never open. A record's links are read in one query, where each link
  cost two. See
  [What a link says about its other end](docs/connection-contract.md#what-a-link-says-about-its-other-end).
- **A space's view carries the blocks into it from other spaces.** Beside the
  links leaving the space, `links` in `GET /api/planning` and its live stream
  (`/api/events?view=planning`), and `edges` in `GET /api/planning/graph`, now
  hold every `blocks` link from another space into it, so a link's `from` can
  name an item that the view's `work_items` or `nodes` do not hold. Every link
  in the view, and every graph edge but `parent`, names its source: `reference`,
  `state_name`, `state_category`, `is_terminal` and `state_unavailable`, read as
  above. A reader that looked `from` up among the space's items reads these
  instead. A graph node's `depth` counts an open blocker in another space, and
  no blocker whose state is finished or unknown. See
  [What a link says about its other end](docs/connection-contract.md#what-a-link-says-about-its-other-end).
- **A chain's edges include the blocks from outside the chain.** `edges` in
  `GET /api/planning/work-item/chain` now hold every `blocks` link into the
  root or a member wherever its source lives, in another space or in the same
  space outside the chain, so `from` need not be a member; `discovered-from`
  edges still join two members. Every edge names its source as a space view's
  link does, and a source whose state cannot be read blocks nothing. See
  [Reading a chain of work](docs/connection-contract.md#reading-a-chain-of-work).
- **The cross-project search marks its results.** Each result's `item` in
  `GET /api/modules/planning/search` adds `kind` and `priority`, and its
  `state` adds `category` and `is_terminal`, as described in
  [What a link says about its other end](docs/connection-contract.md#what-a-link-says-about-its-other-end).
- **`GET /api/ref` looks a commit up in every registered project.** It asks, in
  order, the registered project a value names (`name@abc1234` or
  `name abc1234`, the name matched against a project's id or directory name,
  ignoring case), the project the registry binds the card's planning space to
  (the new optional `space`, that space's exact identity; any other value is
  refused with `400`), the configured document roots, then every other
  registered project, and shows the commit from the first that has it. It used
  to ask the document roots alone and hand a named value to git whole, so most
  commits read as not found. Git's own `@{…}` stays part of the revision, a
  linked worktree counts as a repository, and every directory still comes from
  the owner's configuration. See also **Security**.
- A work item's facts read one way on the board, the list, the graph, the card
  and the task finder, and only the exceptions print: a priority glyph when the
  priority is not medium (on the graph and in the finder, only high and
  urgent), a kind glyph when the item is not a plain task, and of readiness
  only the open blocker an item waits on, «Waiting on MAIN-12». The word
  «workable» no longer stands on nearly every tile and chain member; the list's
  Assignee column says «—» for nobody where it said workable, and the graph
  says workable quietly in place of the state. The list leads each reference with
  the priority and kind glyphs in two fixed slots, so references align, keeps
  medium as a quiet word in its Priority column and, from 900px, shows labels
  under the title. A graph node shows its state as a dot and a name. A finder
  result reads its glyphs, reference, title, state and project on one line, on
  two on a phone. The list's glyphs and the label chips of the board and the
  list are filter buttons outside the Tab order, and a second press takes the
  value out again; the card's label chips filter too. The glyphs of a board tile
  and a graph node are read, and a press on them opens the card, as a press on
  the rest of the tile or node does. The finder's marks are read, not pressed.
- A board tile's first line holds those glyphs, the reference and, at its end,
  only what stops the work: the blocker it waits on, as the waiting glyph and
  that blocker's reference with «Waiting on MAIN-12» as its name and hover
  text, or a stale claim. The line never wraps; a mark short of room keeps its
  glyph and gives its words on hover. The title holds at most three lines, the
  whole of it on hover. The labels keep one line, as many whole chips as fit up
  to three, then «+N», which opens the card, and a chip stays visible on a
  hovered tile or list row. The holder and the steps print only when there are
  any.
- The board's Done column stands the most recently closed work first. Its order
  is no longer arranged by hand: a tile does not move within Done, by drag or
  by Alt+arrow, and a tile dropped on Done from another column closes and
  stands on top. The Cancelled column keeps its manual order.
- The card's head reads who the item is, what holds for it, then what to do.
  Above the title, one line names the kind, the reference (pressing it copies
  it), when the item last changed and its plan anchor as an icon, whose full
  path moves to Relations. Under the title, one line of facts: the state, whose
  chip is the menu that moves the item, so the state is said once and a refused
  move leaves it naming where the item is; the priority with its glyph; the
  holder, with the lease on hover and a warning dot once it is stale; and the
  epic. One action ends that line, or stands under the labels on a narrow
  drawer — «Claim», «Release» on the browser's own claim, «Take over» on
  another's — and where the facts argue against taking the item, the reason
  stands there instead: «Waiting on MAIN-12», or «Epic — take a task from it».
  The labels follow as chips. Each relation row shows the other end's state as
  a dot and a name.
- The card's head gives its room to the text at the first scroll of its body,
  where it used to wait until the text had been read past the head's height,
  and it comes back whole only at the very top. The text glides up into that
  room, or moves at once with reduced motion, and a card that scrolls only a
  little condenses too. This withdraws 2.1.0's rule that the text under the eye
  moved only by the distance scrolled.
- The graph's camera is the operator's. A refresh never moves it, and a filter
  change, a switch or a resize no longer reframes it, which withdraws 2.1.0's
  rule that a new queue or search framed the field afresh. It moves when
  another scope opens, on «Fit whole graph», and, when a narrowing or a resize
  leaves no drawn node in sight, only across, at the zoom the operator chose.
  Leaving the graph and coming back to the same scope finds the camera where
  it was left.
- The workspace's tones are measured as contrast: every pair of grounds that
  stand side by side is at least 1.15:1 apart, where seams stood at 1.08–1.13:1,
  and the secondary text tones and the red hold 4.5:1 on a hovered card. The
  frame around the workspace sinks to near-black so the panel reads as a panel;
  a pointed-at card, a control and its hover, and the rail's pointed-at and
  chosen rows each stand a visible step apart. Each hue
  on a work item means one thing on the board, the list, the graph and the
  chain map: in progress and held work are blue, where in progress was the
  green of done; done is green; the queue and workable carry no colour. A
  switch that is on, a checked box and a chosen option are neutral rather than
  green; a done checklist step keeps its green.
- The context bar no longer prints a sentence describing each module under its
  name, so the header is one row.
- The desktop app opens its window at once, on a starting page in the
  workspace's palette and language, and finds or starts the server behind it;
  when it cannot, the same window says why, with the remedy and «Try again». A
  managed server that is out of date is no longer restarted unasked: the window
  says whether the front end or the server code changed and offers «Restart the
  server». A listener the launcher cannot prove its own is never stopped. Each
  step of opening the window is logged, with its time, to
  `%TEMP%\valkama-desktop.log`.
- With the desktop app installed, a click on the tray icon starts the app and
  leaves every decision to it, so the tray no longer offers to restart the
  server the app has just started. Without the app, the tray decides off the
  icon's thread, takes a double click or a click queued behind a dialog as one
  click, and logs each click to `%TEMP%\valkama-tray.log`.
- The launcher answers `runtime`, `launcher status` and `launcher listener
  status` without loading the whole command line, and on Windows reads who
  listens on a port from the system instead of through PowerShell, so the tray
  and the app reach a window sooner. What the commands print is unchanged.
- A long list shows its first screen at once and fills in the rest right after,
  with its columns already at their final width; until the rest arrive, a scroll
  stops at the last row drawn. The whole list of about 1,200 rows finishes
  painting later than in 2.1.0, by about 1.4 to 2 times.
- A board tile out of sight is not laid out until it is reached. A tile and a list
  row draw about twice the elements they did in 2.1.0, and the board's first tile
  comes some 20 to 130 ms later.
- For contributors: `npm run typecheck`, and with it `npm run build`, now
  type-check every file under `web/tests/`, so a spec that calls a helper that
  does not exist, or builds a fixture of the wrong shape, fails the gate rather
  than only the run that reaches it.

### Fixed

- The card lists only blockers that are still open. An item whose blocker had
  finished, in any space, read as blocked there while its tile said it could be
  taken; a blocker whose state is unknown stays listed.
- An item blocked by open work in another space, and a chain member blocked by
  work outside its chain, now name that blocker on the board, the list, the
  graph and the card's chain, where nothing said why the item was not
  workable; a finished one makes nothing wait.
- The graph no longer jumps when it is laid out again: its status took a line
  above the drawing on every refresh. It now stands in the strip above the
  field and, over a drawing, says nothing until a layout has run for 600ms. The
  card's attempts and the project directory keep what they show while they
  read it again, instead of a loading line.
- A Work read that failed with no error envelope (an empty 500, a 502 page, a
  body that is not JSON) reads «The local service did not complete the
  request.» instead of printing `unavailable` as the technical code; an
  `unavailable` answer with no UI state reads as a missing record on 404 and as
  an unavailable dependency otherwise.
- A hovered primary button no longer turns the base grey under its dark label,
  the look of a disabled one: each variant keeps its own fill and label when
  hovered, one step further from the ground, and every variant is disabled the
  same way. Controls whose hover drew nothing now step up, and a hovered danger
  label stays legible.
- On the board grouped by epic, an empty cell no longer draws a grey box for
  each state its lane has no work in; it keeps its place and draws its ground
  only while a tile of its lane is dragged.
- A checklist step's «Discuss step» button is named by the step's words rather
  than its markdown, so a screen reader no longer reads out its backticks.
- On Windows a second server could bind a port another one was listening on,
  so two answered on one port and the desktop app or the tray took the other's
  identity for its own child's. A server that cannot own its port now exits,
  and a port whose listener closed can still be bound at once.
- A number alone puts the item with that number first, as a whole reference
  already did: `search_work_items` and `GET /api/planning/search` with a space
  answer `12` with that space's item 12 ahead of every item that only mentions
  it, and without a space each space's item 12 leads; the task finder and
  `GET /api/search` lift them across sources. A page cut short no longer drops
  the item named.
- Losing the local service no longer pushes the board, the list or the graph
  down with a notice above them. The rail's connection control says it
  instead, and that Valkama reconnects by itself and shows what it last
  received meanwhile; on a narrow rail, where only its dot shows, pressing the
  dot opens that sentence with «Refresh», and Escape closes it. A card or a view read while the service is down says
  there is no connection rather than that it could not be loaded.

### Security

- `GET /api/ref` hands git a commit revision and nothing else. A value that
  begins with `-` is answered `resolved: false` without running git — one such
  as `--output=<path>` was read as an option and made git write a file — the
  options end before the revision, and the lookup is held to commits, so
  `rev:path` no longer prints a file out of a repository.

## [2.1.0](https://github.com/Muratovnik/valkama/compare/v2.0.0...v2.1.0) - 2026-11-01

The bold entries at the top of **Changed** alter what existing MCP and HTTP
calls do; an agent or integration written for 2.0.0 should read them first. The
store is unchanged at schema 9, so the upgrade runs no migration.

### Added

- **A chain of work**: what one item's work grew into, and whether it
  converges. Scope `epic` is the root's children; scope `chain`, the default,
  adds every item linked `discovered-from` the root or a member and every child
  of a member, walking downward only. `GET /api/planning/work-item/chain` and
  the MCP tool `get_work_item_chain` answer with the counts (total, closed,
  open, ready, per category), the members grouped by parent, a per-day series
  of created and closed members, and whether the last seven UTC days were
  `growing`, `converging` or `steady`. The HTTP read adds every member, with
  its `rank` in the order of work, and the `blocks` and `discovered-from` links
  among them; the tool adds the open members as paged rows, active first. See
  [Reading a chain of work](docs/connection-contract.md#reading-a-chain-of-work).
- `list_work_items` and `GET /api/planning/work-items` take `parent`, and then
  list only that item's children.
- The work item card shows the item's chain. A branch map leads it: one lane
  per origin of the work (the root's own children, each other epic, the work
  under no epic), branching off the task it was discovered from, one segment
  per member, coloured by progress. A segment names and opens its task, a lane
  label narrows the member list to that lane, and each lane is one keyboard
  stop. Below it, one line counts the work under the root, and the next turns
  the last seven days into a forecast: «At this pace the open work closes in
  about 9 days (by Nov 9)», or how much must close a day to converge. A chart
  of scope against done work and the members by state follow, the finished
  ones folded. The key, the counts and the headings name a group alike: by the
  state all its members share, as the board's column does, or by its own word.
- A chain narrows every view. «Show on graph» closes the card and moves focus to
  the graph, opened on the chain's open part (the root, marked «root», the open
  members and every member that is the parent of another), framed on any branch
  the map chose, with a «Closed · N» switch for the rest; an epic lane's Chain
  action narrows Kanban and List to it. Chips leave the chain and the branch; a
  reload or a shared link keeps both, through the Planning route keys `chain`,
  `chain_scope`, `closed` and `branch`. A link to a chain this space cannot show
  is answered with the whole space and a notice; a chain whose read fails stays
  in the address and offers Retry, unless the item does not exist.
- An order of work that agents and the board share. `update_work_item`,
  `transition_work_item`, the `transition` group of `apply_work_item_changes`
  and their HTTP writes take `rank`: `first`, `last`, `before:<item>` or
  `after:<item>`, a place among the items of the state. Lists follow that
  order, and so does `claim_ready_work_item` (see Changed). On the board, drag
  a tile within its column, or press Alt+↑ or Alt+↓ on it. The order is the
  existing `position`, so an earlier build reads it too. See
  [The order of work](docs/connection-contract.md#the-order-of-work).
- The board can be grouped by epic (route key `group`): one lane per epic, with
  its counts, a fold and actions to open its card or narrow the board to its
  chain, and work under no epic last. A lane's heading stays in view while its
  lane is, and names its open work in columns scrolled out of sight; a cell
  shows three tiles and «Show all · N». A lane with nothing open starts folded,
  and its Done and Cancelled cells show only a count until opened. A reorder in
  a lane says for a moment that the order is the whole board's, one per state.
- `merge_work_items` (`POST /api/planning/work-item/merge`) folds 1 to 20 items
  that are one change into the one that survives, all or nothing: their steps
  (with ids, ticks and step claims), discussion, refs and links move to it, and
  each merged item is linked `duplicates`, summarized and closed as cancelled.
  An item another session holds needs `force`. See
  [Merging items that are one change](docs/connection-contract.md#merging-items-that-are-one-change).
- `create_work_item` and `POST /api/planning/work-items` take `claim`,
  `checklist` and `links`, applied in the creation's transaction; a refused
  step creates nothing. `apply_work_item_changes` takes a `checklist` group too.
  A step sent as `{text, done: true}`, there or to `set_work_item_checklist`,
  is recorded as the caller's tick, so one call can set done steps, the summary
  and the closing transition. See
  [Creating an item with its claim, steps and links](docs/connection-contract.md#creating-an-item-with-its-claim-steps-and-links).
- A write that names a state reads a category (`active`, `review`, `blocked`,
  `completed`, `cancelled`, `queued`, `backlog`) as the one state that has it;
  a key still wins. A name the workflow lacks is refused listing every state as
  `key (category)`. See
  [Naming a state](docs/connection-contract.md#naming-a-state).
- A Valkama skill, `server/skill/valkama`: the procedure an agent follows
  around the planning tools. `valkama skill install | status | uninstall`
  (`--client claude|codex`, `--force`) writes it where Claude Code
  (`~/.claude/skills/valkama`, or under `$CLAUDE_CONFIG_DIR`) and Codex
  (`~/.agents/skills/valkama`) find a user's skills, from the pinned release,
  without touching either client's configuration; an edited or foreign copy
  needs `--force`. `launcher install` refreshes the unedited copies Valkama
  manages but installs none, and `valkama doctor` reports each one. See
  [Install the skill](SERVICE.md#install-the-skill).

### Changed

- **A claim starts the work it takes.** Claiming an item in a `backlog` or
  `queued` state, by any route (`claim_work_item`, `claim_ready_work_item`, the
  `claim` of `create_work_item` and `apply_work_item_changes`, HTTP, the
  browser, a launch), also moves it to the first reachable `active` state: one
  more `transitioned` event (`dev: claimed`) and one more revision. The answer
  adds `started: {from, to}`. Review, blocked, active and finished items stay
  where they are, and an item that can reach no active state is claimed in
  place with a warning; a launch used to fail on such an item. An agent no
  longer needs its own transition to the active state after a claim (one sent
  anyway is a move within one state, with one more event), and takes the next
  `expected_revision` from the claim's answer. See
  [A claim starts the work](docs/connection-contract.md#a-claim-starts-the-work).
- **A release puts work under way back in the queue.** Releasing an `active`
  item, by its holder, with `force` or by lease expiry, moves it to the first
  reachable `queued` state, or else the backlog (`todo: released`,
  `todo: lease-expired`), unless one of its steps is still claimed. The answer
  adds `requeued: {from, to}`.
- **A confirmed session holds its claims and steps.** When the client proved
  the call's session, `claim_ref`, `claimed_by` and `done_by` read
  `codex (session <id>)` or `claude (session <id>)`, and
  `claude agent <id> (session <id>)` (or `codex agent …`) in a subagent,
  whatever `author` the call signs with, so two sessions signing with one name
  hold separately; other calls still hold by `author`. `list_work_items` with
  `owner` matches the holder exactly, so pass the `claim_ref` the claim
  returned. The web prints such a holder as `codex · 019a3c2e-5b7d`. See
  [Who holds a claim or a step](docs/connection-contract.md#who-holds-a-claim-or-a-step).
- **A checklist write keeps the steps it repeats.** A step sent with the text
  (or `id`) of an existing one keeps its `item_id`, claim and tick, where it
  used to get a new `item_id` and lose its state; steps are appended without
  `force`. Leaving out a claimed or completed step is refused, naming it, and
  `force` discards only the steps left out.
- **A work item that does not exist is `not_found` (404)**, where it was
  `invalid_request` (400): the item named, a `parent`, the other end of a link,
  or a step of a batch, which keeps its `step`. A malformed reference is still
  `invalid_request`.
- **Acknowledgements carry more.** `claim_work_item` adds `started`,
  `requeued` and `warnings` when there are any; `create_work_item` and
  `apply_work_item_changes` add `started` and their claim's `warnings`;
  `create_work_item` adds `applied` when it took `claim`, `checklist` or
  `links`; the `checklist` of `set_work_item_checklist` gives each step's
  `done`. See [Tool results](docs/connection-contract.md#tool-results).
- **The server lists 31 tools, up from 29**: `get_work_item_chain` and
  `merge_work_items` are new.
- **`claim_ready_work_item` takes the first ready item in the order of work**,
  a `queued` state before a `backlog` one. Priority only breaks a tie, so an
  urgent item nobody placed waits its turn.
- **A source the search skipped names why.** The coverage `reason` of
  `GET /api/modules/planning/search` is `store_not_attached`,
  `store_unreadable`, `attached_list_unreadable`, `space_missing`,
  `binding_conflict` or `search_failed`, where it was `source_unavailable`; the
  request list across projects (`GET /api/modules/planning/requests`) names the
  same reasons for a source it skips.
- `launcher install` reaches running sessions. The launcher's `mcp` is now a
  stdio front that keeps the client's pipe and, seconds after an install,
  switches the server behind it to the new release between two requests. It
  tells a client that can hear it when the tool list changed: Claude Code's CLI
  (2.1.304) lists the tools again; Codex does so only with its
  `mcp_tool_list_changed` feature, off by default, though its calls reach the
  new release either way. A release that does not start leaves the session on
  its old one, with a warning. An install that raises the store schema
  therefore migrates the store through the first session that switches, or,
  with none running, when the next session opens it. A session started before
  the front still warns until restarted. See
  [A release switch under a running session](docs/connection-contract.md#a-release-switch-under-a-running-session).
- The desktop app is built on Electron 45 (Chromium 156), up from Electron 43.
- The board: finished columns stand last, so Blocked reads before Done; the
  columns that fit share the width; a large space regroups without stalling.
  The list gives titles the spare width and, on a narrow window, folds State,
  Priority and Assignee, then Steps and Updated, under the title, whose heading
  keeps their sort; at phone width the heading stays one line. A click anywhere
  in a list row opens its card. A board column and the list's rows are each one
  Tab stop, walked with the arrow keys, Home and End; Page Up and Page Down move
  through the list a screen at a time.
- The bar above the board, list and graph is two compact rows, its queue
  folding into a menu when the row is full. Every count above the stage counts
  the same items, the chain with its root or the whole space, and a view that
  leaves items out of its counts says so on a line of its own.
- The whole-space graph leaves out items no drawn link touches, with an
  «Unlinked · N» switch. The key and the camera controls stand in strips above
  and below the drawing, never over a node, and on a chain the key names groups
  as the card does. The graph opens with its work in view — whole where it
  reads, else from its first item at the top-left — and a new queue or search
  frames it afresh; the «Focus work» control is gone. The nodes are one Tab
  stop, walked by the arrow keys with the camera following. Zoomed out, a node
  is a block of its state's colour; at phone width the bar and the camera
  controls are one row each.
- The card's head pins only the title and the sections and condenses while the
  body is read, with Back beside Close; the sections wrap on a phone. Back
  reopens the parent card where it was read, with focus on the entry opened.
- The questions dialog keeps focus after an answer, a refused answer or a
  failed refresh, and counts only questions still waiting, as the rail does
  («2+» when the count is incomplete, «?» when it could not be read). Yes/No
  and short choices are radio buttons, a refused field says why at the field,
  and projects are named by title.
- The graph and Settings download on demand, and the libraries ship as a
  `vendor` chunk that keeps its hash across releases. A failed download shows
  «Could not load this view» with Retry.
- A shell notice can be dismissed; the Settings subtitle names only its
  sections; a text action rests on the control fill, so it reads as a control.

### Fixed

- A search whose query is exactly a work-item reference, such as `MAIN-12`,
  answers that item first in `search_work_items`, `GET /api/planning/search`,
  the task finder's search and `GET /api/search`. It used to come after every
  newer item that mentioned it, and a full page could leave it out.
- The task finder opens the first result on Enter as soon as results show, or
  says a typed task reference was not found rather than open a task that
  mentions it; it names each skipped project and space with the reason above
  the results and stays at the top of the window as results arrive.
- A board move the server refused no longer leaves the tile where it was
  dropped, and a move sends the revision it read, so one made after an agent
  changed the item is refused with `409` instead of overwriting it. A search on
  the board no longer hides that an item is blocked.
- The rail names each entry by what it shows, so a screen reader hears a
  module's count and the questions waiting. The finder shortcut prints as
  «Ctrl K»; its «⌘» made every first screen download a fallback font.
- An address that names no page opens the app with «Section not found» and
  status 404, marks no section current and is not reopened next time; a card
  for an item that does not exist or was deleted says only that, with no Retry.
  Unreadable view settings in an address are reset with a notice, a missing
  project is named in the scope selector and lists the projects that exist, and
  a route a module cannot open says so naming the module once.
- Escape closes the top dialog, finder or card even after focus fell out of it.
- An unexplained error no longer ends in «technical code: » with no code.
- The fallback font, the licence notice and the licence text are sent with
  their own content types instead of `application/octet-stream`.
- On POSIX, stopping a child process no longer kills the caller's process
  group; a launch and an adapter run in a session of their own.
- The release check runs every Python tool from its own interpreter, and stops
  with one message when a `requirements-dev.txt` pin is missing or at another
  version there.

## [2.0.0](https://github.com/Muratovnik/valkama/compare/v1.0.2...v2.0.0) - 2026-10-31

### Added

- The MCP tool `apply_work_item_changes` applies several writes to one work
  item in one call: a claim, checklist ticks, refs, links, a comment, the
  summary and a transition, in that order, so a closing transition sees the
  ticks and the summary sent with it. Each step is the write its single tool
  makes, with the same guards, events and revision bumps. The call is all or
  nothing: a refused step writes nothing, and the error keeps the refusal's
  code and names the step (`step: {group, index}`). The batch is recorded as one
  call with its identity. It answers with the usual acknowledgement plus
  `applied`, what each group changed; `verbose: true` returns the full item.
  The HTTP write `POST /api/planning/work-item/apply` takes the same body. The
  single tools are unchanged.
- `valkama hook <client> <event>`, the command Claude Code and Codex hooks run.
  It records a session lifecycle event from stdin straight into the store, with
  no `serve` or MCP session running. It covers session start and end, subagent
  start and stop, turn end, prompt submission, compaction and, for Claude Code,
  notifications. The event becomes one `execution_events` row, confirmed with
  source `hook`, and updates the session rows that every session reader uses.
  A subagent gets its own row, `<session>:<agent>`, under its parent.
  - The write is a light open of a store that already exists at the current
    schema. A busy, missing or other-version store, or a failed insert, sends
    the event to `spool/` beside the store instead. A hook never creates the
    store's own directory, because its existence is what stops the first open
    from adopting a store written under an earlier product name. Spool files are delivered
    later by the next successful hook write, or by `housekeeping.drain_spool`.
    Delivery is idempotent on the event's uid. An event older than what the
    store already knows is kept as history and changes no session, so a late
    drain cannot revive an ended session. A spool file that fails validation,
    including a list or an object where a string belongs, is set aside as
    `*.rejected`; no file content stops a drain, and a failure in start-up
    maintenance is reported on stderr without stopping the server.
  - The command always exits 0 and prints nothing, whatever its input. It keeps
    an allowlist of fields and never the prompt, tool arguments, assistant text
    or Codex turn metadata.
  - `valkama hook claude pre-tool-use` prints the `PreToolUse` output that adds
    `_identity` (session, tool use, and agent inside a subagent) to a Valkama
    tool call. It does not open the store, and it makes no permission decision.
  - `doctor` reports spool files still waiting, with the oldest event time;
    rejected spool files; events delivered through the spool in the last 14
    days; Planning writes in the last 14 days by identity state and source; and
    the last hook event per client.

  The contract is in `docs/hook-contract.md`, which replaces the superseded
  session event contract. `POST /api/ingest` is unchanged.
- A local transcript archive. When a session ends, `valkama hook` copies its
  transcript, and a subagent's own transcript when the client reports one, into
  `transcripts/` beside the store. The copy survives the client deleting the
  original.
  - Each copy is written through a `*.partial` file and renamed to a name made
    from the session, the agent and the content's sha256. A
    `transcript_archived` row in `execution_events` records the source path,
    the archive path and the sha256. The content never enters the store.
  - In the hook, a copy is made only for a source of at most 8 MiB that copies
    within 1.2 seconds, which keeps the hook inside Codex's three-second
    `SessionEnd` budget. Anything else stays owed. `transcripts.sweep` makes
    owed copies, records a source that no longer exists, and purges copies by
    the retention rule. The start-up of an MCP server or `serve` runs it after
    the spool drain and the lease expiry, in a background thread, so the first
    request never waits for a copy. The drain and the lease expiry before it
    share a budget of about three seconds and give up quickly on a store
    another writer holds.
  - Retention: copies are kept while a non-terminal work item refers to the
    session (by a session ref, a write call, its current claim, an execution
    linked to the session, or as the item the session was launched for), and
    for at least 90 days after the later of the session's last activity and
    the newest terminal transition of a referring item. A purge
    appends `transcript_purged` before it deletes the file, and the next sweep
    removes a file a crash left behind. A sweep deletes nothing else but an
    abandoned `*.partial`: a copy no row names, as after restoring the store
    from a snapshot, is kept and reported by `doctor`.
  - `valkama transcripts purge` deletes copies on request, whatever retention
    says: `--session <id>` (repeatable), `--before <date>` (sessions whose last
    activity is earlier) and `--dry-run`. Each copy gets a `transcript_purged`
    row with `reason` `on-request` before its file is deleted, a copy still
    owed for those sessions is never made, and the command prints counts only,
    including how many open work items refer to the sessions.
  - The export lists "transcript archive" among what it excludes and never
    reads it. `doctor` reports copies kept and their size, copies owed, files
    no row names and recorded copies missing from disk.
- The store gains what session identity and claim leases need, still at schema
  9. A new append-only table `execution_events` records the execution tree:
  client lifecycle events and every Planning write call with the identity it
  carried. Its triggers refuse UPDATE and DELETE.
  - `work_item_events`, `work_item_comments` and `work_item_refs` gain a
    `call_id` link to the call that wrote them.
  - `work_items` gains `claim_call_id`, the call that took the current claim.
  - `sessions` gains `parent_session_id`, `agent_id`, `transcript_path` and
    `client_version`.

  The first open of an existing store by this build takes a verified snapshot
  labelled `preidentity` and adds these columns once. Every existing row keeps
  its values, and its new link is empty, which reads as "not confirmed".
  The step itself writes nothing into them, and the MCP tools are unchanged.
  An earlier schema-9 build still opens the store and writes to it. A
  `claim_ref` write that does not name its call, which is how such a build
  claims, clears the claim's link.
- Every Planning write call records who made it. Each MCP tool call and each
  browser write that changes Planning adds one `planning_write` row to
  `execution_events`, inside the call's own transaction, and every event,
  comment and ref the call writes points to it. A refused call leaves no row.
  The row is `confirmed` when the client proved the session: Codex through
  `_meta.sessionId`, Claude Code through an `_identity` argument whose
  `tool_use_id` matches `_meta["claudecode/toolUseId"]`, the browser through
  its session credential. Anything else is accepted and recorded as
  `unconfirmed`. The `author` text and the server's environment are never
  identity. See `docs/connection-contract.md#call-identity`.
  - Every tool accepts and removes an `_identity` argument before checking its
    schema, so a `PreToolUse` hook that adds one breaks no call. A malformed
    one is dropped, never refused. `tools/list` is unchanged.
  - History events in `get_work_item`, a `verbose` write and the HTTP item
    read carry `identity`: `state`, `source`, `session_id` and `agent_id`. An
    event recorded before this reads as `unconfirmed` with the rest `null`.
    The web reads records strictly, so a `web/dist` built before this change
    refuses every item; serve the one built with it.
  - A write made by the execution runner outside any call records no call row
    and reads as `unconfirmed`.
- A claim is a lease held by the session that took it. Its state, `live`,
  `stale` or `unconfirmed`, is computed at every read: `unconfirmed` when no
  confirmed session took it, `stale` when that session ended, failed, has no
  row or showed no sign of life for 14 days, otherwise `live`. See
  `docs/connection-contract.md#claims-are-leases`.
  - `get_work_item`, a `verbose` write and the HTTP item read carry `claim`:
    `holder`, `state`, `session_id`, `agent_id`, `source`, `acquired_at`,
    `last_seen` and `expires_at`, or `null`. Every item record, the compact
    list and search rows and the short write acknowledgements carry
    `claim_state`. `claim_ref` and `ready` keep their meaning, and `tools/list`
    is unchanged. The web reads records strictly, so a `web/dist` built before
    this change refuses every item; serve the one built with it.
  - A confirmed write call counts as a sign of life of its top-level session,
    so a session whose hooks are silent stays live while it writes. One that
    arrives after the session ended makes it `active` again, because a client
    can resume an ended session without a new session start; its claims then
    stay live. A drained or replayed hook event never does.
  - A stale lease is released by the first write that meets it:
    `claim_work_item` on that item, `claim_ready_work_item` in its space, and
    the start-up of an MCP server or `serve`, which now also drains the hook
    spool. The release is a `released` event with the detail
    `lease-expired: <holder>`, written by `valkama` under its own call row
    (source `valkama`, tool `lease-expiry`). Taking a stale claim over needs no
    `force`.
  - The board marks a stale claim on its tile, and the inspector shows the
    lease and its expiry. The owner takes a stale claim over without being
    asked to confirm a takeover; the owner's own claim shows no lease.
  - `doctor`'s hook and identity findings have their texts in the web's
    Settings, in English and Russian.

- `valkama export --space KEY` (repeatable) exports only those Planning spaces
  and names them in the file as `space_filter`; an unknown space exits non-zero.
  `valkama export --output PATH` writes the export through a temporary file in
  the same directory and replaces the target in one rename, then prints one
  line with the path, the spaces and the item count. Without `--output` the
  export still goes to stdout.
- `list_work_items` and `search_work_items` take an optional `offset`, and so do
  `GET /api/planning/work-items` and `GET /api/planning/search`. Their answers
  carry `next_offset`, the offset of the next page, or `null` on the last one.
  The `tools/list` change is additive only: one new optional `offset` property
  on each of the two tools, and longer descriptions that explain paging. The
  HTTP answers gain `truncated` and `next_offset`, and so does a `verbose`
  tool answer, which is the HTTP answer; no existing field changes.

### Changed

- The MCP tool `get_work_item` answers by default with the item's current
  fields and only the newest part of its history: the 5 most recent comments
  and 10 most recent events, with `comments_total`, `events_total` and
  `history_truncated`. The new boolean argument `full: true` returns the
  complete history, as the tool did before. The HTTP read
  `GET /api/planning/work-item` is unchanged and takes the same cut as opt-in
  `comments`, `events` and `sessions` parameters.
- `get_work_item` also carries `sessions`: each agent session whose confirmed
  calls wrote to the item, with its `client`, `identity_source`, `first_at`,
  `last_at` and number of `writes`. Valkama records this itself, so the MCP
  server's instructions and the `attach_work_item_ref` description no longer
  ask an agent to attach its session id as a ref, and they point to
  `apply_work_item_changes` for several writes to one item.
- Moving an item to Review no longer warns about missing evidence when a
  confirmed session has written to it: such a write names its session as a
  session ref does. Before, an agent that stopped attaching session refs got
  the warning on every move to Review without a commit ref.
- Two sessions that sign with the same `author` no longer release or take
  over each other's claim. A confirmed session holds its claim whatever author
  it signs with, and any other caller needs `force` against a live lease. A
  claim without a confirmed session is still compared by author.
- The space's abandoned claims (`stale_claims`) follow the lease: a stale lease
  is listed at once and a live one never, whatever its quiet. The three-day
  quiet rule stays for unconfirmed claims, except the owner's own claim made
  in the browser; a claim a launch took for its runner is still listed.
  Each entry carries `claim_state`.
- Starting an item under an unconfirmed or stale claim answers with a warning.
  The claim still counts as the executor, and a claim taken in the browser
  gets no warning.

- **Breaking for every running client: store schema 9.** The first open by this
  build takes a verified snapshot labelled `preschema9` beside the store, then
  drops the extension registry's tables, `platform_modules` with
  `platform_registry_audit`, and `integration_settings`; every other row is kept
  as it was. A store older than schema 8 goes through the same historical
  migrations as before, under its `preproductmodel` snapshot, and ends at 9. A
  build at schema 8 refuses the upgraded store with `StoreTooNewError` and
  leaves the store file unchanged, so restart every agent client after pinning
  this release with `launcher install`. Going back to a schema-8 build is described in the README under
  "Migrating an older store".
  A fresh store is created at 9 without those tables, and a store stamped 9 that
  still holds one of them is refused.
- **Breaking for `export`:** an export carries only the `planning` section. The
  `relations` section (the registry's adapter links) and the `settings` section
  (the integration switches) went with their tables; `--section relations` and
  `--section settings` are refused as unknown.
- A store that is already current opens without the full `PRAGMA
  integrity_check`. The check still runs whenever an open migrates the store,
  and on every snapshot and restore.
- **Breaking for MCP clients:** the work-item write tools (`create_work_item`,
  `update_work_item`, `transition_work_item`, `claim_work_item`,
  `set_work_item_checklist`, `claim_work_item_checklist_item`,
  `tick_work_item_checklist_item`, `set_work_item_summary`) answer with a short
  acknowledgement (reference, revision, state, holder and what the call changed)
  instead of the whole item. Pass `verbose: true` for the full item. Every MCP
  tool result is now serialized on one line without indentation. The HTTP API
  and the read tools are unchanged.
- **Breaking for MCP clients:** `list_work_items` and `search_work_items` answer
  one compact row per item and, without a `limit`, at most 50 rows, with a
  `truncated` flag. Pass `verbose: true` for the full items as before. Planning
  tools now refuse an argument their schema does not have, and a missing required
  one, naming the tool and the arguments it takes. They also read the spellings
  agents tend to reach for when a schema is out of view (`reference` for `id`,
  `to` for `state`, `planning_space_id` for `space`, and the few others listed in
  the connection contract); the published schemas are unchanged apart from the
  optional `verbose`.
- Focus the workspace on projects, work items, claims, blockers, execution,
  results, and review. Navigation contains Work and Settings; board, list, and
  graph share the Planning read model. Memory refs and exact session context
  remain inside work-item context.
- Keep session lifecycle ingestion in Planning, accepting `session_start`,
  `session_end`, `attention`, and `turn_end`. `/api/session` resolves compact
  stored context rather than an event feed.
- **Breaking for adapter authors:** the external adapter manifest has exactly
  four fields (`contract_version`, `adapter_id`, `version`, `capabilities`), and
  any other field is refused by name, including a record installed with the
  earlier, longer manifest. Capabilities are an open set of dotted lowercase
  ids. Check and install such an adapter again.
- The module list (Planning, Memory, Settings) is declared in code.
  `GET /api/modules` and the MCP tool `list_platform_modules` keep their shape
  and answer from it without reading the store: every module is `enabled`, none
  is `mutable`, every `revision` is 1 and `updated_at` is when the list last
  changed. Settings no longer declares the registry's read models, and the
  entity kinds `service`, `connection` and `registry` left the reference
  vocabulary.
- `launcher install` pins a release: it copies one commit of the checkout
  (`--revision`, default `HEAD`) with `git archive` into the releases directory,
  and the stable command runs that copy instead of the working tree. Uncommitted
  edits no longer reach new client sessions or the store they open; newer
  commits reach clients at the next `launcher install`, and an earlier
  `--revision` is the rollback. The launcher manifest gains `revision` and
  `checkout`, keeping its schema version. A running MCP server warns once the
  launcher has been pinned to another release, and `doctor` reports how far the
  checkout has moved past the pinned commit. Run `launcher install` once after
  updating so the stable command stops running the checkout directly.
- The default workflow has a terminal **Cancelled** state for work closed as not
  needed, duplicated or superseded, so it is no longer counted as done. Moving
  an item there needs a closing summary but leaves its undone checklist steps
  open; Done still needs every step ticked. A workflow still shaped like the
  earlier six-state default gains Cancelled, with every move to and from it,
  the first time a store is opened; a workflow shaped differently is left
  alone. No existing row changes meaning, so this needs no store schema change.

### Fixed

- An MCP server whose launcher had moved on to another build appended the
  stale-build warning to every tool result, so a long session carried dozens of
  copies and paid for each on every later request. The first result after the
  drift carries it; a reminder follows only after at least 30 minutes, three in
  all per process.
- The desktop app refused to start or reuse the server on Windows builds that
  report a listening socket's TCP state as `Closed` or as no state at all:
  `launcher listener status` looked only for `Listen` sockets, found none and
  called a port that the managed server held `free`. A listener is now any
  socket on the port with no remote end, whatever state Windows reports.
- Any local process could obtain the browser session token, because
  `GET /api/security/bootstrap` without an `Origin` returned it, and could
  then write as the owner (`browser`, signed `user`) with a forged `Origin`.
  The bootstrap and every write with the browser credential now also require
  `Sec-Fetch-Site: same-origin`, the fetch metadata a browser sets on its own
  requests; a request without it is refused with `403`
  `fetch_metadata_refused`. The web client and the desktop app send it
  already. The adapter endpoint is unchanged.
- An MCP tool call refused for its arguments -- an unknown argument, a `limit`
  that is not an integer -- answered only with the text
  `PlanningHttpError: ...`. It now answers like every other refusal, with
  `structuredContent.error.code` (`invalid_request`) and the message.
- `valkama export` wrote at most 1000 work items per Planning space and said
  nothing about the rest; the items lost were those in the last workflow
  states. It now reads every item page by page and checks the count against
  the space's own. A count that does not add up stops the export, and nothing
  is printed or written.
- `list_work_items` cut its answer at 1000 items and `search_work_items` at
  200 without saying so; at a `limit` of 1000 or more (200 for a search) the
  compact answer reported `truncated: false` while it was cut. A page still
  holds at most 1000 (200) items, but `truncated` is now correct at every
  limit and `next_offset` says where the rest starts. The list order now ends
  on the work item id, so paging cannot repeat or skip an item that ties with
  one from another space.
- Rolling the launcher back with `launcher install --revision` to a release
  from before `valkama hook`, while the client hooks were still registered,
  would have blocked every prompt and tool call in Claude Code: that release's
  argument parser exits 2 on the unknown command. The shim now answers
  `valkama hook` with exit 0 and no output when the pinned release has no hook
  entry point.
- A half-written migration snapshot, left by a process killed while writing it,
  was found as reusable at every later open and stopped each one. A reusable
  snapshot that cannot be read is now renamed to `*.unverified`, kept, and a
  fresh snapshot is taken.
- Search across attached scopes (`/api/search?scope=all`) failed as a whole when
  one attached store was written by an earlier build: reading a claim there
  needed a column that store does not have. Such a claim now reads
  `unconfirmed`, and a scope that cannot be opened or searched for any reason
  costs only its own hits and is named, with the reason, in the new `skipped`
  list of the answer.
- A claim, checklist claim or checklist tick made in the browser was signed
  `agent`, while a comment made there was signed `user`. A browser write that
  names no author, or an empty one, is now signed `user`.
- Load the global Work directory from project and space counts, keeping large
  work histories within the bounded UI response. The full directory API remains
  available without the optional `directory_only=true` query.
- Wrap work-queue filters and Settings controls in narrow windows.
- Keep every work item in a space's board, list, graph, and work queues, including
  spaces with more than 1000 items. Bounded item searches retain their limits.
- Decode Git reference context after byte capture while preserving its timeout.
- Check subprocess byte capture and explicit decoding policy, write ownership,
  and document lifecycle without pinning private expressions or release-note text.

### Removed

- Standalone Analytics dashboard and export/read model; Improvements signals,
  analysis, evaluation, monitoring, jobs, API, and MCP tools; Skills catalogue
  and activation UI/API; standalone Sessions fleet, inbox, and tool event feed.
- `/api/sessions`, `/api/session-seen`, and the Sessions SSE view. Installed
  skill files and existing client enablement settings are unchanged.
- Unused desktop inbox notification wiring, frontend remnants of the retired
  Analytics and Skills screens, and the unused usage client with its test fixtures.
- The extension registry: services, connections, assignments, grants, actions,
  packages, relations and capability resolution, with `/api/platform/registry`,
  `/api/platform/relations`, `/api/platform/actions`,
  `/api/platform/assignments` and `/api/platform/grants`, which now answer 404.
  Nothing seeds or reads the registry's rows, and store schema 9 drops their
  tables. The work-item read no longer carries a `relations` key.
- **Breaking for HTTP clients:** turning a module on or off. `POST
  /api/modules/state` answers 404, the Settings Workspace section that held the
  switches is gone, and a disabled module row in an existing store no longer
  hides or refuses anything. Store schema 9 drops the `platform_modules` and
  `platform_registry_audit` tables.

## [1.0.2] - 2026-09-27

The first public release. There is no earlier public version to compare
against, so this entry describes what the repository contains rather than what
changed in it.

### Added

- **A local modular control surface for agent work.** Planning, Sessions,
  Analytics, Improvements, Skills, Memory, and Settings share one Kernel vocabulary,
  persisted module registry, and normalized integration records.
- **A Planning module agents use over MCP.** Its Kanban view has six fixed
  columns, competing claims are refused by `claim_work_item`, epics are parent
  work items, and transition guards refuse a move the Planning workflow could
  not honestly report.
- **An activity trace on every Planning card** — creations, moves, claims,
  takeovers, releases, checklist completions and link changes, each with its
  author, beside typed refs for commits, sessions and memory entries.
- **Checklists with stable ids** that agents claim and complete individually, so
  two agents can split one card without either of them inventing a percentage.
- **A live Planning UI** in Vue 3, served from a committed build, updating over
  Server-Sent Events rather than polling, in English and Russian. Concurrent
  moves are resolved with a `409` naming who moved the card where, not silently
  undone.
- **Agent session launching from a Planning card**, with an explicit delivery
  contract and an enforced JSON result schema. A process exit code is not
  treated as delivery, and resume works only against the client's own stored
  session identity.
- **An analytics dashboard** over the same events — flow, throughput, cycle,
  reopen and blocked KPIs — that reports coverage as `confirmed`, `inferred`,
  `partial` or `unknown` and never fabricates a duration across missing history.
- **An improvements module** for working through recurring failures: a sidecar
  domain with its own database scope, a job supervisor, and evaluation runs
  bound to canonical pack snapshots.
- **A skills inventory** over registered projects, and normalized registry
  views for Modules, Adapters, Services, Connections, and Assignments.
- **Local project registration owned by Valkama.** The `projects` CLI adds
  existing roots, binds Planning spaces, checks and publishes a fixed schema-v3
  projection, and can restore the preceding inventory and projection bytes.
  An explicit import accepts an existing schema-1 TOML inventory.
- **An Electron desktop window and a Windows tray icon.** The tray appears while
  an agent holds a session and disappears when the last one ends; a click always
  produces a visible outcome, including a refusal when the listener cannot prove
  it is this checkout.
- **A dual-era MCP surface**: one process serves revision 2026-07-28 and the
  `initialize` handshake it replaced, choosing from how the client opens. See
  [`docs/connection-contract.md`](docs/connection-contract.md).
- **Two guards against version skew** — `static_assets.SourceWatch` for a
  process that went stale while it ran, `store.STORE_SCHEMA_VERSION` for a build
  that was already old when it started.
- **A CLI** covering the current Planning lifecycle and product diagnostics:
  `serve`, `mcp`, `summary`, `runtime`, `export`, `migrate`, `attach`, `detach`,
  `scopes`, `purge-stream`, `config`, `setup`, `doctor`, `adapter`, `capabilities`,
  `status`, `launcher`, and `projects`.
- **Migration recovery points.** Store migrations take clean SQLite snapshots
  before changing existing data. The Board-to-Planning conversion is explicit;
  `migrate planning-model --dry-run` converts a temporary copy first. Tests
  restore a pre-migration product-model snapshot into a separate store and
  replay the migration.

### Notes

This is the first public release. The source archive contains the Python service
and the built web UI. The Windows installer contains the desktop window; it uses
the Python service and managed launcher installed from the source archive.
