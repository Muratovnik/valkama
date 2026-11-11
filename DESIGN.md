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
  kind-epic: "#cfa0ff"
  kind-improvement: "#7defdc"
  kind-task: "#b4c6e0"
  series-1: "#3987e5"
  series-2: "#d95926"
  series-3: "#199e70"
  series-4: "#9085e9"
  series-5: "#c98500"
  series-6: "#d55181"
  series-other: "#b3b3b3"

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
  gaps are 12px, panel spacing is 16px, and section rhythm is 36px. A module
  keeps `--size-page-gutter` from the panel edge. Density comes from alignment
  and disclosure; taking it from the gaps instead is what made the shell read as
  crowded — rows whose parts touch are read as one blur rather than scanned.
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
  | recess | `--color-surface-recess` | `#181818` | 1.41 under a card | an epic well, a strip cut into a card |

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
  a ground is the one move that goes the other way: an epic bundle is a well one
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
  | `warning` (amber) | a decision waiting, or high priority | review, a stale claim, high |
  | `danger` (red) | stopped, or urgent | blocked, urgent |
  | `neutral` | nothing to act on | backlog, the queue, low and medium priority, workable |

  Hue says how much it asks of the reader and shape says which fact it is, so a
  state and a priority that share a hue never share a shape. A kind is not on
  this table: it says what an item is, so it has a colour of its own below and
  no tone. A colour that appears on every card is a colour nobody reads: in
  progress used to be the green of done, the queue the blue of focus, and
  workable — the ordinary condition of open backlog — a green line on every
  second card, which made it the loudest colour on the board and the one that
  meant least. Each hue holds 4.5:1 as text on a hovered card and 3:1 as a mark
  on a pressed control (WCAG 1.4.3 and 1.4.11); `designTokens.test.ts` holds
  both, and `uiSystem.test.ts` holds the meanings.
- Color is never the only state signal. Every status has a stable text label
  and uses the shared semantic-state component.
- A kind's colour names the kind and never argues with a state. It draws the kind's
  glyph and word and nothing else: a card, a column, a frame and the zoomed-out
  graph node stay the state's to speak on. Its hues keep out of the state's way: an
  epic is the epic loot's purple lifted until it reads (`#a335ee` stands at 1.93:1 on
  the hover card), a bug is rose because the coral beside it is blocked, an improvement
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
- Spacing follows the four-pixel grid. Label/value gaps remain 8px and
  heading/content gaps 12px; section rhythm is 36px. Density is achieved with
  alignment and disclosure, not tiny type or cramped targets.
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
  had stood the new-task labels field 52px tall beside a 40px epic. A field's
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
  then the kind and the priority, then the labels and the parent, and the description
  last: its rows come from `FACET_ORDER` (`COMPOSER_ROWS`), the order every surface
  reads an item's facets in, and the description follows the facts as it does on the
  card. It used to ask for the description between the two pairs.
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
  second larger figure only adds a third size to a row of four numbers.
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
  the first 300 ms, and once shown at least 400 ms, whatever arrives meanwhile.
  `web/src/shared/ui/loadingPresence.ts` holds both numbers and the rule;
  `PlatformStatePanel` and the downloaded views follow it, and a screen whose own branch
  takes the panel away keeps the branch while the rule says the wait is held. While it
  is not shown, the panel keeps its box and its busy mark and paints nothing, so the
  place does not collapse and grow back. A switch of space on a two-megabyte board reads
  in about 170–200 ms, which is why the delay is not shorter.
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
  checklist's heading, three edges in one column. `production-card-list-edges.spec.ts`
  measures them.
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
  made an epic group inset 8px at the sides and 16px underneath.
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
same way, not a record that could not be loaded. The context bar keeps the
selected Planning space or operating scope and global activity controls in
fixed, predictable positions.

