# Changelog

Notable changes to Valkama. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The MCP server reports itself as `<release>+<build>`, where the build is a digest
over the modules the running process started with. Two servers from different
checkouts are therefore distinguishable even at the same version.

## [Unreleased]

### Added

- **How much work an item actually took, and what it would cost at API prices.** The server
  now reads the clients' transcripts in the background and tells working time from waiting
  for a person, for a subagent or for a failed service, and from a machine that was off.
  `GET /api/planning/work-item/usage` reads an item or its whole chain and
  `GET /api/planning/session/usage` a session, with what no item took on a line of its own.
  Store schema 11 holds the rows, under a snapshot taken before the upgrade; no message or
  command text is kept, and existing transcripts are read too. The cost is an estimate, not
  a bill. A background command counts as work for three hours from its start at most, so a
  server left running is not read as a script someone waited for.
- **A card says how much work its item took.** A quiet line under the card's facts gives
  the working time, the estimated cost at API prices and the tokens processed anew; an epic's
  line takes in its items, and each item of its chain shows its share. The «Agents» tab
  shows the whole with what each number means, the tokens by kind and by model, each
  agent's share, the session's own run, and each session's total with what it did for no
  task. Estimates, missing prices and missing data are said as such, never as zero.
- **Task types have colours, and you can change them.** A type's icon and word are now
  purple for an epic, rose for a bug, turquoise for an improvement and grey-blue for a
  task, on the board, in the list, on the card, in search, on the hover card, on the
  graph and in the filter menu; the colour of a state does not change. Settings →
  General → Task type colors picks another colour per type, applies it at once, says
  when one is hard to read and lets you keep it, and resets one type or all. The choice
  is kept on the device, so a browser and the desktop app each remember their own.
- **One batch edits an item, writes several comments and asks questions.**
  `apply_work_item_changes` takes three more groups, each working as its single tool
  does: `update` (`update_work_item`), `comments`, up to 100 (`comment_work_item`), and
  `questions`, up to 100 (`create_work_item_request`). They apply in the order `claim,
  update, checklist, checklist_ticks, refs, links, comment or comments, resolutions,
  questions, summary, transition`. `applied` names the fields edited and the id of every
  comment and question written. A call that names both `comment` and `comments` is
  refused, and so is one that asks a question and closes the item, which would end the
  question unanswered. A refused entry's shape now names its `step` too.
- **A list in the discussion becomes steps of the task in one action.** A comment, a reply
  or a work report that holds a list carries a «Make steps» icon on an open task. It opens
  the points as boxes, every one ticked but a point the task has as a step already, one that
  repeats a point above, or one longer than a step can be, each said beside it; the count
  says how many steps the task will hold of its 100. The chosen points join the checklist
  through the same write as any change of it, so whoever holds the task hears that its
  steps changed, and they are ordinary steps from then on.
