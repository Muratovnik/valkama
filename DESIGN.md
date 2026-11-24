---
name: Valkama
description: A dense, calm, dark operations console for planning, executing, and reviewing agent work.
colors:
  navigation: "#030405"
  navigation-raised: "#191a1b"
  navigation-active: "#262728"
  canvas: "#181818"
  surface: "#252525"
  surface-muted: "#333"
  surface-hover: "#3d3d3d"
  surface-active: "#464646"
  text: "#ececec"
  text-muted: "#c4c4c4"
  text-tertiary: "#a8a8a8"
  navigation-text-muted: "#8f8f8f"
  rule: "rgb(255 255 255 / 8%)"
  rule-strong: "rgb(255 255 255 / 18%)"
  scrollbar-thumb: "#464646"
  scrollbar-thumb-hover: "#5c5c5c"
  accent: "#7cacf8"
  brand-body: "#ececec"
  brand-accent: "#08c5d5"
  action-primary: "#ececec"
  danger: "#f99a8f"
  success: "#7bd6a1"
  warning: "#d9b06a"
  kind-bug: "#ff9db5"
  kind-container: "#cfa0ff"
  kind-improvement: "#7defdc"
  kind-task: "#b4c6e0"
  series-1: "#3987e5"
  series-2: "#d95926"
  series-3: "#199e70"
  series-4: "#bf51b0"
  series-5: "#c98500"
  series-6: "#9085e9"
  series-apart: "#e6e6e6"
  series-other: "#a8a8a8"

typography:
  scale:
    meta: "12px"
    dense: "13px"
    interface: "14px"
    emphasis: "15px"
    section: "16px"
    module: "18px"
  display:
    fontFamily: "'Inter Variable', 'Onest Variable', sans-serif"
    fontSize: "1.5rem"
    lineHeight: 1.3
  interface:
    fontFamily: "'Inter Variable', 'Onest Variable', sans-serif"
    fontSize: "1rem"
    lineHeight: 1.5
  control:
    fontFamily: "'Inter Variable', 'Onest Variable', sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.4
  metadata:
    fontFamily: "'Cascadia Mono', Consolas, monospace"
    fontSize: "0.8125rem"
    lineHeight: 1.3
rounded:
  control: "8px"
  panel: "10px"
  status: "6px"
  shell: "12px"
spacing:
  compact: "8px"
  component: "12px"
  panel: "16px"
  section: "36px"
  page-gutter: "clamp(20px, 2.5vw, 32px)"
  column-gutter: "24px"
  control-height: "40px"
  control-height-compact: "36px"
  control-target: "44px"
  nav-expanded: "260px"
  nav-collapsed: "64px"
  inspector-default: "440px"
---

# Design System: Valkama

## Direction

Valkama is a desktop workspace for reading and moving a large amount of work,
and every rule here serves one aim: a reader finds an item, what state it is
in and how much it matters at a glance, without reading every word on the
screen. The qualities the interface keeps — dense, calm, dark, low chrome,
text first, detail beside the work — are kept because they serve that aim. A
dark ground lets the few marks that carry meaning stand out; density keeps a
whole column of work in one view; a state written as a word reads without a
legend.

A rule earns its place by legibility and hierarchy, measured where it can be —
a contrast ratio, a count, a size — and never by resemblance to another
product. The look was first pointed at with a reference application's mood;
that reference was a direction for the mood, not a specification, and
matching it is not a criterion anywhere in this document. No third-party brand
assets (logos, proprietary typefaces, names) are used, with one narrow exception:
an agent client's or editor's own mark may stand for that product as a client or
a place to open in, and nowhere else. It is the vendor's own drawing, unchanged,
filled in the ordinary icon colour and never the vendor's colours, sized like the
glyphs beside it by the icon owner, which records its source beside it. Three are
drawn. Cursor's cube, which its brand page gives in single colours. VS Code's
icon in Microsoft's white variant, which Microsoft allows "only when there isn't
enough contrast otherwise": the blue's darkest band has 2.5:1 on a list, 1.8:1 on
a control and 1.5:1 on a highlighted row, under the 3:1 WCAG 1.4.11 asks of a
graphic. Codex's icon as OpenAI draws it in one colour on its own Codex page.
Claude keeps a neutral glyph, because Anthropic allows its marks only in
materials it approves. A place with no mark of its own keeps a neutral glyph and
never borrows another product's.

This is an application, not a themed dashboard. The shell is dark throughout;
hierarchy comes from tonal steps, typography, and a small set of colours that
each mean one thing. There are no paper surfaces, textures, decorative
diagrams, glass, gradients, glow, oversized marketing headings, or game-like
chrome. The one gradient allowed is inside `mask-image`, where it adds no colour
and only fades the end of a strip that scrolls on past it.

## System rules

- Navigation stays on the left, expands to 260px, collapses to 64px, and can
  accept more destinations without becoming a horizontal game menu.
- Spacing stays on the four-pixel grid: label/value gaps are 8px, heading/content
  gaps are 12px and panel spacing is 16px. What a module lays out stands at four
  levels, each with its own gap: sections 36px apart, the groups of a section
  24px, the blocks of a group 16px and the lines of a block 4–8px. The air between the
  parts of a section is declared once, on the section, and two blocks a section lays out side
  by side stand that far apart one under the other, so the air after every part of a section
  is the same whichever view each block shows: the day chart stood 16px under a ring, whose
  drawing reaches its block's foot, and its heading read as stuck to it. A heading says
  its level before it is read: the type scale gives each level one size in every
  module — the module's name `module` 18px, a section `section` 16px, a group
  `emphasis` 15px, a block `interface` 14px and a label over a block's lines
  `dense` 13px — so no heading is the size of the level over it. Everything on a line of a
  heading's row shares one centre line — the heading, an icon-only control, a text button, a
  switch: aligned by baselines, the menu at a quota account's name, which has no baseline of
  its own, stood 3px above «Name» beside it. With no group level, an account of the quota stood
  16px from the next like any block, under a heading as large as its section's,
  and six accounts ran together into one 4279px list. A module keeps
  `--size-page-gutter` from the panel edge. Density comes from alignment and
  disclosure, not from tiny type or cramped targets; taking it from the gaps
  instead is what made the shell read as crowded — rows whose parts touch are
  read as one blur rather than scanned.
- The context bar names the current module once. A module must not repeat the
  same title or introductory copy merely to fill space. A line under the name
  earns its place only by stating a fact the reader acts on; every module once
  carried a sentence describing what the module is, which the rail and the
  screen already said, and it took a second row of the header for it.
- A permanent explanation is not placed. A paragraph that stands over a section
  saying what it holds or what its search searches is read once and then pushes
  the content down on every visit; a card's History, Executions and their intro
  each carried one, and they came back after being taken out once. Where an
  action is not predictable from its control, the control says it in its own
  place: a placeholder in the field, the empty state when there is nothing, or
  a `detail` hint on the control. A field's own hint under it (`VField`) is part
  of that field, not a paragraph over a section.
- The shell has two zones and they must read as two. The chrome — the
  navigation rail and the context bar — is the dark backing of the whole
  window, and the workspace is a lighter panel lying on it. Two adjacent zones
  separated only by a sub-threshold delta collapse into one dark mass, which
  this palette has now managed three times: `#0d0d0d`/`#121212`, after the
  direction was inverted the first time `#181818` chrome against a `#121212`
  canvas, and then a `#0e0f10` graphite under the `#181818` panel — 1.08:1,
  which the owner read as everything merging into the graphite.
- The left and top chrome use near-neutral graphite with a subtle cold
  undertone; the workspace stays neutral. A neutral `#0d0d0d` under the rail
  read as absence rather than as a surface — the owner asked twice for a color
  there — which led to a cool backing. The graphite has a two-point channel
  spread, much less blue than the earlier ramp, and it now stands at
  `#030405`, darker than that `#0d0d0d`: it is the one rung that can carry the
  1.15 seam to the panel (the ladder below says why), so the cold lean is
  what remains of the colour there. A violet chrome once
  tried to solve the same problem and tinted every panel in the shell instead,
  which is a color the product does not mean, so the panel's neutrality remains
  essential.
- `designTokens.test.ts` owns both statements as one oracle with two ways to
  pass, because there are two ways to be right. The current graphite uses the
  neutral branch: its channel spread is at most 2, and it owes a ratio of 1.6.
  The oracle also permits a distinctly tinted chrome, which carries a second
  signal and may sit at 1.35 when its cast falls between 6 and 14 — below that
  there is nothing to see, above it the shell is painted rather than lit. The
  workspace must be neutral in either case. The floor is the part that has
  been wrong before: at 1.2 the test passed both merged pairings above, and so
  certified the very defect it was written for, which is why the oracle now
  carries the failing pairings as cases rather than as prose. The three chrome
  tokens must stay on the same chosen branch, since a mismatched hover would
  make a seam one state deeper.
- The chrome is one ground with a corner in it, painted from one token. The
  rail and the context bar drew from two, so the corner where they meet had a
  seam and the header read as a third zone; the same test pins both to
  `--color-navigation`.
- The workspace panel is the only element that breaks out of the chrome, and it
  does so at one corner: the top-left, where the rail and the context bar hand
  over, at `--radius-shell`. The tone step between the two zones is the whole
  boundary — the corner drew a hairline on its two edges once, which was a
  second divider on a boundary the tone had already divided. Its other three
  sides run to the window, so the shape costs no working width.
- Surfaces are one ramp and depth is a step on it: chrome, workspace panel,
  ground, sheet. An object lies one step above the container holding it — a card
  on a lane, a lane on the workspace — and never level with it. Each rung has
  exactly one token, and the two that are positions rather than tones are named
  as such. The contrast is the WCAG 2 ratio to the rung the thing lies on:

  | Rung | Token | Value | Contrast to what it lies on | What stands there |
  | --- | --- | --- | --- | --- |
  | chrome | `--color-navigation` | `#030405` | — | the rail and the context bar |
  | workspace panel | `--color-canvas` | `#181818` | 1.16 on the chrome | the module panel |
  | ground | `--color-surface` | `#252525` | 1.16 on the panel | a lane, a list, a table, a drawer |
  | sheet | `--color-surface-sheet` | `#333333` | 1.21 on its lane | a card, a panel lying on a ground |
  | control | `--color-control-surface` | `#3d3d3d` | 1.16 on a card | a resting control, a hovered card |
  | pressed | `--color-surface-active` | `#464646` | 1.15 on a control | a hovered or chosen control |
  | recess | `--color-surface-recess` | `#181818` | 1.41 under a card | a goal's well, a strip cut into a card |

  Separation without a line is a contrast, so it is measured as one. Every
  pair of grounds that stand side by side owes 1.15 — the workspace on the
  chrome, a lane on the panel, a pointed-at card over its rest, a control and
  its hover, a rail row pointed at and the chosen row beside it — and a card
  owes 1.20 to its lane, the smallest seam the interface already showed as two
  surfaces. The ladder before stood 1.08–1.10 at every seam and read as one
  grey mass, and the one after it still left the chrome at 1.08 under the
  panel and a pointed-at card at 1.13 over its rest, which the owner read as
  everything merging. Hovered and pressed are one rung, so a control has one
  step to make, not two. The ratio's `+0.05`
  models glare on a real screen, which is why a channel difference cannot stand
  in for it: eight hex units at the dark end are a large ratio of two tiny
  luminances that a good panel in a dark room shows and an office monitor in
  daylight does not. It is also why the chrome carries the seam to the panel:
  at the dark end 1.15 costs the most, and every rung above the chrome is at
  its ceiling — the pressed step holds the danger action's red word at 4.52:1
  and cannot lighten, and each step under it is the lightest that still owes
  its floor to the next — so lifting the panel would have lifted the whole
  workspace into that red word. `designTokens.test.ts` holds the floors by
  name and keeps both ladders that blended as cases it must reject.

  `--color-surface-sheet` and `--color-surface-recess` are roles: a container
  standing on another rung may re-point one to stay a step above itself — the
  drawer stands on `--color-surface`, the rung the default sheet already sits
  above, so it re-points nothing — and a rule that must be one exact tone
  wherever it renders names the palette step instead. The panel that says a read
  failed reads its fill from `--color-state-panel-surface`, which falls back to the
  sheet; a host lying on the workspace panel itself — the Work module's frame, every
  project's work, installation health, the shell's recovery, a task's link — names
  the ground there instead, because the sheet stood two steps up, 1.41 to the panel.
  What a chart's table keeps in place while the rest passes under it — the names at
  its frame's start, a section table's heading row and total — is painted in
  `--color-chart-table-ground`, the canvas unless its host names the ground it lies
  on: a quota account, on a surface of its own, names that surface, where the canvas
  stood as dark blocks on it.
  A question asked in place (`ConfirmStrip`) is a block of the sheet's tone where it
  stands on a ground; on a sheet, whose tone that already is, it draws no ground and
  no inset and its words start on the sheet's edge. The strip reads which of the two
  it stands on, since a flag every host had to set was left off a refusal, where it
  drew a block nobody could see and a third left edge. A rung that names the
  same palette step as another rung is a duplicate and fails
  `designTokens.test.ts`, which reads the rungs out of the palette; a role names
  the rung it stands on (`--color-surface-hover` is the resting control's rung,
  which is where a pointed-at card or row lifts to). The palette shipped
  `--surface-panel` and `--color-surface-sheet` painted identically, and later
  `--color-surface-hover` and `--color-control-surface` as two rungs of one
  grey, while the check read a hand-written list of two. A group cut into
  a ground is the one move that goes the other way: a goal's bundle is a well one
  step *down* from the lane, because a second outline around cards that already
  have one would be two frames deep. What lies in a well still counts its step
  from the ground the well is cut into, not from the floor of the well, or the
  cards inside it would sink to the ground's own tone and the group would read
  as a hole with nothing in it. The direction keeps the work brightest: the
  window's under-colour is the darkest thing on screen and the content lies on
  it as a lighter rounded panel, so the eye starts where the work is. The
  chrome uses a near-neutral graphite ramp (`#030405`/`#191a1b`/`#262728`) with
  a two-point channel spread at each navigation step, keeping the shell subtly
  cool while the workspace remains neutral.
- The canvas, lists, panels, fields, and inspectors use the neutral ladder
  above. Light tones are reserved for text and the primary action button, never
  for large page surfaces.
- Three text tones carry rank inside a row — full, muted, tertiary — and each
  holds 4.5:1 on every ground it is drawn on. The tertiary tone is drawn on a
  hovered card, so that is the ground it is measured on; a control and its
  pressed state carry only the full and muted tones. Lifting the grounds lifts
  the text: the tertiary tone stood at 4.08:1 on a hovered card before the
  ladder moved. The three stay three — full over muted at least 1.4, muted
  over tertiary at least 1.3.
- The primary action is a light button on the dark ground. The accent
  identifies selection, focus, and links, always as a ring, an outline or the
  text itself around what is chosen; a state never draws a ring.
- A colour on a work item means one thing, everywhere it appears, and ordinary
  work carries none. `uiSystem.ts` assigns them and nothing else does:

  | Tone | Means | On a work item |
  | --- | --- | --- |
  | `info` (blue) | work moving | in progress, a held item on the graph |
  | `success` (green) | finished, healthy | done |
  | `warning` (amber) | a decision waiting, or high priority | review, awaiting confirmation, a stale claim, high |
  | `danger` (red) | stopped, or urgent | blocked, urgent |
  | `neutral` | nothing to act on | triage, deferred, ready, cancelled, not started, low and medium priority, workable |

  Hue says how much it asks of the reader and shape says which fact it is, so a
  state and a priority that share a hue never share a shape. A kind is not on
  this table: it says what an item is, so it has a colour of its own below and
  no tone. A colour that appears on every card is a colour nobody reads: in
  progress used to be the green of done, the queue the blue of focus, and
  workable — the ordinary condition of work waiting to be taken — a green line on every
  second card, which made it the loudest colour on the board and the one that
  meant least. Each hue holds 4.5:1 as text on a hovered card and 3:1 as a mark
  on a pressed control (WCAG 1.4.3 and 1.4.11); `designTokens.test.ts` holds
  both, and `uiSystem.test.ts` holds the meanings.
- Color is never the only state signal. Every status has a stable text label
  and uses the shared semantic-state component.
- A kind's colour names the kind and never argues with a state. It draws the kind's
  glyph and word and nothing else: a card, a column, a frame and the zoomed-out
  graph node stay the state's to speak on. Its hues keep out of the state's way: a
  goal and a stage share one colour, as they share one sign, an epic loot's purple lifted
  until it reads (`#a335ee` stands at 1.93:1 on the hover card), a bug is rose because the coral beside it is blocked, an improvement
  turquoise because green is done, a task a grey-blue because blue is in progress. Each
  default holds 4.5:1 on every ground a mark stands on, the hover card being the
  lightest, and the four stay apart under protanopia, deuteranopia and tritanopia;
  `kindColors.test.ts` holds both, and the glyph and the word carry the kind regardless.
  `check:ui-system` refuses one on a background. There is one way to it: the facet
  registry names a mark's kind, an element says it with `data-kind`, `shell.css` turns
  that into `--color-kind-ink`, and what draws the kind reads that. Nothing else names a kind's colour. The owner's choice lands on the
  document's root over `--color-kind-*`, before anything is drawn. A forced palette
  takes all four back for its own ink.
- A meaning colour may occupy a mark or an edge, never a surface. A dot, a glyph,
  the text itself, or a 3px inline-start marker carries the state; a tinted
  panel spends a whole surface on what its own sentence already says, and a
  screen holding several of them reads as a screen full of alarms.
  `check:ui-system` rejects a meaning colour blended into a background or a
  container border, and holds the few areas filled with one straight — a dot,
  a 3px edge, a ticked step's box, the zoomed-out graph node — to an exact
  ledger (`FILL_BUDGET`), each with its role. A control's own state is not on
  it: a switch that is on, a checked box and a chosen option take neutral
  ink — the primary-action fill, the text tone — because "on" is where a
  control stands, and the green that painted it said "done". The family it guards is declared once
  (`scripts/ui-system/semantic-colors.mjs`) and shared by the tint rule, the
  line ledger and the state-ownership rule; a test holds it equal to the tones
  `uiSystem.ts` paints with, so a new meaning colour cannot arrive unguarded.
  The guard never decided which facts get a colour — the tone map does, and
  `uiSystem.test.ts` is what holds it.
- Separation is tone and air; a drawn line is an earned exception. The review
  that forced this law counted 151 one-pixel lines across 42 files — every
  control outlined, every panel boxed — and named the signature: a designer
  differentiates with color and fill, a generator draws a border around
  everything. Four roles earn a line, and only these: a **divider** between
  rows or sections that share one ground (`--color-rule`); the **field** edge of a
  place to type (`--color-rule-strong`); the **overlay** hairline that keeps a
  floating surface from melting into what it covers, always lighter than both
  grounds; and a **status** edge — 2-3px in a semantic color that carries real
  state. One boundary, one divider: a container whose tone already separates it
  draws no line, and a header band above a hairline is two dividers saying the
  same thing, so one of them goes. `check:ui-system` keeps the ledger
  (`LINE_BUDGET`): every file's drawn-line count is recorded exactly, and both
  a new line and a silently vanished one fail the gate until the ledger is
  changed in the same commit, with the role named.
- A line drawn as a ground is still a line. Seven containers set their gap to
  one pixel and painted `--color-rule` behind their children, which draws a hairline
  at every seam — a list of eight rows drew seven — and cost the ledger nothing,
  because the ledger reads borders. That is why the interface could read as
  ruled everywhere while the ledger said the product barely drew a line.
  Separate those with air and a ground of their own; `check:ui-system` rejects
  the pair.
- A control is a fill, never an outline: rest one step above its ground
  (`--color-control-surface`), hover one step further (`--color-surface-active`); in the
  chrome the same grammar runs on the chrome's own ramp. The control fill and
  `--color-surface-hover` are one tone, so a hover written with the second over
  the first draws nothing, which two controls did. The primary action is
  the light fill; an outlined control reads as lower emphasis than a filled one
  everywhere the pattern is documented, which is the opposite of what an
  interface means by a button.
- One rule weight, expressed as a percentage of white rather than a fixed grey,
  so a hairline reads the same on every step of the ladder.
- Statuses have exactly one owner. `uiSystem.ts` maps a typed dimension and
  state to a tone; components render the tone. A second mapping keyed on the
  same state in CSS is how `todo` came to have a dot and no border while `dev`
  had a border that disagreed with its dot.
- The palette has two tiers and the application only ever names the upper one.
  Primitives are raw values — the gray ramp, the blues, the size scales — and
  semantic tokens say what a value is for and resolve to a primitive.
  `check:ui-system` rejects a component reaching for a color primitive, because
  a screen pinned to `--color-gray-900` is pinned to a step rather than to a meaning
  and the next palette move goes around it. That was not hypothetical: the
  raised chrome and the canvas were `#181818` written twice, with no way to move
  one without the other — which is exactly what tinting the chrome requires. The
  size scales are primitives that are named directly on purpose, so the rule
  reads a token's value rather than its name. Two tiers and not three: Primer
  and Pajamas both mark their component tier "limited in use" and USWDS ships
  two, which is the right size for one product on one platform.
- `tokens.css` is the source and every other copy of a token is generated from
  it by `scripts/sync-tokens.mjs` — the semantic tone map, the favicon,
  the Windows ICO, the Electron window and its offline page, the page a listener
  answers when the app takes a link, and this document's
  own frontmatter. Copies exist because a browser tab, an ICO and a
  window frame resolve no custom property, and every one of them had drifted at
  least once; tests caught that drift but could not fix it, so a palette change
  meant editing seven files by hand. Each site names an anchor that must match
  exactly once, so a moved anchor fails loudly instead of silently doing
  nothing. The document's `spacing:` block is not generated yet.
- How tall a control stands and how large a pointer target it offers are two
  measurements with two tokens. `--size-control-height` is the row a control
  occupies and belongs on its outermost box; `--size-control-height-compact` is the
  same idea for a control riding a dense header. `--size-control-target` is the
  pointer area, and it is spent only where there is no label to widen the box —
  an icon button, a tag in a card foot, a 22px switch — where the extra pixels
  go on a hit area rather than on the drawing: under a finger or on a phone-wide
  screen an icon button or a toggle shown as its glyph alone (`VButton`, `ToggleChip`)
  answers a press across the target around what it draws, and its row keeps its height;
  a line of inline icons too close together to reach grows each icon's box instead.
  Whether a finger presses is asked once, in `reach.css`, and every control takes its
  target from there; `check:ui-system` refuses a window width anywhere else in a query
  list. The rail's own buttons and a card head's 28px copy-link icon
  do not reach yet. The floor everything clears is
  WCAG 2.5.8 at 24px; 44 is the 2.5.5 AAA figure and this product spends it
  wherever a control has no label of its own to widen the box, which is where
  the difference is felt. One token used to answer both,
  which is how a 2px-inset tab track came to stand 48px beside a 44px button in
  the same toolbar: a control that sizes its inner element is structurally
  taller than the thing it wraps. A track takes the row and subtracts its own
  inset. `check:ui-system` keeps a ledger of literal heights in the 28-56px
  band, exact in both directions like the line ledger. The base rule gives every
  `button` the control's height, so a button that is a line of text and not a
  control gives it back: a tile's title stood centred in 40px with up to 22px of
  hole around it, and a list row's reference moved the row's shared baseline down
  13px, for as long as nothing compared the two boxes. A compact field gives it
  back too, or it stands 4px over the compact controls beside it.
- **Controls of one row are one size.** A row's owner names the size, not each
  control in it: `SectionHeader` hands its actions slot one size, compact, so a
  section's switch and its button cannot drift apart again — the chain's heading
  held a 36px scope switch beside a 28px «На графе». A label chip standing alone
  is drawn across the whole 28px it is pressed across, the height of the «+»
  beside it, rather than as tall as its words. A field holding chips keeps the
  field's height: a chip's remove button gives the base rule's 40px back, which
  had stood the new-task labels field 52px tall beside a 40px parent field. A field's
  advice for an empty field is its placeholder, never a hint under one field of a
  pair, which stands that field taller than its neighbour.
  `production-row-controls.spec.ts` measures each such row's heights and top edges.
- **A menu draws a value as its button does.** A list of priorities, kinds or states
  — the card's state and priority, the new task's kind and priority, the filter's
  kinds, priorities and states — draws each value with the registry's mark
  (`choiceMark` in `facets.ts`, `useFacetChoices`, `FacetChoiceMark`): a priority's
  glyph in its tone, its word and what it means as the row's note; a kind's glyph and
  word in its colour; a state's dot and name. Its button draws the chosen value the
  same way, so a value reads one way above the list and in it. Priorities stand most
  pressing first everywhere they are offered. `ChoiceSelect` takes the drawing through
  its `option` slot and `OptionGroups` through its `text` slot; neither knows a facet.
  `production-choice-marks.spec.ts` compares each row with its button.
- **A form asks in the order the card reads.** The new-task dialog asks for the title,
  then the kind and the priority, then the project and the labels, then the parent on a
  row of its own, and the description last: its rows come from `FACET_ORDER`
  (`COMPOSER_ROWS`), the order every surface reads an item's facets in, the project before
  the labels as what the work changes before how it is marked, and the description follows
  the facts as it does on the card. The project and the labels share a row where each has
  240px and stand one under the other on a phone, where a chip and the input took two lines
  in half the dialog; the project is named above its input as the labels are, so the two
  inputs stand level. It used to ask for the description between the two pairs.
- **«Новая работа» says what the new work is and where it starts.** A stage is a goal
  under a parent, so the kind offers no stage of its own: «Цель» chosen with a parent reads
  «Этап», with a stage's mark, and is sent as a goal, which the server makes a stage
  (`composerKinds`). A stage offered on its own was refused for want of a parent. The
  project field starts on the project the workspace stands on, the one the scope narrows
  to or else the space's default, and offers the space's projects; the dialog names a
  project only where another than the default is chosen, and the server reads the default
  otherwise. A goal or stage holds the work of any project and names none, which the server
  enforces, so for one the field says «Любой проект», takes no choice and says why in its
  accessible description. A space with no project, or whose projects were not read, draws
  no field. A switch under the description, «В „Не разобрано“», named by the workflow's
  one triage state as the interface names it, leaves the new card there, for work raised
  before it is sorted: the owner's own write otherwise lands where the workflow puts it. A
  workflow with no such state, or two, draws no switch (`triageState`). Every field starts
  over each time the dialog opens.
- **«Новая работа» chooses its parent from the tree.** The field offers «Без цели» first,
  then every goal and stage of the space at any depth, laid out by the tree's model
  (`treeRows`) as the list draws them: each under the one it stands in, open before
  closed and the newest first among the ones beside it. An option's note is the path
  above it, the references of the goals and stages it stands in, and its state, and
  the search reads the note too, so a stage five levels down is found by its title or
  by the number of any goal above it. Another space's goal is not offered: it holds
  work only in its own space. A space with no goal or stage offers «Без цели» alone.
  Only goals at the top level were offered, so a stage could not be chosen at all.
- **A failed write keeps the dialog as it was typed.** The title, the kind, the
  priority, the labels, the parent and the description all stay, and the reason
  stands below them in the dialog's own words: «Работа не создана:» and the server's
  reason where it refused, «сервер не ответил» with a request to try again where it
  did not answer or failed itself, and «Работа не создана» alone for an answer the
  client could not read. The dialog showed the error as the client caught it, the
  server's sentence bare or `HTTP 503`, which named no work and said nothing of what
  to do next.
- Corners stay at 8px for controls, 10px for panels and 12px for the one shell
  corner; small status chips may round fully. Depth is primarily tonal; shadow
  is reserved for an overlay that must be distinguished from its owner surface.
  What a modal drops on the window and what a floating surface casts are two
  tokens, `--color-overlay-scrim` and `--color-shadow`. Both were literals written
  into four components in four different near-blacks at four strengths, unseen
  by the color guard because it read `#hex` and these were `rgb()`; the scrim
  was the weakest of them, dimming the canvas by about one step of the grey
  ramp, which is the distance between two ordinary surfaces — so a dialog read
  as one more panel rather than as something over the window.
- Two columns of one record stand `--size-column-gutter` apart. A grid spends the
  whole gutter as its gap and a real `<table>` spends half of it inside each
  cell, which is why the same idea had drifted to 24px in one table and 12px in
  another, close enough there for a name ending in an ellipsis to touch the
  next column's text.
- A type style is one decision, so it is one token. A size, a leading and a
  weight are read together and mean nothing apart, and 139 rules were assembling
  them by hand out of 8 sizes, 5 leadings and 4 weights — 47 distinct styles, 22
  of them written more than once in files that had no way to know about each
  other. `tokens.css` names those 22 as `--font-<role>`, a whole `font`
  shorthand under one name, and a component writes `font: var(--font-label)`.
  `check:ui-system` fails the *second* rule to assemble a style by hand: a style
  written once is not duplication and stays where it is written. A rule that
  decides two of the three slots and leaves the third to inheritance has not
  assembled a style and is not asked to name one — a role token cannot express
  it, because the shorthand always sets a leading.
  Naming the 22 left a finding in plain sight rather than fixing it: the reading
  size carries four leadings and the 600 weight carries four more, which is more
  type styles than one product needs. Merging them changes the interface, so it
  is a decision with an owner — but it is now one decision in one file.
  A type role is not a utility class and does not become one. The class still
  says what the element is and lives with the element; only the value is shared,
  exactly as a colour is. A `.text-label` in `base.css` would put a class a
  component cannot see inside that component's markup, which is the failure
  scoped styles exist to prevent — and it would delete 6 of the 114 rules,
  because the other 108 set a colour or a padding too and stay either way.
- Two font families, not four names for two values. `display`, `body` and
  `utility` were byte-identical, so 63 rules chose one of three names for one
  font; what this product distinguishes is `--font-family-interface` and
  `--font-family-mono`.
- A size is named, never spelled. `tokens.css` owns the ramp as `--font-size-*`
  and the leadings as `--line-height-*`; a component names a step. The ramp used to live
  only in this document while every component wrote the number, which is how
  one overlay title came to exist at 19, 20, 20 and 21px in four files, and how
  `0.8rem` — a 12.8px step nothing had chosen — survived in the palette itself.
  stylelint rejects a literal size or leading, including one that lands on the
  ramp by luck, and it reads the `font` shorthand as well as the two longhands —
  most of this app's typography is written as a shorthand, so a rule on
  `font-size` alone would have covered a third of it. A fallback is a literal
  too: `var(--text-secondary-size, 0.75rem)` spelled 12px behind a token that
  was never missing.
- Layout asks its container how much room there is, never the window. The rail
  is 260px or 64px depending on a state the viewport knows nothing about, the
  inspector's width is dragged by the operator, and a dialog stops growing at
  640px — so a viewport threshold names the wrong box by up to 196px in the
  shell, and a dialog was rearranging its fields on news about the monitor.
  Named containers: `main` right of the rail, `workspace` for the module panel,
  `overlay` for a dialog, drawer or inspector, plus `nav`, `card`,
  `filters`. A shared primitive queries
  the nearest unnamed container, because it stands in more than one of them.
  The two exceptions are the elements that size themselves — the rail and the
  drawer — and `check:ui-system` owns that list.
- Styling has one system: semantic tokens plus class names that say what the
  element is. A utility framework is not a second system to fall back to, and a
  class named after its own declarations is the same mistake by another route.
  Tokens live in `tokens.css`, element defaults in `base.css`, application
  chrome in `shell.css`, and everything else in its component's scoped block.
- The stylesheet language is CSS, and nesting is native and shallow. Chromium
  156 — what the desktop app runs — ships nesting, `:has()`, `@container` and
  `@property`, so a preprocessor would buy none of them. It would also bring a
  second nesting language: Sass desugars textually without `:is()`, so the same
  source resolves to a different specificity than the browser gives it, and the
  one thing Sass alone still has — `@mixin` — has no counterpart to replace,
  because every repeated recipe here belongs to a primitive that already exists.
  Nesting goes two levels at most; `&` names a state or modifier of the same
  element and never concatenates one (`&__title` is Sass syntax and invalid
  CSS); and `&` carries the specificity of `:is()`, the highest in its parent
  list, so a nested rule is not automatically the weaker one. `vite.config.ts`
  pins `cssTarget` to `chrome150` so the bundler ships that nesting rather than
  flattening it back out.
- A component's class names are one family, not several. Every class names a part
  of that component and carries the component's own stem, so a reader can tell at
  a glance which file a name belongs to and how the parts relate: `card-foot`,
  `card-foot-labels`, `card-foot-label`, `card-foot-counts`. A modifier is the
  exception and takes no stem, because it is an adjective rather than a part
  — `active`, `selected`, `stale`, `recessed` — and it is always written
  beside the part it qualifies.
  The failure this ends is a file whose classes share nothing: `SessionActions`
  named its five parts `detail-actions`, `link-button`, `ack-inline`,
  `open-notice` and `no-card`, five families for five parts, and none of them
  said which component they came from. `.panel-kicker` is the other half of the
  same problem, copied into a second component with the rule left behind in the
  scope it came from, where it had been rendering as plain text for as long as
  nobody looked.
- A repeated recipe belongs to an owner, in this order: a primitive component,
  then an existing class in `shell.css` or `base.css`, then — only when the
  recipe belongs to no component — a new named class recorded here. It is named
  for what the thing is, never for what it declares; a per-property utility is
  the second styling system arriving under another name.
- IDs, hashes, paths, and code use the metadata font — what a person compares
  character by character. A timestamp is read rather than compared and stays in
  the interface font; six of them set in mono is what made the session ledger
  look like a log file.