The rail's width is the reader's. Its right edge is a window splitter, the same edge a
drawer is resized by: dragged, or stepped 16px by the arrow keys, Home and End taking it to
its narrowest and widest. It starts at 260px, goes no narrower than 200px and no wider than
480px or than leaves the workspace 500px, and keeps the width chosen across a reload. A
name the rail still cuts short says itself in a hint beside the rail; a name it does not
cut shows none. At 760px and narrower the rail is its icons alone and has no edge to drag.

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
sessions. An epic, or any item the list holds only as the parent of others, is no row of
its own: its title is said on its items' rows. An epic at work is a row like any other.
This replaced a tree of epics with their items under them, quiet and pinned items mixed in
by number, which read as a heap, and then a single fold whose one word for held and silent
work said nothing of what each row was doing.

A row on view has two lines. The first is the sign, the number, the title and the agents'
count; it is a row of one line whatever follows it, so the sign, the number, the title and
the controls at its end stand where they stand on a row of one line. The second, smaller and
muted, starts under the title and says the state in a word, «работает», «спрашивает» or
«ждёт», then how long, «N мин» under an hour and «N ч» from one and nothing under a minute,
then after « · » the epic's title for an item or the folder for a session that has a title
of its own. How long counts from the session's `since` and moves on once a minute, from one
clock for the whole list; it changes words only and never the order. A row in a fold and a
pinned row keep to one line: the sign, the number, the epic's title, muted, before the
item's own, which gives way first, down to three letters and never more than two fifths of
the row, and a closed item's state at the row's end, never more than half of it, cut with an
ellipsis. The row's hint and its accessible name say the whole row in a sentence: what it
is, its epic or folder, the state with what it means (asking: the session stopped in the
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
  whole row is the disclosure target when it opens a detail surface.
- **Status:** one semantic-state primitive owns label, dot/badge geometry, and
  palette across work items, executions, references, and Settings.
- **Choice controls:** one accessible custom control owns search, icons,
  keyboard behavior, and collision-aware portal positioning. Native selects or
  local popovers must not reappear in feature code.
- **Dialogs and drawers:** one overlay host owns focus, Escape, stacking, body
  lock, and restoration. A command dialog layers above an open drawer instead
  of unmounting it. In a window 620px wide or narrower a dialog takes the whole
  width as the drawer does, without corners, its head, body and foot sharing a
  16px inset in place of the floating dialog's 24px.
- **Inspectors:** persistent right-side detail uses the shared resizable
  inspector. Width is bounded by the actual workspace, not the viewport. The
  panel lives while any item is open and only its content changes with the item:
  a link and Back stay in the same panel, so the slide belongs to the first open
  and to the close, and focus moves to the new content's first control as it
  does on an open. A panel opened by no input, from an address or a reload, holds
  focus on what it is read with until a Tab, so that no control stands ringed for
  something nobody pressed and the keys that scroll work at once.
- **Hints:** a hint is `vTooltip` and its one host, `TooltipHost`, never the
  `title` attribute, which the browser draws late, in its own font and colours, and
  never for text cut short. It shows after a short rest of the pointer and at once on
  focus a key brought, never for a finger, and goes with Escape, a press, the pointer
  leaving or a scroll. It stands above its element unless the place asks for a side —
  the rail's hints stand to its right, clear of the rows — and flips where the window
  has no room. Every hint states its kind, and the kind says when it shows: `name` is
  the words of an element that shows only a glyph, shown whenever it is pointed at;
  `clipped` is the whole of words its element shows cut, shown only while they are cut;
  `detail` says what the element does not show, and stands in `check:ui-system`'s
  register with the reason the place needs it. No hint says again the words its element
  shows: a board tile, a label chip and the usage line have none, since everything they
  would say is on screen. A hint may carry a note, a second line in the quiet ink, for a
  state that qualifies the action: a session button hints what a press does — «Open in
  VS Code» — over the session's state, and never the holder's name it shows. A detail on
  an element whose own words can be cut (a one-line name, a path, a value) is given those
  words too: while they are cut the hint says them whole on a first line, over the
  detail, since a cut word is not on screen; while they are whole it is the detail alone,
  and with no detail to add it is the `clipped` hint of its words. For
  assistive technology a hint is what `title` was: the name of an element nothing else
  names, else its description when it says more than the name. A reference's preview
  card wins over it. A hint is words; anything with a control in it is `InfoTip`.
  `check:ui-system` refuses a `title` an element or a component's root would get, a hint
  that states no kind and a `detail` its register does not hold.
- **Charts:** two primitives answer "how much, and of what". `RankedBars` breaks one
  measure down by one dimension, largest first: a name, the value as it reads and a bar as
  long as its share of the longest. `PeriodColumns` stands a column per day or hour, stacked
  by a few series. Each has a table twin (`RankedBarsTable`, `PeriodColumnsTable`) that holds
  every number its chart draws and opens what the chart opens; a page shows it beside the
  chart or instead of it, and a twin wider than its column scrolls in its own frame
  (`ChartTable`, `keyScroll`) rather than widening the page. They are boxes of HTML on the tokens, not a chart library, which the
  product removed for its weight. A value axis starts at zero and names a few round steps; a
  time axis names what it has room for, counted back from the last period. A series takes
  its hue from `seriesSlots()`, which pins a slot to the name — the whole domain in code-point
  order, never by rank, so a filter repaints nothing — out of six `--color-series-*` hues
  ordered so that neighbours in a stack stay apart under protanopia and deuteranopia. A
  seventh series folds into `--color-series-other`, the neutral that also draws the rows that
  are not categories — the folded tail, «no task», «unknown» — which close a ranked chart in
  a list of their own, unranked, their names in the quiet ink. A hue never speaks alone: a
  chart of two series or more carries a legend, and the readout over the plot and every
  accessible name say each series by name. A period still running is hatched (a mask, which
  adds no colour) and says «so far» under its name, so it does not read as a drop; a change
  at a period's start, such as the account the work ran under, is a numbered line up the
  plot with its words under the chart. The periods are one Tab stop and the arrows walk
  them; nothing in a chart moves on its own. A period that acts when pressed is never
  narrower than an inline action (`--size-control-inline`, 28px): a span that takes more room
  than the chart scrolls sideways inside the plot and never moves the page, opens on its
  last periods, keeps the value axis in view over the plot's start, and brings a period the
  keyboard reaches clear of that axis with its focus ring whole. Periods that only show
  keep sharing the chart's width, however narrow that makes them.
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
  the trigger the same way, and the trigger's value box says it. A menu's entry is not such a label: it wraps,
  and every word of it stays on screen.
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
  same control built again, and `check:ui-system` rejects one.
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
- **Disclosure:** what shows more of something — the rest of a long text,
  earlier replies, a chain's or a lane's further rows, a folded thread — is the
  bare `text` weight, its words in line with what it opens. The ghost's fill is
  for actions; a disclosure in the same fill stood level with the actions beside
  it.
- **Fields:** `VField` owns the frame around a labelled control — label,
  control, optional hint — and `VTextInput` owns the control itself for one
  line or several. A button beside a field lines up with its control, so that
  field's hint stands under the row and is named by `describedby`; inside the
  frame it put the button level with the hint, under what the button acts on. A
  date keeps the platform picker inside that field, because
  the native control is already localized and keyboard-complete. A label passes
  the pointer to its control, so its box reaches down to the control and the
  pointer crossing from one to the other never leaves them: across a gap the
  control's hover went out and came back. Six screens
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
  on its last line; padding that takes no room in the line gives its words a pointer
  target as tall as their line, 24px in reading text, without reaching the words above. One
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
  for a work item's number in free text, half a second after the pointer rests on
  it or at once on Tab: number and state on a line, the title, the holder and the
  steps. Its number copies itself and the icon beside it copies the item's address, as in a
  card's head and with the head's note; Tab goes from the reference through those two and on
  from the reference. Its text can be selected: focus goes back to where it stood when the
  press ends with nothing selected and otherwise at the next Tab, and a selection holds the
  card up until a press elsewhere, Escape or a scroll. The pointer on the card keeps it
  whatever reference lies under it. A press on the reference still
  opens the item, and Escape closes the card and nothing under it. A card from the
  pointer closes when what holds the reference scrolls. A card from Tab stays,
  because the browser's own scroll to the focused number would close it, and is
  hidden only while the number is out of the window. Focus handed back by a closing
  surface does not bring it up. A number the open space holds is drawn from memory
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
It pairs a collapsible epic index with a horizontally scrollable board.
The bar above the views is two rows and no more: the view and its menu, then the
filter, then the one primary action, every control of the row at one compact
height, and under them what is drawn and how much of it. The view's menu, «View»
by the view because it arranges what is drawn, holds how the view is arranged and
the views kept: the grouping is a choice in it, offered only where the view has one
(the board's «No grouping» or «By parent»); «Save view…» keeps the address's state —
the view, its grouping and the filter — under a name, per space, in the interface's
own settings, and a kept view is a choice the menu marks while the address holds it
exactly; choosing it puts its state back, and the marked one can be deleted. A
space never lists another space's views. Nothing in the row is a pressed filter of
its own any more: everything to the right of the field narrows it, and the two
conditions that once stood beside it as presets, «Workable» and «Has an
assignee», are the first group of the filter's menu. A usable filter is as wide as a
phone's, 108px with the longest words; where the view's segments and the action
cannot stand beside that, the bar takes its phone form, where the menu is its sign
alone. The filter's
hint starts with «Filter:» and names what it narrows by, so it does not read as the
search over every project, «Go to a task» in the navigation; it is whole where it fits
and short where it would be cut. The field is the way into the filter's menu, with no button of its own: a
press in it, `/`, ↓ or a letter typed opens it, and Tab or focus coming back by
itself does not, since Tab passes through to what the menu would cover. The menu takes
two steps, as Linear's does: it opens on the facets — state, kind, priority, holder,
label — under the two conditions, and a facet's row, marked with a chevron, steps into
that facet's values. Every value of every facet at once was a list a real space's
labels made thousands of rows long. The values' step heads its list with the facet's
name as the way back; ← or Backspace from the start of the text goes back too, and
the highlight lands on the facet it left. Typing in the facets' step still finds a
value of any facet, the fast path for a reader who knows the word, and a pick made
that way lands in its facet's step with the value highlighted. Text always ends the
menu with «Search for "…" in all projects», which hands it to the finder; with no
value left that row is all the menu holds, one row tall, and Escape takes it away.
The menu stands as tall as the window
lets it, down to 8px over its foot. A group's head stays in sight while its values scroll, and
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
grouped board says how many epics it draws as rows where the line has room, and
a filter names the closed items it let through only when no open one matched.
Epic progress, lane state, and active work share the same semantic palette.
Aggregate epic activity belongs to the epic index, including its compact state,
and to an epic's frame on the graph, where it is the one sign of work moving
inside a folded frame; bundle headers on the board do not repeat a “working” label.
A frame says that sign in words, «5 working», and never as a sign or a number alone.
Zoomed out, where its band has no room for the words, it shortens to the count beside the
working session's sign, «◌ 5», and the reference is cut before the mark goes; it never gives way
whole, since then nothing on the field says work is running. The header's hover text says
it whole, as a zoomed-out card's does, and so does its button's name: over the work under no
epic, whose one button is the fold, the fold's.
On a phone the list's folded orders are one choice in the title's heading, in the
heading's font and with the least around it, and an order's name is never cut: the
longest takes a line of its own under the title's sort.
Cards do not reserve empty tag or source regions.
A board tile prints exceptions, not defaults. Its first line is a kind glyph
when the item is not a plain task, the reference, a priority glyph when the
priority is not medium, and at its end only what stops the work — the open
blocker it waits on, drawn as its glyph and its reference («⛔ MAIN-12», named
«Ждёт MAIN-12»); the line never wraps, and an exception short of room keeps
its glyph and says its words on hover. The title follows, at most three lines,
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
The board grouped by parent gives a lane to each item that holds others, an epic or
an item of any other kind, and one to the work under none, «No parent» («Без
родителя»): the grouping and its lanes name the parent, as the card does, and only an
epic's own title and sign say it is one; the branch map's lane under none and the
graph's frame under none are named the same way.
On the board grouped by parent a cell with no tile drawn takes no ground until a
tile of its lane is dragged and could land there, and a finished cell's offer of
its tiles is a line of text. An epic's row is one line: its reference, its title
and what it holds, and its state only once the epic has moved, since one not
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
in English 802px under a finger, 782px with a mouse), in lanes with an epic and
without: three lines for two, or four for three where a long title also names
work out of sight.
They come up as a row's actions do (**Actions that come up**), in a place kept
for them, so nothing shifts or is covered; where nothing can hover they stay, a
finger's reach apart. The keyboard moving along a row held at the top leaves the
board where it is: the room the board keeps there for that row does not push its own
buttons out of view. Their rings stand whole wherever the row does: it keeps the
ring's reach above its arrow, and the board keeps it at its edges. A tile the board brings into
view under the row's heading, by the keyboard, by opening it or by moving the
tile below into its place, stands below
the heading at the gap the lane keeps under it, however many lines the heading
takes.
The Done column, and a lane's Done cell, stand newest closed first, by the time
of the item's latest transition; nothing there is planned, so the manual order
of the other columns does not apply. A tile does not move within Done, by drag
or by Alt+↑/↓, and its tiles do not advertise the reorder keys. A tile dropped
on Done from another column still closes, wherever the drop lands, and stands
on top.
Graph nodes allocate separate rows for status, title, and relationship
metadata so labels cannot collide.
A long list paints what fills its height first and draws every other row right
after, with its columns already as wide as all the rows need; no row is ever
taken out of the page again, so a sort, a filter, the keyboard and find in page
reach all of them once it has settled.
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
from 900px of list; an open blocker is named, «Waiting on MAIN-12», wherever it
lives. A graph node leads with the kind, says its state as a dot and a name
in the hue of its chain edge, says workable quietly in the state's place and
never in heavier ink, and reads high or urgent after its reference; its glyphs are read,
not pressed, since the card is one button. A search result leads with the
same glyphs, then its state's dot and name and its project; results share
their columns so every reference and title start at one edge.
A card's chain section stands in «Связи», after the item's links and references: what
the work grew into is a relation of the item, and the map and its hundreds of rows held
Overview's first screen between the next step and the description. Its «Эпик | Цепочка»
switch stands only where the two answer differently, by the counts the chain read gives
for both scopes: where the work grew nothing past the root's children the two are one
list, and a root with no children has no epic scope to read.
The section leads with a branch map: one lane per origin of work,
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
never reads that limit, or a field that grew could not be fitted. The
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

Over the whole space the graph stands in frames. An epic, and any item that grew
children, is drawn as a frame round its work, and the work filed under no parent has
a frame of its own, «Без родителя» (`none`), so every open item stands somewhere on
the field. A frame is told by tone and draws no line: it is ground a step above the
field and its cards a step above it, and a frame inside a frame is a well cut a
step below the one it stands in. Without a filter the field draws every frame with
open work and every open epic, and in «All» every epic; under a filter, as on the
board, only a frame the filter found something in. So every item is on the field,
as a card or as the frame it heads, and the open-or-all switch counts the items the
counts line above it counts. A frame has three readings.
Open, it is its header over its cards. Folded, it is the header alone, a little
wider than a card so its counts fit. A header is as tall as its title, one to three
lines, with the counts right under it, and the layout leaves it the room that same
header takes when drawn; the chevron leads its reference line, and everything in the
header starts at one left edge, the one its cards start at. Zoomed out past reading, the header is the
epic's reference grown with the field, as a zoomed-out card's is, with the count of
work moving under it at the far end and a thicker edge beneath; the work under no parent
keeps its name instead. The header is two buttons with one action each, as a card
is one: the chevron folds or opens the frame, and the rest opens the epic's card;
over the work under no parent the rest is plain text, with no parent to open. At the scale
the field opens at, the chevron is a 28px target under a fine pointer and 44px under a
finger or at a phone's width, reaching up and back into the header's padding and the air
round the frame and never onto the epic's words, so the header is drawn no taller; each
button's focus ring goes round its own drawing with air and no further, and the fold's face
under the pointer covers its chevron alone, zoomed out too, where its target is the whole band
of the work under no parent: never that band's words or its edge. Zoomed out, the chevron is as
tall as the band's first row and grows with it, and the ring round any of the band's buttons
keeps the share of its words it has at reading size, so the focus reads as they do. The field
opens with as much air above its first row as between two frames, so no edge cuts a fold's
target. Below a
quarter of full size a header is a few pixels and the frame round it is what the hand
finds, so the ground of an open frame with an epic opens that epic too and the pointer
says so. It is the pointer's shortcut: the keyboard has the header's button and no new
stop, a card on the ground and a frame inside a frame answer for themselves, and a drag
from the ground moves the field. A card in
a frame does not name its epic, since the frame does. A chain has no frames: it
keeps its flat drawing, its root and its epics as nodes, because its progress is
the card's map and not the field's.

A frame starts folded by its structure alone — how much open work it holds — and
never by who is working on it, or every agent's turn would lay the field out again.
A frame holding more than 20 open items starts folded and shows its progress in its
header instead, and so does an epic with nothing open; the frame of the work under
no parent with nothing open folds only past 20 drawn cards, so «All» on a space with
a few finished items draws them. Every frame between those starts open, so the
links of its work are seen at once. What the operator chooses for a frame, folded or
open, outranks that default and is kept per space in this browser (`localStorage`,
`valkama-graph-frames`), apart from the board's folded lanes, which start from other
defaults; outside a filter a choice that matches the frame's default is forgotten,
so a frame left alone follows its work again. Folding or opening a frame lays the
field out again, and the camera follows across, at the operator's zoom, so the
frame's header stays where it stood on the screen and what was pressed does not
move from under the hand (`toggled`). The arrows reach a header's two buttons as
they reach cards, the fold on its left (`frame:<id>:fold`) and the epic across the
rest (`frame:<id>`); the work under no parent has only the first. Right from the fold
is the epic's button beside it and Left from that button is the fold, however wide
the header, since measured from centres a wide header's second button stands further
off than the first card under the fold. Once a fold hides
the target the keyboard stood on, the field's Tab stop is the fold button of the
innermost frame round it that is still drawn. Zoomed out past reading the fold is
hidden and is no target, except over the work under no parent, whose header has no
other button and keeps it (`foldIsTarget`): the arrows, the Tab stop and the way in read one
list of the targets the field draws at its zoom, so Tab never rests on a button
that takes no focus and the field stays one stop at any zoom. Focus on a fold the zoom
hides moves to the epic's button beside it before the fold goes, whatever changed
the zoom, and the camera stays; at reading size the stop is the fold again.

Open work comes first as the field is read, finished frames after it. The field's
pieces are the frames no drawn line joins, each alone, and the frames lines join,
together; `box` packs them, a piece holding open work at a higher priority. Where
the space has five or more lone frames with open work, they stand on a shelf of
their own, then the linked open work on a second, then the finished frames on a
third, and each shelf stacks its small frames to fill its rows (`GROUP_MIXED`).
Without shelves a row is as wide as the widest piece and as tall as its tallest, so
a dozen small epics beside one linked piece thousands of pixels wide made one thin
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
epic's state is said once it has moved, and quietly on a closed epic that still
holds open work. Only the title gives way when the row is short; the counts are
never cut, and take a row under the name before they would be. Under the row a 3px
edge draws the same counts as a chain's lane is drawn: finished, review, under way,
blocked, then what is ahead (queued and backlog together), each part as long as its
share, in the board's hues, and a part too short to see still a dot. The counts
describe the epic and not the view: every item under the frame, open and closed,
nested frames' included, whatever is drawn or a filter lets through. Over the whole
space the key names the parts the frames' edges draw, «Впереди» for queued and
backlog together, and finished work by the board's word, «Выполнено», which the
header's count says too.

A link is drawn between the drawn ends it reaches: a card, an epic's frame, or the
outermost folded frame the card stands in. So a link to an epic ends on its frame
rather than being dropped, and a line to work folded away ends on the frame that
holds it. Frames lie under the lines and cards over them, so a line runs across a
frame and into the card it ends on. A link between an item and a frame it stands in
is not drawn, since the frame already says it, nor one whose end is hidden finished
work or lives in another space. All the links from one drawn end to another are one
line, its arrow keeping their direction: solid when any of them blocks, since a
block is the one hard dependency, and dashed as context otherwise.

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
Back, «…» and Close. «…» holds what a person does with the item that is no fact of it: the
pin that keeps it in the side panel's «Работа», a setting checked while it is on. The pin
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
once, so a move the server refuses leaves the chip naming where the item is, then, while a
question waits, «Ответить» with the question's sign: a verb that goes to the question on
Overview, in the state chip's word and on its baseline. It was drawn as the status «Ждёт ответа», a state that acted when pressed, and
that the agent waits the state's dot already says. The priority is a menu as well, urgent to low, each
choice saying what it means; on an item the client cannot change both are plain marks.
The parent is named «Родитель», since any item may hold others one level deep, and drawn by
its own kind's sign in that kind's ink, as a tile of it draws it: the epic's sign for an epic,
a bug's for a bug, and for a plain task, which has no sign, the generic parent's. Every
parent was called «Эпик» under the epic's sign, a task holding others too. Its reference is
an item link, the same link a number in text is: a press opens the parent through the card's
departure, its draft guard and Back, and resting on it shows its hover card; its number is
trimmed to its letters as every value of the facts is, so it stands on its name's baseline.
The new-task dialog's field is «Родитель» as well, offering «Без родителя» first. A ↳ and a
bare number there led nowhere. Every item a fact names is such a link. The holder is bare words, shortened to its name and the start
of its session with the whole value and its lease in a tooltip — on a holder that is a
session's button, in what a screen reader hears after its name, since its hover says what a
press does — and a warning dot once nobody is behind it; a plate there read as one more chip. «Подписаны» names the other
sessions that follow the item, each as its claim's holder would print, a name moving to
the next line whole and one wider than the line wrapping between its own words, read whole
with no ellipsis, since plain words offer no hover to a keyboard or a finger; with nobody
following there is no such row. A label chip only filters, its words in its middle with
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
«Ждёт MAIN-12», the number a link, while an open blocker remains, «Эпик — возьмите задачу из него» on an
epic.
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
that are still open.
Overview opens with the next step, when there is one: a quiet line, «Следующий шаг · 3 из
9», whose number is the step's place in the list and not how many are done, then the step's
words as a description reads, with no heading over one sentence. «Все шаги» at the end of
that line goes to the checklist and puts focus on its heading; the only step has neither
the number nor a way to itself.
A section of a card that holds nothing and offers nothing is absent, rather than a
heading and a sentence saying so on the first screen: the «Agents» tab and «Checklist»
stand only while they have something in them, and a step arriving with the live stream's next
frame brings its section back with no reload.
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
«Answered by agent kolo» over an answer, is one unit the same way.
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
would move from under them. Selecting does nothing but select, nothing is chosen for
the person, recommended or not, and Send is what sends. Every choice is a full-width row
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
person pressed no longer stands where they left it. What is asked lies on nothing, so that a
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
holds a row per type: its glyph and word in the colour they have now, the platform's
colour field, the value in words and a reset, with one reset for all under them. A
colour under 3:1 on the hover card is said beside its field in a quiet line and stays
chosen. A plain task has no glyph anywhere, so its row is its word.

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
clear of the words and turns at a control's corner, so one line never closes into a capsule. A text field shows focus by turning its own
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