- **A question can be a review of many points.** A field of the new type `verdict` is
  one point the owner accepts, puts off or rejects, with a comment or an own variant like
  any choice. A field may now add a `description`, a `group` that the fields of one area
  stand together under, and `under`, which shows and asks it only while an earlier field's
  answer holds an option: the steps or the way of an accepted point. A verdict may add
  `recommended`. Each mistake in such a schema or its answer is refused naming the field
  and how to put it right. A question without the new keys is what it always was. The
  compact read of a review gives `verdicts` and `undecided` whole before any row, and its
  `answer` holds only the fields under a point, with `under` and `of`, and the points with
  a comment or an own variant; a notice sums a review up by its verdicts. See
  [Questions and decisions](docs/connection-contract.md#questions-and-decisions).
- **One small frame says where work is going on now, across every space.** A stream
  opened with `GET /api/events?view=planning` carries it as `event: live` beside the
  space's read model, and `view=live` is a stream with only that event, for a page that
  has no space stream. Each row is an item at work, held, waiting or silent for over a
  day, a pinned item, or the parent of one, with its live subagents counted, its workflow
  state, and since when a silent one is silent. Agents at work on no item are counted
  per space by the folder their session was opened in, as a caption that binds nothing.
  The frame is sent when it changed and no more than every two seconds, and it reads the
  primary store only. See [the connection contract](docs/connection-contract.md#the-live-work-frame).
- **A person can pin an item.** `POST /api/planning/work-item/pin` pins an item or
  removes its pin and answers with the frame. A pin lives in the store, so the browser
  and the desktop app show the same ones; it is no change to the item, writes no
  history and is told to no agent. It outlives the item's close, moves to the survivor
  of a merge, goes with a deleted item, and an export carries it as `planning.pins`.
- **A review is answered row by row in the thread where it was asked.** A question with
  verdicts shows each point with «Accept | Later | Reject», none chosen until you choose,
  its points under their group headings with how many are decided, and the steps or the way
  of a point right under it once you accept it, filled with what the agent recommends the
  first time. «Accept recommended» decides every point still undecided as recommended and
  leaves what you chose. An own variant and a comment stand beside each point. The count
  and that button stay at the top of the panel and the comment, «Don't answer» and «Send»
  at its bottom while the form is in view, without covering what has focus. Over «Send» the
  form says how many points are undecided; the agent reads those as undecided, and a
  required one stops the send. A question with none of this looks and works as before.
- **An answered review reads as one line.** «Accepted 14 · put off 1 · rejected 1 · own
  option 1 · undecided 1», the points not simply accepted by name, and «Show all 18 rows»
  for every point with its verdict and every step with what was chosen. «Change answer»
  opens the same form in place, and its previous answers read as what each change changed,
  row by row, as the agent is told it: «P12 put off → accepted», «P10 · Steps +… −…».
- **An agent can put a list the owner ticks under its own comment.** `comment_work_item`,
  `report_work_item`, `set_work_item_summary` and the batch's `comment`, `comments` and
  `summary` take `list`, a label and up to 20 options, on a root only; the comment and its
  list are one write, and the answer adds `list_request_id`. The list is a question of one
  `multi_choice` field that carries `comment_id`, so it is answered, changed, searched and
  exported as any question, and its answer reaches the agent that wrote it and the item's
  holders. Nobody waits for it: it raises no Windows notification and takes none back, it
  is not in the interface's read of open questions without an item, and it does not hold
  the item open. On a closed item it reads `expired` with `task_closed` until the item
  reopens; a list on a closed item, or in the call that closes it, is refused. A merge
  moves a list with its comment, so a report's list stays with the report. See
  [A list on a comment](docs/connection-contract.md#a-list-on-a-comment).
- **A comment can tell the work on other items.** A number in a comment's text stays a
  link and tells nobody. `POST /api/planning/work-item/comment`, `comment_work_item`,
  `report_work_item` and the batch's `comment` and `comments` take `mentions`, on a root
  or a reply: up to 20 items from the interface and 5 from an agent, and one session names
  one item at most 3 times an hour, the fourth refused with `mention_limit` (429 over
  HTTP). Naming the comment's own item, an item twice or a missing one is refused. Each
  item named keeps a `mentioned` event pointing to the comment, and the answer says per
  item who holds it and, in `told`, why nobody will hear it. A person's
  mention is a person's act on the item named: its holders hear it in `from_person` and in
  the hook's notice («mentioned … from MAIN-12 #61»), an idle holder is woken, and a close
  is refused with `person_spoke` until an agent writes there. Another agent's mention
  reaches the holders, never the agent that wrote it, in a block of the notice of its own
  («Valkama notice from agents, not from a person»), and only at their next tool call or
  prompt: it never wakes a session, never continues a turn at `Stop`, and is in neither
  `from_person` nor `person_spoke`. The hook's `.marks` files are now headed `v3`, with a
  second place per item for agents' mentions; a `v2` or `v1` file is read without telling
  its news again, and an earlier build reads a `v3` file as empty, which tells the current
  news once more. Every comment now carries the items it named in `mentions`, and the
  read of an item carries the comments that named it, the newest 5 for `get_work_item`
  and 50 over HTTP, with `mentions_total`. See
  [Mentions](docs/connection-contract.md#mentions) and
  [who is told](docs/hook-contract.md#who-is-told).

### Changed

- **A question holds up to 40 fields instead of 12.** The 64 KiB the fields of one
  question fit in are unchanged.
- **`question_changed` says what changed, row by row,** as `changed: p12 later→accept;
  p10-steps +lock −glob`, instead of quoting the new answer and the old one, which do not
  both fit in 300 characters. Rows past the limit are counted, as `; and 4 more`.
- **A compact question past 2000 characters keeps every field it can.** It now leaves out
  the replaced answer first, then every label at once, and only then the later fields, so
  an answer with long labels shows each answered field instead of the first few.

- **A new task's epic and labels are chosen by searching what the space has.** In the
  «New work» dialog the epic is found by its number or title, with «No epic» as the empty
  choice, and a reference typed by hand that names no epic is no longer taken. Labels are
  picked from those the space already uses, most used first, or added by typing a new one
  and pressing Enter; each chosen label is a chip that its cross or Backspace removes.
- **The skill keeps Valkama calls apart in Claude Code's auto mode.** It tells the
  agent to send them in a response of their own: the hook that adds the session to a
  call makes auto mode withdraw its review of a call that runs after it in that
  response, and answering `allow` from the hook does not prevent that. See
  [the hook contract](docs/hook-contract.md).

### Fixed

- **A choice made with the mouse leaves no focus ring behind.** Opening a dropdown with a
  click ringed the option under the pointer, and choosing one ringed the dropdown itself,
  as if it had been reached with Tab. Focus the interface places after a click now stands
  unringed everywhere; the keyboard still rings every stop, in the list and after it.
- Every part of a screen that opens on request — technical details and passed checks in
  Diagnostics, a task's outcome, the recorded details of an attempt and of a memory
  search — opens on the same chevron as the rest of the app, beside its words. Passed
  checks drew the browser's triangle on a line of its own above its name, set in a
  heavier weight than anything else on the screen.
- In Diagnostics the time of the check is set in the size of the counts beside it, a
  finding starts on the same edge as its level, and on a narrow window a passed check's
  description and a technical value stand under their names instead of a few letters to
  a line beside them.
- In Settings, Readiness is named on the line of its state rather than half way down
  beside the button under it, and a task type's colour swatch stands as tall as its
  Reset.
- **Dialogs, the task finder and the new-task fields line up.** A dialog's title and its
  close button now stand on one line, with no extra space under the title, and the same holds
  for the Back, action and close buttons of a document's head. In the task finder a result's
  number stands on the first line of a two-line title instead of between its lines. In the
  new-task dialog on a phone, Labels and Epic take the dialog's whole width one above the other,
  so an epic's title is readable in its field and in its list. A press on the Epic field no
  longer highlights its value: the field empties for the search and shows the chosen epic in
  grey until you type; an epic chosen with the pointer leaves the caret in the field, as one
  chosen with the keys does, instead of sending the next Tab to the top of the page. In the
  filter menu, the number of tasks in hand stands beside «Assigned»
  instead of at the menu's far edge.
- **No more capsule-shaped rings round a line of words.** When a question's deadline passed
  or the list moved on to the next question, focus went to the deadline's line or the next
  question's title and drew a thin capsule round it. Focus now goes to the question itself,
  which that line describes or names, and the ring goes round the question. Why a send or a
  refresh failed still takes focus, so that Tab goes on from there, and its ring, like a
  reply's and the checklist heading's, stands clear of the words with the corners of a
  button.
- **The form that marks a thread resolved has its buttons where every form does.** It put
  «Mark resolved» before «Cancel», at the start of the line on a phone; «Cancel» now comes
  first and the primary button ends the line.
  The question asked before written words are dropped, under a reply, in this form or
  while an answer is changed, now puts its buttons at the end of its line too, keeps them
  together on a phone, and starts its words on the form's own edge. So does the question
  asked before a refused move is carried through anyway, which stood inside the refusal on a
  ground of the same grey, 12px in from its words, and on a phone in Russian put «Перевести
  принудительно» on a line under «Отмена».
  «Mark the thread resolved» under a reply takes a press across a line as tall as an
  action's, not only across its words. The icons at the end of an entry's name and date, a
  review's point and a field's label stand on its first line when it wraps, not up to 14px
  under it.
- **A time inside a sentence no longer breaks in two.** A closed question's line, a thread's
  mark and a question's deadline could end one line with «05 нояб. 2026 г.,» and start the
  next with «23:47»; the time now moves to the next line whole.
- **The buttons of «Make steps» stay at the form's end on a phone.** Wrapped under the count
  they went to the start, unlike every other form's.
- **A question's two answers wrap together.** Once «Check status» joined the row after a
  failed send, Send stood alone on the next line under «Don't answer», and changing an answer
  on a phone in Russian put Save under Cancel. The two now go to the next line as one pair.
  On a wide screen the row no longer drops the two to a second line in Russian, after a
  failed send or past a deadline, while everything fits on one. On a phone «Open task» and
  «Check status» keep the start of their own line above the buttons, with no empty strip
  over them, and «Don't answer» asks its question in their place.
  Changing an answer keeps the comment's icon on the line of its buttons on a phone, so
  «Сохранить изменение» is now «Сохранить» in Russian. The line kept above the buttons on a
  phone for the question «Don't answer» asks is one line in English too, which now reads «The
  agent gets a refusal; no undo.»
- **A question that has ended is ringed as a whole, not round one line.** After a send or a
  decline focus went to the line saying how it ended and drew a thin capsule round it, pressed
  against the words and the rule of the answer. Focus now stays on the question itself,
  described by that line, and the ring goes round the question as it does round a thread
  that folds. A question is now named by its author and time, as a comment's thread is.
- **A review keeps one column of edges.** A group's heading put its chevron a few pixels
  into the column and its title further in than anything else; the title now starts where
  the rows do and the chevron ends the line after the count, pointing down while folded and
  up while open. What a point's answer opens, its steps or its way, stood at a third edge
  between them; it now starts under the point's words, and an answered review sets it in
  by the step its reply is set in, the same step every reply and quote in the thread uses. The
  chevron now sits on the line of the title, also when the title wraps, and in a forced palette
  it is drawn in the system ink, so it stays visible.
- **An entry's time stands under its author on a phone, not in the middle of the line.**
  Where a question's or a comment's icons took the end of its head, the time that no longer
  fitted beside the name dropped to a line of its own and kept to the end of the words,
  which is where the icons begin, so it stood mid-row under nothing. On its own line the
  time now starts where the name starts; beside the name it still ends the line.
- **A card's lists start at one edge.** A chain's rows stand on the edge their group
  headings start at, and the names of open groups line up with «Done»; a session in
  Relations that cannot be opened starts where its label does; a checklist step's box stands
  under the heading's first letter. A row's highlight under the pointer reaches a little past
  the column instead of pushing the words in. A disclosure's chevron, in a card and in
  Settings' diagnostics, starts on its column's edge too, folded or open, where it stood four
  to six pixels in.
- **A long title no longer breaks in the middle of a word.** A title such as
  `loading/empty/error/unavailable` was one word to the browser, and at a phone's width it
  broke wherever the line ran out, leaving «un» on one line and «available» on the next.
  A title now also breaks after each `/`, in the list, on the board, on the graph, at the
  head of a card, on the hover card, in search, among a card's links, in the picker of
  related work, on the branch map's tip, and in the epic and label lists of the new-task
  dialog. A single word wider than the line still breaks inside, rather than running past
  the edge: on the branch map's tip such a word was cut off at the edge with nothing to
  say it went on. A screen reader reads the title, and a copy takes it, as it was
  written, with no space after a `/`.
- A checklist step of 513 to 1000 characters is accepted. It was refused as if it held a
  control character, because the character check also stopped at 512 characters.
- Moving the pointer from one graph card to the next no longer flashes the whole field
  back to full brightness in between: the lit lineage passes straight to the next card's,
  a card lights once the pointer rests on it for 120 ms so a sweep across the field lights
  nothing it crosses, and leaving for empty ground restores the field after 200 ms. A
  card's title and a zoomed-out card fade as they recede, as the lines already did. The
  keyboard's focus still lights at once.
- **«Loading» no longer flashes when you switch boards or open a card.** A read that answers
  within 300 ms shows nothing in its place, and once «Loading» appears it stays at least
  400 ms, so a read that ends just after it does not blink it away. The same rule now holds
  for every loading panel and for a view whose code is still downloading.
- A pointer resting on the hint under a field no longer lights the field as hovered, and a
  press on the hint no longer puts the cursor in it. A field's label now names only the
  field, and screen readers read the hint as the field's description.
- The release check runs `npm ci` in `web` and `desktop` before anything else, so it
  verifies what the lockfiles pin rather than whatever `node_modules` holds, and it
  refuses a `node_modules` that is a link, because `npm ci` through a link empties its
  target.
- `tests/isolated.py gates` refuses an npm step on a `node_modules` that is missing or
  differs from its lockfile, says in which directory `npm ci` is needed, and no longer
  reports this as a failed step. Console messages in a step's summary are read in the
  console's code page instead of coming out garbled.
- **Priority means how much an item matters, and rank sets the order.** Urgent blocks work
  or loses data; high is serious and could block work; medium noticeably affects work, with
  a workaround; low is minor. The definitions show when you hover a priority on a card, a
  tile, a list row or the chooser, and the tool schema and the agent skill say the same. The
  values themselves are unchanged.
- **The filter opens in its own field.** The «Filter» button is gone: a press in the field
  or `/` opens the menu of values at once, all groups in sight and the picked ones marked,
  and the empty field says it searches and filters. Tab and focus coming back from a card,
  a dialog or another window leave the menu closed; ↓ opens it. With no value left to
  offer, as in a search by number, the menu steps aside and the work stays in sight.
- **Labels combine as you say.** The label group's head offers «all» and «any»: with «all»
  each label narrows the work, as before, and with «any» one of them will do. Every view
  and the counts follow, a word between the chips says which it is, a label pressed on a
  tile or in a card joins in the reading in force, and Reset takes it out. Only «any» is
  written into the address, so links made before read as they did.
- **The way to combine labels is in sight as the filter menu opens.** The menu stands as tall
  as the window lets it, and the label group, now last as the longest list, keeps its head
  with «all» and «any» at the menu's lower edge until the list reaches it, so no scrolling is
  needed on a real space or a short window.
- **What can be done to an entry of a discussion is a quiet icon on its first line.** Reply,
  Resolve and its removal, folding a resolved thread, Change answer and Make task outcome
  stand beside the author and the time instead of as buttons in a row of their own under
  each entry. They always show, say their name under the pointer and to a screen reader, and
  grow to a 44px target on a phone and under a finger.
- **There is one Reply.** A question, a comment, a report and a reply each have the same icon,
  and it opens the one field under the last reply of that thread. Reply in thread is gone: a
  thread is one level deep, so the two buttons only ever did the same thing. Leaving the field
  brings focus back to the icon that opened it.
- **A card's head reads as three rows with room between them.** The state, a waiting
  question, the priority and the epic stand on the first; «Held by», the holder and the
  action about them on the second; the labels on the third, which an item without labels
  does not have. The holder is a bare link instead of a plate, and the rows stand 12px apart
  instead of 4px.
- **The head's one action is bare text.** «Claim», «Take over» and «Release» carry no
  fill until the pointer is on them. A claim keeps the text ink and a takeover or a release
  reads in the quieter one, so the claim still comes first.
- **The identity line over a card's title and its state button align on their letters.** The
  texts of each line share one baseline, and the dot, the chevron and the icons stand on the
  middle of the lowercase letters beside them. A monospaced reference no longer sits a pixel
  above its neighbours.
- **«What comes next» on a card is now «Next step · 3 of 9».** A quiet line says it is a step
  and where it stands in the list, the step's words follow it, and «All steps» goes to the
  checklist with focus on it. The only step has neither the count nor the way to itself.
- **A card's agents have a tab of their own, «Agents 44», after «Overview».** The block no longer
  stands on the first screen of an open or a closed item, and a card without agents offers
  no such tab. Every row stands at once, newest first, with no «Show all», and rows stand
  under their parent session, whose «Open the parent session» stands once at their head
  instead of in each row.
- **An ambiguous link is said once for its group.** Under the group's head, one line gives the
  coordinator's count, «ambiguous: the coordinator held 13 items», or the range of its rows'
  counts, «13–19 items». The rows of that group no longer repeat it; each keeps its exact count
  in its tooltip and its accessible description.
- **The graph is easier to hit from a distance, and stops where the map still reads.** Below a
  quarter of full size, a press anywhere on the ground of an open epic's frame opens that epic,
  as its header does, and the pointer says so. A finger's tap there opens the epic too, though
  the browser would move it to a card in the finger's reach; a tap centred on a card opens the
  card. Cards on it open as before, a frame inside a frame opens its own epic, a drag still
  moves the field and Tab stops where it did. «Zoom out»,
  the wheel and a pinch now stop at the zoom «Fit whole graph» gives for what is drawn in this
  window, where the button turns off; a filter, a fold or a larger window that leaves the camera
  further out brings it up to that zoom.

- **Changing the space keeps the view you were in.** The board, the list or the graph, and the
  board's grouping by epic, stay as they were when you pick another project, go through all
  projects or open a project from there. A filter, an open card and a chain stay with the space
  they were set in, and Back returns to it with all of them. While the next space is read the
  bar stays where it was, with the view, the grouping, the filter and New work item, and only
  the place under it says it is loading; it used to give way to a page that said «Loading».
- **A chain's rows in a card line up, and their titles can be read.** The «Waiting on» mark stood
  about 2px above the rest of its row and made that row taller, and each row sized its own
  columns, so a waiting mark or a holder began at a different place in every group. Every cell of
  a row now stands on one line, rows of one line are one height, and the rows of all groups share
  one set of columns, with a long holder cut short and its whole name in its tooltip. In a card at
  its usual width the mark goes under the title, so a title has about 340px instead of 177px and
  rows without a mark are no longer cut for one; who holds the task keeps its column. A card
  widened to nearly its full 720px keeps a row on one line.
- **A compacted context no longer hides that a session is waiting for you.** A session that
  had finished its turn or asked for attention lost that mark when its context was compacted
  while idle. The mark now stays until you answer.
- **A click on a notification about a question goes to the question.** It used to open
  the card at its top and leave the question to be found further down. The card now
  brings the waiting question into view with the keyboard on its first field, however it
  stood when the click came, and opens as usual if the question has been answered by then.
  The notification's address has changed, so install the new desktop app before the new
  server: an older app refuses the new address and the click does nothing.
- A session opens in the folder it was started from, not in the folder its agent's
  shell had reached. A compaction or `/clear` no longer moves the recorded folder,
  and sessions already recorded are read right from where their transcript is kept.
  The window, the terminal and the command to copy all use that one folder, and the
  copied command now starts with `cd` into it.
- In the app, a session from VS Code or another editor opens with one press and no
  dialog: the window, a short pause, then the conversation. If the editor was not
  running, the conversation follows once its window has had time to appear. In the
  rare case that the conversation reaches the window too early and starts empty,
  pressing again opens the right one. The browser still takes two presses.
- The notice in the corner no longer stays for good after something worked: it goes
  after five seconds of being seen, and waits while the pointer or the focus is on it
  or while another window is in front. A refusal stays until it is put away.
- That notice now says what it is about: a session by its holder and its place, a file
  or a folder by its name, and a copied command by its session.
- **The screen no longer blinks as a document opens over a card or the questions.** The
  layer underneath dropped its dimming at once while the new one faded in from nothing, so
  what lay under both lit up for a moment, and it went too dark as the document closed. Each
  layer now keeps its dimming while it stands, so the screen under them only fades one way.
  This holds for any dialog over a card.
- **A chain with nothing to tell apart says it once.** With all its work in one state the
  chain block in a card named that state twice, in the map's key and over the list, and with
  one lane its name was a filter that narrowed nothing. The key and the filter now appear
  only when there is a second state or lane, and the map, the figures and the list stand
  clearly apart.
- **On a phone a chain's titles keep the whole width.** A row's waiting mark or state word
  stands under its title, so one row's mark no longer squeezes the title of every row.
- **A card opens on the first click after a drag.** However a drag ended, in another column,
  in the same one, back where it began, refused by the server or over nothing that takes a
  tile, the next click on any tile was lost, and so was Enter on one. A click right after a
  drop is no longer taken for the drop, and the release itself still opens nothing. A press
  with a hand's small shake in it is now a click rather than a drag of a pixel or two.
- **An answered question keeps no empty room before its options.** Their words start at the
  row's inset, the same with a selection and without one. The selected option is told by its
  ground and the word «selected», so the tick beside it is gone.
- **Opening an option's description only adds lines under it.** In the form and in an answered
  question its first line stays where the excerpt stood, at the same width and in the same type.
- **Opening something in the list of waiting questions moves nothing above it.** The dialog
  stands from the top instead of the middle, and the room for its scrollbar is kept from the
  start, so what is on screen neither jumps nor breaks into other lines.
- **The presses that open a comment are quiet glyphs.** They used to take a line each on every
  question. A comment on a field opens from the end of the line naming the field, and a comment
  on the question from the left end of the row of buttons, above which it opens. A written comment
  shows a filled glyph and says so in its name. A question with one field offers only the comment
  on the question; a comment an older answer has on that field stays to read and change.
- **The field of your own option has no caption over it.** The row right above it says what it
  is, and a screen reader hears the field named for the question it answers.
- **An epic's header on the graph no longer moves when it folds or opens.** The two views
  had two heights, so the text and the progress edge stood in different places in each.
  The header is now one height, folded or open.
- **An epic's title has room on the graph.** It stands on up to three lines of its own under the
  reference and the state, as a card's does, instead of the 80 pixels left beside them.
- **An epic with no tasks says «No tasks» on the graph,** with no empty progress edge and
  no chevron, in place of «0 of 0 done». A frame whose work the view hides keeps its
  counts and edge and offers no chevron until the view can draw that work; a stored
  «open» for such a frame is ignored and kept for when it can.
- **A folded epic on the graph says what it hides.** Its header reads «90 open inside»,
  «90 inside» zoomed out and «+90» far out, counted by the epic and not by a filter, with
  the sheets of a stack under it; the keyboard and the accessible name say the same.
- **An epic's header on the graph is easier to hit from far away.** It is taller, and
  zoomed out the whole band and the air round it are one target, 24 pixels on the
  screen down to a zoom of 0.104.
- **Tabbing into the graph no longer moves the camera the operator set.** The keyboard
  entered on the first target whose centre was in sight, and pressing it centred the
  camera on it if the edge of the field cut it. It now enters on a target wholly in sight.
- **A subagent started for no named item moves the one item its coordinator holds.** One
  launched with a number in its first prompt moves that item, and a coordinator holding
  several items still moves only what its subagents are seen on.
- **A Codex session's token totals read its rollouts again.** The counters had moved inside
  each record, so `GET /api/execution/usage` found none in a real rollout.
- **A compacted context no longer stops the work on the graph.** A session whose context was
  compacted reads as it did before: a turn still running stays at work, and so do its
  subagents, so their cards no longer say «waiting». A client that really restarted still
  cuts off the subagents it left behind.
- **A subagent's work moves on the graph for as long as it runs.** An item moves while a
  live subagent wrote to it since it last started, holds one of its steps or was launched
  with a description naming its number, however often its coordinator is woken in between.
  An item a coordinator merely holds stays still, and a step a stopped subagent left moves
  nothing.
- **A subagent that fell stops moving the graph.** Its record stays active with no end, so a
  subagent whose transcript has gone unwritten for two hours no longer counts as running. A
  page left open learns of it within a minute, even when nothing else is written.
- **The moving mark on a graph line has one length and one speed.** It used to be a share of
  the line, so long lines carried long, fast marks and short lines tiny slow ones. A very long
  line now carries the next mark on the way instead of hurrying one.
- **The moving mark stays visible on a graph zoomed far out.** Its stroke used to thin below
  a pixel with the lines it runs on; it now keeps a pixel and a half while its length shrinks
  with the field.
- **A card on a graph zoomed far out no longer shows three unexplained dots.** Its number
  stands whole inside the block at any length, and what an agent is doing on it is in the
  card's tooltip and accessible name, on its lines and in its frame's count.
- **The card a number shows copies and can be selected.** It offers the number and a link to
  the item as a card's head does, with the same icons and the same note when a copy is made or
  refused, and Tab reaches both from the number. Its text can be selected with the pointer, which
  a refused press used to prevent, and a selection keeps the card up until you press elsewhere
  or press Escape, even if the drag ended outside it. A card standing over another number stays
  as the pointer reaches it, where it used to give way to that number's card.
- **A frame on a graph zoomed out says what its number counts.** Its header showed three
  dots and «5» with no word; it now says «5 working» at every zoom, on the reference's line
  where there is room and on the line under it where a fold leaves that free. Where neither
  has room the mark gives way whole rather than as dots or a bare number, and the header's
  hover text and accessible name say it. The number now takes the size and colour of its
  word close up too.
- An answer given in the interface now reaches the agent: a person answering, changing,
  declining or withdrawing a question never produced a notice, a `from_person` line or the
  `person_spoke` refusal, because the interface answers through a route those reads did not
  count as Planning's.
- A question's options show code in their labels as code, as their descriptions already
  did: a label such as «The standard `vue/max-lines-per-block`» showed its backticks. In
  the form a link in a label reads as its words, since a press there also chooses the option.

## [2.5.0](https://github.com/Muratovnik/valkama/compare/v2.4.0...v2.5.0) - 2026-11-05

### Added

- **The space's read model says which items an agent is at work on now.** `live_work` in
  `GET /api/planning` and its event stream maps each such item to `working` (a session
  in a turn wrote to it since its last prompt or a subagent of it holds one of its steps,
  or an attempt is running), `held` (a session in a turn holds it but is not seen working
  on it), `waiting` (the session is live and its turn ended or has not begun) or `quiet`
  (silent for over a day, with `quiet_since`). It is read from the sessions behind the
  item's claim and its open steps and from what sessions in a turn wrote, in five reads
  whatever the size of the space, and no MCP tool answer carries it. See [Work-item context](docs/product-model.md#work-item-context).
- **The graph shows the work an agent is doing now.** A card says «working» with the
  pulsing working dots while a session's turn writes to its item, whether or not the
  session holds it, while the session's subagent holds a step of it, or while an attempt
  runs on it. A card whose item a live session holds says «held» with still dots while
  the turn is about other work, «waiting» with still dots once the turn is over, and
  «silent since» the session's last sign of life after a day of quiet; the key names held
  work while a card shows it.
  A line that reaches work being done now carries a short comet running to
  its arrow, and a frame says how many items under it are being worked on, so a folded one
  still shows the work moving inside it. «Stop the motion» in the strip above the field
  stops all of it at once and is remembered in this browser for every space; stopped, or
  under reduced motion, a live line is held still and wider. In a forced palette a live
  line takes the palette's colour for what is picked out. The switch and the key's live
  line are offered only while something on the field moves, so work a filter or a chain
  leaves out brings neither, and a refresh that makes a line live or still changes it at
  once. A card's live word is never cut: a long holder's name beside it gives way, and the
  card's accessible name says the holder whole. Beside live work the foot drops «Claimed
  by», so some of the holder's name always stays, and «silent since» names the day alone. The switch answers a pointer across 44px.
- **The graph draws an epic as a frame round its work.** The frame's header names the epic,
  its state once it has moved, and how its work stands in words — «8 of 21 done · 2 in
  progress · 1 blocked» — over a 3px edge of the same counts in the board's hues. The
  chevron folds a frame to its header alone, the rest of the header opens the epic, and the
  work under no epic stands in a frame of its own. Lines run over the frames and end on a
  frame where the work they reach is folded inside it. Zoomed out, a header keeps the epic's
  reference and its edge; in a forced palette the frame is outlined and its edge fills what
  is finished and dashes what has begun.
- **A work item's number in a text shows its card.** Rest the pointer on the number for half
  a second, or reach it with Tab, to see its state, title, holder and steps without leaving
  what you are reading. A press still opens the item, Escape closes only the card, and a tap
  opens the item with no card. A number in the open space costs no request; any other reads
  the item's brief record once, which the card's read gives with `brief=true`.
- **Comments form threads.** A reply stands under the comment, report or question it
  answers, one level deep. In a card a question has replies of its own, with the field for
  the next one in the same place, and threads open by their latest activity and hold still
  while the card is open: a thread with news says «New reply» rather than moving. An agent
  replies with `reply_to`, a comment's id, or `reply_to_request`, a question's id, on
  `comment_work_item`, the `comment` group of `apply_work_item_changes` and
  `POST /api/planning/work-item/comment`; a reply to a reply stands under its root, and the
  answer names the root it joined. `get_work_item` takes `thread` to read one thread whole,
  every comment in every read names its parent and carries `by_person` and `resolution`, and
  `get_work_item_request` carries a question's replies. An export carries the new keys under
  the same `interface_version`. See
  [Threads and the resolved mark](docs/connection-contract.md#threads-and-the-resolved-mark).
- **A thread can be marked resolved.** A mark holds who, when and a one-line decision; in a
  card it folds the thread to one line and can be taken back, the heading counts what is
  still open, and a filter shows only that. `resolve_work_item_comment`,
  `POST /api/planning/work-item/comment/resolve` and the `resolutions` group of
  `apply_work_item_changes`, up to 100 roots in one call, set it, and `reopen` takes it off.
  The history records both as `comment_resolved` and `comment_reopened`, and no revision
  changes. `get_work_item` with `unresolved: true` reads the roots without a mark, 20 at a
  time, continuing with `comments_after`, and its counted reads add `unresolved_total`. A
  search also finds an item by a mark's decision.
- **An answer can carry an own option and comments, and be changed.** Every field with
  options has «Your own option» as its last row, and a comment on a field or on the question
  goes beside the choice; an agent sends them as `own` and `field_notes` beside `note` on
  `answer_work_item_request`. An answered question shows every option of every field with
  the chosen one set apart, and while its task is open it offers «Change answer»: the same
  form on the answer in force, Save off until it differs, and Cancel asking before it
  discards anything. An agent changes an answer with `change: true`, and the interface
  through `POST /api/modules/planning/request/change`; a change that alters nothing and a
  51st version are refused. The replaced answers are kept, behind «Previous answers» in the
  card: the reads add `answer_version`, the compact form `previous` and the whole form
  `history`, a changed answer comes again to a reader that passes `answered_after`, and a
  person's change reaches the agent as `question_changed`. An export carries the new keys.
  See [Questions and decisions](docs/connection-contract.md#questions-and-decisions).
- **A path in a text opens what it names.** A path to a project's file or folder in a card or
  a question, written in the text, in a code span or as a Markdown link, can be pressed: a
  Markdown file opens in Valkama, another file in the editor Settings names at its line, and a
  folder in that editor. A path that is surely one but opens nothing copies itself instead,
  with a dotted underline; one that only looks like a path stays text until the server
  confirms it. The page asks `GET /api/documents/resolve` what each path is, from the space's
  root and then from the projects registered inside it, and nothing outside a registered
  project's root is opened. See [Project documents](README.md#project-documents).
- **A Markdown file named in a text opens in Valkama.** A press on a path to a `.md` file in
  a card or a question opens the document over them, read-only: headings, lists, tables and
  code drawn, at the `#kb:…`, heading or `:42` the path names, with a link to another document
  opening in the same place and Back returning to where it was read. Escape comes back to the
  link, and a draft under it stays. The file is read again when the window returns.
  `GET /api/documents/read` serves it, up to 512 KiB, from inside one registered project.
- **A document stands beside what it was opened from.** Where the window holds both, a
  Markdown file opened from a card or from the panel of open questions stands in a pane to
  their right rather than over them: from 1460 px beside a card at its opening width, 1200 px
  beside the narrowest card and 1160 px beside the questions. Below that it stands over them
  as before, and a window that crosses the width moves it across with the reader's place. The
  two panes are one dialog: Tab goes through both, F6 and Shift+F6 move between them, the
  first Escape closes the document and gives focus back to its link, and the next closes the
  card or the questions, whose draft stays all along. The edge between them sizes the
  document, which keeps a width of its own, and Enter on it folds the document away and back.
- **A document can have a window of its own.** The new-window button in the viewer's head
  opens the document at `/doc?project=<id>&path=<relative>#<anchor>`, alone in the window
  with nothing of the shell, and closes it where it was, so focus goes back to its link. A
  link followed there writes over the address, so a reload stands where the reader stood; a
  refused read is said on the page, and a work item's number or a session is plain text,
  having no card to open in. A browser opens the page in a new tab cut off from the first by
  `noopener`. The desktop app opens it in a second window with the main window's settings,
  which closes with the main window; any other address a page opens still goes to the system
  browser.
- **A document's file opens in the editor from its head.** A button in the viewer's head, over
  a card, beside it and on `/doc`, opens the Markdown file in the editor Settings names, by
  the same open plan as a file named in a text: at the line a link named while the reader is
  still there, otherwise at the first line of the block at the top of the view. A file too
  large, not UTF-8 or not text, which the viewer does not show, still opens there. A plan that
  refuses copies the path and the shell's notice says why. A path pressed in a text that the
  plan refuses now says why as well, where it said only that it could not be opened.
- **An item's plan anchor opens in Valkama.** The mark beside a card's source and its row in
  Relations open the plan in the document viewer at the anchor, in a browser and in the desktop
  app alike. A source Valkama cannot find is copied as written, and the notice says why.
- **A session opens where it was last open.** The session-start hook records where each
  session is open — an IDE extension, its terminal, a terminal, Claude Desktop or the Codex
  app — from a few named environment variables and, on Windows, the names of the programs
  above it, and keeps none of their values. The holder in a card's head, a step's holder, an
  agent, an attempt and a link name that place before the click, and a press opens the session
  there: the Claude Code extension in its folder's window, Claude Desktop, the Codex app, or a
  terminal that resumes it. Where only a program can start it, a browser offers the command to
  copy. A session recorded before places opens where its transcript says, and one with no
  place in the owner's fallback and then VS Code; a Codex session from the IDE extension opens
  in the Codex app. A subagent opens through its parent. A session live in a terminal is not
  started a second time: the button says where it runs, and once it has been silent for a day
  offers, on a press of its own, to resume it if its window is closed. A session its client no
  longer keeps says so instead of opening an empty one. `GET /api/open-plan` answers the steps
  a press takes and `GET /api/open-places` what this machine can open; the desktop app runs the
  steps, a browser takes one press for each.
- **A card's read says who each holder is.** `GET /api/modules/planning/work-item` gives
  the claim, each step and each agent an `executor`: the session a click would open, the
  agent inside it, where that session was last opened, its client `family`, and whether it is
  live, ended, gone, headless or none. The record adds `last_claim_executor` for whoever held
  a closed item last. It costs the read one more statement, however many holders the card has,
  and no MCP answer carries it.
- **The agent working an item hears what a person did there.** Any write to an item
  answers with `from_person` when a person acted on it in the interface since an agent
  last wrote there: a comment or a reply, an answer or a changed one, a resolved mark set or
  removed, a status change, an edit, a cancel. Each event is told once, the newest 20 with a
  count of the rest.
- **Client hooks bring the same news on their own.** Claude Code's `post-tool-use`,
  `user-prompt-submit` and `stop` answer with a short "Valkama notice" when there is
  news on the work the session holds: the orchestrator hears about all of it, a subagent
  about the items where it holds the claim or a step. `claude watch`, registered with
  `asyncRewake`, wakes an orchestrator that is idle, for example while it waits for a
  background subagent. Codex is told at its next prompt or tool call. The `notify`
  setting (`VALKAMA_NOTIFY=off`) switches this off. Beside the holders, whoever started
  a thread hears the replies in it and whoever asked a question hears its answer, a
  changed one too, and so does their orchestrator, even on an item they hold nothing of;
  a resolved mark reaches only the holders. A notice that fails costs its hook's
  lifecycle event nothing.
- **Work item numbers show as links in Claude Code without the agent writing the address.**
  `POST /api/hooks/message-display` answers Claude Code's `MessageDisplay` hook: a number
  whose `/open` address leads to a card comes back as a link, on the screen only, and code,
  existing links and URLs stay as they were. Nothing is logged or stored, and any failure
  shows the original text. `valkama capabilities` names the address to register, under
  `interfaces.http`.
- **Windows notifications when an agent needs you.** A question or decision from an agent
  and work moved to review show a Windows notification from the process that wrote them,
  with Valkama's window closed too; a failed launch can as well. A question already on your
  screen stays silent, several items within a few seconds become one notification, and one
  that stops being true is taken away. A click opens the item, or the panel of open
  questions for a notification about several, through the `valkama:` scheme the desktop
  installer now registers. Settings → Windows notifications chooses the events and the
  text, says whether Windows will show them, and sends a trial. They need the desktop app;
  `doctor` reports the shortcut, the helper and autostart in one line. See
  [Windows notifications](README.md#windows-notifications).
- **The panel of open questions has an address.** `/open/questions` opens it in the desktop
  app or the browser, as `/open/<number>` opens a card.
- **A card copies the link to its item.** The link button beside the reference in the
  card's head puts the item's short address, `/open/<number>` on the address Valkama is
  served from, on the clipboard and says in the same line whether the copy happened. The address
  opens the same card wherever it is followed, and the desktop app, which has no address
  bar, now has a way to give it.
- **The desktop app has a context menu.** A right click offers "Copy link address" on a
  link, "Copy" on selected text, and Cut, Copy, Paste and Select all in a field, in the
  language of the interface.

### Changed

- **The card's Execution tab is off by default.** Turn it on under Settings → General →
  Interface. With it off, a card does not offer launching an agent; launching itself is
  unchanged.
- **The graph's open-or-all switch counts what the counts line counts.** Over the whole
  space every item is on the field, as a card or as the frame it heads, so «Open» and «All»
  now count epics and parent items too, and agree with «N open of M» above them rather
  than counting cards alone.
- **The space's graph is laid out by epic.** Each epic, and each item that grew children,
  holds its work in a block of its own, and the work under no epic holds the rest, so every
  open item is on the field and the «Unlinked» switch is gone. A block with no open work or
  more than twenty open items starts folded to its heading, except that the work under no
  epic with nothing open folds only past twenty drawn items, so «All» shows a few finished
  ones without a press. A link to an epic is drawn to that epic's block rather than dropped,
  and several links running the same way between two blocks or cards are one line, solid
  when any of them blocks. Blocks that hold open work, with the blocks linked to them, come
  first as the field is read, and blocks of finished work after them. In a space with five
  or more unlinked blocks of open work, those blocks are stacked to fill the field's rows
  rather than strung out in one strip over empty field. A chain's graph is drawn as before.
- **The graph is laid out again only when what it draws changes.** A refresh that changes
  a state, a holder or a title is laid on the drawn graph without a new layout, and a line
  lit by the pointer or the keyboard stays lit while its item is drawn. A block the operator
  folds or opens is remembered per space in this browser (`valkama-graph-frames`); outside a
  filter, a choice that matches the block's default is forgotten. Under a filter a block
  still counts all of its epic's work.
- **The graph's camera and keyboard know the epic blocks.** The field opens on its first
  heading or card as it is read — or, when that first screen holds only finished blocks, on
  its first open work, so a phone never opens on finished work alone. Every framing
  measures the blocks as drawn, and folding or
  opening a block moves the camera only across, so its heading stays where it was pressed.
  A resize brings the drawing back when no heading or card is left in sight, a block's
  empty middle not counting.
  The arrows also reach each heading's two buttons, fold or open on its left and the epic
  across the rest (the work under no epic has only the first), and once a fold hides the item
  the keyboard stood on, the field's Tab stop is that block's fold button. Otherwise Tab
  enters the field where the camera looks: on the first heading or card in sight as the
  field is read, so the field does not jump to a block out of sight. Right from a heading's
  fold button is its epic's button, and Left goes back. Zoomed out past reading, where the
  fold buttons are hidden, Tab still enters the field on a heading or card it draws; the
  work under no epic keeps its fold button there, its heading's one button. Focus on a fold
  button the zoom hides moves to its epic's button instead of dropping to the page.
- **The graph's first layout no longer waits for its worker to load.** The worker starts
  when the page knows the graph is coming — the address names it, or the pointer or focus
  rests on the switch to it — and loads ELK while the space is read. A worker nobody takes
  within a minute is ended.
- **The graph keeps one layout worker while it is open.** Every layout started a worker of
  its own, which loaded ELK again before it could begin: about a tenth of a second on each
  change of filter, scope or data on an idle machine, and seconds on a busy one. The graph
  now lays out on one worker for as long as it is drawn and ends it when the view closes. A
  layout asked for while a superseded one still runs ends that worker and starts on a fresh
  one at once, so the new drawing never waits behind the old; a layout that fails or does
  not answer within 30 seconds ends its worker too, and Retry starts a fresh one.
- **The history names the question an event is about.** A question asked, answered,
  changed, declined or expired is named by its title — «Question “Where do the comments
  go”» — from the questions the card has already read for its discussion, so the history
  sends no read of its own. A question older than the newest the card reads stays unnamed.
- **What opens more of a text is lighter than what acts on it.** «Show all» under a long
  text, «Show N more replies» and a resolved thread's Expand stood as chips of the same
  height and fill as Reply and Resolve, three rows of them between a thread's root and its
  replies. They now rest bare, as a chain's and a lane's «show more» do, with their words in
  line with the text they open; the actions keep their fill.
- **A segmented choice takes one Tab stop and the arrow keys.** The work view switch, the
  graph filter, a chain's scope and the discussion's thread filter are radio groups: Tab
  reaches the chosen segment, and the arrows, Home and End move the choice. A card's
  sections, Settings' sections and an editor's Write and Preview are tabs over the panel
  they show, and a screen reader hears the panel named by its tab: Left, Right, Home and
  End walk them, showing a card's section or the preview as they go, while in Settings they
  only move focus and Enter or Space opens the section, since Diagnostics runs the
  installation's checks when it opens. Each segment was its own Tab stop before, and the
  arrows did nothing.
- **The history says what a record id stood for.** A thread's mark names the thread by its
  first words and its decision instead of the comment's id, a link reads from the card's
  side («Led to MAIN-7» rather than «discovered-from from MAIN-7»), and a question's id no
  longer stands in the row. The search still finds the recorded line.
- **Breaking for every running client: store schema 10.** The first open by this build
  takes a verified snapshot labelled `preschema10` beside the store, then, in one
  transaction, gives every comment an empty parent and resolve mark (`reply_to`,
  `reply_to_request`, `resolved_at`, `resolved_by`, `resolution`, `resolved_call_id`),
  numbers each question's answer (`answer_version`, 1 for one already answered), adds
  the table of replaced answers (`work_item_request_answers`), widens the history's
  actions with `comment_resolved`, `comment_reopened` and `request_changed`, gives
  every session an empty place (`opened_in`, `opened_host`, `opened_folder`,
  `host_session_id`), and adds the owner's notification settings
  (`owner_alert_settings`, empty until saved). Every existing row keeps its values.
  Triggers refuse a comment with two parents, a reply whose parent is itself a reply, a
  reply on another item than its parent, and a resolve mark on a reply; the tools place
  a reply to a reply under its root before they write. A store older than 9 takes the
  schema-9 and schema-10 steps in one open under its `preschema9` or `preproductmodel`
  snapshot. A schema-9 build refuses the upgraded store with `StoreTooNewError` and
  leaves the file unchanged, so restart every agent client after pinning this release
  with `launcher install`. To go back, stop every process that holds the store, delete
  the `-wal` and `-shm` files beside it, put the `preschema10` snapshot in its place, and
  only then pin the earlier release; everything written since the upgrade is lost.
  Pinned first, the earlier release reaches every running session within seconds and
  refuses the store still at 10. The README's "Migrating an older store" has the
  details.
- **Breaking for an agent that answers a question: a note no longer stands in for a
  required field.** `answer_work_item_request` and the interface's answer refuse an
  answer that leaves a required field without a value or an own variant, naming the
  field: `answer <field> is required; give an option or your own variant in own; a note
  no longer stands in for a field`. The note is a comment on the whole question. An
  answer given earlier with a note in place of a field stays as it was written and
  reads as that field unanswered with a comment on the question.
- **`get_work_item` reads the threads with the newest activity.** Its default read gives
  the roots of the 5 threads with the latest activity, each with `replies` and
  `last_reply`, where it gave the 5 newest comments, so a reply in an old thread lifts
  that thread into the read. `comments_after` still gives every comment after an id,
  roots and replies flat, and `full` every one. The counted reads add `threads_total`
  and `unresolved_total`. `merge_work_items` moves a comment with its thread and leaves a
  report's thread with the report on the merged item. The HTTP read of a card stays
  flat, each comment naming its parent.
- **An attached store another build wrote says why its card cannot be read.** An
  attached store is never migrated, so one a schema-9 build wrote lacks what this build
  reads on a card. That card's read answers 409 `store_schema_mismatch`, the page says
  what that means in both languages with no retry to press, and `/open/<reference>`
  still leads to the card. A store old enough that its whole space cannot be read
  answers the same code where it used to drop the connection.
- **The hook spool writes a session start as version 2.** The line carries where the
  session is open; every other event keeps version 1, and this build reads both. An
  earlier build sets a version-2 file aside as `*.rejected`, which `doctor` counts until
  the file is deleted, so after going back a session start still waiting in the spool
  is not recorded. It belonged to the upgraded store that going back discards, so
  nothing more is lost.
- **Opening a session follows the server's plan.** Settings → Opening sessions and files
  replaces the one opener per client family with a place to fall back to, an optional
  place to always open in, and the editor files and folders open in. A stored opener
  becomes the fallback it named, so VS Code and Cursor now open the session in their
  extension rather than its folder; Codex's stored terminal, which earlier builds saved
  by default, gives way to VS Code, and an own command becomes the place to always open
  in. The desktop app takes only the target and the owner's settings from the page and
  fetches the plan itself, and a session no longer needs its space bound to a project to
  be opened.
- **An agent cannot close past what a person said.** Its move to a completed or
  cancelled state is refused with `person_spoke` while a person acted on the item since
  an agent last wrote there, and the refusal quotes what they did. A comment sent in the
  same call does not lift it; `force` still does and is recorded.
- **A client hook starts faster.** The launcher starts it without importing `runpy` and
  `pathlib`, which took about as long as the rest of the hook. Every other command starts
  as before.
- **A new mark: a spark.** A long stroke, a triangle under its short arm and a
  four-pointed star replace the gradient V everywhere the product shows its mark. In the
  navigation it is one ink, as before. The browser tab, the taskbar, the tray, the
  installer and a notification show it in two flat colours, light grey and teal, on its
  own dark rounded tile; no version of the mark uses a gradient any more. The Windows
  icon now holds a frame drawn at each size Windows shows it (16, 20, 24, 32, 40, 48, 64
  and 256 pixels) instead of one 256-pixel image Windows shrank, and the tray takes the
  small frame, so the star stays apart at 16 pixels. The installed desktop app shows the
  new icon once it is rebuilt and reinstalled.

### Fixed

- **The working dots stay drawn in a forced palette.** They are a fill in the text's colour,
  which a forced palette clears to its ground, so a loading panel, a card's live mark, a
  frame's count and the graph's key all lost them; they now keep the palette's text colour.
- **A name over a changed answer reads whole on a phone.** «changed · time» took most of a
  narrow card's line, and the agent's name beside it stood in what was left, a word fragment
  to a line, broken inside its words. The time stays at the end of the name's first line
  while the name keeps at least 14 characters' width there; with less, the time takes a line
  of its own under the name, still at the end, and the name the whole width. A name shorter
  than that still shares the line with a time that fits beside it, and wider cards change
  nothing.
- **A long name over a question or its answer leaves the time at the end of the line.** The
  agent that asked and the one that answered still pushed the time under a name too long for
  the line, to its start, as threads and earlier answers no longer do. Both now keep the time
  at the end of the first line and wrap the name whole beside it.
- **What shows more of something reads apart from what acts.** «Previous answers», a
  question's «Comment on this field» and «Comment on the question», a card's «Show all» under
  its agents and «Show all» under the threads a view hides still wore the filled weight of
  an action, level with Send and Change answer beside them. They are now bare at rest, with
  their words where the lines they open start, as a thread's and a text's own toggles are;
  an option's chevron takes the same weight.
- **A refused choice in a question is marked, not only red.** «Choose one of the options.»,
  «Tick at least one option.» and «Choose Yes or No.» under a question's field differed from
  the text around them by colour alone, which a forced palette paints over. They now carry
  the alert mark a refused text field already has. A text answer and your own option's words
  keep the doubled edge they already showed; the choices themselves have no edge to double.
- **The interface check sees a tab role passed as an object.** `check:ui-system` kept tab,
  tablist and tabpanel roles to the shared segmented control and tab panel only where the
  role was written on an element; one handed over through `v-bind`, from a script, a
  composable or a variable a `:role` reads, went through. It now refuses those as well.
- **Memory stands whole on the frame it is chosen.** A card read Memory's knowledge source
  only once the section was shown, so the section appeared with a line saying it was being
  checked and then grew by the provider and its path; on a phone the card's sections, stuck
  above it, settled a frame later. The card now reads the source as it opens, as it reads
  its attempts.
- **A label stays a chip in a forced palette.** High-contrast modes clear the ground that
  was a label chip's only boundary, so a card's and a tile's labels read as plain words, a
  filter to press with nothing showing it could be pressed. A chip now draws its edge there.
- **A step's holder stands as far from its dot as the words before it.** «завершил ·» put a
  word's space before the dot and twelve pixels after it; the dot now has the same room on
  both sides, as the dots of a card's identity line do. On finished work «Ранее отвечал:» is
  followed by a word's space to the holder, not the wider gap that parts two facts.
- **«What comes next» is set as the text under a heading.** The step's words took the page's
  16px, larger than the 15px heading over them; they now take the size and leading of a
  description.
- **A long name leaves an entry's time where it stands.** Above a thread's root, a reply and
  an answer a change replaced, a name too long for the line pushed the time under it, to the
  line's start, while the entry beside it showed the time at the end. The time now keeps the
  end of the first line, and the name wraps whole in the room left to it.
- **A card's unresolved count is what the unresolved view shows.** «Unresolved N» and the
  heading counted comment threads only, while the view also kept a question still waiting
  for its answer, so the number stood one short of the rows under it. A waiting question
  now counts, and the line under the view says what it hides in threads: «1 resolved thread
  hidden», «Скрыто 5 разобранных веток».
- **Escape keeps a thread's decision until you say to drop it.** In a card, Escape or Cancel
  in the line that marks a thread resolved closed it and dropped what was typed in it. With
  words in it they now ask «Discard this draft decision?», as a reply's field does, and a
  second Escape keeps them; an empty line still closes at once and gives focus back to
  Resolve.
- **A reference in text wraps with the text.** A work item's number, a path or a file was
  drawn as a box that moved to the next line whole, so a long path left the line before it
  half empty and could leave the comma after it alone on a line, worst in a question or a
  thread on a phone. It is now a link in the line like any other: it breaks with the words,
  a path also after each `/`, and what is written against it stays on its last line. A
  number or a document that opens is a link to its address, `/open/<number>` or the
  document's own page, so in a browser Ctrl+click and the middle button open it in a new
  tab; the desktop app opens every press in place. What only copies, opens a file in the
  editor or shows a record stays a button, with Enter and Space.
- **A long card and a large space open.** The interface refused a card with more than
  500 comments or 1000 history events, and any module answer of more than 16384 values
  or 1 MiB of JSON, which took the Planning directory of a space past about 1170 items
  with it. It now reads an answer of any size the server sends, and holds each list and
  text only to a bound the server itself keeps.
- **A launch from Valkama that ended is recorded.** The listener's reaper held a
  transaction open around each pass, inside which recording an ending could not start
  its own, so an ended launch got a closed attempt and a warning but no session status,
  no comment and no move to review. It now gets all three, and the reaper no longer
  takes the store's write lock every two seconds with nothing to write.
- **Tab goes on from where a card was pressed.** A press on plain text in a card or a
  dialog left Tab starting from the top of what held it: Shift+Tab after a press in the
  bar went to the comment field and scrolled the card to its end, and Tab after a press
  far down went back to the first fact at the top. Tab and Shift+Tab now go on from the
  place pressed, as on a page, and still come round at the ends of the card.
- **A link Tab reaches in a long text stays in sight.** Tab to a link below the cut of a
  folded text opens the text, which moved the link away from where the browser had
  scrolled, so focus sat on a link below the window. The link is brought back into view.
- **A forced palette keeps controls legible and what is chosen.** Windows' contrast
  themes, or any forced colour palette, cleared the fills controls are drawn with: a
  switch showed nothing of which way it was thrown, a button read as text, and the
  pressed segment of a segmented control, the current page in the navigation and the
  suggestion Enter takes could not be told apart, while a button waiting on its answer
  looked ready to press. Each now keeps an outline and a switch its own colours; the
  pressed segment and the current page take the palette's colours for a selection, the
  suggestion an edge, and the waiting button the palette's colour for unavailable text.
- **A state word on the branch map's tip reads.** The active group's blue stood at
  4.10:1 on the tip's ground; the word now takes the muted ink, at 5.41:1, and the dot
  keeps the tone.
- **A transition's reason is checked before the item moves.** A reason long enough to
  overflow the history entry, which reads `<state key>: <reason>`, used to move the item
  and then fail on that entry, naming `event.detail`, a field the caller never sent. The
  reason is now refused by its own name, `reason must be at most N characters`, where N
  leaves room for the state key, and nothing is written. The same applies to a `transition`
  inside `apply_work_item_changes`, which refuses the whole batch. A reason is never cut to
  fit.
- **An answer no call gave no longer reads as an agent's.** A question answered outside
  any call, by a launch or before calls were recorded, said `by_person: false`, as if a
  tool had answered it. It says `null` now, as a comment and a replaced answer do.
- **A notice can be seen and heard from inside a card or a dialog.** The notice at the
  window's corner lay under every open card and dialog, so what a press there said reached
  nobody. It now lies above them, and its status region is always in the page, so a screen
  reader announces a notice instead of meeting it with its region, a repeated one too.
- **A press no longer lands on what the card's bar is fading in or out.** Scrolling a
  card fades the reference line or the action out of its bar and the title or the action
  into it, and for the length of a fade they took a press: a press could go down on
  something already leaving and lose its click when the fade ended, or a tap on an
  empty-looking place could start a takeover. What has begun to fade out takes no press
  now, what fades in takes one once it is half there, and a part a press went down on
  stays until the press ends.
- **A write that names no revision is no longer refused for one.** Agents writing to one
  item at once got `revision_conflict` ("work item is at revision 30, not 0") on ordinary
  reports, summaries, edits, transitions, claims and checklist writes that passed no
  `expected_revision`: each read the item before it took the write lock, and the guarded
  write compared what it had read. The read now happens under that lock, so a revision
  is compared only when the caller names one. A merge read the same way could drop a
  checklist step added to the surviving item in between; it no longer can. Deleting an
  item while another agent gave it a child answered with a raw `FOREIGN KEY constraint
  failed`; the child is now counted under that lock and the delete is refused naming it.
- **A press in the instant a question's buttons move no longer declines it.** The step of
  "Don't answer" ended when its buttons moved, but that was seen only at the next frame, so
  a press landing between a question folding above and that frame still confirmed the
  refusal. The buttons are now compared when the press goes down as well: one that finds
  them moved ends the step, and if it went down on them it reaches neither, so it writes
  nothing, not even what Send would. Keys on a button in focus work as before.
- **A click no longer rings what it lands on.** A question's heading, how it ended, the
  question itself and the comment field took a focus ring from a plain mouse press. The
  ring now shows only where the keyboard put focus or where the interface moved it — to
  how a question ended, to the next question, to why a send failed — whatever was used
  before. A text field shows focus by turning its own edge blue, for a click as for Tab,
  with no ring around it.
- **A note in a card's head is never cut.** What copying the reference, the link or the
  plan anchor did is shown as a check, or a mark when it failed, with its words beside it
  where they fit whole; the date shortens first to make room. A phone-wide card used to
  show «Ссылка скопиров…». Screen readers hear the whole sentence either way.
- **A document beside a card keeps its title.** Its four icons stood 16 px apart on the
  title's row and left a pane of 480 px about 220 px of title and the last letters of the
  path. Its actions now stand 4 px apart as one group, the way out apart from them, and
  under 560 px of head they take a row of their own under the way out, so the title and the
  path have the row.
- **What a dialog is about reads as a note under its title.** The line under the title of
  the session panel and of other dialogs, a session's client and id or a task's number,
  stood flush under it in bold; it now stands a step lower in the weight of ordinary text.
- **A document's page keeps its lines to a reading length.** On a wide window a paragraph
  ran to the page's whole column, over a hundred characters a line. Text now keeps to about
  seventy, while a table or a block of code still takes the column.
- **A failed read stands out from what it failed in.** In a card or a document the panel
  that says a read failed was the ground's own tone, so only its red edge showed, bent by
  the corners into a bracket. The panel now lies a step above the ground
  with a straight edge, and the dots of a read under way start where the content will.
- **A long identifier in a document's table stays whole.** A word longer than a column's
  measure, plain or written as code, was broken in the middle; it now widens its column, and
  the table scrolls in its frame as a wide table already did.
- **Escape closes a refused document, not the card.** A document opened beside a card that
  could not be shown — over 512 KiB, a read the server failed, a file no longer there — left
  focus on the card's link, so Escape closed the card and dropped focus on the page. Focus
  now goes into the document whatever its read comes to, and Escape closes the document
  alone and gives focus back to the link. Focus moved during the read stays where it was
  moved, and a read begun by the window's return never takes it, so typing in the card is
  not cut off when a refused file turns readable.
- **The folded document strip answers to what it says.** Folded beside a card, the strip
  shows «Document: <title>» but was named «Document width», so a voice command naming what
  is on it found nothing. It is now named by those words, with «Document width» as its
  description.
- **Code in a document's list widens as other code does.** A block of code inside a list item
  was held to the text's end and scrolled there, while a table beside it took the wider
  column. It now reaches past the text as far as that column, from the item's own start, and
  only as far as its longest line asks.
- **A phone-wide table shows the columns after its labels.** A column of labels took the
  measure a line of prose reads at, which on a phone is the whole frame, so a table of
  counts showed its labels and nothing else. Beside other columns a column now takes at
  most part of the text's width; a long identifier still widens it.
- **A table with an empty head is named without it.** A table whose head over its labels is
  empty was announced as «Table: , MAIN, OTHER»; empty heads are now left out, and a table
  with no words in its head is announced as «Table».
- **A frame of code says its language.** A block of code too wide for the document, which
  the keyboard can reach and scroll, is announced as «Code block: ts» when its fence names a
  language, rather than only «Code block».
- **A path before a tag is a path again.** A path with a tag written against it, as
  `docs/a.md<br>` where a table cell breaks its line, was read as a template and stayed
  text. A name in angle brackets is still a template where the path goes on around it —
  `tmp/<task>/`, `docs/<name>.md` — and anywhere else a tag only ends the path.
- **No space before a comma after code.** A code span stands on a ground inset from its
  words, and beside a comma, a bracket or a quote written against it that inset read as a
  space: «`App.vue` , both». On a side something touches, the inset narrows to 2 px.
- **The waiting list no longer says there are no questions above questions.** A question
  that closed while this window held something in it stays in «Needs my answer» to say how
  it ended, and the line above it read «No questions need your answer». It reads «Waiting
  for an answer: 0 — the questions below have closed» now.
- **A choice not sent is said when its question closes elsewhere.** A question answered in
  another window while this one had an option chosen in it folded as if nothing had been
  chosen; only words were kept and shown. It now says «Not sent. This is what you had
  chosen:» with a line per field, and the words of a text answer join the words kept, which
  a closing used to drop.
- **A dialog on a phone takes the whole width.** A dialog kept a 20px gutter from the window
  and a 24px inset inside it at every width, so on a phone the questions waiting for an
  answer gave an option's text 184px of 390. In a window 620px wide or narrower, where the
  card already takes the whole width, a dialog does too, with no corners and a 16px inset
  shared by its head, body and foot; the finder still stands just under the top.
- **A question's own comment stands apart from its fields.** «Comment on the question» was the
  same press, the same step away, as the comment on the field above it, and read as one more
  comment on that field. A rule now sets it off with the buttons under it. With that comment
  open, the room kept for «Don't answer» to ask in stood as an empty band of about 45px above
  the buttons; it now stands in the buttons' row beside the two answers, and on a row of its
  own only where that row has no room.
- **How long ago stays on one line.** A span of two units, such as «2 дн. 23 ч», broke
  between its units on a phone-wide card, in an agent's row and in a silent session's
  panel. The space between the units no longer breaks, as the one inside each unit never
  did.
- **Settings tells an editor from an app.** The places a session or a file opens in drew
  one monitor for VS Code, Claude Desktop and Codex alike. An editor now draws code
  brackets, and Claude Desktop and Codex a glyph each of their own.
- **A setting over several controls is named at their top.** «Claude Code», «Codex»,
  «Other clients» and the notification events stood half way down the places and
  checkboxes they name; each now stands on the line of the first of them.
- **An error reads as one without colour.** Under a field, in a text editor's foot and in
  Settings, an error differed from the hint beside it only by its red, which a forced
  palette paints like any other text. It now carries a warning mark, and a refused field
  or text doubles its edge, which a forced palette keeps.
- **A program this computer lacks is said once on a card.** Where every session would open
  in VS Code and VS Code is not installed, «VS Code is not installed» stood beside the
  holder, every agent and every step, in the ink of the name before it. The card now says
  it once under its facts, with where to choose another place; each of those sessions keeps
  a mark whose name gives the reason, and an agent's row says what a press would have done.
  What a session alone is, such as gone or running without a window, is still said on its
  row, its holder's name now in its own ink and the mark right after the last word.
- **A card's holder has the line under its facts to itself.** Beside the action a holder
  too long for what was left wrapped its place onto a second line, and its plate kept the
  width of the first. The holder and the epic now take the whole width under the state,
  priority and action, where most holders read on one line.
- **A failed read of the Windows notifications stands apart in its group.** Once the panel
  took the sheet's tone it lay flush under the group's head, in the same tone, and ran into
  it, and its round corners stood out of the group's edge. It now stands inside the group
  with the rows' inset on every side.
- **A failed read on the workspace lies one step above it.** Where the panel that says a
  read failed stands on the workspace panel itself — the Work module, every project's work,
  installation health, the shell's recovery and a task's link — it took the sheet's tone,
  two steps up, and stood off the page at 1.41 instead of lying on it at 1.16. Those hosts
  now give it the ground's tone; in a card, a document and a settings group it keeps the
  sheet.
- **A failed read keeps its disc in a forced palette.** With Windows contrast themes on, the
  palette cleared the red disc beside «Could not load this view» to the ground, and only the
  edge was left to say something failed. The disc now takes the palette's text colour.
- **A document's page is one column in the middle of the window.** On a wide window the
  text kept to its reading measure at the start of a 56rem column while the head ran the
  whole column, so its actions stood about 300px past the end of every line. The head and
  the text now stand in one column as wide as a line, in the middle; a table or a block of
  code wider than that grows by the same on both sides, as far as the old column. A
  document beside a card or over it is set as before.

### Removed

- **The graph's «Unlinked» switch, and the line that said how many parent tasks it drew as
  groups.** Every open item now stands in its epic's frame, or in the frame of the work under
  no epic, so the whole space leaves nothing out: an item linked only to its epic is no longer
  hidden, and the line promised groups the graph never drew. The key names the parts of the
  frames' edges that are drawn.
- **The desktop app's own way to open a plan anchor in VS Code.** The `valkama:open-source`
  bridge, its path check and the desktop app's reader of the project projection are gone; the
  anchor opens in the document viewer, and a file in the editor through the open plan.
- **The notification settings no code obeyed.** The browser-stored `notify` and
  `notifyEnabled` fields, their seven events and their strings in both languages are gone,
  and a stored value drops them when it is next read. Settings → Windows notifications
  replaces them, and keeps its choices in the store.

### Security

- **A session id or a folder can no longer put a flag or a command on a terminal's command
  line.** The desktop app passed a session id that began with `-`, such as
  `--dangerously-skip-permissions`, to `claude --resume` and `codex resume` as a flag, and
  gave Windows Terminal a folder holding a `;`, which it reads as the start of another
  command. An id now starts with a letter or a digit, as every Claude Code and Codex id does,
  and a resume whose folder holds a semicolon is refused with the rest of its plan.
- **A folder named like a project in another case is no longer read as that project.**
  Windows can keep a folder case-sensitive, and WSL makes its folders so; there `proj` beside
  a registered `Proj` is a sibling, but the document routes and the opener compared paths with
  case folded and read, resolved and opened files in it as the project's own. The path a link
  leads to is now compared with the root as the disk spells both, and the sibling is
  `outside_root`.
- **A document is read only from the file the check passed.** `GET /api/documents/read`
  checked where a path leads and then opened it by name, so a folder on the way swapped for a
  junction in that moment had a file outside every project read. The path of the open file
  is now checked again before anything is read, and one outside is `outside_root`.
- **A click no longer fails whole on a folder the app would not take.** The server offered a
  folder rooted on no drive (`\work\repo`), a resume in Windows Terminal from a folder
  holding a `;`, and a file in a project on a network share, and the desktop app refused each
  plan entire as `invalid-plan`. The server now applies the app's own rule: such a session
  explains `no-folder` or resumes another way, and such a file is `invalid_path`.
- **The owner's own command gets no folder holding a `;` either.** A resume in Windows
  Terminal already refused one, but `{cwd}` in the owner's command took it, and that
  command may start Windows Terminal itself, which would run what follows the `;` as another
  command. Such a folder is now passed over, and a command that needs `{cwd}` with no other
  folder is refused as `no-folder`.
- **A resume in a terminal no longer runs a program the repository holds.** The desktop app
  started Windows Terminal in the session's folder with `cmd.exe /k claude --resume <id>`,
  and `cmd` looks for a bare name in its current folder first, so a `claude.cmd` committed to
  that repository ran in the client's place. `cmd.exe` and the client's CLI now go by their
  full paths, the CLI as the app finds it (`claude.exe`, or `codex.exe` beside the Codex app),
  and only the tab starts in the folder. Without the CLI the resume is refused as not
  installed.
- **The owner's own command runs the program on the PATH, not one in the repository.** A
  command such as `wt -d "{cwd}" …` started in the session's folder with its program named
  alone, and Windows looks for such a name in the current folder first, so a `wt.exe`
  committed to that repository ran instead. A program named without a folder is now looked up
  on the `PATH` alone, and one that is not there starts nothing; a path the owner wrote runs
  as written.
- **A window of the desktop app hands the system only a web or mail address.** A link a
  window opened or followed off Valkama's origin went to the system whatever its scheme, so
  a `file:` or `ms-settings:` address asked Windows to start the program that claims it. Only
  `http:`, `https:` and `mailto:`, the schemes the page links, now leave the app; the rest
  open nowhere. The links of an open plan go through the session opener as before.
- **No page of Valkama can be shown in a frame.** The app's pages, the document page and the
  page a click on a card answers carried no framing policy, so another site could frame one
  and lay its own page over a click on Valkama. Each now carries
  `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.

## [2.4.0](https://github.com/Muratovnik/valkama/compare/v2.3.0...v2.4.0) - 2026-11-03

### Added

- **A question is answered in the task's discussion.** It reads as a comment: one still
  waiting stands right under the comment form however old it is, and one that has ended
  takes its place by time, folded to its prompt with the reply under it. Selecting only
  selects and Send sends, the same for every kind of field; nothing is chosen for you,
  and a recommended option only says so. "Your own answer" is always there and stands in
  for what is required. A reply says "You" only for an answer given through this interface,
  and otherwise names the agent.
- **Options with long descriptions keep the choices in sight.** A description of one line
  stands under its label, a longer one shows its first words, past six described options
  only the labels stand, and each opens on its own press without selecting anything. What
  is chosen stands whole under the options and above Send, so nothing folded is sent
  unread, and choosing moves no row.
- **No press on a question holding nothing writes,** whatever comes to stand under the
  pointer, as when an agent answers the question above or asks a new one. "Don't answer" takes
  two steps: the first press writes nothing and asks on the spot, with "Back" in the very box
  of that press and the way on in the box of Send, so pressing again without moving only goes
  back. The step lasts only while attention is on its question: a press or focus elsewhere, or
  its buttons moving for any reason, such as a question folding above or a scroll, takes it
  back, so a page holds one at most. With focus in the question Escape goes back too without
  closing the card or the list, and choosing or writing anything takes the step back. An own
  answer left open is never covered by what is asked. Send with nothing chosen or written
  writes nothing on any question, required fields or not, and says at the first field what it
  wants. A deadline passing takes focus to the line that says so.
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
- `by_person` says whether the call that closed a question came through Valkama's interface:
  true for one, false for any other call that answered, declined or withdrew it, and null
  while none has. It is read from the call that wrote the row, so no argument sets it and
  `author` does not count. It means "through the interface": a process holding the
  interface's credentials counts as the interface.
- `search_work_items` finds an item by a question's text, answers and note, and a row found
  that way carries `question_hit`.
- An export carries every question in `planning.requests`, with its `by_person`.
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
  whole records. `get_work_item_request`, the HTTP request reads and the answers of request
  writes add `note` and `by_person`, and `answers` no longer shows a note among them.
- The compact form of a question stays cheap: a note, a written answer and a label are cut
  at 500 characters, and one question is at most 2000 characters of JSON, keeping its first
  fields and saying `clipped: true`. The whole text is in `get_work_item_request` and in the
  list with `full: true`.
- `list_work_item_requests` takes `offset` and says `truncated` and `next_offset`. With
  `answered_after` the oldest answer comes first, and a page runs past `limit` rather than
  part two answers of one time, so a reader that keeps the last `answered_at` loses none.
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

- **Creating work items from several agents at once no longer fails** with a raw
  `UNIQUE constraint failed` on the item number: the counter is taken under the write lock.
  Two planning spaces whose names derive the same key, created at once, get two keys instead
  of a constraint error, and a project naming a second space alike is refused in words.
  Recording a summary or report while another writer commits no longer fails with
  `database is locked`.
- **A press on the board no longer crashes the tab.** Chromium 156 crashes the renderer on
  a press that takes focus out of a `content-visibility: auto` element just back in view,
  in Chrome and in the desktop app. A tile out of sight is now laid out like any other, and
  a press on one just back in view reaches it. A lane still skips its layout, which a space
  of many lanes needs, and keeps the focus of a press inside it.
- **A second press reaches nothing it was not meant for.** A press at the point of the one
  before, with no move between, reaches nothing inside a question or anywhere in a card's
  thread unless it lands on the same control, however long after it comes, and the scrim
  follows the same rule. So a double click cannot choose or send in the next question, and on
  a tile it leaves the card open with its reading keys alive. Moving more than 3 px or turning
  the wheel ends that, and keys are never held back.
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