- Seven steps, and 12px is the floor. Hierarchy is carried by weight and by the
  three text tones, not by inventing an eighth size; a screen that needs 11px to
  fit is a screen with too much on it, which is the disclosure problem wearing a
  typography costume.
- 12px is chrome, 13px is the reading floor. Text a person reads to decide —
  titles, labels, tags, states, counts they act on — is 13px or larger; 12px is
  reserved for chrome minutiae such as a column count or an axis label. The
  interface once held 131 declarations at 12px against 22 at 14px, which is an
  interface typeset at its own floor and why it read as too small.
- Weights come in four stops: 400, 500, 600, 700. Seven ad-hoc stops (620, 650,
  680, 720, 750…) crept in and made near-equal text argue about emphasis;
  `check:ui-system` rejects a weight outside the scale.
- A scan surface — a board card, a table row — uses at most two type sizes: one
  for its title, one for everything else. Rank inside the row comes from tone
  and weight, never from a third size.
- A screen decides what leads, and on a scan surface one thing does. The
  `--font-row-title` role stands at 500, a step under a section's heading; what
  stops the work and who holds it take the muted ink, and identity and labels the
  tertiary one. The role stood at 600, which put 73% of a board's characters at a
  heading's weight while the same title in a list row stood at 400: earlier work
  settled how each fact is drawn and never which of them a reader meets first, so
  everything was shown at once at one weight. A second question a screen can
  answer goes behind one action rather than beside the first.
  `production-density.spec.ts` holds this where it is drawn.
- A KPI figure is the one step above the scale, at 28px, and every figure in a
  strip is the same size. Which one leads is said by order and column width; a
  second larger figure only adds a third size to a row of four numbers. Every
  figure of a row of tiles stands at one height, in both languages and at every
  width: where a tile's name may take more lines than another's, the figure
  stands over the name, at the tile's top. Under names of one, two and three
  lines, Volumes' figures stood up to 34px apart in one row.
- The module is named once, by the context bar. A page does not repeat that
  name in a display heading, and a section heading inside a page is a section
  size, not a page size.
- A background refresh never blanks or rebuilds what is already drawn. The old
  projection stays until its replacement is ready, and a stream frame is
  written only when the payload actually changed (`EventFrames` on the server,
  frame dedup in the planning view). The degraded banner and the endlessly
  reloading graph were both this one invariant, violated in two places. It has
  a geometric half too: background work takes no room while something is
  drawn. It is announced to assistive technology, and said on screen only once
  it has run long enough to be noticed (the graph's re-layout after 600ms), in
  space the layout already holds — never as a line pushed into the flow, which
  is how a status above the graph moved the field 43px on every refresh, and
  never by putting "Loading…" in place of a list it is reading again.
- A first read of what a view shows, a space opened or switched to, takes the stage under
  the view's bar and never the bar: the controls that say how the work is looked at are the
  operator's, not the data's, and a switch of space that took them away for the length of
  a read read as the view being lost. What the bar counts it says only once it has read it.
- A wait is said only once it has lasted, and then long enough to be read: nothing for
  the first 500 ms, and once shown at least 200 ms, with whatever arrives meanwhile held
  back until then. `web/src/shared/ui/loadingPresence.ts` holds both numbers and the rule,
  and every read wait goes through it: `PlatformStatePanel`, the downloaded views, and a
  wait said in a line of its own — a section of a card, a dialog's note, a search, whose
  delay counts from the keystroke. A screen whose own branch takes the panel away keeps
  the branch while the rule says the wait is held. While it is not shown, the panel keeps
  its box and its busy mark and paints nothing, and a line keeps a line's height, so the
  place does not collapse and grow back.
  The delay is 500 ms because that is the default of the spin-delay library and of
  Turbo's progress bar, and because Primer advises showing no indicator for a wait under
  a second. The minimum of 200 ms is the spin-delay default too; it keeps a read that only
  just outlasts the delay from flashing for a few dozen milliseconds. The earlier 300 ms
  delay was too short for a cold first entry: a reply that arrived just after 300 ms
  lengthened the wait by about 370 ms, in 2 of 10 cold board entries and 3 of 10 list
  entries. A switch of space on a two-megabyte board reads in about 170–200 ms, which
  the 500 ms delay also covers with room to spare.
- Before the application mounts, `web/index.html` draws the shell's chrome and nothing
  else: the rail with its mark and the outline of its first entries, the context bar and
  the empty workspace panel, each where the shell draws it, so the shell takes its place
  without a jump and a slow bundle never leaves the bare ground on screen. The desktop
  window's starting page draws the same chrome while it finds the server. Neither ever
  draws a row of content, a count or a word of what the workspace will show: loading the
  code is not a read, and the board's own read wait is the rule above, unchanged.
  `web/tests/startupSkeleton.test.ts` holds the two pages to one set of rules, and
  `production-first-launch.spec.ts` holds each part to the shell's box within half a pixel.
- The first screen downloads what the shell and the board draw, and nothing else. The
  card, the list of questions waiting for an answer, the graph, Settings and Analytics
  each download behind `web/src/shared/ui/lazyView.ts`: the card once the board stands and
  the page is idle, because opening one is the board's first action; the questions when
  their dialog first opens, beside the read that opening starts. One opened before its
  code has arrived says so with the panel's wait in the place it will stand — the drawer,
  the dialog, the stage — after the same delay, and is never an empty panel. A view that
  draws its own frame around its own waits hands that frame to the boundary (`frame`), and
  the download's wait and failure stand in it: the card's stand in the headless frame it
  draws while its record is read (`InspectorWaitFrame`), with its bar and Close from the
  first frame, so the dots stand in the card's column and do not move when the card's own
  wait takes over. On the drawer's bare ground they stood a frame's inset, 24 px, to the
  left of that column. Only what is
  drawn inside such a place goes behind that boundary: a component that stands closed
  beside the shell, such as a dialog with its frame, would draw that wait in the shell's
  flow. `production-lazy.spec.ts` holds each of them.
- A read wait has one word, the panel's: «Загрузка», "Loading". The surfaces that each
  said what they were reading — «Читаем цепочку…», «Ищу коммит…», «Поиск…» — gave one
  state five names. «Строим граф…» is not a read but the layout of what was read: it keeps
  its words and its longer delay over a drawing (600 ms), and once shown it stays as long
  as any wait does. A search told to open its first match says that instead of the word.
- A wait is announced once, when it is shown: its word is written into a `role="status"`
  region that stands, empty, before the wait begins, and leaves it with the mark. A region
  drawn together with its words is not reliably announced, and one that held them from the
  first frame announced reads that answered before anyone saw them. A view or a dialog has
  one such region (`web/src/shared/ui/WaitStatus.vue`, which the panel carries): a section
  waiting inside it, a card's chain or its attempts, keeps its visible word and its busy
  mark and announces nothing of its own, so one wait is not said twice. `aria-busy` only
  marks what is being read — most screen readers ignore it — and is absent rather than
  `false` when nothing is.
- Interface copy leads with the useful action, state, or cause. Do not append
  self-justifying capability disclaimers, restate the inverse state, or use
  vague quality claims. Name a concrete boundary only where it changes the
  user's decision.
- Warning color and icon already establish attention. Do not add meta-headings
  such as “Why this needs attention”; state the concrete cause and recovery
  action directly.
- A number belongs to the thing it counts. `space-between` on a row of two
  related elements is not a layout decision, it is the absence of one: it sends
  a count to the opposite edge of the label it describes, and a column of such
  counts reads as a table nobody drew. Push apart what is genuinely two groups;
  keep a pair together with a gap.
- And the layout is what places it. A translation names the label alone;
  `CountBadge` carries the value beside it. `"Skills · 37"` welded the two
  together inside the string, which reads as a tab rather than as a fact and
  leaves no way to weight, wrap or move the number. The exception is a count
  that travels inside one control's own name — a segment of a segmented control
  is a single accessible name with no layout inside it, and there the separator
  stays.
- Content is never cut off silently. A box that clips without an ellipsis, a
  line clamp or a scrollbar has lost something the reader cannot know about, and
  the usual cause is a track that cannot be narrower than its own contents:
  `grid-template-columns: minmax(0, 1fr)` rather than the implicit `auto`, and
  `min-width: 0` on a flex child that has to shrink. What gives way first is a
  decision — a long agent name yields before the word that says what is
  happening — and it is spelled as shrink factors rather than left to chance.
  `tests/browser/overflow.ts` reads the browser's own answer on every module at
  two widths; it is the only check here that can see a defect no element's
  declared style is wrong for.
- A word whose neighbours centre on its letters is trimmed to them, by one class:
  `.trimmed-word` in `shell.css`. The trimmed box is the capitals' height, from the baseline
  up, so marks above the letters and descenders stand outside it and anything that clips at
  it cuts them;
  a card's words were written with the trim and an inherited `overflow: hidden`, and every
  «Высокий» read «Высокии». The class says the trim and the sideways-only clip together, and
  `check:ui-system` refuses `text-box` anywhere else. `production-card-alignment.spec.ts`
  holds the rest: a word's own box or an ancestor's that would still cut it.
- A row that carries anything but text aligns by centre. A flex or inline-flex
  box hands its baseline to its first item, so a row aligned by baseline lines
  its neighbours up with a 5px status dot or the bottom edge of a 13px icon
  rather than with the text beside it. Baseline is for a row that is text and
  nothing else. An icon that ends a line of words centres on that line, and on
  the first line once the words wrap, not on the middle of the block they make:
  a review group's chevron stood half a line under the title it ends. One rule
  does it, `LineEnd`: it holds the icons and lends them the baseline of the
  line they end, an unseen space centred where their targets are, and the row
  aligns by `first baseline`, which here aligns a line with a line. A target
  taller than the line moves the words down by half the difference rather than
  rising above the row, so each target keeps its size; a head of one line is
  centred on its icons as before. Aligned to the block, or started at the top
  in a target taller than the line, an icon stood 4–14px under the first line
  of an entry's head, a review's point and a field's label. An option's press
  that opens its description ends its label the same way, in a question and in
  a list under a comment, where a margin had left it 1.5px above the first line.
- A work item's marks read in one order on every surface, and one owner draws them
  (`FacetMarks`, `MarkHead`, `drawMarks.ts`): the kind, the number, then the priority,
  the state, the readiness, the labels, the holder, the parent and the steps
  (`FACET_ORDER`). A surface chooses which marks it prints, never their order, so a
  tile, a list row, a graph node and the hover card read the kind, the number, the
  priority, and the card's head the kind and the number. A search result still lays
  out its own lead, the priority first, and is the one surface that does. A mark's glyph stands in a box that is a line of the mark's
  text, and the mark lines that box up with its word by their baseline; so the glyph
  stands on the same middle as its words on every surface, and on the first line of a
  word that wraps. Centred on the line box instead, a glyph stood 1px high on a tile,
  2–3.5px off in the hover card and up to 3px off on the graph, a different amount on each.
- Every sign beside words — a mark's glyph, a state's dot, a chevron, the session's sign in
  the side panel, on a tile and on a graph card — stands its middle on the middle of the capitals of its
  line, `--size-text-middle` (`0.5cap`) above the baseline, and a box that centres a word
  trims it to its capitals (`.trimmed-word`). The capitals are the reference because the
  lines a sign stands beside are a reference, a number or a word that starts with one, and
  the middle of the lowercase letters, where `vertical-align: middle` and the x-height trim
  put signs, stood them 1–2.5px low beside a reference on every surface but the side
  panel. `production-card-alignment.spec.ts` measures the card and
  `production-sign-middle.spec.ts` every other surface, at 1280 and 390px in both languages,
  within half a pixel.
- What a block in a column draws first stands on the column's edge. A row or a bare
  inline control whose fill keeps an inset under the pointer, `--space-fill-inset`, stands
  that inset outside the column as a negative margin, so its words start where the heading
  over it does and the fill reaches past the edge; a mark in a target larger than itself
  stands on the edge and the target reaches outward. Inside a panel with a surface of its
  own, a menu, the headings take the rows' inset instead. A chain's rows once stood 8px in
  from their headings, a session 8px in from its label and a step's box 6px in from the
  checklist's heading, three edges in one column; a list without marks is no indent either,
  where a question's conditions stood 20px in from their label, and a refusal's list of the
  work it would cancel 20px in from its first line. `production-card-list-edges.spec.ts` and
  `production-question-cancel-edges.spec.ts` measure them. A row whose box is drawn in every
  state, as Analytics' rail entries are, and a table row, whose cells are the table's columns,
  draw that box first: the box stands on the edge and its words take the inset inside it, since
  a box that reached past the column in one state read as an entry pushed out of it
  (Analytics). A question's options and findings are such rows, on a ground in every state: the
  ground stands on the edge and the box is 12px inside it. A ranked row draws no ground at rest,
  so it takes the inset outside the column as other rows do: its name and its bar start on the
  heading's edge. Inset inside, every ranked name stood 8px in from its section's heading, in
  the page and in the value panel.
- A disclosure's chevron is the icon layer's `disclosure-closed` and `disclosure-open`: the
  set's chevron drawn from its square's start edge, so the square stands on the column's
  edge, the stroke starts there in both states, and the words after the square keep their
  place. The set's own `chevron-right` and `chevron-down` start 9 and 6 of their 24 units in,
  and a toggle that stood one on the edge drew its mark 6px in folded and 4px open; making
  that up with a margin per host put «Chart and pace» and «Done» on two edges, one under the
  other. `production-card-list-edges.spec.ts` and `production-settings-layout.spec.ts` measure
  the drawn stroke against the column's first letter, folded and open.
- Vertical rhythm inside a component is one `gap` declared by the container,
  never a margin per child. Three regions of a card each setting their own
  margin is how the card came to read tighter at the top than at the bottom
  with nothing owning the answer, and a bottom margin on a list item is what
  made a goal's group inset 8px at the sides and 16px underneath. One container
  holds one of the four levels of the spacing rule above, so a container whose
  children are of two levels nests the lower one in a container of its own
  instead of spacing both with one gap: a quota window laid its heading, its
  bar, its facts and its caption 8px apart in one column, and nothing in it said
  what belonged to what.
- A control that displays its own value carries no caption beside it. The word
  survives as the accessible name, which is where a control with a visible
  value needs it; printed as well, it is the same word twice and it takes the
  space from the value that has to ellipsize.

## Shell and navigation

The expanded navigation shows icon, label, and optional count, and the count
stands next to the label it belongs to. It sat in a track pushed to the rail's
far edge, which put a two-word entry's own number an inch away from it and made
a right-hand column of six numbers that means nothing read on its own. Only the
compact state moves a count to the top-right of the icon box, which is the one
place left once the label is gone; it never reserves unexplained space below it.

Work, Analytics and Settings own distinct icons. Settings is a destination like any other, in
the navigation landmark, and stands in the rail's footer at its floor, under the
connection state and refresh. It stood under the last navigation group, so a long
list of work going on now carried it into the middle of the rail and a short one
left it half way up; in the footer it is in one place whatever the list holds, and
a lost connection said above it does not move it. A lost connection is said there
and only there: the dot and the word change, the tooltip says that the app
reconnects by itself and what the button does, and assistive technology hears
it once. On a narrow rail the word is gone, so a press on the dot while the
connection is lost opens the same sentence in a panel, which keeps the refresh
as its one action; the wide rail refreshes on the press as it always did. A
paragraph about paused updates once stood in the flow over the views and moved
the board and the graph 46px down for as long as the server
was away; a card read that never reached the server names the connection the
same way, not a record that could not be loaded.

The context bar holds the scope in two choices, at its end in fixed positions. The first
is «All spaces» or one space, named by its key with its name under it; «All spaces» lists
every space with its work count and its projects, each card opening the whole space. A card
shows four numbers under the space's name, counted as the space's Volumes page counts them:
its cards in triage, its tasks ready and in progress, and the questions waiting for the owner.
They stand in two rows of two, since a card is never wide enough for four whole names in a
row, a number never narrower than its longest word. A space without them shows each as «—», never 0, and says why: an
earlier build wrote its store, which is «No data», or its store could not be read. «Open
space» stands at the card's foot: a row of cards is as tall as its tallest, and its ways in
stand on one line, where after each card's own words one row's stood 78px apart. The
second stands only in a space with more than one project to choose, and an address that
narrows to a project keeps it on show: «All projects», the space's own projects, then the
projects of other spaces that its items name, each with its own space's key beside its
name. The board, the list and the graph show the work of the scope chosen. Saved views
belong to the space, so narrowing it to a project keeps them. A space or a project the
address names and this workstation lacks stands in its choice marked as missing, and
cannot be chosen. An address in the retired form, which named a project alone, opens
nothing: it says it is unavailable and offers «Choose a space», which opens the first
choice, and it carries none of its state or open card over. After the choices stands the
space menu, «⋯» named «Space actions»: «New space…», which waits while the main store cannot
be written, and «Configure space…» while a space of the main store is chosen. It stands at
the bar's end from the first frame, keeping its box until the spaces are read as the space's
choice does, so no control moves once they are. Where the workspace is 586px wide or
narrower, the two choices stack at its full width and the menu stays on the space's line,
after it.

The space window creates a space of the main store and edits one, as one dialog with one
save. Its ways in are «New space» over the cards of «All spaces», and on a phone the same;
a sign «Configure space» beside each card's «Open space», a sign and not a word so that the
card's ways in stay on one line, its glyph on the edge the card's words start at; «Create a
space» in the empty state where there is no space yet; and the context bar's space menu, on
every page. A card of an attached store has no sign: such a store is opened read-only. Under
the cards a quiet line names the registered projects that are in no space, and only while
there are some and the registry could be read; it stands twice as far from the cards as the
page's head does, so it does not read as one more of them, and each name keeps to one line
while the line has room for it, rather than breaking between two, with a comma and a space
between names. The empty state names them too, under «Create a space».
The window holds the name, the key, the space's projects and its workflow, which it names and
does not change, and keeps its scrollbar's room from the start, so a list that grows past the
window narrows nothing. A new space's key is the server's for the name until the reader types
one; a name the server derives none from, such as a Cyrillic one, leaves the field empty and
says why under it, once: the reason states the key's form, and no hint says it again. The key's
field holds the room of every hint and reason it can come to say from the start, the hint that
names the key as wide as the widest key, so a reason appearing or another taking its place
moves nothing under the field; given room only while it stood, a reason a line longer than the
hint pushed the projects down at 390px. Once the space has issued a number its key stands as
text with the reason it does not change, since it is in those numbers; a renamed space says
under its name that what names the space by its name will no longer find it, in room the edit
holds for those words from the start, so the fields under the name do not move at the first
letter typed. The projects stand one a row, by name as the interface's language orders names,
whatever the browser's language is, so a Russian interface puts Cyrillic names before Latin
ones: a radio that makes it the default, on the name's first line however the name wraps; its
name, which takes at most two fifths of the row and wraps there rather than take its folder's
room; its folder, cut in its middle so that its last folder, which tells one project from the
next, stays whole while the row has room for it, and shown whole in its hint; and its remove.
The default has no remove while the space has other projects, so the window repeats the
server's rule rather than meeting its refusal, and the first project added becomes the default
by itself. «Add project» searches the registered projects the space does not have, those in no
space first, then those of other spaces with what moving one means, each part by name as the
rows are; what is typed finds a project by its name before one only its folder matches, those
in no space still first among the names, and a folder's path in the list breaks where its line
runs out. Another space's default that space keeps others beside is
listed with its reason and cannot be chosen. «New project from folder…» takes the folder's
path, a name and an identifier, on a ground of its own so that its own two buttons do not
read as the window's foot; the folder suggests its own name as the project's, in any script,
and that name in an identifier's form, each until the reader types one. While the registry
cannot be read the window says so in place of the projects, and an edit waits, since its
save would leave the space with none. Only a space with no work items offers «Remove space»,
at the start of the foot, and it asks in the window before anything goes; where the foot
cannot hold all three, the way out and the save change lines together. A refused save keeps
what was typed and says why, in the reader's language, at the end of the form, and while the
form is longer than the window at its lower edge right above the foot's buttons, so it is
seen with nothing scrolled. A save whose space stood while the registry refused its projects
says so above the fields and turns its button into «Retry binding», which saves the same
draft as that space's edit and never creates a second one. After a save the shell follows the
space: into a new one, onto a changed key, and to «All spaces» from a removed one. Where the
dialog is under 520px wide a project's folder goes under its name.

The chrome says only what it has read. Until the module list names the module, the
context bar's title stands empty on its line; until the spaces are read and the
place a launch comes back to is restored, the space choice keeps its box and paints
nothing, and the rail marks no entry as current. At launch it once said the module's id,
then «Global» and «Work» as current, and then wherever the app actually came back to.
The groups under the list of work going on now are drawn once the list has its first
frame, or once the connection is lost: they used to stand under «Work» at once and drop
by the list's height a second later. They keep their place in the flow while they wait,
so no room is held for rows that may not come; a folded list and a rail of icons hold
nothing back. The wait is short because the list's frame does not wait for the space:
the shell opens a stream of its own for the frame as it starts, and closes it once the
space's stream has delivered its own, so a tab holds two streams only for that moment.

The rail's width is the reader's. Its right edge is a window splitter, the same edge a
drawer is resized by: dragged, or stepped 16px by the arrow keys, Home and End taking it to
its narrowest and widest. It starts at 260px, goes no narrower than 200px and no wider than
480px or than leaves the workspace 500px, and keeps the width chosen across a reload. A
name the rail still cuts short says itself whole over its own place, reading on past the
rail's edge from where it stands (Hints); a name it does not cut shows none. At 760px and narrower the rail is its icons alone and has no edge to drag.

The connection's state shows in the foot only while the connection is lost. Connected, the
streams bring every change as it happens, so a green dot and a refresh nobody needed stood at
the foot of every page; connecting is the moment a page opens, and showing it would only
flash. Lost, the foot holds the state, the reason in its hint and the refresh above Settings,
with a rule over them; connected, it holds Settings alone and draws no rule.

The Work list under «Work» is there to follow running work across spaces at a glance: what
each session is doing now, and which of them waits for a person. Each space shows, first,
the work to follow now in one run: the items a session is working on or has waited at for
less than four hours, and the sessions that work or wait on no item. A row that asks a
person comes first, since it is the one wait a person can end now; the rest stand freshest
first, an item by when it last changed (the live frame's `updated_at`) and a session by when
it began what it does now (`since`), and two of one second stand items first, by number, then
sessions as the frame sent them. Under them up to three rows fold the rest, each drawn only
when it holds something and named by what it holds, in this order: «ещё N у работающих
сессий», the items held by a session at work on another item; «ещё N давно ждут», the items
and sessions that have waited for over four hours; and «ещё N молчат больше суток», the items
silent for over a day. Inside a fold the rows stand freshest first, and in «давно ждут», as in
the run above, a row that asks a person stands first. Each starts folded, opens in place under
itself, and its opening is kept on the device on its own; a device that opened the quiet
work's fold before keeps «молчат больше суток» open. Opening one moves nothing above it and
widens nothing: the numbers' column is sized with the folded rows already. Last, under the
caption
«Закреплённые», the pinned items not on view, by number: a pinned item on view stands with
the work instead, once, and a pinned item that is held, waits long or is silent stands with
the pinned. After the spaces, under the heading «Сессии вне пространств», stand the sessions
whose folder lies under no space, with the same rows on view and their own «давно ждут».
«Сейчас никто не работает» stands only when no space has rows or sessions and none is
outside, and the count on the phone's rail button is the number of rows on view, items and
sessions. A goal, or any item the list holds only as the parent of others, is no row of
its own: its title is said on its items' rows. A goal at work is a row like any other.
This replaced a tree of parents with their items under them, quiet and pinned items mixed in
by number, which read as a heap, and then a single fold whose one word for held and silent
work said nothing of what each row was doing.

A row on view has two lines. The first is the sign, the number, the title and the agents'
count; it is a row of one line whatever follows it, so the sign, the number, the title and
the controls at its end stand where they stand on a row of one line. The second, smaller and
muted, starts under the title and says the state in a word, «работает», «спрашивает» or
«ждёт», then how long, «N мин» under an hour and «N ч» from one and nothing under a minute,
then after « · » the goal's title for an item or the folder for a session that has a title
of its own. How long counts from the session's `since` and moves on once a minute, from one
clock for the whole list; it changes words only and never the order. A row in a fold and a
pinned row keep to one line: the sign, the number, the goal's title, muted, before the
item's own, which gives way first, down to three letters and never more than two fifths of
the row, and a closed item's state at the row's end, never more than half of it, cut with an
ellipsis. The row's hint and its accessible name say the whole row in a sentence: what it
is, its goal or folder, the state with what it means (asking: the session stopped in the
middle of a turn for a permission or an answer; waiting: its turn is over; held: its session
is at work on another item; silent: since which day), how long as a sentence says it
(«ждёт уже 2 ч», "waiting for 2 h", where the second line says «ждёт 2 ч»), and the agents on
it.

A session's row is named by its title, else its folder, else «Сессия без названия», and a
terminal glyph stands in the number's column where an item's number would. Pressing it opens
the session as a card's session button does; it has no card and no pin, and a session that
leaves the frame leaves at once, where an item's row stays a while, muted, its second line
saying «работа закончилась» as its hint does, with no state and no time. An item's row with
a session behind it ends with «Открыть сессию» beside the pin, the same glyph, out of sight
until the pointer or the keyboard is on the row, and standing where nothing can hover. The
rail keeps no column for it: it takes one only while it is up or its press is being carried
out, and then that row's title and second line shorten for it, while the row's height, the
sign, the number and the pin stay where they are. Its name names the item whose session it
opens.

A row's lead holds the sign of its session (`SessionSign`): one ring of one size and one
stroke, 14px in the lead's column, whose inside says the state — a turning ring in the
accent while it works on the item, a question in the warning tone while it asks a person in
the middle of a turn, a check in the text's colour while it waits with its turn over, a
paused ring, muted, while it holds the item and works on others, and a dashed ring, fainter
still, for an item silent over a day. A session's own row draws the same signs. A pinned
item with no work and a row gone from the frame draw none. Every sign stands at one x on
rows of one line and of two and inside the folds. The shape says the state wherever colour
is lost, the second line and the hint say it in words, and the ring stops turning under
reduced motion.

In the Work list's phone panel (the navigation at most 760px wide), a closed item with
no sign loses its lead column, so its title takes that room; an item with a sign keeps
it. There only a pinned row has a pin, and «Открыть сессию» is a finger wide.

The shell owns one page scroll surface. Horizontal scrolling belongs only to a
data region that genuinely needs it, such as Kanban lanes or a wide table.

## Shared component grammar

- **Rows and tables:** repeated comparable records use aligned columns. The
  whole row is the disclosure target when it opens a detail surface. A row's
  action stands under the words that name the row, in the columns read first,
  never in a column of its own at the row's end: a table wider than its frame
  scrolls that column out of sight, and «Attach to a card» stood past the frame
  at 1280px and three frames' width away on a phone. Whether a table's columns
  fit its frame decides how it stands, never the window's width
  (`useTableFit`): it is laid out at each step in turn and stands at the first
  that keeps every column inside the frame. A table of figures has three: its
  headings on one line; the headings over figures on two; and every column at
  the least that breaks no word, the headings over figures as narrow as their
  longest word and the page's words, such as a goal's title, giving way to
  theirs. A table of records read as words rather than compared as figures, as
  Agent decisions' and the commits on no card, stands as one block a record as
  soon as its columns do not fit, at any width, its cells on lines one after
  another and its headings a line of sort buttons over them (`SectionTable`'s
  `stack`). The work outside goals in Volumes, a table of figures, stacks the
  same way where even its least does not fit, each figure beside its
  category's name; scrolling, its last categories stood out of sight until the
  table's end. Sideways scroll is the last resort: only a table of figures whose
  least does not fit and that does not stack scrolls, at its second step, its
  names held at the frame's start. Analytics' tables take no third step: their owner chose a
  second line and the sideways scroll for them. The tables of one section stand at one step and
  on one set of columns: their names' column takes the width the widest of theirs takes there, and
  the figures share the rest alike, so a column stands at one edge in each; laid out by its own
  words, each of the two tables of the work outside goals in Volumes stood its categories up to
  25px off the other's. Stacked by a phone's width alone, Agent decisions left «What
  was decided» past the frame at 1024 and 760; held to their widths, the goals
  of Volumes left «Left ≈» past it at 1280, under a scroll bar below the
  fold.
- **Status:** one semantic-state primitive owns label, dot/badge geometry, and
  palette across work items, executions, references, and Settings.
- **Choice controls:** one accessible custom control owns search, icons,
  keyboard behavior, and collision-aware portal positioning. Native selects or
  local popovers must not reappear in feature code.
- **Dialogs and drawers:** one overlay host owns focus, Escape, stacking, body
  lock, and restoration. A command dialog layers above an open drawer instead
  of unmounting it. In a window 620px wide or narrower a dialog takes the whole
  width as the drawer does, without corners, its head, body and foot sharing a
  16px inset in place of the floating dialog's 24px. A centred dialog is centred
  as it opens and, from the reader's first press, key or typed value in it, keeps
  the top it stood at then while what it holds grows or shrinks: it grows and
  shrinks at its foot, rises only as far as it must to stay in the window, and is
  centred again when the window changes size. Centred all along, it grew by half
  at each edge, so a line appearing under a field or a refusal at the end of the
  form moved its title and every field above them under the hand. What arrives
  before that first act, a picture decoded or a list read as it opens, is under
  nobody's hand, and the dialog stays centred on it.
- **Inspectors:** persistent right-side detail uses the shared resizable
  inspector. Width is bounded by the actual workspace, not the viewport. The
  panel lives while any item is open and only its content changes with the item:
  a link and Back stay in the same panel, so the slide belongs to the first open
  and to the close, and focus moves to the new content's first control as it
  does on an open. A panel opened by no input, from an address or a reload, holds
  focus on what it is read with until a Tab, so that no control stands ringed for
  something nobody pressed and the keys that scroll work at once. That Tab goes on to
  the first control, on a card the first of Back, «…» and Close its bar holds. A card an
  address opens does not wait for its space: it reads its own record beside the
  space's read, and what it takes from the space — the states it may move to,
  its parent's reference — comes in later into places already held for it, the
  state as its menu and the parent's row with its label. A task's card opened from
  any module opens in this inspector over that module, not by moving to the board:
  the module keeps its address and its view, and closing the card leaves them as
  they were. A task pressed in Analytics once opened its card on the Work board, so
  closing it left the reader a module away from the figure they had pressed.
- **Hints:** a hint is `vTooltip` and its one host, `TooltipHost`, never the
  `title` attribute, which the browser draws late, in its own font and colours, and
  never for text cut short. When it shows and goes is kept by one hint manager for every
  element: after half a second's rest of the pointer, at once while another hint is up or
  has just gone, at once on focus a key brought, never for a finger. After the rest it fades
  in, a cut text's whole words as well; at once it is already there, with no animation, as
  the reference's card is, and under a preference for reduced motion nothing fades. Enter,
  Space and Escape bring none: the focus the page moves in answer, into what they opened or back from what they
  closed, is the page's, and its hint would hold up the next Escape. It goes with a press,
  a scroll, whose end asks again for what the pointer rests on, and the pointer leaving: a
  hint the pointer raised can be entered and stays while the pointer is on it, going a
  moment after the pointer leaves both. On its way from the element to such a hint the
  pointer keeps it over whatever it crosses, as a rail row's cut name and pin: what it
  crosses takes over once the pointer rests on it a moment or turns off the way, never as
  it passes. Escape closes the hint and nothing else, never the
  drawer or menu under it; with no hint up it reaches them as before. One surface speaks at a
  time: while a menu, a choice or combobox list or a help a press pinned open is up, no hint
  of an element outside it shows and one already up goes, while its own rows' hints still
  speak. A hint focus holds,
  and a chart period's, lets the pointer and a press through to what it covers. Where a hint
  stands follows what it is to its element, never a side its place writes: a detail stands
  below its element from the element's start, 6px off and at most 20rem wide, and above it only
  where the window has no room below; a name stands below its icon, centred. A cut text's
  hint stands nowhere beside it: its whole words are laid over the cut ones, the first letter
  on the cut text's first letter in the type and ink of the line it stands in and on the ground
  under that line, never in the look of a run the text starts with, as code, a link or emphasis
  (taken from the run, a title that starts with code was set whole in code's type), running
  on to the right up to 8px short of the window's edge and wrapping by words only where the
  whole text does not fit there, so on one line it covers no other row; over a text a clamp
  cuts to its lines, as a graph card's title, a board tile's, an outcome's preview, a title in
  the task finder and a name a chart's table keeps to two lines, it takes the clamp's whole column
  and the clamp's alignment and grows down past the clamp, reading as the clamp opened in place:
  its words wrap where the clamp's did, so its first line is the clamp's and its first letter the
  cut one, it breaks a word only where the clamp does, and it covers every line the clamp shows,
  so neither a line nor its ellipsis reads again beside it, and since its words were cut at that
  width they take more lines there, so no empty room stands under them. Run on to the window's
  edge instead, a board tile's title cut at its third line lay on one line across the next
  columns over 38px of empty frame; laid from the first letter, the whole words over a table's
  column heading, whose lines end at the column's end, stood inside the column, narrower than
  it, broke words in two and left the clamp's second line showing beside them. Where the window
  has no room under it for all its lines
  it stands higher, 8px short of the window's bottom edge. A label a narrow place
  hides whole, as the icon rail's and the board's sign-only action's, is hidden rather than cut:
  no letter of it is on screen to lay its words from, and a glyph beside it hidden from assistive
  technology, as a «+», is none of its words, so its hint names the control where a name stands.
  The whole words let the pointer and a press through to the element under it, which keeps its
  hover and does what it does,
  and the pointer anywhere on it holds it up. A width that leaves the text whole takes it down
  without a hover, and one that cuts it again lays it again; a zoom or a move of the graph's
  camera lays it again on the text, or takes it down where the text went out of sight. A list
  declares itself once on
  its container (`data-hint-list`), and its rows say nothing: in it every other hint stands
  aside of the list, level with its row's
  top, over no other row — the rail's past the rail's edge, a tile's past the Analytics rail,
  a row's past the list view's table — on the left where the right has no room, on the roomier
  side drawn narrower down to 12rem where neither holds it, and above its element where neither
  has even that. A list of rows wide enough to hold a hint (`data-hint-list="wide-rows"`), as the
  settings sheet and a card's checklist are, keeps it inside its element's own row instead:
  beside the element on the side of the row with more room, level with the row's top, over
  the row's own label and no other row, and drawn as wide as that room, up to 40rem, so a long
  one takes as few lines as the row's height allows. A hint of a chart's mark — a period's
  stack, a small chart's column and its name, a ranked row's bar, a reading of a step line, a
  sector of a ring — stands at that mark, by one rule, whatever the chart: the mark declares
  itself (`data-hint-mark`, a point `data-hint-point`), and the hint's start stands 6px past
  the mark's right edge, level with its top; at a point, and at a column of nothing on its floor,
  at its top right, 6px past it and over it. Where the chart's frame (`data-hint-frame`, else
  the window) has no room on the right it stands mirrored on the left, where the window has no
  room over a point under it, and where neither side has room, as in a phone's narrow chart,
  over the mark, centred. Every mark asks for the room of the widest hint, not of its own, so
  along a chart the side changes once and never jumps between neighbours; a frame with that
  room on neither side gives the roomier side of the window. A point asks by its own hint's
  width; a column of nothing asks as its neighbours do. A mark's hint lets the pointer through to what it covers, which may be the next mark
  or a neighbouring small chart, and covers no part of its own mark. A legend entry names a
  series rather than standing for a value: its hint stands under the whole legend at the entry's
  start, clear of every entry, and lets the pointer through to the plot it covers.
  A hint keeps 8px from the window's edge. `check:ui-system` refuses a side written at a
  call site, save an exception its register names with the reason. Every hint states its kind, and the kind says when it shows: `name` is
  the words of an element that shows only a glyph, shown whenever it is pointed at;
  `clipped` is the whole of words its element shows cut, shown only while they are cut;
  `detail` says what the element does not show, and stands in `check:ui-system`'s
  register with the reason the place needs it. No hint says again the words its element
  shows: a board tile, a label chip and the usage line have none, since everything they
  would say is on screen, save the whole words of a tile's title its clamp cuts, laid over it
  as above. Those rise while the pointer rests on the title's lines, never on the rest of the
  tile, though the tile's open target takes the pointer everywhere on it: an element whose box
  takes the pointer past its words marks the part they stand in (`data-tooltip-words`), and
  focus a key brings still shows them. A hint may carry a note, a second line in the quiet ink, for a
  state that qualifies the action: a session button hints what a press does — «Open in
  VS Code» — over the session's state, and never the holder's name it shows. A detail on
  an element whose own words can be cut (a one-line name, a path, a value) is given those
  words too: while they are cut the hint says them whole on a first line, over the
  detail, since a cut word is not on screen; while they are whole it is the detail alone,
  and with no detail to add it is the `clipped` hint of its words. For
  assistive technology a hint is what `title` was: the name of an element nothing else
  names, else its description when it says more than the name; the hint shown is a tooltip
  that holds its words once, and one drawn as a grid reads as its text. A reference's preview
  card follows the same manager and these rules, as one more surface of it: on a reference it
  wins over a hint, and the card and a hint take over from each other at once, never both up
  and with no frame without one, but for the moment a card that reads waits for its answer.
  What the card adds, controls to press and text to select, is
  its own (A reference's card). A hint is words; anything with a control in it is `InfoTip`.
  A chart's mark says in its hint what it does not print (Charts). A caveat that
  qualifies a whole section is no element's hint: it is said once, by an «ⓘ» at the
  section's heading that opens on a press as well, as `InfoTip` does, since a hint
  never shows for a finger. `check:ui-system` refuses a `title` an element or a component's root would get, a hint
  that states no kind and a `detail` its register does not hold.
- **Charts:** three primitives answer "how much, and of what". `RankedBars` breaks one
  measure down by one dimension, largest first: a name on one line (cut with an ellipsis, whole
  in its hint), the value as it reads and a bar as long as its share of the longest category.
  Values named by free text — tasks and sessions by their titles, which run to a sentence — are
  a list of their own (`freeText`): each name on lines of its own at every width, two at most and
  then an ellipsis, whole in the row's hint, so the reference a task's name starts with,
  «VAL-1228 …», is never cut; the bar and the value under it, every value ending at one edge; a
  pair a line a part, each cut at its own end. It lists the first ten values; the folded tail,
  «no task» and «unknown» close it under a rule, unranked, each with a bar in its neutral on one
  scale with the values, which the longest row of all sets, so a large «no task» still reads as
  large. Wherever the rows split a whole, each row's figure says its share of it after the
  amount, «4 дн. 1 ч · 78 %», in the figure's own ink and never in the row's hue, the rows the list
  leaves out counted in that whole; the table twin says the same figure. No strip of the whole
  stands over rows that draw their own bars: as thin as the bars and with no words of its own,
  it read as one more row. Parts are compared by ranked bars on one base; a thin segmented strip
  belongs only over rows that print a name and a number and draw nothing, as a rail tile's
  `MiniShareBar` does. A row whose figure is less than the least its unit shows — «меньше
  минуты», a cost under a cent, no token — says nothing of how much and is in no view of a chart,
  under any name, judged from its amount against that unit and never from its words: not the
  ranked bars, the ring's sectors and legend, the small charts, the day chart's series, nor the
  table twin of any of them, which all take their lines from one rule (`drawnLines`). «Unknown» of
  a unit or more stays, since it shows a gap in what is placed. The section's total and every
  share still count such a row — a ring that leaves one out stays open by its share rather than
  stretching the rest over it — the section's own table, which holds every value in every
  measure, lists it, and a chart whose every row is one draws them all. The same holds for an
  entry of a breakdown, one value in one day, hour or minute or one figure of the section's
  table (`unnamedEntries`, `entrySpent`): it is absent there as a value that did not spend there
  is — the period's hint does not list it, it draws nothing, and its table cell, a small chart's
  hint and the section table's cell read «0 мин» — while the period's total, the value's figure
  over the span and the section's total count it. A total under the unit, the running minute or
  a whole day under a minute, keeps its words.
  `PeriodColumns` stands a column per day or hour, stacked by a few series. `SmallMultiples`
  draws one small chart of the span per leading value, all on one scale whose top is written
  once over them, each with its name on one line and its figure; the folded tail shares the
  scale, while «no task» and «unknown» close the charts by name and figure and set nothing. Each
  has a table twin (`RankedBarsTable`, `PeriodColumnsTable`, `SmallMultiplesTable`) that holds
  every number its chart draws and opens what the chart opens; a page shows it beside the
  chart or instead of it, and a twin wider than its column scrolls sideways in its own frame
  (`ChartTable`, `keyScroll`) rather than widening the page. A twin only a few pixels wider
  than its frame, less than the least target, takes them from its headings over figures that
  stand at their floor and fits instead: the days' twin of a section at 1024px scrolled by 5 to
  18px, which brought nothing into reach and left its note's last letters under the edge. A
  twin's name, a row's or a series'
  over its figures, takes two lines at most, then an ellipsis, whole in its hint, as the side
  panel's narrow names do (`.two-lines`), and a detail a line of its own under it: unbounded, a
  task's name in the ranked twin at 390 stood on fourteen lines and its row 234 px tall, and the
  days' twin by task stood its heading row 336 px tall over seventeen lines of a name. A chart
  opens on the drawing it opens on at 1440 at every width, a phone's too, and its table is a
  press away: in a panel of 294 px at 390 the ring, the ranked bars (each name on its own line
  over its bar), the days
  (scrolling in their frame, a day 24 px at least) and the quota's windows each stand whole, with
  no word cut but by a designed ellipsis. A panel under 560 px once opened every chart as its
  table, though none needed it. They are boxes of HTML on the tokens, not a chart library, which the
  product removed for its weight. A value axis starts at zero and names a few round steps; a
  time axis names what it has room for, counted back from the last period. A series takes
  its hue from `seriesSlots()`, which pins a slot to the name — the whole domain in code-point
  order, never by rank, so a filter repaints nothing — out of six `--color-series-*` hues
  ordered so that neighbours in a stack stay apart under protanopia and deuteranopia. A
  seventh series folds into `--color-series-other`, the darker of two neutrals, which draws
  the folded tail; the rows that are not categories, «no task» and «unknown», are the lighter
  `--color-series-apart`. Two greys and no hue: in a stack the two can stand on each other and
  are often a period's two largest parts, so they differ in lightness for every reader, and the
  legend names them in the stack's order. The folded tail takes the darker grey because it is
  often most of a period and says least; no grey can sit darker still, since a middle grey is
  what several hues become under deuteranopia and protanopia and a darker one falls below 3:1 on
  the sheet a chart can lie on. In a section's
  ranked chart named by identifiers and its small charts «no task» and «unknown» stand where
  their figures put them,
  drawn on the same scale in their neutral with their names in the quiet ink, since the largest
  share of a period can be work on no task; only the folded tail closes the chart, apart and
  unranked, and sets no scale. Elsewhere, as in a card of first values, all three close the
  chart in a list of their own, set apart by air, draw no bar and are read by their figures.
  Hatching means one thing on every chart: a figure that is not final yet — a period still
  running, the forecast to a window's reset, the minutes no record has reached yet. Where a
  chart hatches, its legend or its words name what the hatch is. The hatch is one drawing
  (`hatch.css`): a mask over the mark's own paint in 135° stripes of the whole paint and two
  fifths of it, which adds no colour, so it keeps the hue of what it continues, reads in
  grayscale, and under a forced palette draws its stripes in the mark's ink. A final figure is
  never hatched: a reading that is no longer fresh is drawn solid and says its age in words, and a
  part with no value or no recorded owner is the neutral under its name. The hatch once marked
  work on no task and an organization nobody recorded as well, so one texture said two things
  and a reader could not tell from it which one was meant.
  A hue
  never speaks alone: a chart of two series or more carries a legend, and every hint and every
  accessible name say each series by name. The legend's lines step 24px with no gap between
  them, every line one height, and every key fills its line: one that acts, a link, a button
  or a layer's toggle alike, is the 24px target WCAG 2.5.8 asks and reaches no key of the next
  line, and one that only shows takes no focus, no pointer's hand and no press. A series' key
  acts where its series does; a mark's key acts only where the mark is a layer. The marks a chart
  draws beside its data are its layers — the tick of the period compared with, the line of an
  account change, and on a step line the pace and the forecast — and a layer's key is a toggle:
  a press, by the pointer or by Enter or Space, turns that layer off on every chart that draws
  it, and the next turns it on again, one choice per layer kept on this computer, which a
  reload keeps until it is turned on again (`chartLayersStore`). A layer turned off is not
  drawn, and no hint, name, place or step of the scale counts it, so a period before that was
  taller no longer holds the scale up. Its key stays, pressed while its layer shows
  (`aria-pressed`) and, while it is off, its swatch faint and its name in the tertiary ink struck
  through, a state said by more than a tone, and there to turn it back on; nothing else on the
  chart says a layer is off, no banner and no note. A layer a chart lacks because its read failed,
  the period before's steps or the accounts of a new view, keeps its key's room in the legend,
  unseen and out of reach, until a read brings it: dropped, the legend stood a line shorter and
  the retry that read them moved what stands under the chart 24px down. A chart's table keeps
  every figure. A layer
  obeys its toggle only where the chart carries its key, so a layer turned off can always be
  found and turned on again: a window's bar has no legend, on its rail tile too, and keeps its
  pace tick and its forecast tail. The owner asked for «previous period» and the other added marks to be switches that turn their
  display off and on, and drew the line: the data itself — the stacked series, a step line's
  readings — always shows, so a column's sum never disagrees with the figures beside it; the
  hatch of a period still running is how unfinished data is drawn, and a step line's now and
  the level of its top orient the plot, so none of them is a layer and their keys do not act.
  A legend's name takes one line, as
  wide as the legend at most, and ends in an ellipsis from its end, so a task's reference stays,
  and a pair's first part gives way before its end, the model, does; the entry's hint says it
  whole. Broken wherever a letter fell, a task's name took two lines an
  entry and 164 of the day chart's 435 pixels, and a session's four, «Valkama: проектирова / ние
  системы агентов». In a ring's legend, whose lines end in a figure, a name too long to stand
  beside its figure takes its line alone and the figure the line under it, at the end where the
  others end, as a ranked row's name takes a line over its bar in a narrow chart: beside their
  figures at 1440px the two cache writes of the tokens by kind were cut to «Зап…» and «Запи…».
  Every mark of a chart — a period, a segment of one, a small chart's name, a legend entry, a
  ranked row — keeps one contract. Pointing at it, or focusing it from the keyboard, shows its
  hint at the mark through the one hint host, a segment's being its period's: the mark's series, its value, its share and the
  period before, leaving out what the mark already prints, as every hint does. Every such hint
  is a grid, and a mark of one series — a sector, a ranked row, a small chart, a legend entry, a
  reading — names it in the grid's head beside the legend's swatch of its hue, so the hint says
  which colour it speaks for; a ring's rest lists its five largest parts and one line for the
  others. A period, which
  the keyboard walks, says its sum against the period before, what is said of it and its series
  largest first, each with its share of the period. A segment has no hint of its own: the period
  is one place for the pointer, its whole height and its half of the gap to each neighbour, its
  segments and the ground between them included, and focus on a segment shows the period's hint
  too. The period's hint is a grid rather than lines of words: its name and sum in semibold, the
  period before in the quiet ink, a row per series with the legend's swatch, its figure and its
  bare share, figures and shares each in a right-aligned column of tabular figures that never
  wraps, and what is said of it under the rows; its words stay what assistive technology reads.
  The row of the segment the pointer or the keyboard stands on is marked by a band and a
  semibold name, and the mark follows it without the hint opening again or moving. A press or
  Escape closes the hint; resting on what was pressed brings none back, and another part of the
  same period asks for it again. Crossing a period keeps its one hint, its words and its place; the next period's stands
  beside its own column at the same height, so moving along the plot moves the hint sideways
  only, and no hint covers the period it speaks for. Segments still lift under the pointer and
  act when pressed. Every series mark lifts one way under the pointer or the keyboard — a ring's
  sector, a ranked row's bar, a small chart's column, a period's stack and a segment of it: its
  hue a fixed step of lightness higher (`--series-lifted`, `seriesFill.css`), the forced
  palette's highlight there. Only the paint changes, never the mark's size or what the pointer
  meets, and where a larger box takes the pointer, a ranked row or a period, its marks lift with
  it. A ring's legend entry pointed at or focused lifts its sector. The hint lies over the page, so pointing and leaving move nothing. Pressing a mark does what its entity
  does, the same as its row of the table: a task opens its card, any other value narrows the
  view to itself and a period narrows it to that period. The folded tail, unknown work and a
  period that only shows lead nowhere: their marks show a hint and do nothing when pressed. A
  frame dragged along a time axis, or stretched from the
  focused period with Shift and an arrow, becomes the page's own period, bounded by the moments
  it covers and not only by whole days, and every chart and table of the page follows it; it is
  a step of the history, so Back returns the period before. No line stands over the plot. A
  readout held to one line stood there: it cut a period of several series to an ellipsis, named
  no segment under the pointer, and a press acted for the period rather than the part pressed. A
  period still running is hatched (a mask, which adds no colour), so it does not read as a drop,
  and its hint says it is under way; no word stands under its name, since «so far» came out in
  Russian as «пока», which reads as «bye». While such a period is on the plot the legend names
  the hatch, «in progress» beside a hatched swatch, and drops the key once none is. A change
  at a period's start, such as the account the work ran under, is a line up the plot in the gap
  before its column, a shape and not a hue. While the plot marks one the legend names the line,
  «account change» beside a short upright line, and drops the key once none is, so the line is
  read without a hint. The period's hint, its table row and its name say what changed — a period
  that acts names its action and then the change — by the accounts that came, «+», and those that
  left, «−»: «Account change: +b» where b joined a, «Account change: −c» where c left a, never
  «a → a, b», which made the reader find the difference. Each account is named as the page names
  one, an account and not its organization, and work no reading places on an account is left
  out: the chart keeps no row for
  changes, over the plot or under it, so they cost the plot none of its height. The periods are one Tab stop and the arrows walk
  them; nothing in a chart moves on its own but a live span's frame keeping up with its running
  period, as below, which never meant that nothing may stand over it: a hint lies in the hint
  layer and shifts nothing. A period that acts when pressed is never
  narrower than the 24px target WCAG 2.5.8 asks (`--period-reach`), and a span whose periods
  all fit the chart at that width never scrolls: an inline action's 28px scrolled four weeks
  beside the rail by a few pixels. A span that takes more room than the chart scrolls sideways
  inside the plot and never moves the page. A past span — a week, days chosen, an earlier
  day — opens on its first periods. A live one, «Now» or «Today», opens on its running period,
  scrolled on only as far as that period needs to stand at the frame's end — one period in from
  it where later ones follow, so the fade toward those falls on the next and not on it — and
  the minute or hour running and the minutes with no data yet are in view beside the ones
  leading to them; while the reader leaves the frame there, it keeps the running period at its
  end as the span moves on with the clock, and once they scroll it, a new minute or the bar's
  refresh keeps the period they read where it stood until they scroll back to the running one.
  The plot fades out toward an edge past which periods are hidden, at the axis on a live span
  opened on its end (a mask, which paints no colour and drops while the keyboard stands in the
  plot), keeps the value axis in view over the plot's start, and brings a period the keyboard
  reaches clear of that axis with its focus ring whole. Periods that only show
  keep sharing the chart's width, however narrow that makes them. A period compared with the
  one shown stands on the same scale as a tick at its height across each column, an edge and
  not a hue, so a period before that was larger never outweighs the columns shown: the legend
  names it beside the same short line, a period's hint says its figure beside the sum, and the
  table gives it a column after the sum. The tick reaches 4px past each side of its column, in
  the text's main ink and ringed in the ground's colour. A segment's border never leaves its
  column, so the overhang is what tells the tick from a gap between two segments, in grey and in
  coloured segments alike and under a forced palette, which drops the ring. Drawn as wide as its
  column in the quiet ink, it vanished into the grey of «no task» and left only its dark ring,
  two stripes that read as two more gaps. Where a period's room leaves less than 4px beside its
  column, the tick reaches what it can and stays 1px inside that room, so it never touches a
  neighbour's column or tick: four weeks at 1440px leave it a little over 1px past each side,
  and on a phone, where their columns of 24px stand 2px apart, it is as wide as its column and
  told by its ink and its ring alone. The time axis names each period under the middle
  of its column, the first and the last too, moved in only as far as a name would hang past the
  plot, and no two names come within 8px of each other, measured in the axis's font: a period
  still running keeps its name, and a neighbour that would touch it gives way. A day is named by
  its weekday, and the first name the axis prints and the first it prints of each later month by
  the date with the month, «Oct 27», «Nov 1» (`stepName` in the page's words, so every chart of
  days has it), so a span across months says which; the table names every day in full. The plot's frame is as tall as the plot with its names, so it never scrolls up and down. A single day stands by the hour
  and «Now» by the minute, and pressing an hour or a minute narrows the view to it as pressing a
  day does: the page's own period runs between its moments, and Back returns the view before. An
  hour used to only show, which left «Today» the one period whose parts led nowhere. Where a ranked chart shares a row with others, as a card of first values
  does, it is `dense`: the name and the value on one line and a thin bar under them, each value
  as wide as its own figure and its name taking the rest of the row.
  Two small charts stand beside a figure rather than in a section of their own, as the
  Analytics rail's tiles and the page's three figures use them: `MiniTrend`, a column per period on a hairline floor with no
  scale and no names, and `MiniShareBar`, one thin bar of a whole split into its first parts,
  largest first, with what they leave out last in the neutral. Each is one image whose words say
  what it draws — the highest and the last period, every part with its share — so neither is read
  by its shape or its hue alone: columns and parts stand apart by a gap of ground, a period still
  running is hatched and the trend's words, which are its hint too, say «running» after its
  figure, work on no task is the plain neutral that its name in the words says, and a forced
  palette draws the marks in its ink and the floor, the rest and an empty track in its quiet ink.
  Neither acts or moves under the pointer, and each keeps its height with nothing to draw, so the tile around it never moves when its figures arrive.
  Two forms draw one window of a limit, a share of it spent and never a sum of two:
  `WindowBar`, the share as a fill on a track of the series hue's own tint, a tick across the
  bar where steady use from the window's start would stand now, and the share and the state in
  words beside it where no line over it says them; and `StepLine`, the window's readings as
  steps from its start, flat until the next reading and never a slope between two, with steady
  use as a thin diagonal in the text ink. The share spent is a reading, final however old, so
  its fill is solid whether the window is fresh or silent, and a silent one says how long in
  words. What the window's forecast says it reaches by the reset is not final, so both draw it
  apart from the share spent, in the series hue of the share it continues: the bar as a hatched
  tail, the line as a dashed line. On the bar it is one tail inside the
  track from the share spent to the forecast's share at the reset, 2px of ground past the fill
  and none inside the tail: a week's range to its high end, the faster pace's, its low end said
  in the words under the bar and not drawn on it, since a second gap inside the tail read as a
  break in the forecast; five hours that last to the
  share their answer says they spend by the reset, and five hours that run out to the track's
  end; from the track's start at 0 %; and no tail where the forecast names no share past the
  share spent — a pace that spends nothing more, a window too new for a forecast, one spent or
  read past 100 %, whose fill stops at the track's end. A reading draws no dot at rest, the line alone, and no
  end marker either: a fresh window's line holds to now past its last reading, a source writing
  one only when a value changes, so a dot there stood hours before the line's end. A window silent
  by now, or by its reset where that has passed, measured nothing after its last reading, and its
  line ends there, so the line's visible end is a reading, which the pointer finds at its end.
  The reading pointed at or focused draws its dot and says its moment, its share and its source
  in its hint, as every mark does; the one a key stands on keeps its dot whatever the pointer
  does, and Tab lands on the latest. Past the readings the line has two places of its own, each
  with its hint and painted only while pointed at or focused: «now» where the line ends, a round
  dot drawn as the forecast's end is, its share, when the latest reading was and how long the
  window has been silent, which takes the pointer from the line's end on and leaves the latest
  reading its own dot farther than a mark's reach from it, the latest found as «now» within it; a
  ring there, which a restart keeps, read as a second kind of point on the one line; and,
  while the window stands and its forecast has a share to draw to, the end of the forecast's line,
  its share at the reset, what that leaves out and when the reset is. The forecast is a line,
  not a band: 2px like the readings' line, in their hue, dashed, the conventional cue for a
  projection, from where the readings' line ends at now. For a week's
  range it follows the high end, the faster pace, the one that decides a run-out, as the bar's
  tail does; the range down to the low end is a quiet solid fill of the hue at low opacity under
  that line, with no hatch and no outline, and none where the range is under about three pixels,
  where it would read as a second edge of the line. Where the forecast runs out before the reset
  the line ends at the run-out, on the 100 % level, and nothing is drawn after it: the run-out is
  the fact the card's words say, «runs out … before the reset», and a stretch flat along 100 % to
  the reset only thickened the level. Where it does not run out it ends at the reset at its share;
  a window spent already ran out at now, so no line runs on from there. Its end is a round dot, a
  reading's dot across and as tall as it is wide, in the line's hue ringed in the ground, the place
  the pointer and the keyboard find, with its hint; never a dash. A forced palette draws the line,
  the fill and the dot in its ink and the ring in its ground. The forecast was a hatched corridor
  to the reset, a band between the two paces for a week and for five hours a ribbon to 100 % at
  the run-out that lay along the level to the reset as a thick hatched bar, its end's mark at
  100 % a flat dash; the owner found the band thick and the dot on hover flat. The legend names
  the line «Forecast» beside a short dashed line, a key that turns the layer off and on as the
  pace's does. Where the window's count restarted inside it, its reset unchanged, the line falls
  at a reading, and the restart is a place on the line at that moment with its hint, painted only
  while pointed at or focused as the others are: a round ring on the middle of the fall, «Counter
  zeroed» with its moment and that the window's reset time did not change, the fact alone, since
  the readings cannot tell what zeroed it. Every place's mark, a restart's ring or the dot of «now» and of the forecast, is a
  true circle at every width, at rest and pointed at, the line's own fall saying how far it fell:
  a restart's ring once stretched over the fall, a capsule up to 89px tall, and an oval 12×8 at a
  fall from 0 % to 0 %. On a window past its reset and on the windows before the current one the
  marks take the neutral ink their readings are drawn in; they once stood blue on a grey line.
  Within a mark's reach of the pointer a place — a restart, a reset between two windows, «now»,
  the forecast's end — is found before any reading: on a period of weeks the readings stand on
  every pixel, a continuum the pointer cannot single out, and a reset on the pixel of the reading
  before it was never found; the place's own hint says the share at its moment. Of two places
  within that reach of each other the pointer finds the nearer, and its hint says the other's
  words after its own, so no place's facts are out of the pointer's reach; each keeps its own name
  for the keyboard. A place's box, which the keyboard's ring is drawn on, has its middle where the
  pointer finds it: the least width of a box around a restart's ring or «now»'s dot, and the
  forecast's from past «now»'s along its line to half that width past its dot; a box that started
  at «now» put its middle 12px past its mark, where the forecast's line took the pointer.
  The arrows walk the readings, each restart before the
  reading at its moment, then «now», then the forecast. A step line shows its whole window, from
  its start to its reset, running or past its reset alike, and its axis names its two ends for
  what they are: «start 11:30» and «resets 16:30», or «reset at 16:30» once that has passed, each
  dated where it is not the page's day, and the moment alone where the window named none.
  Opened on its start to now and a third past it, a running line ended on a bare time, and a
  finished one on its reset said as bare, and either read as now. A line may hold the windows
  before its current one, each whole from its start to its reset, one after another, the count
  falling to nothing at each reset, a place on the line with its hint, «Window reset» and the
  share the window ended at; those windows' line and dots are drawn in the neutral ink of marks at
  rest, which the legend names «Earlier windows», and the pace runs over the current window alone.
  The axis then names the first window's start and the current reset. Lines that share a scale
  longer than what one holds stand inside it, empty where they hold no window, the axis's words
  under the moments they name, moved out toward the empty part whole where the two would not fit
  beside each other. While the window runs, its
  line marks now: a hairline up the plot in the quiet ink, upright where the pace runs across,
  which the legend names «Now» beside a hair of it, and no word stands over the plot. The top of its scale, «100%» or the
  highest reading past it, is written once beside the plot, centred on a hairline in the rule's
  ink at its level, so a line at 100 % meets the line its figure names: written over the plot
  with nothing at its level, a line at 100 % read as stopping under the mark. A frame dragged
  along the plot, or stretched with Shift and an arrow, narrows that line alone to the moments
  it covers, its axis then naming them alone, and «Whole span», a compact button at the head's
  start while the frame holds, takes it back to every window the line holds, the keyboard's place
  kept; where the frame ends before the forecast's end the line runs to the plot's edge, its dot
  there, and the forecast's hint says the reset stands past it. A window past its reset by the
  page's clock, even one read before it, draws
  neither the forecast nor the places past its readings nor now, its line held to the moment it
  was read or to its reset where it was fresh then, and ended at its last reading where it was
  silent by then, its restarts still marked on it; its readings, their marks and their key in
  the legend are drawn in the neutral ink of marks at rest, as its bar is, which a forced palette
  draws in its inactive ink: in the series' hue beside a muted bar, the last window's line read as
  the share spent now. A 0 % has no fill,
  and a window with no figure draws the track alone; the fill stands apart from the ground and
  the track by lightness, so both read in grayscale and under a forced palette in its inks,
  where the hatch, the forecast's line and fill and the marks take its ink too. Their table twins
  are `WindowBarTable` and `StepLineTable`, each holding the forecast as well, and the second each
  restart and each reset between the windows it holds as a row before the reading at its moment.
  A value keeps one hue in every chart of a panel — its bar, its small chart and its share of a
  day — and its name beside it.
  A table that is the subject of its panel, as a dimension's breakdown, is held to about the
  window's height, so it and its heading line stand in the window together, and scrolls both
  ways inside its own frame: its heading row stays at the frame's top, its total row at its
  bottom and its names at its start, each a sticky cell of the frame. A shorter table stands at
  its own height. Held at the edges of the panel's scroll instead, moved there by a
  scroll-driven animation, the heading row lagged a frame behind the rows and shook as the page
  scrolled. Each heading sorts by its column, and a line over the table says how many rows it
  shows of how many, how they are sorted, and downloads what it shows in that order.
  A row of such a table is one line: its figures take what they need and its name the rest,
  cut with an ellipsis and whole in its hint. The side panel's table of every value leaves its
  names a narrow column, and there a value named by free text, a task or a session, takes two
  lines at most as in a ranked list, then an ellipsis, whole in its hint, so the reference and
  the start of the title stand together: cut to one line in a column of eight ems, a task's name
  showed its reference alone. A pair there takes a line a part, a session's detail a line of
  its own under its name, and the row's figures stand on the name's first line. Any other name
  there, and every name of the section's own table, keeps to one line.
  `DonutChart` is a ring of how one whole splits into parts, one of the two drawings of every
  such chart beside its ranked bars: a sector a part, largest first from the top, five at most
  with the smaller past them folded into one rest in the folded tail's neutral; each part in the
  hue its value has on the page, and a legend beside it naming the parts in the ring's order,
  each with its figure and bare share, «6 h · 47%», at the end of its line in the quiet ink, the
  figures of the lines ending where the others end. The share is the legend's to say, once: a
  ring given figures that already carried it read «90 M · 60 % · 60 %». No words stand on a
  sector: the near-black written there read badly on the darker hues, and the legend holds
  every number. A sector's one hint gives its figure and share, and the rest's each part it
  holds; it stands at the point of the sector's band by the pointer, on the band's middle where
  the pointer stands round the ring, and at the middle of the sector under the keyboard: a
  sector three quarters round the ring once had its hint at its middle, 70px from the pointer.
  Each sector takes the pointer over its half of the gap to the next, and a sector too thin to
  show past its gap still takes it there. The sectors are one Tab stop walked round with the
  arrows. Rows that are no part of
  the whole close it by name and figure under the legend, their figures ending with the
  legend's. Its table twin is `RankedBarsTable`.
- **Empty and error states:** one shared state component (`DataEmptyState`)
  explains what is absent, why it matters, and the next valid action when one
  exists. It stands in the middle of the space the data would fill when a whole
  panel, tab or column is empty, smaller (`compact`) where that space is small,
  and as one quiet line at the start of a section (`inline`) when the absence
  sits among other content, as a section of a card does. A section does not
  write its own muted paragraph for it. Two absences stay rows of their own
  list: a popup's «no matches» line, because a list of choices may hold only
  choices and a status there is refused, and the rail's «nobody is working»,
  one of the rail's captions in the rail's ink and row height.
- **Icons and badges:** application glyphs come from the central icon owner;
  local SVGs and per-screen badge shapes are prohibited. A glyph is the size it is drawn
  at: `VIcon` (and `ControlIcon` through it) takes the size as `size` and keeps it in a
  row short of room — no flex shrink, no `max-width` from the page — so no consumer
  writes `flex: none` for it or a width over it. Measured on every surface at a desktop
  width, a phone's and the navigation's narrowest (`production-icon-size.spec.ts`).
- **One-line labels:** a label that keeps to one line carries the shared `one-line`
  class (no wrap, an ellipsis where it ends) and a `clipped` hint with its whole words,
  on itself or on the control around it, so a cut label is whole on hover. No component
  writes the three lines again: `check:ui-system` refuses an ellipsis, or one line clipped
  without one, in any other rule (a file's rules for one selector read as one), and a
  trimmed word that its component holds to one line without the class; and
  `production-icon-size.spec.ts` finds labels by how they are drawn rather than by the class. A word trimmed to its capitals (`trimmed-word`)
  takes both classes and keeps the trim's cut, sideways only, so its accents stay whole. What
  a host draws in a choice's option is held to the row, so its own one-line word gives way,
  and the row's hint says the option's words; what it draws for the chosen value is held to
  the trigger the same way, and the trigger's value box says it. A field found by typing that holds
  one value draws it so while nobody types there, its hint on the field (`SearchCombobox`). A menu's
  entry is not such a label: it wraps, and every word of it stays on screen.
- **The mark:** one drawing — a spark: a long stroke, a triangle under its short
  arm and a four-pointed star — in two tones, owned by `BrandMark`. Inside the
  shell it is a single ink taking its color from the carrier. Where it stands
  alone on a ground this palette does not own — a browser tab, the tray, the
  taskbar, an installer, a notification — it is two flat colours on its own dark
  rounded tile: the stroke in `brand-body`, the triangle and the star in
  `brand-accent`. No version of the mark uses a gradient.
- **Buttons:** `VButton` owns the five weights the product uses — primary
  (light on dark, one per surface), secondary, ghost, text, danger. A ghost with a
  label rests on the control fill and steps one further on hover, so a text action
  reads as a control; an icon-only ghost stays bare at rest. `text` is an offer that
  repeats down a surface, such as the rest of a group: it rests bare, because a fill
  per cell stood level with the tiles it offered, and fills only under the pointer.
  A screen does not restyle a
  bare `<button>` for an ordinary action. A weight is a set of values, not a set
  of rules: each variant declares its fill and label at rest, hovered and
  disabled, and one rule per state reads them, so no state rule can outrank a
  variant — the base hover once painted a hovered primary dark under its dark
  label, which is how a disabled button looks. Hover is the same weight one step
  further from the ground; disabled is one look for every weight, a step toward
  the ground with a quieter label that still reads at 4.5:1.
- **Actions as icons:** an obvious action is its icon alone — refresh, close, copy,
  edit, remove, add, open in another window, fold and unfold: a ghost `VButton` with
  `icon`, its words as the hint and the `aria-label`, and under a finger or at phone
  width a press target of `--size-control-target` (`icon` reaches by itself; an
  `inline` one is given `reach`). An action keeps its words when it commits or sends
  something, confirms a destruction, is the one primary action of a form or a surface,
  is the way out of a failure or an empty state, or has an icon that would need a
  legend. A panel opened by a finger keeps its words too: a finger gets no hint.
- **Actions that come up:** a row of a long list may keep its actions out of sight until
  they are wanted, and then all of them by one rule, `reveal.css`: the row is `reveal-row`,
  the action or its group `reveal`. Where a pointer can hover, the action is see-through at
  rest and keeps its place, so nothing in the row moves when it comes up; it comes up under
  the pointer anywhere on the row, with the keyboard anywhere in it, while a popup it
  opened is open and while a press on it is carried out, and Tab reaches it from either
  side. A press with the pointer does not leave it up. Where nothing can hover it stands.
  It serves a checklist step's discussion, the pin of an unpinned row of the Work list and
  a lane heading's card and chain. One action gives its place up as well, `reveal-room`:
  «Open session» on a rail row of the Work list, which few rows carry, so the row's words
  have that room until it comes up and shorten while it is up. `check:ui-system` refuses a
  copy of the rule elsewhere.
- **Segmented choice:** `SegmentedControl` owns "pick one of a few visible
  alternatives" — view switches, chart encodings, ledger filters, a card's
  sections. Picking a value — the board's view, the graph's filter, a chain's
  scope, the threads to show — is a radio group: Tab reaches it once, on the
  chosen segment, and the arrows, Home and End move focus and the choice
  together. Switching what a panel shows — a card's sections, Settings' sections,
  an editor's Write and Preview — is tabs over that panel (WAI-ARIA APG): the
  same row given tab ids from `useTabIds`, and `TabPanel` around what it shows,
  naming the tab back. Only Left, Right, Home and End walk a row of tabs; the
  arrows show a panel as they reach its tab where it shows at once, and only
  move focus where showing it starts slow work, as Settings' diagnostics do. A
  row of `aria-pressed` buttons, `radio` or `tab` roles styled locally is the
  same control built again, and `check:ui-system` rejects one. A row that
  scrolls sideways where its room is narrower than it — a card's sections, the
  kinds of question over «Needs my answer» — scrolls in a `ChoiceStrip`, which
  fades the end a choice is cut at and keeps the chosen one, and the one the
  keyboard reaches, clear of that fade: the strip of its own faded nothing and
  kept the chosen by the browser's nearest edge. A segment not
  pressed takes the hovered ground and the main ink under the pointer, a step
  under the pressed one's ground; the ink alone was a step of grey a reader
  pointing at a two-segment row did not see. A row of choices wider than half a
  settings row is a wide row (`SettingsRow`'s `wide`): the choice stands beside
  the name in the half every row's control stands in where its words fit there,
  and under the name, as every row of a narrow workspace does, where they do not;
  it wraps only where that line cannot hold it either. Wrapped, a row of
  segments (`SegmentedControl`'s `wrap`) stands in columns of one width on the
  fewest lines the room allows, and in the fewest columns that keep to that many
  lines (`segmentColumns`): every line but the last is full, and the last, short
  only where no number of columns divides the segments, keeps its segments under
  the columns above. Four stand two over two, never three over one; five in room
  for three or four stand three over two, and in room for two, two, two and one;
  where not even two columns fit, one column. Held to the half, Participation's
  set wrapped onto a second line at 1280px; reaching toward the name instead, the
  choices of one column started at three edges at 1024px. Each wrapped line
  sharing its own room, the set broke a phone's two lines 17px apart and stood
  three over one at 430px. Held to columns that fill every line, the five
  periods of Analytics would have had none but one, five lines tall in a bar that
  stays on the screen.
- **Menus:** `VMenu` owns a menu behind a button — a card's «…», a view's settings — as
  the WAI-ARIA APG menu button. The trigger is a ghost `VButton`, its sign alone with the
  menu's name as its hint, or its sign and words; Enter, Space and ArrowDown open it on its
  first entry; the arrows walk the entries and wrap, Home and End go to the ends, a letter
  goes to the entry it starts; Escape, a choice or a press outside close it and focus goes
  back to the trigger. An entry that opens a dialog, «Save view…», opens it from there in the
  same moment, and the dialog gives focus back to the trigger as it closes. It holds actions, settings that show a check while on, and a choice of
  a few values under a caption, each a row of the control height, and floats over a card or a
  dialog as a choice list does. A stray press reaches neither the trigger nor an entry. A
  menu does things to what it stands beside; picking the value a field holds is
  `ChoiceSelect`'s.
- **Facet filter:** `FacetFilter` owns a filter's field and its menu, and
  `FacetFilterChips` the values it holds as chips; the Work views and the Analytics bar
  filter through them, each saying what its filter is over: the values no facet holds, the
  facets, and each facet's values. The field is the way into the menu, with no button of
  its own: a press in it, `/`, ↓ or a letter typed opens it, and Tab or focus coming back by
  itself does not, since Tab passes through to what the menu would cover. Escape closes the
  menu, then clears the text, then leaves the field, one step a press. The menu takes two
  steps, as Linear's does: it opens on the facets, each row marked with a chevron, and a
  facet's row steps into that facet's values; a condition that holds values of its own, as
  «Closed in a period» does, is a row among the conditions that steps into them the same way.
  The values' step heads its list with the
  facet's name as the way back; ← or Backspace from the start of the text goes back too,
  and the highlight lands on the facet it left. Typing in the facets' step still finds a
  value of any facet, the fast path for a reader who knows the word, and a pick made that
  way lands in its facet's step with the value highlighted; inside a facet the text narrows
  its values. A facet's values are asked for only while they show — the facet stepped into,
  or every facet while text searches them all — so a host that reads them reads none for a
  closed menu; what is not there is said under them, in the muted detail words and no row:
  a wait once it has lasted, a read that failed, nothing found. Every row keeps to one line
  by the one-line labels' rule, its words cut with an ellipsis where the menu is too narrow
  and said whole in its hint. The menu is as wide as the field, up to 24rem, or as wide as
  its host asks, and never past the window's end; it stands as tall as the window lets it,
  down to 8px over its foot. While it shows it is the page's open popup, and the hints of
  what lies under it keep quiet. A chip is a press that takes its value out; once the chips
  without it are drawn, the focus goes to the chip before it, the next one when it was the
  first, and the field when none is left, so it never falls to the page. ← from the start
  of the text reaches the last chip, and Backspace there takes it out. Every bar composes
  the two alike: the field stands in the bar's row and takes the room the row leaves, and
  the chips stand in a line of their own under the row, the way to take every filter out
  at that line's end, so the chips never compete with the field for one row's width. The
  Analytics page once had a list of its own, a field for each dimension under a button: an
  unplaced account's «<id> · аккаунт не определён» wrapped to two lines there, 52px beside
  rows of 40px.
- **Disclosure:** what shows more of something — the rest of a long text,
  earlier replies, a chain's or a lane's further rows, a folded thread — is the
  bare `text` weight, its words in line with what it opens. The ghost's fill is
  for actions; a disclosure in the same fill stood level with the actions beside
  it.
- **Tree rows:** `treeRows` lays out records as a tree of rows: each row's depth,
  its place among its siblings, whether it is open or folded, and, under a
  filter, the path rows kept above what matched, each with how many matched
  under it. It is the one file that writes the tree grid's role and a row's
  level, set size and position; a component binds them whole, as
  `v-bind="treeRowAttrs(row)"` and `treeGridAttrs`. `TreeRowLead` draws a row's
  start: an indent of 24px a level, 16px on a narrow list, that stops at the
  fifth level, the second on a narrow list, and the arrow that folds or opens the
  row. The arrow stays out of the Tab order, because ← and → do the same.
  `useFoldChoices` keeps a reader's fold or opening against a rule, per space,
  and forgets a choice once it agrees with the rule. The board's lanes, the
  graph's frames and the list's tree each keep their own choices under their
  own rules.
- **Fields:** `VField` owns the frame around a labelled control — label,
  control, optional hint — and `VTextInput` owns the control itself for one
  line or several. A button beside a field lines up with its control, so that
  field's hint stands under the row and is named by `describedby`; inside the
  frame it put the button level with the hint, under what the button acts on. A
  date keeps the platform picker inside that field, because
  the native control is already localized and keyboard-complete. A label passes
  the pointer to its control, so its box reaches down to the control and the
  pointer crossing from one to the other never leaves them: across a gap the
  control's hover went out and came back. A field whose words under it change as
  it is typed in names every hint and reason it can come to say, and holds the
  room of the tallest from the start, so a reason appearing, or one taking a
  hint's place on more lines, moves nothing under the field. Six screens
  had written their own text field and no two agreed on the fill, the hairline
  or the radius; `check:ui-system` rejects a new `<input>` or `<textarea>`
  outside the primitive, and lets a checkbox, a radio and the search box
  through as the different controls they are.
- **Long titles** break at a space, after a hyphen and after each `/`, and inside a
  word only when that one word is wider than its line. A browser offers no break
  after a `/`, so `loading/empty/error/unavailable` was one word to it, wider than a
  phone's line, and `overflow-wrap: anywhere` broke it where the line ran out:
  «un» above «available». The `v-slash-breaks` directive (`slashBreaks.ts`) draws
  each piece that ends in a `/` as a `.slash-break` span, whose `::after` is a
  zero-width space with empty alternative text (`content: '\200B' / ''`). The break
  is not text: the title's text, a selection's copy and the accessible name Chromium
  computes are the title as written, character for character. A `<wbr>` is not used:
  Chromium names an element with a space at each one («loading/ empty/ error»). A
  title that wraps is drawn through the directive, and a word wider than its line
  breaks inside rather than running past the box (`overflow-wrap: anywhere`). A title
  held to one line ends in an ellipsis instead and breaks nowhere: a chain's row, an
  editor's suggestion, the card's pinned title. `check:ui-system` holds this rather
  than a list of surfaces, which is what the next surface skipped: a template that
  writes `{{ … title }}` as text is refused unless `title-breaks.mjs` registers why it
  need not break. A title that reaches a template under another name is drawn
  through the directive by the control that draws it: every option of
  `SearchCombobox`, the runs of the card's head, a path in free text.
  `production-title-surfaces.spec.ts` measures each surface. It is a directive because
  a component instance in every tile and row is a cost the board's budget refuses.
- **Code in a title:** a work item's title may hold code between backticks, «Raise
  `` `STORE_SCHEMA_VERSION` `` to 18», and every surface that draws a title draws it as
  code: in the monospace face (`--font-family-mono`), without the backticks. One parse
  cuts a title (`titleRuns.ts`): backticks pair from the left, a pair with something
  between them is code, an empty pair or a backtick left alone stays text, and a
  reference inside code is code. One primitive draws the runs (`textRuns.ts`):
  `v-work-item-title` on a surface that knows it holds a title, and `v-text-runs` with the
  runs its host hands it on a control that draws any text — `CommandList`,
  `SearchCombobox`, an editor's suggestion, a dialog's context line — which never cuts a
  string of its own. Code breaks at a space and after a `/` as the rest of the title does,
  and never after a hyphen, which is held to the character after it; a word of it wider
  than its line breaks inside and stays in its box. Its lines are the title's own lines, so
  a surface that ends a title in an ellipsis or a clamp still does: drawn as a box of its
  own, one long word of code was one line to the board's clamp and its tile grew to six.
  A cut title's whole words are laid in the same runs, in the title's type, its code as
  code, even where the title starts with it. Everything that is text rather than
  drawing holds the title as written, backticks included: a name or a hint attribute, a
  description, a download, and a copy — a selection inside a drawn title puts each piece
  of code it holds whole on the clipboard between its backticks. The list's find reads a
  title as it is drawn, without them. `production-title-code.spec.ts` measures the
  surfaces. Analytics names a task by its reference and title, «MAIN-12 Raise
  `` `X` ``», and hands that name with its runs (`valueRuns`, `lineRuns` in
  `useSpendingWords`) to every place that draws it: a list's and a card's rows, a legend,
  a small chart's name, the table twins, a hint's rows, a filter's choice and chip, a
  tile of the rail, the overview's changes and the side panel's heading. A chart's name is
  drawn by `PairName`, which cuts a pair's runs where its end starts; where nothing says a
  name holds a title it is drawn as the text it is. The page draws no title as SVG text.
  Its names as text — an accessible name, a hint's copy, a download, a sort, a table's
  search — keep the backticks. `production-analytics-title-code.spec.ts` measures it. The
  guard refuses a template that draws a title through `v-slash-breaks` too, unless
  `title-breaks.mjs` registers why it is no work item's title: that directive draws code
  as the backticks it was written with.
- **Free text:** `RichText` owns every text an agent or a person wrote — a
  description, a comment, a report section, a question, an attempt's result, a
  ref's label. It reads markdown (paragraphs, lists, code, links, emphasis,
  quotes, tables) into a tree that carries no markup: raw HTML is shown as the
  text it was, an image is a link to it, and a link with an `http`, `https` or
  `mailto` address opens outside the app. The one image drawn as a picture is one
  this server keeps for an item, written `/api/images/<sha256>` in a card's own text
  outside a link, as a paste writes it (`RichImage`): on a line of its own, on the
  recessed ground of a code span, no wider than the text or 32rem and no taller than
  six lines, so a comment `CollapsibleText` holds at eight still shows it whole. It
  is a button named «Open the picture full size», which opens the product's dialog
  with the picture at its own pixels, scrolled when larger; Escape closes the picture
  and leaves the card. Not a new tab: the server hands a picture only to this page,
  and the desktop app opens new windows in the system browser. A picture that no
  longer loads is the words written for it; inside a link or a press, and in a
  document, an image stays what it was. A link with no scheme names a file or
  folder of the project, as a path written in the text or in a code span does,
  and a link of any other scheme keeps its words and loses its address. Nothing
  reaches `v-html`. A single line break stays one, because these texts were `pre-wrap`
  before and agents write one fact per line. In a card a markdown heading is an
  emphasised paragraph: the section the text stands in owns the outline. A
  document the viewer shows keeps its headings as headings. Code, hashes and
  ids are set in the metadata font.
- **References in free text** link only where they resolve, and each owner of
  that knowledge answers for its own: the open space for its items, the card for
  its own space (through its draft guard and Back) and for the commits and
  memory ids it carries as refs, the shell for another known space and for
  session ids the server knows, and the documents layer for paths, which the
  server resolves from the space's root or from the document they stand in.
  Whatever no layer claims — `SHA-256`, a number missing from the space — is the
  text it was. A path that is surely one but opens nothing copies itself instead,
  with a dotted underline that tells it from a link without colour; one that only
  looks like a path (`client/server`) stays text until the server confirms it. A
  modal dialog that could only open a card behind itself — the new task's preview
  — claims every reference as text.
  A reference is inline, as a link in prose is, never a box of its own: a box moved to
  the next line whole, left the line before a long path half empty and could leave the
  comma after it alone on a line. So it breaks with the words, a path also after each
  `/`, which a browser does not offer by itself, and what is written against it stays
  on its last line. A work item's number is the exception: one word of a few letters, it
  breaks around itself and never at its hyphen, as in a title, linked or not, since a
  question's head on a phone ended one line on «MAIN-» and began the next on «314».
  Padding that takes no room in the line gives its words a pointer target as tall as
  their line, 24px in reading text, without reaching the words above. One
  that leads to a card or a document is a link to that address (`/open/<number>`, the
  document's page): a plain press opens it in place through its owner, and a press with
  a modifier or the middle button is the browser's, as on any link. The desktop app has
  no tabs and hands such an address to the system browser, so there every press opens
  in place. One that acts — copies, opens a file in the editor, shows a record or a
  session — is a button, with Enter and Space.
- **A project's document:** `DocumentViewer` shows one Markdown file of a project,
  read-only, in whichever host the window has room for. Where the window holds both, it is a
  second pane inside the surface it was opened from, right of a card or of the panel of open
  questions. The threshold is a formula in `shellLayout.ts`: the surface's width, 440 px of
  document, a 40 px gutter and what must stay usable under the surface — 360 px of board
  beside a card, 40 beside the modal questions — so 1460 px with a card at its opening width,
  1200 with the narrowest and 1160 with the questions. It is measured again when the window
  changes width and once a drag on the card's edge ends, never during one, and crossing it
  moves the document between hosts with the reader's place. Below it the document is a drawer
  on the command layer over them, at full width on a window of 620 px or less. The card stays
  mounted under either with any draft, and a document goes with the surface it was opened
  from. The pane and its surface are one dialog with one Tab trap and two named regions: F6
  and Shift+F6 go between them, to where focus last stood in each. Focus goes from the link
  into the document whatever its read comes to — its text, a file too large to show, a failed
  read, no file — so the first Escape is the document's: it closes it alone and hands focus
  back to the link that opened it, the next closes the card or the questions, and an Escape
  in the card closes both. The document takes focus from where it stands only on an
  opening or a step inside it that the person began, until they move focus themselves, and
  never on a read the window's return began; a landing with focus on nothing takes it from
  nobody, whoever began the read. The edge between them is the document's width, kept under
  `valkama-document-pane-width` and shared with the drawer, and Enter on it folds the
  document and brings it back. Folded, the strip it leaves is named by the words it shows,
  «Document: <title>», as a window splitter is named by its pane; «Document width» is its
  description and that it is folded its value. At `/doc?project=…&path=…#…` the
  document is the whole window with nothing of the shell: the address follows the reader, a
  work item's number is text, and there is nothing to close. There the head and the text stand
  in one column as wide as a line of the text, 58ch, in the middle of the window, and a table
  or a block of code wider than that grows by the same on both sides, as far as the 56rem
  column the page used to be and never past the window; a pane or a drawer keeps the text at
  its start. The head names the project and
  the path, which copies itself, and offers Back to the document before, a refresh, the file
  in the owner's editor and, outside `/doc`, another window, which closes the document here.
  The editor opens at the line a link named while its block is in view, else at the first
  line of the top block in view, and also takes a file too large or not text for the viewer;
  a refused plan copies the path and the shell's notice says why. The actions are one group,
  4 px apart, and under 560 px of head they take a row of their own under the way out, so
  the title and the path keep the row beside a card. A `#…` or `:42`
  brings that block to the top and marks it in the gutter, with room for its ring above and
  at both sides; an anchor the file no longer has is said in the head's status line. A link
  to another Markdown file opens in the same place, and a file read again when the window
  returns keeps the reader's place by the heading above it.
- **A reference's card:** `ReferencePreview` owns the one card per window shown
  for a work item's number in free text. When it shows and goes is the hint manager's (Hints):
  half a second after the pointer rests on it, at once while a hint or a card is up or has just
  gone, at once on Tab. It shows number and state on a line, the title, the holder and the
  steps. Its number copies itself and the icon beside it copies the item's address, as in a
  card's head and with the head's note; Tab goes from the reference through those two and on
  from the reference. Its text can be selected: focus goes back to where it stood when the
  press ends with nothing selected and otherwise at the next Tab, and a selection holds the
  card up until a press elsewhere, Escape or a scroll. The pointer on the card keeps it
  whatever reference lies under it. A press on the reference still
  opens the item, and Escape closes the card and nothing under it. A card from the
  pointer closes when what holds the reference scrolls, and the scroll's end asks again for
  the reference the resting pointer is on, as for a hint. A card from Tab stays,
  because the browser's own scroll to the focused number would close it, and is
  hidden only while the number is out of the window. Focus handed back by a closing
  surface does not bring it up; a pointer resting on the number that surface uncovers asks
  again after its rest, as after a scroll's end. A number the open space holds is drawn from memory
  with no request; any other reads that item's brief record once.
- **Writing free text:** `MarkdownEditor` owns the field, and draws it as one
  object: a slim toolbar, the text and a foot inside one hairline and one radius,
  told apart by tone; while the text has focus the hairline itself takes the focus
  colour, with no ring around it. The toolbar mentions a task or a file and marks the text up
  (bold, italic, code, a link, a list; Ctrl+B and Ctrl+I by the key's place, so a
  Russian layout has them too) and switches between writing and a preview drawn
  by `RichText`, which lies over the text so that switching moves nothing. Its
  buttons go through the browser's own editing, so Ctrl+Z takes them back like
  typing. The field starts
  at the lines its host asks for with `rows`, grows with its text to
  `--size-text-area-max-height`, and then scrolls inside. An `@` that starts a word
  opens the list of what can be mentioned, whether it was typed or written by the
  button; a `#` opens nothing, since at a line's start it is a Markdown heading. The
  list holds the space's tasks and, once something is typed, the Markdown files of the
  project the space is bound to, found by the server's document search; each kind is a
  group under its name, tasks first, sharing the list's eight rows evenly, and the keys
  walk the rows straight across the groups. A task is written as its number, with no
  `@`, and a comment sent from the card's comment field tells that task in `mentions`,
  as long as the number still stands in the text: a number typed by hand stays a link
  and tells nobody. A reply, an outcome and a description tell the same way. A
  file is written as a Markdown link from the project's root named by its file name,
  `[plan.md](docs/plan.md)`, which opens through the same resolver as a link typed by
  hand. What else the list offers is one more source in `mentionSuggest`'s list, with
  its kind's name; nothing else changes. The field stays a
  multi-line text box naming that list, and the list floats beside the field
  rather than at the caret: under it where the window has room, over it where it
  does not, never taller than the room it got and scrolled to the active row. It
  stood in the flow under the field, so a comment field at the foot of a card
  showed two of its eight rows, or none. Every multi-line field whose text
  `RichText` will draw is one — a card's description, a comment, an outcome, a new
  task's description, a text answer to a question. Its host says three things: its
  own action for the text, in the foot's end, or nothing where that action stands
  elsewhere and no foot is drawn; whether its label shows, which it does not where
  a heading already names the field; and where `@` searches, the space the text
  belongs to, or nowhere when the host cannot name that space in the store the
  search reads. Hosts with several fields that are one answer bind them to one
  view. A launch prompt is not one: it goes to the agent's command line as typed
  and nothing here draws it. Inside a card's Overview each field also takes a picture
  pasted or dropped into it (`useEditorImages`, provided by the card): a PNG, JPEG,
  WebP or GIF up to 10 MB, told by its first bytes, is sent to the item and written
  at the caret as `![name](</api/images/<sha256>>)` on a line of its own; anything
  else is refused in the field's foot before it is sent, and a clipboard that also
  carries words pastes the words. A field outside a card, such as a new task's,
  pastes as it always did. A long text held by `CollapsibleText` ends on its
  last whole line, and a link below the cut that takes focus opens the text.

A screen that needs a style no primitive provides has found a gap in this
inventory, not a licence to write it locally. The remedy is a variant on the
owning primitive, or a new primitive with an owner — never a utility framework,
which is a second styling system wearing the costume of a shortcut and makes
the one-off cheaper than the shared thing.

## Module composition

### Work

Work presents board, list, and graph views from the same Planning read model.
The bar above the views is two rows and no more: the view and its menu, then the
filter, then the one primary action, every control of the row at one compact
height, and under them what is drawn and how much of it. The view's menu, «View»
by the view because it arranges what is drawn, holds how the view is arranged and
the views kept. The grouping is a choice in it, offered by view: the board's «No
grouping», «By goal», «By stage» and «By project»; the list's «No grouping», a flat list
of the whole scope in one order, «By goal», its tree, and «By project»; the graph has
none, its frames are its grouping. The order follows as two choices: «Sort» — «Queue
order», the default and the order the take-next queue gives work in, «Updated»,
«Created», «Priority» — and «Direction», whose words say what comes first («Newest
first», «First in the queue first») rather than an arrow's. A list header sorts into the
same order, and the menu names a column's order a header chose among the four. The
address keeps the order as `sort` and `desc`, the queue's from the start writing
neither. «Save view…» keeps the address's state —
the view, its grouping, its order and the filter — under a name, per space, in the interface's
own settings, and a kept view is a choice the menu marks while the address holds it
exactly; choosing it puts its state back, and the marked one can be deleted. A
space never lists another space's views. Nothing in the row is a pressed filter of
its own any more: everything to the right of the field narrows it, and the two
conditions that once stood beside it as presets, «Workable» and «Has an
assignee», are the first group of the filter's menu, with «Waiting for my answer», a task
whose question to the owner keeps the queue from giving it, «Awaiting triage», a card of
the space's own triage stack that no review has marked, exactly the cards the line «time to
triage» of «Needs my answer» counts for the space, and «From another space», a
card another space holds; that one is a value, so its chip's «≠» keeps every such card
out instead. «Awaiting triage» reads the mark the list read gives each stack card: a card
another space holds stands in that space's stack, so it is not taken. The last condition,
«Closed in a period», is a row with a chevron that steps into its periods, those of the
period bar — «Today», «This week», «Past 4 weeks» and «Days of my own» — one at a time: a
card that came to be completed or cancelled within the period's days, each whole on the
reader's calendar, a preset to the end of today. It keeps exactly the cards the Volumes read
counts as Done and Cancelled for those days, by the moment the read counts by, when the card
came to stand where it is, so with the state beside it «Done in a period» and «Cancelled in a
period» are each one address. Its chip says the period, «Closed this week»; for days of the
reader's own the chip says «Closed on my days» and the period bar's two day fields stand after
the chips, the first and the last day taken in, a day set anew narrowing the work at once.
The address keeps it as the period pages keep theirs: `period`, and `from` and `to` for days of
the reader's own. «Workable» is the list read's own answer for each card, the one the queue
gives by, so the filter lets through what claim-ready hands out and follows a rule the
server adds without a copy of it here: where the owner hands out work by hand, the queue gives
nothing and no card there reads workable. A usable filter is as wide as a
phone's, 108px with the longest words; where the view's segments and the action
cannot stand beside that, the bar takes its phone form, where the menu is its sign
alone. The filter's
hint starts with «Filter:» and names what it narrows by, so it does not read as the
search over every project, «Go to a task» in the navigation; it is whole where it fits
and short where it would be cut. The field is the shared facet filter (Shared component
grammar): its facets are state, kind, priority, holder, project, goal or stage, and label,
under the conditions. «Project» offers the projects the work names, by name, and «No
project»; «Goal or stage» offers each container as «MAIN-12 · title» with its path of
references after it, «MAIN-1 › MAIN-12», and keeps the container's whole subtree, the
container included. Every value of every facet at once was a list a real space's labels made
thousands of rows long. Text always ends the
menu with «Search for "…" in all projects», which hands it to the finder; with no
value left that row is all the menu holds, one row tall, and Escape takes it away.
A group's head stays in sight while its values scroll, and
the label group's head says how the labels picked combine, «all» or «any», where the
space has two to combine. Where typed text offers that group beside others it stands last, as the
longest list, and until the list reaches it its head waits at the menu's lower edge, so the
choice is in sight as the menu opens, on a short window too. The menu once
stood 420px tall with the head 37px under it, and the spec passed on a fixture of few entries.
The arrows reach that choice as they reach a value, because
a list has one focus and it stays in the field. The chips say the same in a word
between two labels. A facet's value is «is» until its chip says otherwise: the chip
starts with its operator, «=», a pressed toggle that turns to «≠» and the chip's words
to «Label: not ui», so the work must not carry that value; work nobody holds is not held
by the holder named. Linear asks for the operator the same way, on the chip, rather than
on every pick as GitLab's three steps do. The menu marks a value negated with the chip's
cross in its check's place, and a press there takes it out whichever way it was in. In the
address a negated value rides its facet's own key behind `%-`, which no older link holds. On a phone the counts' line is as tall as the reset that joins it while a filter
is on, so the work does not move as a filter turns on. Every number in the bar counts one population — the space, or a chain
with its root — and a view that draws fewer items says what it leaves out: the
grouped board says how many parents it draws as rows where the line has room, and
a filter names the closed items it let through only when no open one matched.
A goal's progress, lane state, and active work share the same semantic palette.
Aggregate activity under a goal belongs to its lane's head, including its compact state,
and to its frame on the graph, where it is the one sign of work moving
inside a folded frame; bundle headers on the board do not repeat a “working” label.
A frame says that sign in words, «5 working», and never as a sign or a number alone.
Zoomed out, where its band has no room for the words, it shortens to the count beside the
working session's sign, «◌ 5», and the reference is cut before the mark goes; it never gives way
whole, since then nothing on the field says work is running. The header's hover text says
it whole, as a zoomed-out card's does, and so does its button's name: over the work under no
parent, whose one button is the fold, the fold's.
Wherever the list folds the state, the priority and the holder, its folded orders are one
choice in the title's heading, in the heading's font, and an order's name is never cut. So the
head folds before it wraps: as a run of buttons after the title's sort those five took three
lines of a phone's head, and a second line of the head at 1024px once «Steps» became
«Conditions». The two that fold first, «Goal and stage» and «Project», stay a run. A heading
holds one line. Where even the narrowest fit's does not, the list stands that fit once more
with the choice bare: its chevron alone, the words it shows otherwise still the value
assistive technology reads and its hint's name. A tree's lead and an urgent glyph widened the
reference column of a phone's list until the title kept 136px, and «Порядок» beside the
title's sort needed 158, so the choice took a second line of the head. Only a title too narrow
even for the bare choice lets its heading wrap, since that level gives way to none.
Cards do not reserve empty tag or source regions.
A board tile prints exceptions, not defaults. Its first line is a kind glyph
when the item is not a plain task, the reference, a priority glyph when the
priority is not medium, and at its end only what stops the work — the open
blocker it waits on, drawn as its glyph and its reference («⛔ MAIN-12», named
«Ждёт MAIN-12»); the line never wraps, and an exception short of room keeps
its glyph and says its words on hover. A tile that stands ready and that the take-next
queue would still not give is muted: its title takes the finished tile's muted ink, and
its first line ends with the blocker, or, with none open, a sign and a word for the queue's
first reason — «ждёт ответа», «вручную», «отложено выше», «другое пространство» — whose
whole sentence, «Очередь её не выдаёт: она ждёт ответа владельца», is its name and its
hover text. Tone alone means nothing and a hint is not seen, so the word is on the tile; a
line short of room keeps the sign. Elsewhere the column says why: work in triage, put off or
at work is not ready, and a ready tile the queue gives is the norm and says nothing.
The title follows, at most three lines,
its whole words laid over them while they cut it (Hints), while the pointer rests
on its lines rather than anywhere on the sheet, and on the focus a key brings it,
then the labels on one line — as many whole ones as it holds, up to three, then
«+N», which opens the card like the rest of the sheet — then the holder and the
steps when there are any, the steps only while the item is open. The holder is
its executor: the glyph of the client whose session holds the item — Claude's,
Codex's, a client's for any other — and after it what that session is doing, as the
session's sign (`SessionSign`) the side panel draws, at the client glyph's 14px and on its
middle: the turning ring while it works on the item, the paused ring while it works on
others, the question while it asks a person in the middle of a turn and the check while it
waits with its turn over. A session silent over a day draws none there. A stale claim keeps
its client in the warning tone and draws no session. A claim no session proved, with
no session at work on the item, draws nothing: a person's glyph there said only
that a claim existed, on items nobody was working. The client is the holder's name,
the channel the server says the session proved itself on, and the session's doing
is the read model's `live_work`, so the tile reads nothing the board does not
already carry. Its words, «Держит claude · 5937aa01-1234 — работает над ней», «… —
спрашивает человека: ждёт разрешения или ответа», «… — ждёт человека» and «… — захват
устарел», are its hover text and what a screen reader
hears, and the hover card and the card say the name and the stale claim in full.
Printed as a name and a «Захват устарел» beside it, the holder was the loudest line
of a tile after the title and stood it 28px taller. Only the title takes the full ink and the row-title weight; a finished
item's takes the muted ink, so a column of a thousand closed items does not stand
level with the work still open. On a tile and a list row a label is its word, in
the tertiary ink: a press filters, and its 28px pointer box reaches past the line
into the air around it, so the line is a line of text tall. It takes a face under
the pointer and while it is in the filter, and everywhere else it stands alone, a
card's head, it is a chip with a face at rest. The face is a percentage of white
over whatever it lies on, so it stays a step above a resting tile, a hovered tile
and a list row alike; the control grey it used to be is the hovered tile's own
tone. Workable, medium and a plain task are
never printed: they are the norm of the columns that hold them. The title is
the open target, stretched over the whole sheet, so the sheet opens wherever it
is clicked and stays one Tab stop; the chips lie above it as filter buttons out
of the Tab order. The priority and kind glyphs are read, not pressed, as on a
graph node: each spends its 14px and no 28px pointer box, keeps the line's own
small gap from the reference, and the list, the card and the filter's menu filter by
them. The reference is set in the line's own figures, not tabular ones: no
column of digits lines up on a tile. So urgent, an improvement, a four-digit
reference and «⛔» with another hold whole in a desktop column when the space's
key is three letters; a longer key folds as any exception short of room does.
A goal or a stage stands as a tile only while it is not accepted, in «Triage» or «Deferred»;
accepted or closed, it stands in no column: an accepted one derives its state from the work under
it, and the board shows it as a lane where it groups by goal or stage.
The board grouped by goal gives a lane to each goal, the root of a line of work, and
one to the work under none, «No goal» («Без цели»). A goal's lane holds all the work
under it, through its stages at any depth; a stage heads no lane and is work of its
goal's lane, a tile there while it stands in a column, so no item is drawn twice. A tile
filed under a stage names that stage on its second line, «Stage MAIN-12 · title», in the
quiet tone, since the lane names only the goal. The lanes name the goal, as the card
does. Grouped by stage, every goal and stage heads a lane named by its path, «Goal ›
Stage», stands as no tile, and work stands in the lane of its nearest container. Each part
of the path is a press that opens that part's card, and the chevron alone folds the lane.
A lane's counts are «closed N of M» («закрыто N из M»): its work closed out of all of it,
one population, as the list's group rows count. A card
of another space, which has no parent here, stands by goal and by stage in a lane of
its space, «Space ALPHA · name», after this space's lanes. Grouped by project, a lane is
each project of the space, in the space's order and kept while empty, then «Several
projects» for a card naming more than one, drawn once there so its drag, its focus and
the counts stay whole, then «No project»; an accepted open goal or stage stands in no
column and so in no lane.
On the board grouped by goal a cell with no tile drawn takes no ground until a
tile of its lane is dragged and could land there, and a finished cell's offer of
its tiles is a line of text. A goal's row is one line: its reference, its title
and what it holds, and where it stands only once its work has moved, since one not
started is the norm of a board that holds a hundred of them and the word goes on
being read out. Its card and its chain are two icons with their words in
`title` and `aria-label`, as an entry's actions are, at the end of the line;
where the row wraps, at the end of its last line. A row that may wrap keeps its
title's words: what it holds goes to the next line once it and the whole title
no longer fit one, rather than the title giving way to keep it beside. Where the
last line is full they stand beside the title only if it stays whole there;
otherwise they take the line's last part down with them onto a line of their
own, since a title cut to half its words reads worse than a line more. The
state goes up beside the whole title on its own, apart from the counts, wherever
it fits there and that saves the row a line: a short title then keeps its state
beside it and its counts and actions on the line below, where the state and the
counts together left the actions a line alone. Only where nothing can come down
with them, a phone's row whose counts would leave its state alone where the
state does not fit beside the whole title, stand alone or not fit a line beside
them, do they end the row on their own. Where they stand and where the state
stands follow from the row's width alone, worked out from its parts' widths as
the lines lay them, and are worked out again once the interface font has come
in, so a window widened to a width, one narrowed to it and one opened before its
font draw the row alike. A wrapped line starts under the reference, not under
the arrow: a line from the row's edge stood 4px left of the arrow. The indent,
28px (the arrow's 4px inset, its 16px and their 8px gap), shortens every
wrapped line, so the row takes a line more across at most the 28px of width
above each width where lines from the edge would first fit it in one line
fewer. That happens up to 890px in Russian under a finger (849px with a mouse;
in English 802px under a finger, 782px with a mouse), in lanes with a goal and
without: three lines for two, or four for three where a long title also names
work out of sight.
They come up as a row's actions do (**Actions that come up**), in a place kept
for them, so nothing shifts or is covered; where nothing can hover they stay, a
finger's reach apart. The keyboard moving along a row held at the top leaves the
board where it is: the room the board keeps there for that row does not push its own
buttons out of view. Their rings stand whole wherever the row does: it keeps the
ring's reach above its arrow, and the board keeps it at its edges. A tile the board brings into
view under the row's heading, by the keyboard or by opening it, stands below
the heading at the gap the lane keeps under it, however many lines the heading
takes.
The «Deferred» column («Отложено») starts folded to a strip as narrow as a control, its name
running down it over its count, so work put off holds no column's width; a press on the strip
opens it, the same press on its open head folds it, and a reader's choice against that rule is
kept per space and forgotten once it agrees with it. Under a filter a column nobody folded opens
when it holds a match, so a search never hides what it found; folded, its count still says it.
Grouped, the row of state names holds the strip as its chevron and count, the name its hover
text, and every lane keeps the narrow track empty until it opens. Focus follows the press to
the control that undoes it.
The Done column, and a lane's Done cell, stand newest closed first, by when the
item last entered its finished state; nothing there is planned, so the order of work
the other columns stand in does not apply. No tile is placed by hand in any
column: a drop within its own column changes nothing, and a tile dropped in
another column moves to that state, standing last until the board reads the
space again. A tile dropped on Done from another column closes, wherever the
drop lands, and stands on top.
Graph nodes allocate separate rows for status, title, and relationship
metadata so labels cannot collide.
A list of fewer than 300 rows paints what fills its height first and draws every
other row right after, with its columns already as wide as all the rows need, and
keeps every row in the page. From 300 rows a list keeps in the page only the rows
in and about its scrolled window, and gaps hidden from a reader hold the height
of the rest, so the scroll bar is as long as the whole list. Its columns are as
wide as all the rows need wherever it scrolls; a sort and a filter act on every
row; ↑/↓, Home/End and Page Up/Page Down move by a row's place in the whole list
and bring the row into view; the rows are the list's one Tab stop, and the head's sorts
and its choice of orders are none of their own, since Tab came to the rows only after a
stop at every sort, seven for a reader before the first row: ↑ from the first row goes to
the heading above the cell focus was in, ← and →, Home and End walk the head, and ↓ goes
back to the rows; nothing in the list or around it listens for a press but its controls,
since a browser names a listening element clickable to a reader, and the list's box was
read as «clickable» before its table; the Tab stop and the row focus is in stay in the
page wherever the list scrolls; the table tells a reader how many rows it has
and each row where it stands; a printed list prints every row; and Ctrl+F finds
in every row, as the next rule says. The cost, for now: on a list that long, a
screen reader's browse mode reaches only the rows in the page.
After its title a list row's «Goal and stage» («Цель и этап») names the goal and the
stages it stands under, goal first, «Launch › Beta», read from the whole space, so a
filter that leaves the goal out of the rows still names it. Work under no goal says a
dash; a card of another space says nothing there, since this space's read does not name
that card's goal. The column sorts by the path. It gives way first: beside every other
column a list of 900px left the title 20 characters and pushed the table past its edge.
Folded, the path leads what the row prints under its title, on one line cut at the row's
edge and whole on hover: a line of its own above an open blocker and the labels while the
state, the priority and the holder stand, and the first fact of the line of facts once they
fold with it. The list by goal draws
no such column, since a row's place there is its goal; the list by project does.
After it «Project» («Проект») names what a row changes, drawn by the rule of a tile's
project mark: the space has several projects and «All projects» is chosen. It says the one
project of this space the row names, «Several projects» for one naming more, as the board's
lane by project does, and a dash for work naming none; a card of another space is named by
this space's projects alone. It sorts by the project's name, work naming none first and
work naming several last. The list by project draws no such column, since a row's group
names it. It folds with «Goal and stage» and follows the path wherever that leads, a name
saying nothing for work naming none. Each of the two is at most 10rem wide.
The list stands the widest of its four fits — every column; all but those two; the
reference, the title, the conditions and the date; the reference and the title — whose table
its own box holds. A fit's table is as wide as its columns need: each as wide as its widest
row and its heading, the first column of a tree with its lead, the arrow and the indent of
its deepest row, and the title 36 characters with its heading on one line. A fit that needs
more pushes the table past the list and gives way to the next within the frame, so a reader
sees only the one that holds. The narrowest keeps the title 16 characters and what the
reference leaves, and gives way only to itself with its choice of order bare, as the head
says above. Fixed widths decided before, 1100 and 1270 for
every column, 920 for all but two and 560 for more than the reference and the title, set
where a typical title kept its 36 characters beside a flat list's first column: a
migrated store's longer states, holders and dates left a flat list of a 1280px window its
title 172px and its head two lines, and a list by goal three levels deep at 1280px, measured
on the width alone, left its title 131px with words broken inside and ran 24px past its
frame. A narrow list's cells take half the inset, 8px, as its head's sorts do,
so a heading's word starts where its column's words do: at 12px a tree five levels deep at
390px left its title 16 characters, broke «Переосмысление» inside, and stood «Название» 4px
left of the titles under it. The priority's glyph that follows a reference where its column
has folded is counted in the first column's width, and a narrow list's indent stops at the
second level, a row deeper naming its parent under its title: counted as nothing, an urgent
row five levels deep at 390px stood its glyph 6px past its cell over the title's inset, and
counted with the indent at the third level, the table ran 9px past its frame. A group's row wraps between words and keeps each count whole, its
wrapped lines starting under its name: held to one line, a project's long name stood the
table 574px wide in a list of 302 on a phone.
Grouped «By goal», the list is a tree grid. A goal stands at the top, with its
stages and tasks under it by depth, and rows that share a parent stand in the
list's sort order. Grouped «By project», it is a tree of one level: a row per group, as
the board's lanes by project are, its name and counts across the columns, and the cards
under it in the list's order. A group's row opens nothing: Enter, a press on its arrow, ←
and → fold and open it. A card of another space, which has no parent here, stands by goal
in a group of its space, «Space ALPHA · name», one a space, after this space's rows, as the
board's lane and the graph's frame of that space do: a group's row, its cards under it as a
list with no tree inside, so another space's goal opens nothing here. A card there with a
parent names it under its title, «in ALPHA-4», as a row below the indent's last level
names its own: the read names that parent, which lies in the card's space and among none
of this space's rows. «From another space»
negated keeps those cards out and their groups with them. The view menu offers «By goal» on the list and on the board alike. A goal or stage with more than 20 open items, or with none open,
starts folded. A reader's choice against that rule is kept per space and is
forgotten once it agrees with the rule. A filter lays out the whole scope and
shows what it let through with the path to it: a path row is quiet, a reader is
told it is a path, and it says how many rows matched under it. Under a filter
the rule folds nothing. Below the indent's last level a row names its parent,
«in MAIN-12», under its title. Focus is on the row. ↑/↓, Home/End and Page
Up/Page Down move by place in the whole tree. → opens a folded row and
otherwise goes to the row's first cell. ← folds an open row and otherwise goes
to its parent. In a cell, ← and → go to the cell beside it, and ← from the
first cell returns to the row. Enter opens the card. A press on a row's arrow takes no
focus: it moves focus to the row and then folds or opens it, as the keys do, so a reader
hears the row and then its change; on the arrow the row took focus from inside itself and
a reader heard neither. Folding a row that holds
the focused row moves focus to the folded row. The tree draws its window from
300 rows it could show, folded rows included, not from the rows it shows. Its
first column is as wide as the deepest reference needs after its indent, so
neither a fold nor a scroll moves a column.
A goal's or a stage's row says under its title what it spent, as its row on the Volumes page
says it: «Spent», without the cancelled work, and «With cancelled», each agent time and the
tokens processed anew, «—» with its hint where usage was not counted, never 0. The list reads
those rows in one read for the goals and stages it draws, a list that draws more as it scrolls
asking for the new ones, and a row without its figures yet, or whose read failed, has no line:
the list never waits on them. A space of an attached store, which that read does not answer
for, draws none.
The list has a find of its own, because the browser's reached only the rows in
the page. While the list is what the page shows, with no card, dialog or finder
over it and no menu, choice list or other popup open, Ctrl+F (⌘F) opens the
list's bar in place of the browser's; over any of those and on every other screen
Ctrl+F stays the browser's. Ctrl+F is the key that types F, wherever the layout
puts it, so on Dvorak the key in QWERTY's F place is Ctrl+U and stays the
browser's; only where that key types no Latin letter, as «а» on a Russian layout,
is it read by its place. The bar floats over the list's top end corner under the
sticky head and clear of the scroll bar, so the sorts stay in reach and opening
it moves nothing; it is a named search landmark,
and its count, «3 of 12» or «No matches», is a polite status that describes the
field and is as wide as its widest form, so a step moves no button. The find
reads the words each row prints, at the list's width and in its language, and
nothing a reader does not see: a priority folded to its glyph is not found by its
word. Case does not count, nor white space beyond one space; «ё» is «е», a Latin
letter is itself without its marks and a stress over a Cyrillic vowel does not
count, but a letter a mark makes stays itself, «й» apart from «и»; no match spans
two cells. Enter and Shift+Enter, F3 and Shift+F3 walk the matches in the list's
order, round past either end, and a match out of sight comes to the middle of the
room under the head, not to its edge: the match itself, on its own line of a row,
whether the list draws its window or every row, unless the list's end stops the
scroll first. The drawn matches are marked through the CSS Custom Highlight API:
every match keeps its ink on a quarter of the find's yellow,
the current one is the whole yellow with dark ink, and a forced palette draws them
in Mark and Highlight. They are marks of the screen: a printed list carries neither
them nor the bar. The count and the current match follow the stream, a filter
and an order: the current match stays on its row while the row still matches, and
only the reader's own step moves the list. Escape closes the bar and gives focus
back to where it was, without scrolling the list back to it, or to the list's Tab
stop when that element has gone. While the bar is open the find reads every row's
words once for its term, and again only when the rows, the language or a width
that changes what a row prints change; a key typed into the term only matches.
A list row, a graph node and a search result print a work item's facets only
through the facet registry, and print the exception, not the default. A list
row leads its reference with the kind (but a task) in one fixed glyph slot, so
references align whether or not a row has a glyph, and the reference's heading
starts where the slot does; the priority column says every priority as its word
alone, in its tone, and medium quietly, and only where that column has folded away
for want of room does the priority (but medium) follow the reference as its
glyph, because a blank cell in a sortable column
reads as unknown; the holder column
says nobody with a dash, never «Workable»; the labels sit under the title
while the state, the priority and the holder stand; an open blocker is named, «Waiting on MAIN-12», wherever it
lives. A graph node leads with the kind, says its state as a dot and a name
in the hue of its chain edge, says workable quietly in the state's place and
never in heavier ink, and reads high or urgent after its reference; its glyphs are read,
not pressed, since the card is one button. A search result leads with the
same glyphs, then its state's dot and name and its project; results share
their columns so every reference and title start at one edge.
«Связи» holds the item's related work, then its evidence. A group of related work longer than
five rows opens folded to its heading, which counts its rows by state — «Привело к 14 ·
11 выполнено · 2 не разобрано · 1 отменено» — and a shorter group opens; what the reader opened
or folded holds while the card is open and comes back with it by Back. A goal's fourteen
rows of «Привело к» put everything under them a long scroll away. A link's row says the
other end's state in one place whatever the length of its title: in a column every group
of the list shares, on the title's first line with every dot on one edge, and under the
title, at its edge, where the list is a phone's. The state followed its title in a row that
wrapped, so down a list it jumped between the end of a short title's line and a line of its
own under a long one, and groups that sized their own columns put it at another edge in each.
The evidence ends with the item's commits, «Коммиты», newest first: each named by its
repository and the start of its hash, «valkama · a3cc0de4», the pair that finds it, with its
subject, then its project's name, when it was committed and, for a commit attached by hand,
«прикреплён вручную». The server attaches a commit itself when a session makes it, which is
the norm and says nothing. Its name opens what git says of it in a dialog, asked by that
repository and hash (`GET /api/commit`) in the repository's registered root alone; a
commit of no known repository says git has nowhere to be asked. A hash written in the
card's text opens the same dialog where it names one commit the card carries, and is text
where it names none or could name two. A commit is not a ref: the refs above it are
sessions, memory records and links.
A card's chain is a tab of its own, «Цепочка», in the order Обзор · Агенты · Цепочка ·
Исполнение · Память · Связи · Системные события, of which a card shows those it offers.
The card offers it only where there is a chain — an item with children, or one work was
discovered from — and for an item with no children only once the chain read has said so;
a card on the tab whose next read finds no chain steps back to «Обзор». The chain stood in
«Связи» before, after the links and references, as a relation of the item, which put it
under every link of a goal; the map and its hundreds of rows had held Overview's first
screen between the next step and the description before that. The tab names it, so it has
no heading of its own: it opens on its «Состав | Цепочка» switch and «На графе», and Back from
the graph opens the card on this tab. A goal or a stage opens on «Состав», what it holds,
and a task on «Цепочка», what grew from it: a task holds no work. The switch stands only
where the two answer differently, by the counts the chain read gives for both scopes: where
the work grew nothing past the root's children the two are one list, and a task with no
children has no contents to read. A goal or a stage with no children keeps it, since it
opens on its empty contents and the switch is its one way to its chain. The reader's choice
holds while the card is open and comes back with it by Back. An item of an attached store
has the tab only where it has children, and there it says that its chain is read in the
primary store.
«Состав» says first how much of the work under the root stands in each state, the chain
read's counts in scope `tree` and none counted by the interface: tasks by their state's
category, then, on a line of their own, the goals and stages under it by the state they
derive, since «В работе» is said by both; then «По проектам», its tasks by the project each
changes, the most first and «без проекта» last. A task of two projects counts in both, so
that line adds up to more than the tasks; a project the registry does not name shows its
id. Under the counts the work is the list's tree of
rows: the root's stages and tasks at the top, each stage opening down to its tasks, in the
order the read gives. A row says its reference, its title on one line, its state and who
holds it while it is open; at a phone's width the holder gives way. A stage with open work
opens and one with none starts folded, as in the list, and a fold the reader chose is kept
with the list's, so a stage folded in one is folded in the other. One Tab stop, ↑ ↓, → and ←
walk the rows as in the list, and Enter or a press opens a row's card. A root with nothing
under it says «Внутри пока нет задач.» and draws no tree. «Состав» draws no branch map and
no groups: its rows are the root's own work, and the map's lanes are origins of a chain.
In «Цепочка» the section leads with a branch map: one lane per origin of work,
one equal-width segment per member, finished work then current work then what
is ahead, so a lane's length is its volume. Chain views colour with the
board's hues — finished green, in progress blue, review amber, ahead grey,
blocked red — because a hue means one thing on every surface: Dev is the same
blue on a column head, in a list row and on a lane. The lane is a 3px status edge; where a
member is narrower than a few pixels, work under way rides it as a raised
rounded mark, so it is still seen without spending a surface on it. No lane is
drawn shorter than 16px: a lane of one or two tasks on a long chain is
stretched to that, its tasks sharing the length, and a dot closes it, so it
reads as a lane and still as the shortest; its counts say its volume. A lane's
label stands beside its own lane — after its end where there is room, else at
its start — and never a row above it with only a stem to say whose it is. Where
a lane names some of its work under way and not all, a last label says how
many it left out. A chain view's legend names only the states its drawing
holds, on the map as on the graph, so no key — least of all the emphatic
«Blocked» — stands for nothing; on the map each key has its figure, so it is where
the section says what stands where and no sentence names the groups again. Chain
views name a single state as the board's
column does and a group of states by the group's own word, never by a
workflow key. The graph's key stands in the field's own strip above the flow,
not in the bar, and keeps the place of a state a switch can add, so no switch
moves the bar or the field; the camera controls stand in the strip below. Neither
lies on the flow, so no framing and no pan puts a node under either, and the field is as
tall as the room the two strips leave it. It keeps a floor — one row of cards at the size
the field opens to be read, with the air a framing keeps round it — and its row grows to
that floor, so the floor never runs the field over the strip below. A window too short for
that — a phone held on its side — scrolls the graph's view instead, so the strip below is
reached whole, never covered or cut. There the floor gives way to the view's own height:
the field stays a finger's target shorter than the view, so wherever the view is scrolled
the bar and the strips beside the field show that target between them, the larger at
least half of it. A finger on the field moves the camera, not the view; on the bar or a
strip it scrolls the view. A view under one target tall leaves the field no floor. In a
phone-wide workspace the bar is one row — the filter or the chip and a «Graph
options» button that opens the switch and the key under it — the frontier count
takes the key's place in the upper strip, and the camera controls
keep one row, so the field keeps most of the screen and no camera control falls
outside it. The field opens with its drawing in view: whole where it reads at
reading size, else from its first node at the top-left at reading size; a chain
opens on its root and an open card on its item, and no opening frame leaves
empty ground beside work it cuts. Over the whole space the first screen holds open
work: when the field's beginning shows none, the camera begins at its first open
work as it is read instead (see the frames below). The camera is the operator's. A data refresh
and any change of queue, search or switch never moves or zooms it; it moves
only when a different scope opens — another project, another chain, a branch
from a card's «Show on graph» — by the opening frame above, on the explicit
«Fit whole graph», when the operator folds or opens a frame (`toggled`, below),
and when after a narrowing not one drawn node is left in
sight, and then only across, at the operator's zoom: onto the whole of what is
drawn where that fits, else onto its first node as it is read. A field that
changes size follows the last rule, and leaving the graph for another view
and coming back to the same scope finds the camera where it was left. The camera
goes no further out than the zoom «Fit whole graph» gives for what is drawn now in
the size the field has now: past it a header is a pixel or two and the map a smudge.
The button, the wheel and a pinch stop there and the button says so, and a narrowing,
a fold or a resize that leaves the camera further out brings it up to that zoom; a
refresh still moves nothing. The fit is worked out from the drawing and the field and
never reads that limit, or a field that grew could not be fitted. In a phone-wide
workspace the camera also goes no further out than the zoom at which a card's smallest
text stands at the ramp's floor: 12px over that text's 13, both read from the tokens
(`graphZoomFloor.ts`). At 390px the whole space fitted only where a card's words were specks.
The floor is not the 13px reading floor, the card's own size: a card and the air the keyboard
keeps clear round it would then be wider than a 390px window's field, and every step into the
field would move the camera the operator had placed. There «Fit whole graph» shows the
drawing from its beginning at that zoom, as it is read, and the rest is a pan away;
«Zoom out», the wheel and a pinch stop there, the button
turning off as at any limit; and «Fit whole graph», which stays pressable, says why in its
hint, which is also its accessible description, since a button turned off takes neither the
pointer nor the focus. A drawing that fits at that zoom is fitted whole, as anywhere, and a
wider workspace keeps the rule above unchanged. The
2.1.0 rule that framed the field afresh on every new queue or search was
withdrawn by the owner after use: each narrowing cost the operator their place
and their zoom. The keys to the chain list its
groups as a lane runs, finished first, while the card's member list runs as work
is taken, what is under way first. «Show on graph» from a card
whose map has a branch chosen opens the
chain framed on that branch — the whole of its work where that reads, else its
beginning at reading size — with its members edged in the selection accent, a
chip naming the branch that lets it go, and the branch in the address; focus
goes to the graph, never to the page. The field is one Tab stop: the arrows
walk to the nearest node their way, Home and End to the first and last as the
field is read, and the camera follows. The node the keyboard stands on lights its
lineage and the rest of the field recedes; a pointer over a node lights nothing and
dims nothing — the node takes its hover ground and every other node and line stays as
it was, since a field that dimmed under a passing pointer only got in the way.
Zoomed out past reading, the graph draws each node as a block of its
state's colour with its reference, so the whole of a long chain reads as an
overview. Under the map, one line gives the figures the key does not — the work under the
root, how much is open, how much can be taken — and a second answers whether and
when the open part closes, from the last seven days, and says so as a range when
those days disagree. Where the pace can say nothing that second line is not there.
What those days added and closed, why there is no verdict yet, and the chart of
the chain's history stand one action away, and the action's state comes back with
the card's other reading on Back. The scope rides the heading's row.

Over the whole space the graph stands in frames. A goal or a stage is drawn as a
frame round its work, at any depth, a stage five levels down as a frame inside four, and the
work filed under no goal has a frame of its own, «Без цели» (`none`), as the board's lane
and the list's group of that work are named, so every open item stands somewhere on
the field. Another space's work the read holds — its cards that name this space's project,
and the far end of each link between the spaces — stands in a frame of that space, one a
space, after this space's frames, the spaces by key, named as the list's group of that
space is, «Пространство ALPHA · Alpha» (`space:<key>`). Such a card has a parent, only in
its own space, so «Без цели» would say the wrong thing about it, and another space's goal
is a card there rather than a frame, since it holds nothing in this space. That frame's
header is the work under no goal's: a fold and the name, with nothing to open, and it folds
by the same rule. The counts line says another space's cards apart, after this space's
work: «8 открытых из 9 и 2 из других пространств», since they are in the read and drawn on
the field but are not this space's work; under a filter it says what the filter let through
of them, and «≠ Из другого пространства» leaves none, nor any of their frames or the links
to them. The far end of a link is counted nowhere above the field, in that part or any
other: the read holds it only to end the link. The census behind the line is the one
every view reads (`usePlanningCensus`). A frame is told by tone and draws no line: it is
ground a step above the field and its cards a step above it, and a frame inside a frame is a well cut a
step below the one it stands in. Without a filter the field draws every frame with
open work and every open goal, and in «All» every goal; under a filter, as on the
board, only a frame the filter found something in. So every item is on the field,
as a card or as the frame it heads, and the open-or-all switch counts the items the
counts line above it counts. A frame has three readings.
Open, it is its header over its cards. Folded, it is the header alone, a little
wider than a card so its counts fit. A header is as tall as its title, one to three
lines, with the counts right under it, and the layout leaves it the room that same
header takes when drawn; the chevron leads its reference line, and everything in the
header starts at one left edge, the one its cards start at. Zoomed out past reading, the header is the
goal's reference grown with the field, as a zoomed-out card's is, with the count of
work moving under it at the far end and a thicker edge beneath; the work under no goal
keeps its name instead, as another space's frame does. The header is two buttons with one action each, as a card
is one: the chevron folds or opens the frame, and the rest opens the goal's card;
over the work under no goal and another space's work the rest is plain text, with no goal
to open. At the scale
the field opens at, the chevron is a 28px target under a fine pointer and 44px under a
finger or at a phone's width, reaching up and back into the header's padding and the air
round the frame and never onto the goal's words, so the header is drawn no taller; each
button's focus ring goes round its own drawing with air and no further, and the fold's face
under the pointer covers its chevron alone, zoomed out too, where its target is the whole band
of the work under no goal: never that band's words or its edge. Zoomed out, the chevron is as
tall as the band's first row and grows with it, and the ring round any of the band's buttons
keeps the share of its words it has at reading size, so the focus reads as they do. The field
opens with as much air above its first row as between two frames, so no edge cuts a fold's
target. Below a
quarter of full size a header is a few pixels and the frame round it is what the hand
finds, so the ground of an open frame with a goal opens that goal too and the pointer
says so. It is the pointer's shortcut: the keyboard has the header's button and no new
stop, a card on the ground and a frame inside a frame answer for themselves, and a drag
from the ground moves the field. A card in
a frame does not name its goal, since the frame does. A chain has no frames: it
keeps its flat drawing, its root and its goals as nodes, because its progress is
the card's map and not the field's.

A frame starts folded by its structure alone — how much open work it holds — and
never by who is working on it, or every agent's turn would lay the field out again.
A frame holding more than 20 open items starts folded and shows its progress in its
header instead, and so does a goal with nothing open; the frame of the work under
no goal with nothing open folds only past 20 drawn cards, so «All» on a space with
a few finished items draws them. Every frame between those starts open, so the
links of its work are seen at once. What the operator chooses for a frame, folded or
open, outranks that default and is kept per space in this browser (`localStorage`,
`valkama-graph-frames`), apart from the board's folded lanes, which start from other
defaults; outside a filter a choice that matches the frame's default is forgotten,
so a frame left alone follows its work again. Folding or opening a frame lays the
field out again, and the camera follows across, at the operator's zoom, so the
frame's header stays where it stood on the screen and what was pressed does not
move from under the hand (`toggled`). The arrows reach a header's two buttons as
they reach cards, the fold on its left (`frame:<id>:fold`) and the goal across the
rest (`frame:<id>`); the work under no goal has only the first. Right from the fold
is the goal's button beside it and Left from that button is the fold, however wide
the header, since measured from centres a wide header's second button stands further
off than the first card under the fold. Once a fold hides
the target the keyboard stood on, the field's Tab stop is the fold button of the
innermost frame round it that is still drawn. Zoomed out past reading the fold is
hidden and is no target, except over the work under no goal, whose header has no
other button and keeps it (`foldIsTarget`): the arrows, the Tab stop and the way in read one
list of the targets the field draws at its zoom, so Tab never rests on a button
that takes no focus and the field stays one stop at any zoom. Focus on a fold the zoom
hides moves to the goal's button beside it before the fold goes, whatever changed
the zoom, and the camera stays; at reading size the stop is the fold again.

Open work comes first as the field is read, finished frames after it. The field's
pieces are the frames no drawn line joins, each alone, and the frames lines join,
together; `box` packs them, a piece holding open work at a higher priority. Where
the space has five or more lone frames with open work, they stand on a shelf of
their own, then the linked open work on a second, then the finished frames on a
third, and each shelf stacks its small frames to fill its rows (`GROUP_MIXED`).
Without shelves a row is as wide as the widest piece and as tall as its tallest, so
a dozen small goals beside one linked piece thousands of pixels wide made one thin
strip with empty field under it, and the first screen at 1500 px was 83 % empty;
`box` ignores priorities in its grouping modes, which is why the priority stands on
the shelves and the grouping within them. A first open piece can still begin with a
finished frame linked into it, so the camera does not count on the order: when the
field's beginning shows no open card and no header of a frame with open work, it
begins at the first open work instead, and a field whose beginning shows some opens
on its beginning. The keyboard enters where the camera looks: once the field is
placed, Tab from outside lands on the open card's item or the chosen branch's work
when it is in sight, else on the first header button or card in sight as the field
is read, and only with nothing in sight on that card or the field's first target,
which the press then brings into view; the camera does not move for a target
already in sight.

A header says how its work stands in words, a number beside each word and never
rounded to «99+»: «8 из 21 выполнено», then how many are in review, in progress and
blocked, each only when it is not zero, and how many are being worked on now. The
goal's standing is said once its work has moved, and quietly on a closed goal that still
holds open work. Its reference line is as wide as a folded frame lets it, and a folded frame
is wide enough for the longest standing a goal or stage derives, «Ждёт подтверждения», to
stand whole beside a reference with a five-digit number: a state waiting for its owner is
read at once, not when a pointer finds its hint. Only the title gives way when the row is short; the counts are
never cut, and take a row under the name before they would be. Under the row a 3px
edge draws the same counts as a chain's lane is drawn: finished, review, under way,
blocked, then what is ahead (ready, untriaged and deferred work, and a nested goal or
stage still open, together), each part as long as its
share, in the board's hues, and a part too short to see still a dot. The counts
describe the goal and not the view: every item under the frame, open and closed,
nested frames' included, whatever is drawn or a filter lets through. Over the whole
space the key names the parts the frames' edges draw, «Впереди» for all that is
ahead together, and finished work by the board's word, «Выполнено», which the
header's count says too.

A link is drawn between the drawn ends it reaches: a card, a goal's frame, or the
outermost folded frame the card stands in. So a link to a goal ends on its frame
rather than being dropped, and a line to work folded away ends on the frame that
holds it. Frames lie under the lines and cards over them, so a line runs across a
frame and into the card it ends on. A link between an item and a frame it stands in
is not drawn, since the frame already says it, nor one whose end is hidden finished
work. A link with another space is drawn as any other, to the card in that space's frame or
to the frame folded round it. A link whose far end the read holds neither as a card nor as
an end lies in a space the read could not read: it is not drawn, and the key says so first,
«Связи с GAMMA не прочитаны» by the key the link names its source with, or «Связи с другим
пространством не прочитаны» where nothing names it. That line is a fact about the field, so
a screen reader hears it, while the rest of the key stays a picture's key it does not read. A line runs the way the work went, and the layout
ranks its start before its arrow, over the whole space as in a chain: a block from the
blocker to the work it holds, and a discovery from the work it was found in to the work
that grew out of it, so a chain's root stands before what was discovered from it and the
arrow lands on the new work. That is against the order the link is stored in, «A was
discovered from B», which the card's links, the history and every other word for the
link keep. Drawn as stored, the new task stood before its goal with the arrow on the
goal, and the dashed line read as that task done into it. All the links from one drawn
end to another are one line, its arrow keeping that direction: solid when any of them
blocks, since a block is the one hard dependency, and dashed as context otherwise.

Live work is what the read model's `live_work` says an agent's session is doing on
an item now. A card says it at its foot as the session's sign (`SessionSign`), the one
the side panel and a tile draw, in one 14px box for every state, and a word: «работает»
(`working`), «спрашивает» (waiting with a question to a person in the middle of a turn),
«ждёт» (`waiting`, its turn over), «у сессии» (`held`) or «молчит с <date>» (`quiet`).
The sign and the word stand as one line of text, the sign on the middle of the word's
capitals. The word is the one mark of the state that is not a colour, so it never
gives way: the holder's name beside it is cut first, and the card's accessible name
says that name whole. Beside live work the foot drops «Закреплено за», which the
word already implies, so the word, the name and a priority share the line and some
of the name always stays. «молчит с» names the day alone: a session is called
silent only after a day without a sign, so the hour tells a reader nothing. Only `working` moves: an item a session at work (its turn running, or a
subagent of it) wrote to since the last message a person sent it — a claim, a step,
a comment, a link from it — whether or not it holds the item, by itself or through
a subagent; an item one of its subagents holds a step of; and an item Valkama runs
an attempt on. Its sign turns, and every line that stands for one of its links
carries a comet: a short bright stroke in the hue of work under way, running from
the line's start to its arrow over the line as it is drawn, solid or dashed. An
item the session holds while it works on others stands still with «у сессии», so a
coordinator holding many items does not move them all on every turn, and the items
of a session whose turn ended and that waits for a person stand still with «ждёт», and
those of one that asks a person in the middle of a turn with «спрашивает»:
motion that also meant holding or waiting would no longer tell work from rest. The
words say what the session's events show, as a card's «Agents» tab does, and
never that a process was seen alive. A frame counts the items under it that move,
so a folded one still shows the work inside it moving. The key names the live line,
and the strip offers the switch that stops it, only while something on the field moves: a
drawn card being worked on, or a frame, folded or open, that counts work moving
under it. Work the filter or the chain leaves off the field moves nothing there.
The key explains each session's sign a card on the field shows, and only those, with the
card's own glyph at the card's size and standing still: «сессия работает над ней»,
«спрашивает человека посреди хода», «ждёт: ход закончен», «у сессии, сейчас не в работе»
and «молчит больше суток». A sign is a stroke, so a forced palette draws it in its host's
ink. The loading panel's three dots, the one indicator still drawn as dots, keep their
fill in the palette's text colour: a palette clears every fill to its ground, and dots
made of a fill would vanish with it.

Moving work starts by itself and lasts as long as the work, so the reader can stop
it (WCAG 2.2.2): one button in the strip above the flow, «Остановить движение» and
then «Пустить движение». Its place is held whether or not it is offered, so its
arriving with the first moving work moves nothing. The choice is one for every
graph and every space, kept in this browser (`localStorage`, `valkama-graph-motion`)
across reloads and never in the address a link carries; storage that refuses the
write keeps it as long as the page. Stopped, there is no comet at all, since a
frozen one would be a dot stuck at an arrow: a live line keeps its stroke and is
held still and wider, in the hue of work under way, and every working sign on the
field stands still. Reduced motion outranks the button and needs none: nothing
moves, as when stopped, and the button is not offered. A forced palette clears the
hues, so a live line and its comet take the palette's colour for what is picked out
(`Highlight`) and a wider stroke, moving or not; a frame, its ground cleared, is
outlined; and its edge fills what is finished, dashes what has begun (review and
work under way) and leaves the rest an empty outlined track.

The comet keeps the rule, stated with the motion tokens, that a background refresh
is never animated. It is a looping indicator, as the working sign's turn is, saying that
work goes on for as long as it does, and not a transition of anything being read. A
frame of the stream turns it on or off at once, with nothing easing in or out. The
layout and the camera do not move for it: live work is laid on the placed field by
id and takes no part in what decides the layout, and a refresh never moves the
camera. And since it lasts as long as the work does, it has the pause above.

A card is a bar that never moves and one scroller under it, and no layout in it
depends on where that scroller stands. Its head waits for the record: going from a
card to a card, what is shown until the read answers is Back, Close and the waiting
mark, and on Back the scroller stays hidden until the card stands where it was left,
for about as long as a normal read and no more: a chain that answers later moves the
card once to its place, unless the reader has moved on. So nothing appears in one place
and then jumps to another without a reason to. The bar has one height: on
its left the item
in one tertiary line — the kind (glyph and word, in its own colour), the reference (it copies itself),
when it last changed and, where the item has one, its plan anchor as an icon, whose
whole path stands in Relations with the item's other references, both opening the
document at the anchor — and on its right
Back, «…» and Close. «…» holds what a person does with the item that is no fact of it: first
what changes what the item is part of, only where its place allows it (see «Dividing work from
its card»), then the pin that keeps it in the side panel's «Работа», a setting checked while it
is on. The pin
stood in the identity line between the link and the date, read as one more fact there. The
link to copy stays beside the reference: it is the reference's twin, in the head as on the
hover card, and what it did is said at the end of that line. The scroller holds the rest and moves it 1:1: the title, the facts, the
tabs, the content. The facts are rows 4px apart, each led by its name in the quiet ink in
one column, «Приоритет», «Состояние», «Метки», «Исполняет» or «Ранее отвечал», «Подписаны»
and «Родитель», with the value on the name's baseline; a run of chips with no names read as
one heap of state, priority, holder and tags. The rows stand in the registry's order
(`FACET_ORDER`), the order the new-task dialog asks in and every surface reads an item's
facets in; the template only draws each row, and the parent once stood before the labels
because the template put it there. The state is its own transition menu, said
once, so a move the server refuses leaves the chip naming where the item is. A move that closes
work or puts it off asks first rather than going as it is chosen: putting off opens «Отложить»,
cancelling a task asks its reason in the band under the bar, and cancelling a goal or a stage at
work opens the window of what closes with it (**Closing work from its card**). Then, while a
question waits, «Ответить» with the question's sign: a verb that goes to the question on
Overview, in the state chip's word and on its baseline. It was drawn as the status «Ждёт ответа», a state that acted when pressed, and
that the agent waits the state's dot already says. The priority is a menu as well, urgent to low, each
choice saying what it means; on an item the client cannot change both are plain marks.
The parent is named «Родитель», since a goal and a stage both hold others, and drawn by
its own kind's sign in that kind's ink, as a tile of it draws it: the container's sign for a
goal or a stage, a bug's for a bug, and for a plain task, which has no sign, the generic parent's. Every
parent was once called by the one container word under its sign, a task holding others too. Its reference is
an item link, the same link a number in text is: a press opens the parent through the card's
departure, its draft guard and Back, and resting on it shows its hover card; its number is
trimmed to its letters as every value of the facts is, so it stands on its name's baseline.
The new-task dialog's field is «Родитель» as well, offering «Без цели» first. A ↳ and a
bare number there led nowhere. Every item a fact names is such a link. The holder is bare words, shortened to its name and the start
of its session with the whole value and its lease in a tooltip — on a holder that is a
session's button, in what a screen reader hears after its name, since its hover says what a
press does — and a warning dot once nobody is behind it; a plate there read as one more chip. «Подписаны» names the other
sessions that follow the item, each as its claim's holder would print, a name moving to
the next line whole and one wider than the line wrapping between its own words, read whole
with no ellipsis, since plain words offer no hover to a keyboard or a finger; with nobody
following there is no such row. A goal or a stage is held by nobody, its work being its tasks: its
state row says the state it derives from them, «Не начато», «В работе» or «Ждёт
подтверждения», and its menu offers only what can be done to it, «Подтвердить закрытие» while it
awaits that, «Отложить…» and «Отменить…», each where the workflow has a state it leads to;
«Подтвердить закрытие» stands beside «Ждёт подтверждения» as a button too. Where the read of the item names sessions
working under it the holder's row is «Работают: N», those sessions printed as the followers
are, each with the tasks it holds in its tooltip, and no «Взять». A task waiting to be taken
in «Не разобрано», «Отложено» or «Готово к работе» that was taken before says «начата»
beside its state, quieter than it; a goal never does, its start being its first task's.
Accepted work ends the rows with «Принято»: who decided it is to be done, «владелец», «по
поручению», «как часть цели», «по правилу метки», «решение агента» or «принято до 3.0», and
when; work nobody accepted has no such row. On Overview a step its former holder marked says
«отмечено прежним исполнителем» on a line of its own under the one who marked it: that holder's
lease lapsed, and the mark waits for a fresh one before review or a close, the mark in the amber
of a decision waiting. «Подтвердить» under the mark is that fresh tick, the reader's own, on a
card the client can change. Neither stands in the holder's line, which never wraps: there they
left a phone's holder a letter a line. A label chip only filters, its words in its middle with
the same room at either end, at rest and under the pointer alike. The labels are changed
in one place, the picker the new-task dialog asks with: the «+» that ends the row, or a
press on the row beside the chips, opens it in the row's place over the space's labels,
the most used first, with a check on each the item carries. Choosing an unchecked one
attaches it, choosing a checked one takes it off, and typed words add a new one; Escape,
or focus leaving it, gives the chips back, Escape with focus on the «+». A × kept at each
chip's end was a second way to take a label off, and the room held for it left every
chip's words off its middle. A read-only item with no labels has no such row. The labels
stay under the title, not above it: the title is what the card is found by, and editing
controls over it would push it down by however many labels wrap. Every value stands at
one height, the state chip's, so a wrap adds a row of that height and never a half step.
One action ends the holder's row on a wide drawer and stands at full width under the
facts on a narrow one: «Взять», «Отпустить» on this client's claim, «Забрать себе» on
another's. Where the facts argue against taking it the reason stands there instead —
«Ждёт MAIN-12», the number a link, while an open blocker remains, «Цель — возьмите задачу из неё» on a
goal and «Этап — возьмите задачу из него» on a stage.
Reading down, the tabs stick to the top of the scroller, on one row that scrolls inside
itself where it has to, the one shown and the one focused brought into it, and whatever
is scrolled into view comes to rest under them. The bar answers with two fades on the
surface motion tokens, at once under reduced motion, and moves nothing: the title takes
the identity's place once the big title has passed under the bar, and the action fades
in beside Close once its own place has. Each has its room from the start, so its arrival
cuts no word and shifts no neighbour; a reason goes with the facts and leaves the title
its room. A control the keyboard holds in the bar stays until the keyboard moves on, and
one a press went down on until the press ends; what has begun to fade takes no press, and
what is fading in takes one once it is half there.
Pinned, the bar and the tabs are no taller than the title and tabs of 2.1.0, and they say
which item this is and keep the action and every section in reach: keeping the facts, a
full-width action and two rows of tabs, an earlier head held 279px of a phone. A section
pressed read far down starts at its own top with the tabs where they were; a section too
short to scroll that far lets the head back in, with no blank to scroll into.
What has to be answered or read wherever the reader is — a refusal in the server's words,
a failed write, the question before a takeover or before a draft is lost — stands in a
band between the bar and the scroller, at full width, however far down the write was made.
Its height follows what it says and never the scroller. The body names only blockers
that are still open. Overview opens with what stops the work: work put off says «Отложено до 20
ноября», «Отложено до 3 новых комментариев», «Отложено до 20 ноября или до 3 новых комментариев —
что наступит раньше» or «Отложено до закрытия MAIN-12» and why it waits, then each open blocker,
«Ждёт MAIN-12».
**Closing work from its card.** Each write that closes work or puts it off asks before it goes,
and a refusal keeps what was chosen with the server's reason under it. «Отложить» asks when the
work comes back and why it waits, which the server takes nothing without. It comes back on a
day, «До даты»; after a count of new comments, «Новых комментариев», from 1 to 999, every
comment and reply written on the card after it is put off counting; on both together, whichever
comes first; or on the close of a card, «До закрытия карточки», found by its number or title among
the space's open cards. A card stands alone: choosing one clears the day and the count, and a day
or a count clears the card. With a day and a count both chosen, a line says «Вернётся в этот день
или после этих комментариев — что наступит раньше.» It stands 8px under the day and the count it
qualifies, before the card wherever the card is not beside them, as in this window, where each
field stands across it; where the card is beside them, it ends the fields, so the card does not
move as it appears. Under the card it read as a word about the card. «Отложить» is unavailable,
the reason under the fields, until both are said, for a day already gone and for a count that is
no whole number from 1 to 999. The reason holds the room of every reason it can come to say, so
the value that makes the press available moves nothing: given room only while it stood, it took
that room with it, and the press moved. A refused write keeps all that was chosen, and its reason
stands in that room in the danger's ink, right under why it waits: at the end of the form it
stood across the room's empty height. The window keeps its top as the line or a refusal comes
(**Dialogs and drawers**), so neither moves the fields. A chosen card's number and title too long
for its field end in an ellipsis, whole in the field's hint (**One-line labels**). A
task's cancel asks its reason in the band under the bar, the caret in the field, then «Отменить
MAIN-12? Карточка закроется как «Отменено».» with «Отменить задачу»; the reason is the move's and
the summary's why, since a close needs a summary. A goal's or a stage's cancel at work opens
«Отменить цель»: what closes with it, each row its number, its title, its state and its holder,
then the cards outside it that wait on one of it, then the reason every card it closes keeps,
and «Отменить N карточек». The list is the server's, read as the window opens and confirmed by
its token; work that changed in between is refused again with the new list, which the window
shows with «Список изменился…» above it and the new and changed rows marked, the press naming the
new count, so nothing closes that was not seen. A goal or a stage with nothing open under it is
cancelled in place, as a task is, and one the server answers with a list goes on in the window,
its reason kept. «Подтвердить закрытие» shows the conditions of the whole as boxes, those done
ticked, or «Условий нет: проверяется по описанию» and the description, then what was cancelled
or moved out from under it with each reason; «Подтвердить» waits for every box, ticks the open
ones and the marked ones as the reader's, writes the owner's summary where there is none, and
completes it in one write. Work that opened under it while the window was open makes the server
refuse that write: the window then says «Цель снова в работе, под ней открыта работа: MAIN-12.
Подтверждать нечего.», naming what the refusal names, with «Закрыть» alone, and closing it any way
reads the card again. No press says «Вернуть в работу»: the state is what the work under it
derives, and no write answers to such a press.
**Dividing work from its card.** «…» offers a task outside review «Отделить часть…» while a
condition is still open and «Превратить в этап» under a goal or a stage or «Превратить в цель» at
the top level, the word its place gives; a goal or a stage «Вернуть в задачу» once the card's read
finds nothing under it, closed work included; and work under a goal or a stage «Вынести из
цели…». Nothing is offered that the server refuses for what the card already knows, and closed
work is offered none. «Отделить часть» is a window: the new card's title, empty, and the task's
open conditions as boxes, none ticked; «Создать» is unavailable, the reason under the fields,
until the part is named and takes one. The part stands under the same parent, accepted as the
task is, so the window asks neither; a done condition stays with the task. The other three ask
in the band under the bar, as a task's cancel does: «Превратить MAIN-12 в этап?» says what stays,
and that a held task's claims end and their work becomes a task inside it, or that a task nobody
holds drops its projects; «Вернуть этап MAIN-12 в задачу?» says nothing is inside it; «Вынести
MAIN-12 из MAIN-3?» names the triage state it lands in at the top level and asks its reason in a
field first, the caret in it, since the goal keeps that reason. After each the card reads its item
again. A task that conditions left says where they went in «Связи», under «Условия ушли в»: each
card that took some, by its number, with how many, a press opening it.
Overview opens with the next condition, when there is one: a quiet line, «Следующее условие
· 3 из 9», whose number is the condition's place in the list and not how many are done, then
its words as a description reads, with no heading over one sentence. «Все условия» at the end
of that line goes to the conditions and puts focus on their heading; the only condition has
neither the number nor a way to itself.
A section of a card that holds nothing and offers nothing is absent, rather than a
heading and a sentence saying so on the first screen: the «Agents» tab and «Conditions»
stand only while they have something in them, and a step arriving with the live stream's next
frame brings its section back with no reload.
What work on a card took stands as one quiet line under its facts: the time, the estimated cost
and the tokens processed anew, the whole tree's on a goal or a stage. A goal's or a stage's card
adds a line under it with both numbers of its row on the Volumes page, «Spent», without the
cancelled work, and «With cancelled», read for the card alone and said in that page's words, so a
goal reads the same on its card, in the list and on the page. The «Agents» tab's head adds the
sessions that worked on the item, its why saying they count every session that spent on it or
wrote to it and can be more than the card lists, and, under the organizations, «Weekly quota»:
one line per account and week, the latest first, the account by the starts of its ids, the day
its week resets and the item's part of that week, «≈ 10% of the week», whose hint says the share
of the account's cost that week and how much of the week is spent. A week without a reading of
it, or whose account's work cost nothing, says so in place of a figure. Lines of different
weeks are never added up. A line under them says the figure assumes a quota is spent in
proportion to the API price and leans high, and another how much of the cost is on no account
that can be shown, when any is.
A step's discussion stands at the end of its first line and comes up as a row's actions do
(**Actions that come up**): standing on every step at rest, it repeated one icon down the list.
A question has no section of its own: it stands in the discussion and reads as a
comment does, its author, its time and its prompt as markdown, with its fields under
them. One still waiting stands right under the comment form, however old it is, and a
question that has ended takes its place among the comments by time; one answered while
the card is open stays where it stood until the card is opened again, rather than moving
from under the person who has just answered it. The discussion takes the questions as a
list of entries and does not know where they are stored. They are read at their own
half-minute, whenever the window comes back and whenever the card's record is read again,
and a read that failed or could not reach every source is said over the thread with the
way to read again, because not knowing is not the same as there being none. A card with more
questions than one read brings reads those still waiting on their own, and says that the
newest and those waiting are shown and older ones left out.
Whatever answers a comment, a report or a question stands under it as a thread, a reply set
off from its root by one rule, and the whole thread is one `article` named by its root's
meta line. That line prints an agent's session as every surface does, the start of it in the
metadata font beside the name, with the whole id in its tooltip and, where the server knows
the session, as the link to it. The name and that start are one unit: the start stands right
after the name on the name's last line, and the date shares that line only where the whole pair
fits beside it, otherwise taking a line of its own under the name, starting where the name does.
Where even the name's last word and the start are wider than the head's column, as beside three
44px icons at 320–370px or two beside a long name at 320px, the start stands on a line of its own
under the name, from its left edge, and the date under it. A line that says who in a phrase,
«Answered by agent worker-b» over an answer, is one unit the same way.
What can be done to an entry stands at the end of that line, as icons in the muted
ink that always show, since a phone has no pointer to bring them out with (`EntryHead`,
`EntryAction`): Reply, the mark and its removal, Make task outcome, Change answer, and on the
line of a mark the fold. They rise to full ink under the pointer and the keys, and carry their
words in `title` and `aria-label`. An icon is a 28px target with a fine pointer and 44px under
a finger or on a screen a phone's width, drawn bare either way, so the difference is room
around the glyph. The words of the line wrap in a column of their own, so no name reaches the
icons. A comment that asks and still waits for its reply says «· пока без ответа» after the
time, as plain words of that line and the last of them, not a status chip. They stay beside the time only where the author keeps the lines it has
without them, and otherwise start the next line without the dot; the time never moves for them.
They go once another session or a person replies in the thread, or the thread is resolved. Only what shows more of what an entry says keeps its words, because those say how much
is left. Every entry has the one Reply, because threads are one level deep and an answer to a
reply joins the same root: it opens the one field under the thread's last reply, focus goes
into the field, and leaving it brings focus back to the icon pressed. Threads open by their
latest activity and then hold still: a reply arriving says «New reply» on its thread and moves nothing until the card is opened again, while a new
thread takes the top. Four replies or more show their last two under a button that opens
the rest in place. One form stands open at a time, a reply's field or a mark's line, and
what was written in another thread stays there as a draft the card asks about before
leaving. A resolved comment or report folds to its mark and the first line of its root, in
the muted ink and with no sign of success, because the mark says the discussion stopped and
nothing about whether it went well; it opens with an icon that stays where it is, and it
stays open while a form is left in it. The heading counts the entries at the top of the
list as a bare number, a reply being part of its entry; the unresolved count stands once,
on the filter, whichever way the view is set. The unresolved view hides marked threads and closed questions and says how
many, and a thread marked in that view stays under the reader's hands until the view
changes, as a question answered does. A reply whose question could not be read stands on
its own and says so: not knowing what it answers is no reason to hide what it says.
Where another item's comment, reply, report, outcome or description named this one, its
discussion shows the record as a quiet line among the threads, by its time and in the order
the threads take; it is not a thread, so it has no sheet, no Reply, no mark, is not counted
and stands only in the whole view. It says where and from which item, «Упомянута в
комментарии MAIN-12», the number the item's link, as a number in any text is, which opens that
item, since no address opens a card at a comment; under that, who wrote it and when, as a
comment's head says it; and under that the words' first line in the tertiary ink after the rule a
quote has, on one line with the whole of it in its hint. Where and who on one line, a dot between,
made one run too wide for a phone and broke the number at its hyphen. A record whose item is deleted reads
«Упомянута в удалённой задаче», with no link and no words. When the item has more records than
the read brings, one line under the list says how many older ones are not shown. The history's
«Упомянуто в другой задаче» row names the same item, «В комментарии MAIN-12», while the record of
that comment is among those the read brings; a mention in a description, recorded by its item's
id, keeps the bare title.
One form answers every kind of field, here and in «Needs my answer», which adds whose
task it is and the way there. There each request is a block of questions under a head, the
project, the task's number, which is the way to the task, and the title, that stays at the top of
the list while any of the block is in view, over the block's own ground to its edges, and leaves
with the block's end; what else sticks there, a review's count, stands under it, and focus never
stays under either. The way from block to block stands in the dialog's head, on the title's line
where the head is wide and on a row of its own under the way out where it is not: «Question N of
M», where M counts the blocks still waiting and N is the one whose head stands at the top of the
list, at the list's end the last, and two steps, to the block before and the block after. A step
brings that block's head up to the top of the list, where it sticks, and leaves focus on itself,
so that pressing it again goes on; the one it brought up stays N until the reader scrolls. The
arrows do the same from any of the three and Home and End go to the first and the last; the count
itself takes focus to where its block is answered, the first field. The count keeps the room of
its widest number, so nothing beside it moves as a number gains a digit, and under a finger or on
a phone's width each of the three answers across 44px (`reach.css`). A rail of a bar per question
stood in the start inset before, and needed decoding: it counted answered questions too, and had
more bars than the list said were waiting. A block answered while the list is open folds where it
stands; it goes under «Answered (N)», after those waiting and opening in place, at a later read than
the one its own answer started, and only once it holds no typed or chosen words, no open change and
no focus, and neither the pointer nor focus stands in it or after it in the list, which its leaving
would move from under them. Selecting does nothing but select, and nothing is chosen for
the person but at their own press: Send is what sends. Accepting what the agent recommends is
that press, in one block of a review or in all the blocks of a choice that wait, and it fills
only what the person has not chosen and sends nothing by itself. Across blocks, «Needs my answer»
offers «Accept recommended in all» over the blocks of a choice that wait in the tab shown, the
one press that chooses for the person in several blocks, and still only on that press: it opens
in place the list of what would go, a line per block with its task's number, its title and what
would be chosen in it, says how many blocks it leaves out because their recommendation does not
answer them, and sends only on «Accept N» at the list's foot. Each block is filled and written
by its own question, one write each, so a block refused does not hold the others back: one that
went folds, and one that did not keeps what was filled, with the reason in its foot, and the
line beside the press says how many went of how many. A read of the list that crosses an answer
leaves every block once: one read while its answer is out keeps what was filled, and a read begun
before an answer landed says nothing over it. Every choice is a full-width row
whatever their number: its label, a quiet word on the recommended one, and as much of
its description as leaves the labels scannable, so that the first screen still says what
is asked and what the choices are. A description of one line stands whole under its
label; a longer one shows its first words on one quiet line, and past six described
options even that goes; either opens on the row's own chevron, selects nothing by opening,
and can stand open beside another. Nothing in a row's label can be pressed, because a press
there selects: a reference in it reads as text, and a line holding a link opens on its chevron
like one that runs on, so the link works where it opened. What is chosen is never left folded: it stands whole
under the options and above Send, because only what was shown in full may be sent as the
person's answer, and an agent can put a condition in what a row folds away. It keeps to its
rows' edges: on a question's ground with its words on the radios', and under a list's rows,
which have no ground, with none and its words on the boxes' edge. It stands
there rather than opening in the row so that choosing moves no row: a row closing above the
next press would take that one from under the pointer, and near the top of a card there
is no scroll to take that back. The arrows bring the chosen row into view by no more than
it takes, not to the middle of the view as a browser's own do. The radio is named by its
label alone and described only by a line, or a screen reader would read paragraphs on every
arrow press; a description standing under the options is named as its details and read by
going on to it. The chevron is a tab stop only on the row the keyboard stands on, so that
Tab reaches Send. A review's point is the one exception: closed, it names the way chosen under it
by its label in its quiet line, and the way's description shows when the point is opened, where
the rule above holds again, so that a review of a dozen accepted points reads as a list of
decisions rather than a dozen forms.
No row offers an option of the person's own: a field's comment stands for it. With nothing
chosen, its words are sent as the person's own option; with something chosen, as a note on what
was chosen. A row «Your own option» that opened a field, and a comment beside it, were two places
to write one thing, and the person had to decide which their words belonged in while what was
chosen decided it anyway. A change of answer opens the comment on whichever of the two the answer
in force holds; an older answer holding both opens it on the own option, then the note after a
blank line, and saved beside a choice that goes as one note. Its field takes 2000 characters, a
note's limit, since its words may become either.
A question of a kind other than a choice of options keeps the same frame, its head, fold, history,
change of answer and unsent words, and puts its kind's content where the fields stand and its
kind's answers where Don't answer and Send do: a row of buttons, each writing at one press what it
says, through the same write as Send. Nobody declines such a question. An answer that cannot be
taken back asks first, as Don't answer does: its own box says Back, the box beside it says the
answer in the danger's ink, the asking stands where Don't answer's does, and every box holds room
for each word it can come to say; «Cancel» and «Don't do» are such answers. «Later…» opens in
place the choice «Отложить» asks of when work comes back (**Closing work from its card**), with
the card searched among the open cards of the question's own space: «Until a day», «New comments»,
both, whichever comes first, or «Until a card closes». Its fields stand on a line, the card beside
the day and the count where the line holds all three and under them where it does not, and the
«whichever comes first» line stands as that passage says. Beside them the card's field has what the
day and the count leave, so a long card chosen there is cut by that passage's rule, and choosing
it moves nothing. «Put off» stands under the fields,
unavailable with the reason under it until a day from today on, a count from 1 to 999 or a card
is chosen. It stands there whether a reason does or not, and the reason holds the room of every
reason it can come to say, so a value becoming one the server takes moves nothing but what the
«whichever comes first» line takes. Beside the fields once its reason went, the press took their
width, and the card beside the day and the count went under them. What is chosen is part of the
draft. Where the listing names the question's space and project, the head's first line says them
around the task's number, the space before it and the project after. A question its task's
closing withdrew folds on «Question withdrawn: MAIN-12 was closed».
The kind follows the question's purpose: a review shows the task's outcome under what to check
and answers Accept or Return to work; a group of findings shows the goal it proposes with its
conditions, its findings and why, and a goal its description, conditions and how much open work
stands under it, both answering Do, Later… or Don't do; a task in a goal shows its description,
its goal by number and title and the goal's conditions, and adds Move out of the goal, or Leave it
where it was for a task an agent moves into the goal, which stands where it was until then; a
condition
shows what is removed and what each rewritten step was and becomes, with the reason, and answers Allow or Keep; a cancel shows what closes, who holds it
and what the sessions at work answered, and answers Cancel or Keep; a confirmation answers I
confirm or Leave it open, which says both things the server does on that answer, handing the goal
to the next session in its space or, with nothing under it, only not closing it; and a return
answers as a goal does. What Valkama itself asks names its answers in these words, and its card's
form offers them in these words too: «Делать, позже или не делать?» over Делать, Позже… and Не
делать, where it read «отложить» over «Позже…» and, in English, «Take it on, put it off, or drop
it» over Do, Later… and Don't do. It stands under a head that already names its card by number and
title, so it calls that card «this» and says neither again: repeated, the title filled the lines
a phone shows before «Show all», and the ask at the end folded away under it. The ask follows the
first sentence, before the agent's reason and what the sessions answered, which may run long. A
question of any
other purpose, or without the field its kind answers in, stays a choice of options. What the
question does not carry, as a card's outcome or description, is read from its card when the
record first comes into view. A task's goal is read after that card, by the reference the card
names it by beside its `parent_id` (`parent`), with the exact read of one item, since that read
takes a reference and no id; where the read fails, or the task stands in no goal now, one line in
the goal's place says so, and the question is answered all the same.
A group's findings are rows with a box each, a question's rows, all ticked at first and none with
the recommended word, since the server recommends every one. Ticking only ticks. A finding left
unticked leaves the group and goes back to triage whatever the answer, so every answer sends what
is ticked, and once any is unticked Do names how many go: «Do: 7». The server takes Do and
«Later…» only with a finding ticked, so with none ticked both wait for one: they are unavailable,
and the reason stands under the answers, in a room held for it while the question waits, as it
stands under an unavailable «Put off», so a tick taken away or given back moves nothing under the
answers. A choice of a day already open keeps its «Put off» unavailable for the same reason, said
under that press alone, while the line under the answers keeps only its room: said in both
places, it read twice on one screen. «Don't do» stays, and drops the whole group.
«Later…» puts the goal off with the findings ticked, to a day, to new comments, to whichever of
the two comes first, or until a card closes. «Don't do»
asks first, as every answer that cancels does. Where open work stands under the goal that the
question did not ask about, the server refuses it with the list of that work; the list stands
over the answers, what closes with who holds it and what waits on it, the reference it waits on
never split at its hyphen, focus goes to its first
line, which says the answer cancels that work too, and the asking stands again, its buttons
brought back into view. A list taller than the room the panel leaves over the answers, under the
block's head, is held to that room and scrolls inside itself, stopping at its ends, so its first
line and the answers both stay in view and scrolling it moves no answer; the keys scroll it from
that line, and while it scrolls it is a stop of the keyboard. A scroll of the panel the reader
makes still moves the answers and ends the asking. Confirming it
sends that list's token, never the one the question was asked with, which listed the findings the
answer cancels first; a list that changed meanwhile is refused and shown again the same way.
Where the list holds more than one kind, tabs over it offer All and each kind it holds, each with
how many of it wait; a kind it holds none of has no tab, and All alone would only repeat the one
kind, so a list of one kind has none. A tab shows only its kind's questions, the answered ones
put aside among them, and «Question N of M» counts what it shows. When the kind shown empties, as
its last question is answered elsewhere, the tab goes and the list falls back to All.
Over All and the triage tab stands the line «time to triage», one for each space whose stack of
work waiting for a triage review has grown past the owner's thresholds: «Пора разобрать · Main:
ждут разбора 120, старшая — 3 дн. 4 ч», how many of the stack's cards no review has marked and
how long the oldest has waited, counted from when it entered, since the read carries no clock of
the server. It stands on a quiet ground of its own, as a line of the window and no question:
nothing answers it, no number counts it, and focus never goes to it after an answer. A space
whose triage reminder is off has no line, since the server leaves it out. Its one control,
«Показать находки» («Show findings») at the line's end, or on a row of its own where the words
leave it no room, closes the window and opens that space's board filtered by «Awaiting
triage», the cards the line counts. The space is the line's own, in the store the read found it
in, whatever scope the window was opened over, «All spaces» included; its accessible name adds
the space's name, since every line's word is the same.
A review's point is one row: a chevron and the point's label, which are one press that opens the
point, the three words of the verdict at the row's end and the comment's glyph after them; under
the label, from its edge to the row's end, one quiet line of what the point comes to. Accepted
with a way, the line names the way and what is chosen there, with «recommended» where that is the
agent's choice, or how many steps of how many are ticked; a way still to choose is said there in
the warning's ink. Undecided, or decided otherwise than the agent recommends, it says what the
agent recommends, with its why on a press, and while undecided the start of the description after
it; otherwise it is the start of the description. A written comment adds a line of its first
words. The verdict shares the label's line where the point's own width is 30rem or more, as in a
card's drawer, and otherwise takes a line of its own across the row between the label and the
quiet line, so that opening the point moves it no more than the label. Opening moves nothing
already read: the description starts where the quiet line stood, and what the agent recommends
and why follow it in words. Under them hang the fields the verdict opens and the comment's field,
set in behind the thread's rule (`--color-rule-strong`) that runs from under the point to the end
of the last of them; the points of a list stand apart by a divider. A field hangs there before
the verdict holds its option, read only: a dot stands where each radio or tick will, in its box,
and its label says it is chosen after «Accept», in a box as tall as the plain label, so that
Accept turns the dots into controls and moves nothing. Accept fills the way with the agent's
choice as it always did, which a closed point shows in its line. A send refused at a field that
hangs from a point opens the point and takes focus to the field.
No press on a question nobody has put anything into writes, whatever came to stand under
the pointer. Controls can rise under a pointer at rest, as when an agent answers the question
above or asks a new one, and no watch on the pointer catches every way that happens, so the
form is built for it. Don't answer alone could write at one press and cannot be taken back,
so it takes two steps: the first writes nothing and asks on the spot what going on means. The
way back stands in the very box of that press and the way on in the box of Send, each button
holding room for its other word, so that nothing moves and pressing again without moving only
goes back. Focus stands on the way back, and with focus inside the question Escape answers the
same without closing the card or the list. Choosing or writing anything takes the step back too,
so that Send is Send again by the time it is pressed. The step lasts only while attention is on
its question: a press or focus landing outside it ends it, so a page holds one step at most, and
so does its buttons moving for any reason, a question folding above or a scroll, since what the
person pressed no longer stands where they left it. What moved them before the step began is the
screen's, not the person's: the list a refused answer brings stands over its buttons as the
asking stands again, and on a phone it pushed them past the fold, so the scroll to them ended the
step meant to confirm it. The step therefore brings its buttons into view, by no more than it
takes, before it takes their place, and a scroll the person makes after that ends it as any
other. What is asked lies on nothing, so that a
person refuses seeing the end of what will not go, and moves nothing: it takes the place of
Check status, since a press on it would end the step anyway, and that
place is kept as wide as the asking needs on two lines beside the answers. On a row as narrow as
a phone's it is the line above them, which Check status holds where it is offered; where it
is not, that line stands for the asking alone, as tall as one line of its words and the row's gap,
so that the asking moves nothing when it comes. The way to the task is the number in the head of
the block, not a button here. In the row under a list an agent put under its comment, the
comment's press stands on the buttons' line
where it fits beside the two answers, and only in a row narrower than the press, the gap and the
wider language's two answers, 286.4px, as a card's at 320 and 340px, first on the place's line,
which takes the rest of that line, what it holds wrapping inside it. Kept on the buttons' line in
such a row it took a line alone between the place and the buttons. Kept beside the controls as a
room of its own, the asking sent the two answers to the
next line where everything else fitted. What stands before the answers keeps the row's start
at every width. A row nothing can be declined from, the one under a list an agent put under its
comment, is the same row and keeps no place for an asking it never shows: each of its lines holds
a control, and its way on holds room for no word but its own. The comment's press at the start of
that row keeps its drawn box and, under a finger or on a phone's width, reaches 44px past it
(`reach.css`), so its ground, its ring and a forced palette's frame stay on the sheet it stands on;
on the line of a field's label and in an entry's head it grows its box instead, since rows stand
right under it.
Send with nothing chosen or written writes nothing on any question, required
fields or not, and says at the first field what it wants; a question always has a field.
A list under a comment is not held to that: its marks go with one send, and a send with
nothing ticked goes too, which tells the agent the list is not decided.
A press following another can still do harm where something is held: folding lifts the next
question, and its options or a Send over its choice can arrive under the second press of a
double click. So a press at the point of the one before, with no move between, on anything
but what that one landed on, reaches nothing inside a question or in the thread around it,
however long after it comes. Neither the time nor the browser's click count can tell: a slow
write lets the newcomer arrive a second later, and that press counts as a first. It holds until
the pointer has moved more than 3 px or the wheel has turned, however often the press is
repeated, because pressing on while a write hangs must not get through in the end. The keyboard
is never held back, a press repeated on the same control works as it always did, and the layout
does not stay empty to prevent it. The scrim follows the same rule, so a second press on a tile
leaves its card open, and a press on the scrim that does not close takes no focus out of the
surface. It is not a rule of the whole interface: those are the places where the press would
choose or send without being meant, or take away what was just opened.
A comment is one quiet press away. The press is a glyph with no line of its own: for a field
with options, at the end of the line naming it, its field opening under the options, «Comment»,
heard as «Comment: » and the field's name, its empty field saying that with nothing chosen these
words are the answer; for the whole block of questions, at the end of the first line of the
block's head, its field opening at the block's end above the buttons, «Comment on the block of
questions», heard with the block's title, which explains the answer and stands in for none. Among
the buttons it read as one more of them and said nothing of which block it was on. A block of one
question with options offers only the field's comment, since for the person both would say the
same; a block of several, or of one question answered in words, keeps the block's, and one an
older answer wrote stays to be read and changed. Once written the glyph is filled and says so in
its words, and the comment closes only empty. Opening
anything moves nothing already read: an option's description goes on from where its excerpt
stood, and «Needs my answer» stands from the top of its room, with its scrollbar's room kept, so
that what opens in it only grows downward. Declining is as quiet. A
selection or a comment held is a draft the guard asks about. A send that fails keeps all of it with the reason in
the foot, and does not look sent; while a write is out, the buttons read as busy and keep
focus. Answered, the question folds to its prompt with the reply under it, its author and its
time, and every field keeps all it offered, so the answer can be read against what it was chosen
from: the same rows with no control in them and no room kept for one, the chosen one on a
brighter ground and in full ink
with the word «selected», the others stepped back. That word and a line in a forced palette are
what carry it where colour does not. An own option stands as a chosen row with its words, a
comment as a quote under its field and the one on the question last. They are a list, not disabled
radios, which a screen reader cannot walk; only the first line of the reply is a live region, or
every option would be read out when an answer arrives. Declined or closed, the question folds to
its prompt and a quiet line. It says "you" only when the server says the call that closed it came
through this interface, because a name is only what the caller signed. An option's label stays
the text it was in the form, while words written in a field or a note are markdown.
An answer can be changed while its task is open, from an icon on the question's first line, which
keeps its room while the form stands so the time beside it does not move. The same form opens on
the answer in force, and Save stays off until the form says something else. Cancel closes at once if nothing changed and otherwise asks first, with
focus on going on, and Escape from inside is that same Cancel. The change is written against the
revision the form opened on, so an answer that moved on under it is a conflict to read, with the
draft kept, and not something overwritten. The line of the reply then says it was changed and
when, and «Previous answers» opens what it replaced, newest first, as plain words with who said
them. A closed task says to reopen it instead of offering the icon. An
answer arriving from elsewhere folds it the same way, and a note still in the form stays in
view, saying it was not sent, until the person leaves. While a question waits, the card's
facts carry a mark that brings it into view under the tabs from any section.
A card's agents have a tab of their own, right after «Overview», which names and counts
them («Agents 44») and which the card offers only while it has some; a card that stops
offering it steps to Overview on the read that says so, a card opened from it opens on
Overview as any other does, and Back returns to it if it is still offered. On the first
screen a parent's dozens of rows stood between the next step and the description. Every row
stands at once, newest first, under the parent session it opens: that session's way back
stands once at the head of its rows, because in each row it was the same button down the
whole list, and two parents' heads, which can read alike, say which session each is. A row is one record held together by air: what the agent was
started for (or, for an agent named before that was recorded, its type or its short
id), the step it holds, its times, then its type, id and how it is known to be here.
It says what the record shows and never that an agent is working, because a session
row does not prove a process is alive: the last sign of activity, «ended» only with
a recorded end, and «no sign of it since» for an agent that gave none since its
start, instead of a span of no length. It offers no estimate of what remains, which
Valkama does not know. An agent started while its coordinator held several items
stands on each of them and its row says how many; the interface does not pick one.
An open card reads
the list again on the stream's own `agents` event, which leaves the board and the
graph as they are. A wrapped line of facts starts without a dot, because the dot
stands in the room each fact's margin takes from the line, which the line clips.
A holder with a session behind them is the way to it, in the card's head and on its
steps, as a parent is at the head of its rows in «Agents», and in an attempt, a link and the session dialog the same button does
it: the holder's name, in the weight of the line it stands on, and where the session
opens, which does not give way. The place, a running session and the owner's "always
open in" deciding are glyphs after the name, each named for a screen reader and in its
hover hint: the place by the glyph Settings gives that client, a running session by the
activity glyph in the success ink, and the setting by the settings glyph, because a
setting that overrides the rule must not hide it. A place with no glyph stays a word. In
words the whole run, «VS Code · идёт», read as a second, louder value beside a name of
the same size.
A name too long for the line ends in an ellipsis at twelve characters or takes a line of
its own, and an action's own words are never cut. What the button says is the server's
plan, read before any press and run by none, once for all the buttons of one session,
since only the plan knows what a row older than the place record comes to, what is
installed here and whether the client still keeps the session; the card's own read paints
first, so nothing waits and a failed read leaves that standing. A session nothing can open
is no button: why stands in the quiet ink, its reason a press of a small mark away so that
neither a finger nor the keyboard is left without it. One press opens. In a browser a plan
of two steps, and on either surface one that must explain itself first, opens a panel: focus
stands on the first action, the next is offered once the one before it has run and takes
focus then, and Escape goes back to the button. A button keeps focus while it works, marked
busy and taking no second press. What came of a press is said in the shell's notice, which
names what it is about as the button does. What was done goes after five seconds of being
seen: the time stands while the pointer or the focus is on it and while another window is in
front, as it is the moment a session opens. A refusal stays until it is put away.
A session in a terminal that has said
nothing for more than a day, and whose process nobody saw alive, may have crashed with its
row still saying it runs. Silence proves nothing, so it still says it runs; its panel says
since when, warns about two processes on one transcript, and offers to resume apart from
the actions, with no focus and on no press but its own. The graph reads any session silent
for more than a day the same way: its items draw the dashed ring, stand still and say
«молчит с <date>», the day of its last sign of life, and no frame counts them as worked on. The graph does
not call the session ended; it only stops moving its work.

The related work/session/evidence context is one grouped relationship region,
not a decorative sequence. Execution history and native session opening stay
inside work-item context; Memory is a typed reference there. The card's Execution
tab is off by default, and a switch in Settings turns it on.

### Analytics

Analytics is a monitor of what agent work spent, and it fills the window: a bar over a rail
and a panel. Nothing in it moves under the pointer or when an answer arrives; a hint lies over
the page and shifts nothing, and a part that has nothing to say yet keeps the room it will need.

The page reads within the scope the context bar chose. In a space every figure is the work on
the items the space's board holds, its own and the items of other spaces that name its projects,
and the work on no item whose session stands in one of its projects; a project chosen there
narrows it as it narrows the board, and «All spaces» reads every space of the store this
service writes, the one store usage is counted in. The quota is each
account's and no space's: no scope narrows it.

Each column has one scroll: the rail scrolls, the panel scrolls, and inside the panel only a
dimension's table scrolls up and down, in its own frame about the window's height. Only a row
of periods or a table wider than its column scrolls sideways, in a frame of its own. Held to
the window, a section once stacked three scrolls in one column — the panel, its charts and its
table — and left the table eight rows of a 44-row list; held at its full height instead, the
table's heading row was moved along the panel's scroll and shook behind its rows.

The bar, the rail and the panel stand on one grid of columns. The edge of the rail's entry
boxes, the bar's first control and the page's heading share one left line, the bar's next
group stands on the panel's line, and the bar and the panel end on one right edge. Each part
kept an inset of its own, which put four left edges within 20px — the chosen entry's box, the
heading, the entry's words and the bar's period switch — and the one entry drawn as a box
stood out past the bar over it. The rail is as wide as its entries need, within a range rather
than at a constant, and keeps its scrollbar's room whether it scrolls or not: at a constant
240px an entry's words had 182px, and «Способ запуска» was cut to «Способ запу…». The panel
keeps its scrollbar's room too, out of its end inset, so what it holds ends on the bar's edge
whether it scrolls or not; with the room taken only while it scrolled, a section ended 10px
short of the bar.

The bar holds what every part reads by: the period, the filters, how fresh the data is and the
refresh. Which projects the figures are of stands beside the heading of every section the
period's figures fill, after its «ⓘ», in the quiet ink: «Overview · project Billing» on a page
scoped to one, by the name the context bar gives it, or «all projects»; the overview's «ⓘ» says
the same as a sentence. A project's week beside the global one, with the project named only in
the context bar, read as two answers for one week. The quota's sections say none: the quota is
an account's, of no project, and their «ⓘ» says the chosen project does not change it. The bar
has no room for those words: beside the period they took its line to two rows beside a span of
days at 1440px in Russian, cut a span's name at 1200px and moved the refresh when a failure was
said, and under it they pushed the table of tasks past a 1280×800 window.
A period is «Now», «Today», this week, the past four weeks or a span of the reader's
own: days chosen in the bar, or the moments a frame on a time axis bounds (Charts). «Now» is
the last hour by the minute and «Today» the day so far by the hour, against the same hours of
yesterday; both read again every 30 seconds while the tab is visible, a hidden tab asks
nothing, and a refresh shows its answer whole or not at all, so the scroll, the section, the
sort and the place under the pointer stay. Freshness is one element of constant width: a live
mark and the newest record's age in tabular figures, «● 15 s ago», with the whole sentence in
its hint — the record's time and, for a live period, how often it reads again. The mark says a
live period only while its reads stand: after a read that failed it is not drawn, its room kept,
since a green mark with no age beside a panel saying the read failed claimed a liveness the page
did not have. Said twice, as
«every 30 s» and «Last record 14:17 · 15 s ago», it held 21em of the bar, and the air after
the first part still changed as the record aged. A line short of room gives up its buttons'
words, then the air between its parts, then the word around the age, «● 15 s», in the room of
the widest span, then a failed refresh's retry's own word, the failure's words then being the
retry, and never a failure's words or a day of the reader's own period, whose fields are as wide as a date of
the widest figures needs: beside a span of days in Russian the line ran «Refresh» 92px past the
bar's end at 1200px. The last thing a line gives up is itself: one that still runs past its end
becomes the two rows below, with its words back, and a bar with room for one line keeps one line.
The line is fitted as if a refresh had failed, so a failure said takes only room the filter's
field has past its words: the field's end comes back, and the failure moves neither the bar's
height nor the place of any other control. Fitted for the bar as it stood, a failure moved
«Add filter» 260px and the age as far, gave up the failure's own words beside a span of days
at 1440px, and
turned a line of 1280px into two rows that moved the panel. Beside a span of days, in Russian,
the line needs a 1390px window, the filter's field taking 30px more than the button it replaced;
at 1108px «Refresh» ran 188px past the bar's end, and pressing it
scrolled the bar sideways. There, choosing such a span moves the panel down by the second row:
one line wherever it fits was chosen over a bar of one height for every period.
Below a bar 50rem wide, a window under about 1107px beside the expanded navigation, the bar is
two rows of one height whatever period is chosen: the periods and the filters, then the ends of
the reader's own period at the start of the second row and the
freshness with the refresh at its end. One row cannot hold them there: at 1024px the line is
about 712px, and the periods and two date fields alone take 693px of it in Russian. Standing
beside the periods, the ends pushed the filters and then the freshness onto a third row, and the
panel moved down 44px when a span of days was chosen. On a phone the bar is two rows: the periods
across the whole first row, wrapping onto more lines of their track where one has no room for
them, in columns of one width, as every wrapped row of segments does (Segmented choice); then the
filter, a failure, the freshness and the refresh; with a filter set, the chips' row right under
them, before the reader's own days. Each wrapped line sharing its own room, the breaks
of two lines missed each other: at 390px Analytics' five periods stood three over two.
The reader's own days take a third row once chosen, which moves the panel down by it. The periods
scrolled sideways beside the freshness, opening with «Now» cut and «Custom» past the edge, and a row
held for the reader's own days under every other period stood as an empty band of 72px over the
panel; the period bar of Agent decisions and Volumes is the same bar. On the narrowest phone, a
bar under 19rem in a window under about 400px, Analytics' freshness stands in the periods'
row instead (`beside`): beside the filter, the freshness and the refresh, a failed refresh in
Russian had room only for three lines there and ran 2px past the row's end, and under 18rem, in
windows of 384 to 399px, a live period's took three lines and grew the bar by 11px. It stands in
the cell the periods' short last line leaves, past «Custom», the periods keeping the whole row
two over two over one; only where their count leaves no such cell does it take the row's end, the
periods wrapping in what it leaves. Standing at that end whatever their count, it left them 182 to
206px, one column of five lines. In that cell the freshness never reads as a period: it is words,
not a button; it takes no ground, edge or pressed state of its own, the track's ground under it
being the periods'; it is in the muted detail ink, never a segment's; it sits on the last line's
height, as far from the track's end as a period's words from its column's edge; and assistive
technology reads it as the freshness, outside the choice, which holds the periods alone. A refresh
that fails keeps what is shown and says so in words before the age at every width, «Could not
refresh» with a retry: given up on a short line, its words had left a red disc with no hint. A
refresh whose period before could not be read, where what is shown has it, fails so too: shown,
it took every change and the table's columns of the period before away, and the words that said
so came in over the figures. So does a refresh whose accounts or overview steps of the period
before could not be read, and a new view whose accounts or steps could not be read shows its
answer without their marks and says the same words here: said in a note under the chart, the
failure moved what stands under it, and room held for the note stood empty under every chart at
rest. The retry is reached at every width too: where the line has no room for «· Retry», the words themselves
are the retry, named «Could not refresh · Retry» with «Retry» as their hint, and take no room the
words did not. Dropped there, a phone and a span of days in Russian offered no retry of its own,
only the refresh beside it. Reading another space, period or filter dims what is shown until its
answer comes, after a moment so that a quick answer does not flicker;
a refresh of the same view dims nothing. Records reach the store in batches, so the age is in
seconds and the minutes after the newest record are hatched, as every figure not final yet is,
and say «no data yet» in their hint rather than being drawn as a drop.

The bar's filter is the shared facet filter (Shared component grammar), the one the Work views
filter through, and placed as the Work bar places it. Its field, «Add a filter», stands on the
bar's line after the period and takes the room the line leaves, as the Work filter takes what its
row leaves; the chips it set stand in a row of their own under the line, with «Clear filters» at
their end, as the Work bar ends the line under its row with the way out of its filter. Its facets
are the page's dimensions in the rail's order, the project left out inside a project, and a
dimension's values are its «none» as the read admits it — «No task» for work on no item, «The
session itself» for a session's own run, «Unknown» for a value nobody can place, and none for a
role, which every stretch has — then the values that spent anything in the period, each named as
the page names it; a value a link names that the period did not spend still stands, chosen,
under its id. A dimension's values are read when it is stepped into and again for a new period,
and a filter set has its dimension's read to name its chip; the page used to read all ten at
once to open its list. Several values of one dimension admit any of them, and the dimensions'
filters all apply. «Add to filter» in a value's panel adds to the same filter, and an old link
reads as it did. A chip says its dimension and its value, «Model: model-a»; every chip set is
shown, and more than one row holds wrap onto the next. The field is never narrower than its
words need, 176px, or on a short bar and on a phone its short «Filter», 62px with less air at
its ends: the line gives up its other parts only once the field has given up the room past
that, so the line's give-ups and its two rows come where they came before. The row of chips
comes with the first filter set and goes with the last, and it is the one thing the filters
change in the bar's height: a row of 28px and the bar's 8px gap, 36px at 1440 and at 1024px,
and on a phone, where a chip grows to a finger's reach, 52px for one row and 180px for five
chips over three rows with «Clear filters» under them. On a phone the row stands right under
the field's, and the room of the reader's own days, which every period keeps there, moves under
it: under that room, the chips stood 44px away from the field with no span of days chosen.
At 1440px the field is 487px wide beside a week and the Work field 673px beside its views. It
used to be as wide as its words, 176px, with the chips beside it on the line in the room left
and those without room counted in «Filters: N», whose list held every chip and «Clear filters»:
the field stood narrow beside an empty line, and a filter set stood behind a press.

An item's work has two times, and each has one name wherever it stands. «Work on the clock»
(«Работа по часам») is the time that passed while agents worked, which agents working side by
side share; «Agent time» («Время агентов») adds up each agent's own, the time Analytics counts.
A card's line says the first and, where agents worked side by side and the two differ, the
second beside it; the card's Agents tab names them alike, and a task's side panel in Analytics
says the second of all time. Under one name, «Work», a card's 7 h 38 min beside the 11 h 14 min
Analytics gave the same task read as two answers to one question.

Words are said once, where they belong. A value carries a short label, never a sentence. A
caveat common to a section is said once, in an «ⓘ» at the section's heading, never per block:
that the time of agents working at once adds up, two agents for an hour each making two hours,
so a period's agent time may be longer than the period; that a cost is an estimate at API prices
and not a bill, that a minute's figures share each
stretch of work out by its time in each minute, that the period reaches the quota's step lines
alone. A block does
not say again what the bar or its section says, and detail — an id, a source, how old a
reading is, how a figure was reached — is in the hints of the marks and values it belongs to.
Each block used to say its caveats whole: the quota opened on two sentences of what does not
apply to it, each of its windows said two lines more over its spend, and the words outweighed
the figures they qualified. So every section is headed by its name, the «ⓘ» ends that heading's
line, and on a narrow screen the way back over the section names nothing a second time.
`production-analytics-words.spec.ts` holds it in both languages: with data, no block shows a
sentence longer than 90 characters, and each caveat stands in its section's «ⓘ» alone.

The rail holds a tile for the overview, one for the token kinds, two for the subscription
quota — «Five hours» and «Week» — and one for each dimension of the read: account,
organization, project, task, executor, role, launch class, model, effort and environment.
«Account» is the subscription account the work was spent on (`seat`), «Organization» the
organization it was billed to; an old link's `account` filter still filters by organization.
«Executor» lists the sessions of agents that did the work; planning calls a session by the same
word, so the name stays and its section's «ⓘ» says first what it means, «An executor is the
agent session that did the work.», before the caveats every dimension's «ⓘ» says.
An account is said by the name the owner gave it, and one known by its UUID by the name its
weekly reset was given before; else by its organization's name, or the start of its id, with
what tells it apart: the start of its UUID, or when its week resets in the reader's time for
one known by that alone, «Lab · resets Thu 12:00». Where the reset of an account known by its
UUID is known too, it follows the start of the UUID, «1a2b3c4d · resets Thu 12:00», in the
filter's choices, the section, the quota and wherever else the account is named: the provider
names no account, and eight hex digits alone were no account its owner recognized.
An organization's work no reading places
on an account is «Lab · account not known», and an account two accounts' readings may run
under says «may be two accounts» after its name. A tile is a summary of its own — the leading value, its share, how many values
have a figure in the chosen measure and one bar of the split — so every breakdown is in view
before any is opened, and choosing a tile opens its section in the panel. Opening a section,
from its tile or a card's heading, is a step of the history, so Back returns to where it was,
and so is a split chosen in its heading, so Back returns the split before; a period chosen in
the bar or a measure replaces the step. The rail and
the panel stand side by side only while the panel keeps 640 pixels; narrower, a section takes
the rail's place and a way back stands over it. A plain address opens the overview.

The rail's entries, the ranked rows and the table rows share one model of states. Rest, hover,
the chosen entry and focus are one box: it is laid out in every state, its edge stands on the
column's line, and a state changes only its ground, its ink and the mark inside it, so no state
draws a box past the column. Every rail entry is a box at rest, not only the chosen one, and
the chosen entry's mark stands inside its box. Drawn for the chosen entry alone — a ground, a
3px line on its start edge and corners rounded on one side only — the box read as the
pointer's, and as an entry pushed out of its column. A row with several controls, as a day of
the day chart's table with the day and each value's figure, takes the row's grounds from the
model and puts the focus ring on the control, within its cell. One stylesheet owns the model,
`rowStates.css`, which each list and table reads as its own scoped style;
`production-analytics-row-states.spec.ts` holds the rail to it in both languages, and
`production-analytics-day-table-states.spec.ts` the day table.

The page's levels are the four of the spacing rule: a section of the panel, a group in it such
as an account of the quota, a block such as a chart or a window, and the block's lines, with
the headings the type scale gives each level (System rules); the quota's section and the
account in it both stood at 16px and the same weight. A heading's element follows how the levels
nest, not its size: under the module's name, the page's `h1`, a section's heading is an `h2` and
each heading one rank under the heading of the level around it. A section's heading and its
charts' and table's all stood at `h2`, and a screen reader's list of headings read them as peers.

The overview answers «how much, and is that more than before»: three cells — agent time,
tokens and the cost estimate at API prices — each with its change against the period
before and, beside its figure, its own measure as a small trend over the steps of the
period chart (`MiniTrend`, words as the rail's tile says them), and the chosen cell sets the
measure of everything else on the page. Under its change the tokens cell and the cost cell say
what an hour of agent time took of them beside the period before's, «$17.9/h, was 8.1»; a
period with no agent time has no such line
and a period before with none gives no «was», the line's place kept either way, and the chart
draws no second axis for it. Across the panel under the cells stands the period chart, stacked
by project, with the period before as a short line at its height; at a project's scope it is that
project's one series of plain columns, which no legend names. The period before's steps and the
accounts that mark its changes are read after the chart is drawn; when either could not be read the
chart draws no such mark and the bar says the read failed, so nothing under the chart moves and
nothing stands empty there. Stacked by task it named a few per
cent of the time, the rest «Other», and the tasks have their own section; and under the chart one row of cards: the four tasks that grew or fell the most, each its name over its
change, then the first five tasks, models and projects, each card opening its section. The
roles have no card: there are two, and their rail tile says both. A cell not chosen takes the
hovered ground under the pointer, and nothing moves. The overview may scroll: the chart's
drawing field, where its columns stand without the scale and the steps' names, is never lower
than 200 pixels, however many account changes it marks; where the panel lacks the room the
panel scrolls rather than the chart shrinking, and a tall window's room under the cards goes
to the chart.

A dimension's section answers «of what»: the same cells, then its values three ways. The
form follows how the values are named (`splitView.ts`). Named by identifiers — accounts,
organizations, projects, roles, models, efforts, environments, launch classes — they split one
whole, drawn as
a ring or as ranked bars and switched with the table as «Ring | Bars | Table», the same numbers
in each, opening on the ring: the ranked bars list the first twelve, and under them «All N»
opens every value of the period in the side panel. N counts the values as their tile and that
table's heading row do, the values with a figure in the measure, so work with no value there
is a row of the table and no part of N: counted with it, «All 31» stood beside the tile's
«30 values». The ring (`DonutChart`) names its first
parts and folds the smaller into one rest. Split by a second dimension it draws bars alone, since a ring of pairs would tell one
value's pairs apart by hue alone. Named by free text — tasks and sessions, by their own or on
either side of a pair — they are a list only, switched with the table as «Chart | Table»: the
ranked list of free text, with no ring and no small charts, across the whole width of the
charts. Their names run to a sentence, 90 characters at a week's median and 209 at its longest
for tasks, 36 and 67 for sessions, where an identifier is 17 at most: a ring's legend broke
them inside words, four lines an entry, and beside the small charts the list had 415 of 846
pixels. And tasks are as many as the work done, hundreds a week, which a ring of five named
parts folds into one rest no reader can take apart. Which dimensions are free text is one set
in code, `FREE_TEXT_DIMENSIONS`. The small charts
draw each leading value's days on one scale; the table lists every value with the figures
of the period and of the period before. An account that spent in the period, whose
organization's work no reading placed on an account («account not known») came to more in the
period before than the account's own figure there, has «not known before» as its change and no
percent, and with the page narrowed to accounts so has any figure of theirs beside the same work of
their organizations the filter leaves out — the overview's tiles and the rail's tile of the
overview, the table's lines and its total, the tokens by kind — none of them ever among what
changed most: which account that work ran under is not known, so a percent read the readings
starting to place the work as growth, a rise of thousands of percent on an account that had
worked all along. The rail's tile says it in words of its own, «Not known before», where the
table and the cards say «Account not known before»: beside the tile's total the whole phrase cut
«6 h» into an ellipsis by 9px at 1440px. The Russian table says «Ранее неизвестен», as short as
a figure, where the rail keeps «Раньше не определён». Work with no value in the dimension, or of a value
nobody can place — an unknown model — is ranked where its figure puts it, in the neutral colour;
a list of free text sets it apart after its values instead, with its bar on their scale. A value
keeps one colour on the whole page: in its tile, its bar, its small chart and its share of
a day. That colour is its place in the period's ranking without the page's filters, so a
filter that takes values away repaints none of those it leaves; another measure ranks again
and may. Ranked over what the filter left, every survivor moved up a hue. The day chart is a
part of the section of its own, under the ranked chart and the small charts and 24px under the
lower of them, as the table stands under it, whichever view either shows. The section runs in the panel's one scroll: the cells and the charts at their own height,
and the table under them, held to about the window's height so it and its heading line stand
in the window together, scrolling inside its frame with its heading row and total row at the
frame's edges, so what focus brings into view stands clear of them. A «To the table» link over
the charts brings the table into view with the focus on it. The table sorts by any column and downloads what it shows. A line under its heading row counts the
values of the period that have a figure in the measure, as their tile does, and says apart
those that spent in the period only in another measure — the adviser has tokens and no agent
time — and those that spent only before it. The line is a row of its own, kept while it has
nothing to say, so its words are whole whatever the measure adds to them and choosing a measure
moves nothing under it; where even that row is too narrow it breaks between its parts, never
inside one. A chart whose title names the measure keeps the room of its title under every
measure, so the switch beside it wraps alike whichever measure stands and choosing one moves
nothing under the chart either. Under the measure «tokens» each value's tokens by kind follow
its change: the name,
the three measures, the period before and the change stand in the table's width as it opens,
at 1024px and wider and under every measure, their headings taking a second line rather than
that width, and the kinds are reached by the table's own sideways scroll. A change cell that
says why it has no figure says it in a figure's width, in every language: «Ранее без цены»,
«Без токенов», «Оба без цены», «No price before»; the heading over it names the period it is
compared with, and the section's tiles say the whole sentence. In whole sentences, «Нет цены ни
в одном периоде» made the change's column 215px wide and stood the change 76px past the frame
at 1280px.

The second dimension is the section's, not the table's: «Split by» in the section's heading
chooses it, and the ranked bars, the small charts, the period columns and the table all read
its pairs, «claude-opus-5-5 · high», each pair a value with its own colour and the tail folded
into «other» as any series is. Chosen over the table alone, it left the charts beside a crossed
table answering the first dimension only. A refresh whose pairs could not be read again keeps
them in every one of those parts, in the section and in the side panel of all its values, and the
bar says «Could not refresh · Retry» as it says the page's own reads failed; the side panel, which
stands over the bar, says the same words beside its field, in room the field's row keeps for them
while the section is split, as a value's panel says its own beside its actions. Dropped, the pairs
left the charts and the table gave its place to one line of words; held beside the table's download
the words' room took a line of its own under the heading of a split section on a phone with nothing
failed; said only in the bar, they stood under the side panel, unseen. A pair's name short of
room on its line cuts its first part and keeps the separator and the second whole,
«claude-opus-5-… · medium», because the second is what tells one value's pairs apart: cut from its end, «claude-opus-5-5 · …» stood twice in one
chart. In the ranked bars a pair's name takes a line of its own over its bar at every width, as any
name does in a narrow chart: the second part is a whole value's name, as wide as a model's, and
the one-line name column, two-fifths of the row, held «claude-opus-5-5» with 13 pixels of the task
before it and cut the model as well. A pair acts as its first value does, and a bar, a small
chart or a legend entry that acts is named by that action, «Details of claude-opus-5-5», so
each is described by its whole pair before its figures: described by its figures alone, the high
and the medium row of one model sounded alike to a screen reader.

The token kinds are a section of the same shape, a kind for a value: the kinds the tokens
figure counts add up to it and are the sectors of its ring, or its ranked bars, opening on the
ring; cache reads close the chart under its legend or its bars, no part of any share, and
reasoning is part of output.

The quota's two sections read where each account's quota stands now, which no space or filter
changes,
and read it again on the live interval whatever the period. The period reaches each window's step
line alone: the read asks from the period's start (`from`), and the answer gives each window the
windows before it that the period overlaps (`earlier`), so a line over «4 weeks» holds four weeks;
the figures, the bars, the forecast and the tiles stay on the current window. That the filters do
not reach it, that the period reaches only the lines, that it is the whole account's whatever
space and project are chosen, and that its shares do not add up, the section's «ⓘ» says once. With the
period set to «4 weeks» the owner asked why the charts still showed one week: the lines stood on
no period, each its current window alone.
Each tile names the tightest window of its kind across accounts — of those whose reset is still
ahead, the one nearest its limit by its forecast: first one that runs out before its reset, the
earliest run-out first; then the one whose forecast ends highest at the reset; then the one most
spent, and a window with no forecast by its share after those with one; at the same share a fresh
one before a silent one. The share alone once chose, and named an account at 72% whose week
would end at 81% over one at 6% that ran out before its reset. The tile names it by its account's
name, with its share, beside the section's name when it runs out where it does — a week by its
day alone, «runs out ~Nov 24», since the rail is as wide as its entries need and the part of the
day widened it by a fifth, which the bar's words add — and its state in words where it does not,
and a thin `WindowBar` with
its forecast's tail, which the bar's words and hint name «Forecast ·», since a tile has no room
for a key. A tile with no window to name says why: no source read the work, the account in use
has no five-hour window, the windows reset since they were read, or no reading. A source sends a
five-hour window only for a plan that has one, so where no account's five hours stand and the
account of the newest reading, of any window, has week readings in its current week and no
five-hour reading since that week began, the five hours' tile names that account with «no
window» beside the section's name, its hint saying the current account has no five-hour window,
and the five hours' section says that over its accounts; «Reset since read» there read as a
failure of the read, and the whole sentence on the tile's line was cut by a third. Where that account's own
five hours reset inside its week, the tile says they reset and the window says it in its words. The panel has a group per account on a surface of its
own, named as the page names an account, a menu beside the name, the facts beside them where
there are any — its plan, and «May be two accounts: their readings run under one weekly
reset» where they may — and its
windows side by side where the width allows, 32px apart with a hairline in the rule's ink midway
between two neighbours: 16px apart with nothing between, the moment ending one window's axis and
the one starting the next stood a few pixels apart and read as one axis. Every window, the five hours, the week and a
model's week, has its name on one line with «Breakdown», a compact button at the row's end that
opens what used it in the side panel, the name cut short before the button wraps under it; then
the same two parts 12px apart: what stands now and the `StepLine` of its readings. Windows side
by side line their parts up row by row — the name's row, what stands now, the line's head, its
plot and the line of the window before — each row as tall as the tallest of the pair's, so their
plots start at one height whatever each holds, a past window open in a card's place too: laid
out each on its own, a window past its reset, led by two lines, started its plot 41px under its
running neighbour's.
The menu beside an account's name, named «Account actions: Work», holds three entries at most.
«Rename» puts a field in the name's place that saves through the same names and rules as
Settings, by the account's key, and on the group of an organization no source read by the
organization's: Enter or leaving it saves, Escape leaves the name as it was, either gives the
focus back to the menu's button, and a save that fails keeps the field with the reason under it.
«Add to filter» adds the account to the page's filter by account beside the accounts already
there, as the
value panel's button does, and the section stays where it is; once the filter holds it, the entry
is disabled and reads «Already in filter», and where no filter can take it the entry is absent.
«Copy ID» copies the account's whole id with the copy's usual note. No hint says that id.
An account with no name of its own has «Name» beside the menu, a button that opens the same
field, and no «Rename» in the menu; once it has a name the button is gone and «Rename» is in the
menu. One naming action stands for each state: found only inside the menu, the rename went unseen
while every account stood as the start of its id, and with both at once «Name» said again what the
menu said. The menu and «Name» are one unit on one centre line at every width: beside the name
while both fit there, and on the next line together where they do not, the name keeping its own;
as two items of the heading's row, a phone's wrapped «Name» alone, 40px under the menu at the
name's end. The field stands on the name's edge and line, as wide as its line leaves up to a
name's width, with the menu on its line; laid out at a name's width, a phone's field wrapped
under the unseen name 12px past the edge, the menu 40px above it.
What stands now leads with one line, the share as the window's figure and its state beside it,
«41% used · up to date», «13% used · reading 5 h ago», over its bar, its share solid and its forecast a
hatched tail; then, right under that tail, its forecast in the text's ink after «Forecast ·», the
name the step line's legend gives its dashed line, its words starting where the lines under it do and
nothing of it in the card's inset — the five hours a point, lasting to the reset with the share spent by
then, or running out at a time; a week a range, said as a range and never past 100 %, which a quota cannot pass: a low
end there says the week runs out before its reset and about when its slower pace spends it, a
high end there that it may, and ends said alike one value — and when it resets in absolute and
relative time, quieter, each line 4px from the next. A run-out is said one way wherever the
quota says it, in the window, its bar's and its line's words and the tile: five hours by the clock
time, «Limit runs out at 14:05», and a week by its day and the part of the day it falls in at the
page's offset — night to 06:00, morning to 12:00, day to 18:00, evening to midnight — «by the
evening of Nov 24», never to the minute: a week's forecast moves by hours from one reading to the
next, and its minute claimed what it could not know. The bar's tail, the tile's and the step
line's forecast are drawn from one mapping of the forecast (`forecastCourses`), so none of them
and none of their words disagree; a window past its reset by the page's clock forecasts nothing
more, so none of them is drawn and its words say when it reset where they said its forecast.
Such a window, with no reading since its reset, leads with that, «Reset at 21:20, no new
readings», the share it ended at a quieter line under it, «90% by the reset», as a past window
says it, with «the limit ran out before it» where a reading reached 100 % — never «before the
reset: 90%», which read as what is left until a reset still to come — over its
bar drawn in the neutral ink of marks at rest with no pace tick, which a forced palette draws in
its inactive ink: led by its share over a bar in the series' hue, the last window's figure read as
the share spent now. As a table its row says the same where the share stood, the reset's words
and under them the share it ended at, with a dash for its pace and its forecast, and its window
says no reset under the row. A reading after the reset starts a window that stands, which none
of this touches.
A window nothing reads now is no account gone quiet. A model's week and the usage credits come
from the quota poll alone — the client gives the status line and the mod neither — and the
answer says whether the poll is on and which kinds only it reads (`poll`). With the poll off and
no reading of the poll in the window's current span, the card says so in place of its share,
«Only the quota poll reads this window, and the poll is off», with the way to the switch,
«Quota settings», and draws no bar, no facts, no readings and no «Breakdown»; an imported
reading of an earlier window, drawn, read as «Reset at …, no new readings» of an account that
went silent. Such a window is never the rail's tightest and its card forecasts nothing; the
alerts, which take only a reading fresher than `fresh_for_seconds`, warn of nothing from its
history.
A window of money says the same on its line, and as a table the row says it where the share
stood, a dash for the rest. With the poll on, every window is read as before.
Its state is judged by the same clock: a reading older than the answer's `fresh_for_seconds`
reads silent, on the tile and in the panel, though the answer called it fresh.
Where steady use from the window's start would stand now is drawn — the bar's tick, the line's
diagonal — and said in their hints, the bar's naming its tick, «Pace tick · steady use since the
window started would be at 57% now», with how old the latest reading is and who read it, which its
words for a screen reader say too, with the forecast. As a table, where no hint shows, the account's table
holds each window's forecast, the readings' table ends with it, and the window says its latest
reading in words under its reset, and that it has no pace where it has none. A window's step
line covers the page's period, never less than the current window: every window of its kind and
account the period overlaps, each whole from its start to its reset, one after another, the count
falling to nothing at each reset, the earlier ones in the neutral ink and the current one at the
right end (Charts). How far back from now the period starts decides, not the period's own
length: where it starts no further back than the window lasts — «Now», «Today» and «This week»
for a week, «Now» for five hours — the line is that one window whole across the plot, as it always
was, and the line under the card names the window before; where it starts further back, the line
holds the period, so a custom day three weeks ago is reached. «This week» once drew two weeks
where the week reset mid-week, the one before muted in the left half, since the answer holds every
window that resets after the period's start, and the section's scale doubled with it. A period of the reader's own that ends before now changes
nothing of that: the line still ends at the current window, the one the figures over it say, and
only reaches further back. The two windows of one account always stand on one time axis, the
owner's decision, even where that leaves a card's plot empty until its readings come: an
account's weekly windows reset together. Over the period every line of an account ends at one
moment, the latest reset among its windows in the section, each window at its real time, and a
window with nothing read since its last reset stops there, the line empty from it to that end and
its axis's last word «no readings since …» at the end. At a period no longer than a window, a
card whose window reset with nothing read since, beside a live window of its account, shows the
account's current window: the live one's span and moments, now marked where the live one marks
it, its plot empty and saying what the card's lead says, «Reset at …, no new readings», and the
line under it naming its last window, which opens as before. A model's week the source no longer
reads once ended its line at its own last reset, a week before its neighbour's, the same reset
85 px apart at 1440 pixels. An account none of whose windows in the section has a reading since
its reset keeps its last window whole, muted, as before. Every line of a section runs over as long
a time as the longest of them, the same time to a pixel in every card, so the two windows of an
account side by side stand moment for moment as they stand row for row, and a line that holds less
is empty before its first window. Accounts whose resets differ stand apart by that
difference, as their windows always did: a scale from the earliest start to the latest reset
would align those too, but it would also have shrunk every line inside its plot at a period no
longer than a window. Its axis names the start of the first window it holds and the current
window's reset, under the moments they stand at; it marks now while the window runs, points at
«now» and at its forecast past its readings, and a frame dragged along it narrows that line alone,
«Whole span» taking it back. Its words for a screen reader end with the windows before it, «Before
it: Oct 10, 14:30 – Oct 17, 14:30, 27%; …», and its table holds their readings and a row for each
reset between them. An account no source read says so and draws no window; a silent window is as solid as a fresh one, says how old its
latest reading is and, in its bar's hint, since when it has not changed; a fresh 0 % draws an
empty track and says «0% used · up to date». A window of money past a limit is a line of its name and
its state, its age and its source in the line's hint as a window of a share keeps them in its
bar's and in words as a table, with no figure. No share is added to another, of two windows or
two accounts, and no dollar stands beside one.

In the heading row of each window that names its start stands «Breakdown», a button that opens
the side panel on that window of that account, titled «Five hours · Work»: the work Valkama
recorded on the account from the window's start to the answer's moment, held to the last five
minutes, as ranked bars — the first five items by the API price estimate, each with its share
of the account's estimate, and one line for the rest — or as a ring of every item that folds its
own rest, chosen with «Ring | Bars» beside the breakdowns, or as the bars' table, which the
panel's own «Chart | Table» under its title chooses and which hides «Ring | Bars»; it opens
drawn at every width, as a page's charts do. It opens by task and offers projects and models; the
choice of breakdown holds for that window when the panel turns to its table or opens again. By
project or model it opens on the ring, as every split named by identifiers does, and a person's
choice of drawing holds until the page is left; by task it is the list of free text alone, with
no switch, the rest and the work on no task apart after the five under their rule. Its heading
names the stretch it covers and what its lines add up to, said as a line's estimate is, «Window
breakdown: 05:00 – 13:20 · ≈ $151.90»: the lines added up and nothing said their sum. With no
lines it names no sum, and work its organization recorded with no account known, said apart, is
not in it. It keeps the room of the headings a newer answer can give it, with no sum and with a
sum of five figures before the point, so the breakdowns beside it and the lines under it stay
where they stand when one does: a newer answer once made it a line longer, and the lines moved
25px down under it. It keeps as well the room of its moments as a later day says them, each dated,
since past midnight its start is a moment of another day. That it is the API price estimate and not quota points, and that
work in claude.ai and the desktop app, which the window's share counts, is not in it, the
section's «ⓘ» says once for every window and the panel's own «ⓘ» beside its «Chart | Table»
says for this one, never as a line of the panel. It is read by account, the account's and its
organization's work on no known account, when its panel opens, never for a window nobody
opened, so another account's work
is never in it; work its organization recorded with no account known is a quiet line of its
own, never counted to the account. No work, only such work, a wait and a read that failed, with
its retry, each say so in the panel, and the quota's own figures stand meanwhile. A read again
that fails, a newer step of the window, keeps the lines and says «Could not refresh; data as of
13:20 may be out of date. Retry» under them, in room the block keeps for those words while any
answer stands, so nothing moves when it is said or when the next answer replaces it: said in room
of its own it took 36px under the lines and gave them back, and a panel scrolled to its end moved
by as much. It stands
apart from the window's bar and readings, on no axis of theirs: under the window it was a block
as tall as the window again, and every window of every account read what used it whether or not
anyone asked.

Under every window of a share stands one quiet line of how the window before it ended, as the
answer's `previous` says: «Previous window: until Nov 7, 14:30 — 9%», the moment it reset and its
last share, with «ran out» where it did; or «Previous window: no readings» where
the store keeps none, which is words and no control, as tall as a line with a window on one row and
its words level with that button's in a window beside it. Where the step line over it holds that window
already, as it does over a period longer than the window, no such line stands: it named a window
drawn right above it. The line is one row, never wrapped or cut,
at 1440 and 1024 pixels; a phone-wide window narrower than the line gives it a second row from
the same start, where on one row it stood past the window and scrolled the panel sideways. The
line with a window is a button that shows that window in the card,
read when asked (`GET /api/analytics/quota/window`) and never for a window nobody opened. While a
past window is open, nothing of the current window stands in the card — its share, its bar, its
facts, its forecast, its readings and «Breakdown» are hidden, not mixed with the past window's —
and the card says plainly which window it shows: «Past window: Oct 31, 14:30 – Nov 7, 14:30» as
its heading and the open view's accessible name, its share by the reset, with that the limit ran
out before it where it did, and the `StepLine` of its readings drawn as an ended window, on an
axis of its own from its start to its reset, or its readings' table. «Earlier», named by the
window it steps to, shows the window before the one shown while the store keeps one, and «No
readings earlier» once it does not; «Current window» returns. The focus goes to «Current window»
on opening, stays on «Earlier» while it steps back, and returns to the line on closing. A wait, a
read that failed with its retry, and a window aged out of the store since the line was read each
say so in the view, and the window shown before stays meanwhile. Once a window reset, the page
used to say nothing of how it had ended.

A value pressed on the page — a bar, a sector, a segment of a day, a legend entry, a name in a
table, a line of the overview's cards — opens its side panel on the right, the shared resizable
inspector of the drawer layer, and the page stays as it was: pressing a value used to narrow
the page to it, which lost the view it was pressed in for a look at one value. The panel is a
part of the view's address, so opening it is a step of the history, Back closes it, and a reload
opens it again with no focus ring; the overlay host gives it the focus, Escape closes it, the
page under it is held, and the focus returns to what opened it. On a narrow window it takes the
whole width. It names the value in full, and for a task «Open the card» opens the card over the
page as any reference to the task does. Its figures are the time, the tokens, the cost and the
value's share of the whole in the page's measure, under a heading that names their period as the
page names one, «Figures · Nov 9 – 11»; under them a task has its figures of all time, «All
time», its agent time and its cost, «Agent time 11 h 14 min» and «Cost ≈ $120.00», read and said
as its card's line reads and says them and by its names: a task's own work, a goal's or a
stage's whole tree under «All time, with its contents», as its card says «with its contents».
Where its card reads nothing, an attached store's
item, the panel reads nothing and has no such block. Without either, a week's
cost in the panel beside the card's larger one read as two answers to one question. What
qualifies them — that the cost is an
estimate at API prices, what the tokens count and, read by the minute, that a minute's figures
are shared out — the section's «ⓘ» says under the panel, so the «ⓘ» «About these figures» that
ends the figures' heading says it for the value's own read, once and in that «ⓘ» alone,
never as a line of the panel. Its days are the page's period and step with
the period before marked, one series in the value's colour, its steps read with the panel's
answers; when they could not be read the days draw no mark and the panel says so beside its actions,
as a read again that failed: said in a note under the days, it moved the lists under them 25px down;
under them dense ranked bars say the
models and the accounts it ran on, each in its colour on the page. Its reads are the page's with
the value's filter added, and wait and fail as the page's do: a read again that fails keeps what
the panel shows and says «Could not refresh · Retry» beside its actions, in room their row keeps
for it while nothing failed, so nothing under them moves when it is said or when the next answer
takes it away; said in room of its own on a phone, it took a line and moved the panel's figures
36px down. «Add to filter» adds the value to
its dimension's filter beside the values already there, as choosing it in the filter's menu
does, so A and B and then C is A, B and C: the page stays on its section and the panel closes, a
step of the history too. A value the filter holds already offers it disabled, «Already in
filter»; a filter the link cannot hold says why in the panel. A press with a modifier or the
middle button on a task still opens its card in a new tab, and a day, an hour or a minute still
narrows the page. «All N» opens the section's whole table in the panel, every value with the
period's figures and those of the period before, sorted as the table sorts and with a field that
finds a value by its name; a value pressed there opens its own panel in its place, a step of the
history. While the field finds some, the total under the rows is theirs, «Total of those found»,
and the period's own stands under it as a row of its own, «Total for the period»: the period's
total alone under one found row read as that row's. Both stay at the frame's bottom edge. A card opened from the panel stands over the page while the panel waits closed under
it, and the panel opens again when the card closes: two surfaces of one layer paint in the order
they were first drawn, and the panel stood over the card.

A cost is always an estimate at API prices and is written as one, with «≈», and the section's
«ⓘ» says once that it is not a bill; cached reads are counted apart from the tokens processed
anew and never summed into them. In a table, the tokens a cost leaves without a price stand in
the quieter ink under its amount, which keeps to the row's line, and wrap inside the width the
column's figures give them, between words and never inside a count: the row is taller and the
column as wide as its figures. Kept to one line of their own, they made the cost's column 192px
wide and stood the table 218px past its frame at 1280px.

### Agent decisions

Agent decisions is where a person reads what agents decided on their own: each decision a
participation point let an agent take without asking, and the work it took up by assignment.
It stands in the rail's Understand group beside Analytics and, like it, fills the window: a bar
over one table.

Its scope is the context bar's, as on every page that reads a space: a space, a project of it
or every space at the top, that of the store this service writes, where decisions are recorded.
The page has no choice of space or project of its own, so the scope
is chosen once and a page never disagrees with the bar over it.

Its own filters are the period and the point. The bar is the period strip Analytics stands on:
today, this week, the past four weeks or days of the reader's own, chosen in the bar with the
same fields and the same refusal of a last day before the first. Beside it «Participation
point» narrows the table to one point, «All points» until one is chosen, and the refresh reads
the view again as of now. The period, the point and the days are the page's address, so a
reload or a link reads the same view; a choice rewrites the address in place, so Back leaves
the page instead of stepping through its choices.

The table is the section table Analytics stands on: it takes the rest of the window under the
bar, wherever the bar's rows end, and scrolls inside its own frame under a heading row that
stays, while the bar stays above it and the module's frame has nothing to scroll; a window too
short for its least scrolls the page under the bar instead. Its columns are when, the point, the card — its reference over its
title — the session that decided and what was decided, newest first; each heading sorts by its
column, the moment newest first and words A to Z first. Over the table a line counts the view's
decisions. The page reads them page by page of 200, the first page drawn as soon as it lands
with «Read 200 of 1000…» over it, so a long period of a thousand decisions shows its newest at
once and ends as one table; past 5000 it shows the newest and says how many there are in all.
Where its columns do not fit the frame, at any width, a decision is a block of its own: when and
the point on its first line, the point breaking between its words beside the moment, the card
under them, then the session and what was decided, with the headings a line of sort buttons over
the blocks (Rows and tables).

Its states are the shared panel's. The first read waits in it and, failing, is its error with
«Retry»; a period with no decision says «The agents decided nothing on their own in this
period» and offers a longer period or another point, the bar above it being how it is left. A
choice of another view dims the last one until its first page lands, so the last view is never
shown as the current one; a refresh replaces the rows only once it has read them whole, and a
refresh that fails keeps them and says so over them.

A row's card is a link: a plain press opens the card over the page on its System events, as the
address names it, so Back closes it and gives the page back as it was left; a press with a
modifier or the middle button opens it in a new tab. A card opened from that card opens on its
own first section, and a card Back returns to opens where it was left.

In a card's System events, an event an agent's own decision recorded carries a mark under its
title, the agent's sign and «Agent's own decision · Goal closed»: the point's kind, in the words
of the page's point filter and its table, so a decision read on the card is found on the page by
the same name, and the history's search finds the event by them. An event no decision marked
carries nothing, and the mark is the record's own: the event's point as the full record has it.

### Volumes

Volumes is where a person reads how much work stands in each state of a scope, what each goal
took and has left, the work outside goals, how work flowed in a period and the done work
estimates are judged by. Analytics stays the place of spend and quota: Volumes says what a goal
spent only as the sum its rows carry. It stands in the rail's Understand group beside Analytics
and Agent decisions and, like them, fills the window: a bar over a panel of sections that
scrolls under it, the bar staying where it is.

Its scope is the context bar's, as on Agent decisions: a space, a project of it or every space
at the top, chosen once. Every space at the top is every space the bar's picker offers, those of
attached stores too: the eight categories and «Waiting for me» count them all, as the
portfolio's cards count each of them. What only this service writes — what work spent, the
owner's decisions and the commits — is counted in its own store alone, so the goals, the work
outside goals, the flow, the estimates and «Commits on no card» are that store's, as Analytics
and Agent decisions read it. While a store attached beside it holds work, which the numbers count
and those sections do not, one line over the goals says so, nearer the goals than the numbers:
«Goals, work outside goals, the flow and the estimates count the main store's spaces only.»; with
no such store nothing is said. A store the numbers could not read is said over them as the
questions window says one it skipped, from the same list of sources and in the same words:
«Results are incomplete. Some sources are unavailable.» and, for each space not read, its name
and why («BETA: Store could not be opened»). A read with no work that left a source out shows its
zeros under those words rather than «There is no work in this scope». Its own filters are the period — the period strip Analytics
stands on, today, this week, the past four weeks or days of the reader's own — and the kind and the label
of a task, «All kinds» and «All labels» until one is chosen. The label's choice offers the
labels the page's read itself names, and the one chosen: there is no read of labels of its own,
and a label the read does not name would narrow nothing. Under the kind and label filter only
matching tasks add up, in the numbers and in each goal's row, and a goal's count at acceptance
stands as «—» with its reason, since it was taken of the whole goal. The period, the kind, the
label and the days are the page's address; a choice rewrites it in place.

On top stand ten numbers: one for each of the eight categories, in the model's order, then
«Waiting for me» and «Commits on no card». A number is its figure over its name, so the figures
of a row stand at one height whatever lines the names take. Under an open category's name stands the
age of its oldest card, under «Waiting for me» that of the question asked first; Done and Cancelled
count what came to a close in the period and say «in the period». A category's number counts
its tasks, goals and stages, as the board's filter by category shows them, and its hint says
how many of each; under a filter it counts the matching tasks alone. The numbers stand in one
row while the page has room for every name, and in as many rows as the names need where it has
not, as on a phone, a row sharing its width among its numbers. A number is never narrower than
the longest word of its name, which is never broken, and the numbers never scroll sideways: in
a frame of their own they did on a phone, and opening the commits' list under them scrolled the
frame to the pressed number, moving every other one. Opening that list moves nothing over it.

A number opens the place that shows exactly what it counts. An open category's opens the board
of the same scope narrowed to the category, with the page's kind and label; a label alone names
the three kinds of a task there, so no goal carrying it comes in. Done and Cancelled count what
came to a close in the period, so they open the Work list of the same scope, ungrouped, with
the category, the page's kind and label, and the filter's condition «Closed in a period» for the
page's period, which keeps exactly the cards they count and names the period on its chip. At the
top they stay figures, as every category does there. «Waiting for me» counts
questions, two questions on one card being two, so it opens the questions window, in a space
and at the top alike, rather than the board, where two questions on one card would be one row.
The window lists exactly the questions the number counts, read narrowed so by the server.
Opened from a space, those on the cards the space's board holds, its own and other spaces'
cards that name one of its projects; opened from a project, those of them on the cards that
name the project. Under the page's kind and label the window takes them too and keeps the
questions on the matching tasks alone, by the one rule the number counts by, so a question on
a goal or a stage is never among them; at the top, where it otherwise lists every space's,
the kind and label narrow every space's questions the same way, an attached store's as the
number counts them. Its subtitle says the scope
and the filter («…, only on tasks of kind Bug with the label ui»), and a chip over the list
names the space, the project after it by the name the context bar gives it, and then the kind
and the label («Main · Alpha app · Bug · ui»; at the top «Bug · ui»). A project the bar does
not offer in the space is named by its id, as the bar names it. Removing the chip lists every
space's questions again, with no filter. At the top with no kind or label it lists every
space's, with no chip. The rail's count stays every space's while the list is narrowed, and the
narrowing ends when the window closes, so the rail opens it on every space's.
A number that opens nothing is a figure, not a control, and its hint says why: every space has
no board of its own, the portfolio standing there, so at the top no category opens. «Commits
on no card» is «—» where their list cannot be read for the scope.

«Commits on no card» shows their list under the numbers and hides it again, the number saying
which. A row is a commit, the newest first: its hash as its short form at the row's start, its
subject, the repository, the session as its short form with the whole one in the hint, and when
it was committed. «Attach to a card» stands under the subject, and the repository's name wraps
between its words. Where its columns do not fit the frame, a commit is a block of its own (Rows
and tables): the hash and the subject on its first line, the action under the subject, then the
repository, and the session and the time on the last; as columns scrolling sideways, a phone's
frame cut the repository's name inside a word and kept the time three frames' width away. It
opens a line under the row where the card is found by its number or the words of
its title: the scope's space's cards, closed ones too, since a commit belongs to the card it was
made for, and every space's at the top. «Attach» is the person's attach, the module's own
action: the commit leaves the list, the attach is said aloud, and the page reads its numbers
again, so the number drops by the commit. An attach the server refuses keeps the row and its
line, the server's reason under the field. Past the most one read answers, the list shows the
newest and says how many there are; a list that could not be read says so with a retry, and the
number says «—» until it is read.

The goals are a tree in the section table: each goal, its stages under it to any depth, on the
tree's rows, folded as every tree folds them. One Tab stop holds the table: ↑ and ↓ move through
the rows, → opens a folded row, ← folds an open one or goes to its parent, and Enter or a press
opens the card. A row says where the goal stands, «closed N of M», how many tasks stood under it
at acceptance (or at the start of work, which its hint says), what its work spent without the
cancelled and with them — agent time and the tokens processed anew, the server's sums of
everything under it — and what its open tasks have left by their estimates, rounded and marked
«≈», with the done tasks the estimate is judged by under it. A heading sorts the rows that share
a parent by its column. A row past the fifth level stands at the fifth indent and names its
parent. A row's name is its reference over its title, and what the row says of itself, the
parent it names among it, stands under the title on the title's edge; the words keep a width of
their own whatever the indent takes while the table has room for them, so a deep goal's title
reads on lines as long as a shallow one's. Beside the reference, a goal six levels down kept some
54px of a 276px column and broke into six lines, and its parent stood at the cell's start, 182px
left of its title. Where the table is too narrow for its headings on one line, a spend stands on
two, its time over its tokens, and the column of names takes the room that gives; where even that
leaves a column past the frame, the words come down to their longest word and the figures' words
to theirs, so at 1280 every column stands in the frame (Rows and tables). The table's frame is held to the panel's
height, which the page's layout gives it, so a long tree scrolls in its frame under a heading row
that stays, whatever rows the bar takes.

Under the goals, the work outside goals: the scope's tasks under no goal, by project and by
label, each row saying how many stand in each category, the count of them beside the heading.
Where its columns do not fit the frame even at their least, a row is a block of its own (Rows and
tables): its name across it, then its figures above zero in columns alike in every block, each
beside its category's name. A block's zeros are not drawn, and are still read with their
categories, as the columns of the wide table keep and show theirs: drawn, a block was eight lines
of mostly zeros, and the section ran the page six times longer on a phone. A row stands for tasks
it counts, so a block draws one figure at least; a row with none would draw all its zeros rather
than stand as a name alone.
Then the flow: how many tasks came in and came to a close in the period, the owner's decisions
and the commits, for the period and day by day, newest first, with the pace of the scope's tasks
over them in the words of a chain's. Then the estimates: the done tasks they are judged by,
whether there are enough, and the table by project and kind, each label's row under its own.

A figure the read has no data for is «—» with a hint saying why, never 0: a goal's count at
acceptance the read does not give — under a filter, with part of its work outside the scope, not
yet accepted, accepted empty and not started, or accepted before counts at acceptance were kept;
spending of tasks begun before usage was first counted to a card; an estimate of open tasks none
of which has one. Work counted that spent nothing says «nothing spent». Its states are the
shared panel's: the first read waits in it and, failing, is its error with «Retry»; a scope with
no work says «There is no work in this scope»; a scope without goals says so in the goals'
place, its work outside goals counted below. A choice of another view dims the last one until
its answer lands; a refresh that fails keeps what is shown and says «Could not refresh».

### Settings

Settings uses one section anatomy and one type scale, and its groups read as
label left, control right. Module rows state what a module is and whether it is
on; interface versions are wire facts and do not appear as interface copy.
Installation health reports observed checks with their fixes. A switch is shown
only when the Kernel actually owns that setting. Opening sessions and files states
the rule first — a session opens where it was last open — then, per client family,
where it falls back and an explicit "always open in" that says beside the family
when it replaces the rule. Places a family's sessions cannot open in, and places
not installed here, are omitted rather than displayed as unusable choices; one
already chosen stays shown, with what it comes to beside it. Windows notifications
holds the switch, the events, how much a notification's text reveals, a readiness row
that says what Windows will do with one and how to change it, and a trial that sends
a real notification; turning the switch off keeps the events chosen. Task type colors
holds a row per colour: its glyph and word in the colour they have now, the platform's
colour field, the value in words and a reset, with one reset for all under them. A
colour under 3:1 on the hover card is said beside its field in a quiet line and stays
chosen. A goal and a stage share one row, «Цель и этап» («Goal and stage»), as they share
one sign and one colour; a colour stored for a kind this build does not have is not read,
so that row starts from the default. A plain task has no glyph anywhere, so its row is its word. Accounts holds a
row per organization the past year's work or the quota saw, the most agent time first, with
its whole id and its share of that time, its work on no known account counted in, and under
it, set in, a row per account of it, the most time first: its UUID, or when its week resets
for one known by that alone, with «May be two accounts under one weekly reset» where it may
be, and an account the quota read and the year's work did not show says so. Each row has a
name field whose placeholder says what Analytics shows without one, and a clear; an
organization or an account named before that neither saw keeps its row, so its name can still
be taken away. A name is saved when its field is left or
Enter is pressed, and the group's status line, where its reads say they are under way or
failed, says the save under way, a save that failed with a retry beside it, a saved name
and a cleared one; a field keeps what was typed until its save holds. Analytics says an
account by that name, with no hint of its id, and a session by the title its client gave it,
with the id in the hint.

Participation, the tab between General and Diagnostics, says at which points an agent's
decision waits for the owner. A scope choice heads it: «Общие значения» («Shared values») and
«Пространство MAIN» («Space MAIN»), the space chosen in the context bar, which it starts on;
with all spaces chosen there it has the shared segment alone and a line under it saying a
space is chosen at the top, not by a second choice of space on the page. Under it stand the
set, then the groups «Кто решает» («Who decides»), a row per point with «Агент | Человек»
(«Agent | Person»), «Очередь и сроки» («Queue and periods»), the queue and triage switches and
four number fields, «Метки» («Labels») and, in a space, «Место запуска» («Launch place»). A row's
hint says what happens at the value in force, and changes with it. The set is four segments;
when the rows match none, none is chosen and the hint says «Свой набор: отличается в N
строках» («Custom set: differs in N rows»): there is no «Custom» segment, since it could not be
chosen. In a space a row inherits the shared value until its «Своё значение» («Own value»)
switch is on: inheriting, it says the shared value in words and draws no choice; owning, its
choice starts from the shared value and its name carries a quiet «своё» («own»); switching it
off inherits again, and no separate reset exists. A set chosen in a space gives every row a value
of the space's own. Labels lists only those with a rule or a description — whether their
findings are ready at once, and a description field — and «Добавить правило метке» («Add a rule
to a label») finds one among the labels the space's work carries or takes it typed whole. A
rule's two fields inherit one by one: changing one in a space leaves the other as the space's own
record has it, so a field the space never set keeps following the shared rule. In the shared
scope a rule has «Убрать правило» («Remove rule»); its row leaves with the server's answer, the
focus going to «Добавить правило метке», and a refused removal keeps the row with the reason
under it. A space gives its rule back by switching «Своё значение» off. Every
change is written at once and nothing is disabled while it is out; a number is written when its
field is left or Enter is pressed. A newer change replaces only the waiting change of its own
row, so changing a second row never drops the first. A save that does not hold puts back the
value the server last confirmed and says why under its row, focus staying on the control. The
launch place, «Из пространства | Из проекта карточки» («From the space | From the card's
project»), is a field of the space's own record: it writes, takes back and refreshes on its own,
and a refused participation write never touches it. A first read that fails says «Не удалось
прочитать настройки участия» with a retry.

## Accessibility

The target is WCAG 2.1 AA: full keyboard reach, a visible focus ring, semantic
headings and controls, a text equivalent for every chart, honored
reduced-motion, and correct behavior when text is scaled. Color is always
doubled by text or shape and is never the only carrier of a state.

The focus ring is drawn on `:focus-visible` alone: where the keyboard put focus,
and where the interface moved it in answer to something — how a question ended,
the next question, why a send failed — when a key, and not a press, was the last input
before the move (`moveFocus`), so a keyboard user still sees where focus went. After a
press of a mouse, pen or finger the interface moves focus just the same, for a screen
reader and the next Tab, and draws no ring: the last press or key decides, and a pointer
passing over the page does not. A landing at the end of a round trip yields to the person: if
they moved focus themselves after the action began, into a field to type or to another control,
focus stays where they put it. A press of the pointer rings nothing it lands on, including
an element only the interface focuses. The interface takes focus to a whole and not to a line
of words that only says something about it: how a question ended, its passed deadline and its
title in the list of everything waiting describe or name the question, which takes the focus
and the ring. Words that stay where focus lands, because taking it to their whole would send
the next Tab to the start of a long form — why a write or a read did not go through, a reply
just written, a list's heading — carry `.focus-landing` from `base.css`: the ring stands 4px
clear of the words and turns at a control's corner, so one line never closes into a capsule.
Wherever the interface puts focus (`placeFocus`; lint refuses a bare `focus()` in the app), a
frame that scrolls sideways moves only as far as it must to show what takes focus and its ring,
by the nearest edge, and not at all when that is in sight; up and down it is shown as the
browser shows it. Opening the board's folded column at 390px once slid the board 441px to
centre the button that folds it again, and the tiles' links went off the screen; held where
it stood instead, the board left that column, the button and its ring past its end. So the
board brings a column it opens or folds in whole by its nearest edge before focus lands on
what undoes it, and a walk with the arrows takes a frame across as far as the place walked to
needs. A text field shows focus by turning its own
edge the focus colour, for a press as for Tab, and that colour holds 3:1 on every
ground and fill it stands against.

A forced palette clears every background, so a mark drawn as a fill — a status disc,
a switch's knob, a grip — names a system colour itself and stands out of the palette's
reach with `forced-color-adjust: none`: `CanvasText` for a mark that says a state,
`Highlight` for what is chosen. The palette has no colour for danger; a failure keeps
its disc and its edge in the palette's ink, and its words say the rest. What is told apart
by its ground alone — a tile, a column, a sheet, a chip or a toggle at rest — loses its
bounds with that ground, so it draws its edge in the palette's ink instead. A surface draws a
1px `CanvasText` border, because what is laid out inside it cannot cover a border: the
workspace panel's edge drawn as an outline inside it was lost under the board's own opaque
ground. A control draws a `ButtonText` outline inside itself, where it takes no room. The
keyboard's ring stands apart from such an edge, never on it, where in the same ink it only
thickened the line: a control's ring 2px outside it, and a tile's, which its column would
clip outside, 2px inside its edge in `Highlight`.

Russian and English are equal layout cases, not a base language and a
translation: a rule that only holds while the shorter string is on screen does
not hold.

## Recurrence prevention

Automated UI-system checks must discover new Vue files, not rely on a fixed file
list. They reject raw selects, local SVG ownership, ad-hoc dialog/listbox
semantics, obsolete palette aliases, gradients, direct overlay hosts outside
their narrow primitive owners, self-justifying negative disclaimers, and vague
product-quality claims. Component tests prove behavior; targeted
Playwright checks verify one representative production slice and important
breakpoints. Screenshots are evidence, not the acceptance oracle by themselves.

Only `shared/lib/treeRows.ts` writes the `treegrid` role, `aria-level`,
`aria-setsize` and `aria-posinset`. `check:ui-system` rejects those names in
any other file, whether in markup, in script or as DOM properties. A component
binds them whole from that file, and the inline-style guard reads that binding
as carrying no style. With a second writer, two parts of the screen could
disagree about where a row stands.

Three machines enforce this document and they do not overlap. stylelint owns
what a single declaration may say — the values a property is allowed to carry.
`check:ui-system` owns everything a per-declaration linter cannot see:
composition, which file may author which primitive, which tier a token belongs
to, the drawn-line ledger, and invariants that span files. `check:tokens` owns
equality between the palette and its mirrors, and owns it by writing them
rather than by comparing them.

When a rule is expressible as a value list it belongs to stylelint, so that a
violation has one owner and one message; the four-stop weight scale stays with
the guard because it is a numeric range with an `@font-face` exception that no
value list can state. `tests/styleRules.test.mjs` asks the real linter with the
real config, because a configured rule that never runs reports the invariant as
held. What the tests keep is what none of the three can decide: whether two
zones are far enough apart to be two zones, whether a card still reads on its
lane and a lane on the panel, whether text and the meaning colours read on
every ground they stand on, whether a hue still means one thing, and whether
the drawing in three renderers is still one drawing.
