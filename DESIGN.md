---
name: Valkama
description: A dense, calm, dark operations console for planning, executing, and reviewing agent work.
colors:
  navigation: "#0e0f10"
  navigation-raised: "#191a1b"
  navigation-active: "#242526"
  canvas: "#181818"
  surface: "#252525"
  surface-muted: "#333"
  surface-hover: "#3b3b3b"
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
  brand-gradient-from: "#ececec"
  brand-gradient-mid: "#b9cdf5"
  brand-gradient-to: "#7cacf8"
  brand-spark-from: "#7cacf8"
  brand-spark-to: "#ececec"
  action-primary: "#ececec"
  danger: "#f99a8f"
  success: "#7bd6a1"
  warning: "#d9b06a"

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
    lineHeight: 1.4
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
assets (logos, proprietary typefaces, names) are used.

This is an application, not a themed dashboard. The shell is dark throughout;
hierarchy comes from tonal steps, typography, and a small set of colours that
each mean one thing. There are no paper surfaces, textures, decorative
diagrams, glass, gradients, glow, oversized marketing headings, or game-like
chrome.

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
- The shell has two zones and they must read as two. The chrome — the
  navigation rail and the context bar — is the dark backing of the whole
  window, and the workspace is a lighter panel lying on it. Two adjacent zones
  separated only by a sub-threshold delta collapse into one dark mass, which
  this palette has now managed twice: `#0d0d0d`/`#121212` and, after the
  direction was inverted the first time, `#181818` chrome against a `#121212`
  canvas.
- The left and top chrome use near-neutral graphite with a subtle cold
  undertone; the workspace stays neutral. A neutral `#0d0d0d` under the rail
  read as absence rather than as a surface — the owner asked twice for a color
  there — which led to a cool backing. The current graphite has a two-point
  channel spread, much less blue than the earlier ramp. A violet chrome once
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
  | chrome | `--color-navigation` | `#0e0f10` | — | the rail and the context bar |
  | workspace panel | `--color-canvas` | `#181818` | 1.08 on the chrome | the module panel |
  | ground | `--color-surface` | `#252525` | 1.16 on the panel | a lane, a list, a table, a drawer |
  | sheet | `--color-surface-sheet` | `#333333` | 1.21 on its lane | a card, a panel lying on a ground |
  | control | `--color-control-surface` | `#3b3b3b` | 1.13 on a card | a resting control, a hovered card |
  | pressed | `--color-surface-active` | `#464646` | 1.19 on a control | a hovered or chosen control |
  | recess | `--color-surface-recess` | `#181818` | 1.41 under a card | an epic well, a strip cut into a card |

  Separation without a line is a contrast, so it is measured as one. A lane
  owes 1.15 to the panel and a card 1.20 to its lane — 1.20 is the smallest
  seam the interface already showed as two surfaces, and the ladder it replaced
  stood 1.08–1.10 at every seam and read as one grey mass. The ratio's `+0.05`
  models glare on a real screen, which is why a channel difference cannot stand
  in for it: eight hex units at the dark end are a large ratio of two tiny
  luminances that a good panel in a dark room shows and an office monitor in
  daylight does not. `designTokens.test.ts` holds the floors and keeps the
  ladder that blended as a case it must reject.

  `--color-surface-sheet` and `--color-surface-recess` are roles: a container
  standing on another rung may re-point one to stay a step above itself — the
  drawer stands on `--color-surface`, the rung the default sheet already sits
  above, so it re-points nothing — and a rule that must be one exact tone
  wherever it renders names the palette step instead. A rung that names the
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
  chrome uses a near-neutral graphite ramp (`#0e0f10`/`#191a1b`/`#242526`) with
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
  | `neutral` | nothing to act on | backlog, the queue, low and medium priority, a plain task, workable |

  Hue says how much it asks of the reader and shape says which fact it is, so a
  state and a priority that share a hue never share a shape. Kind carries no
  colour. A colour that appears on every card is a colour nobody reads: in
  progress used to be the green of done, the queue the blue of focus, and
  workable — the ordinary condition of open backlog — a green line on every
  second card, which made it the loudest colour on the board and the one that
  meant least. Each hue holds 4.5:1 as text on a hovered card and 3:1 as a mark
  on a pressed control (WCAG 1.4.3 and 1.4.11); `designTokens.test.ts` holds
  both, and `uiSystem.test.ts` holds the meanings.
- Color is never the only state signal. Every status has a stable text label
  and uses the shared semantic-state component.
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
  the Windows ICO, the Electron window and its offline page, and this document's
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
  go on a hit area rather than on the drawing. The floor everything clears is
  WCAG 2.5.8 at 24px; 44 is the 2.5.5 AAA figure and this product spends it
  wherever a control has no label of its own to widen the box, which is where
  the difference is felt. One token used to answer both,
  which is how a 2px-inset tab track came to stand 48px beside a 44px button in
  the same toolbar: a control that sizes its inner element is structurally
  taller than the thing it wraps. A track takes the row and subtracts its own
  inset. `check:ui-system` keeps a ledger of literal heights in the 28-56px
  band, exact in both directions like the line ledger.
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
- A row that carries anything but text aligns by centre. A flex or inline-flex
  box hands its baseline to its first item, so a row aligned by baseline lines
  its neighbours up with a 5px status dot or the bottom edge of a 13px icon
  rather than with the text beside it. Baseline is for a row that is text and
  nothing else.
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

Work and Settings own distinct icons. Settings is a destination like any other and
stands under the last navigation group; the rail's footer holds the connection
state and refresh and nothing you navigate to. The context bar keeps the
selected Planning space or operating scope and global activity controls in
fixed, predictable positions.

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
  of unmounting it.
- **Inspectors:** persistent right-side detail uses the shared resizable
  inspector. Width is bounded by the actual workspace, not the viewport.
- **Empty and error states:** one shared state component explains what is
  absent, why it matters, and the next valid action when one exists.
- **Icons and badges:** application glyphs come from the central icon owner;
  local SVGs and per-screen badge shapes are prohibited.
- **The mark:** one drawing, two tones, owned by `BrandMark`. Inside the shell
  it is a single ink taking its color from the carrier; the gradient version
  belongs only where the mark stands alone on a ground this palette does not
  own — a browser tab, the tray, an installer. A gradient in the chrome is the
  one exception this document would otherwise have to write into the rule above
  that forbids them.
- **Buttons:** `VButton` owns the four weights the product uses — primary
  (light on dark, one per surface), secondary, ghost, danger. A ghost with a label
  rests on the control fill and steps one further on hover, so a text action reads
  as a control; an icon-only ghost stays bare at rest. A screen does not restyle a
  bare `<button>` for an ordinary action. A weight is a set of values, not a set
  of rules: each variant declares its fill and label at rest, hovered and
  disabled, and one rule per state reads them, so no state rule can outrank a
  variant — the base hover once painted a hovered primary dark under its dark
  label, which is how a disabled button looks. Hover is the same weight one step
  further from the ground; disabled is one look for every weight, a step toward
  the ground with a quieter label that still reads at 4.5:1.
- **Segmented choice:** `SegmentedControl` owns "pick one of a few visible
  alternatives" — view switches, chart encodings, ledger filters. A row of
  `aria-pressed` buttons styled locally is the same control built again, and
  `check:ui-system` rejects one.
- **Fields:** `VField` owns the frame around a labelled control — label,
  control, optional hint — and `VTextInput` owns the control itself for one
  line or several. A date keeps the platform picker inside that field, because
  the native control is already localized and keyboard-complete. Six screens
  had written their own text field and no two agreed on the fill, the hairline
  or the radius; `check:ui-system` rejects a new `<input>` or `<textarea>`
  outside the primitive, and lets a checkbox, a radio and the search box
  through as the different controls they are.
- **Free text:** `RichText` owns every text an agent or a person wrote — a
  description, a comment, a report section, a question, an attempt's result, a
  ref's label. It reads markdown (paragraphs, lists, code, links, emphasis,
  quotes, tables) into a tree that carries no markup: raw HTML is shown as the
  text it was, an image is a link to it, and a link keeps only an `http`,
  `https` or `mailto` address and opens outside the app. Nothing reaches
  `v-html`. A single line break stays one, because these texts were `pre-wrap`
  before and agents write one fact per line. A markdown heading is an emphasised
  paragraph: the section the text stands in owns the outline. Code, hashes and
  ids are set in the metadata font.
- **References in free text** link only where they resolve, and each owner of
  that knowledge answers for its own: the open space for its items, the card for
  its own space (through its draft guard and Back) and for the commits and
  memory ids it carries as refs, the shell for another known space and for
  session ids the server knows. Whatever no layer claims — `SHA-256`, a number
  missing from the space — is the text it was. A modal dialog that could only
  open a card behind itself — the new task's preview — claims every reference as
  text.
- **Writing free text:** `MarkdownEditor` owns the field: a preview drawn by
  `RichText`, `#` and a query to link a task, Ctrl+Enter to send. The field
  stays a multi-line text box naming its list of completions, and the list
  stands under the field rather than at the caret. Every multi-line field whose
  text `RichText` will draw is one — a card's description, a comment, a report
  section, a new task's description, a text answer to a question — and its host
  sets one Write | Preview switch above all of its fields, says what Ctrl+Enter
  does with its own button's words, and decides where `#` searches: the space
  the text belongs to, or nowhere when the host cannot name that space in the
  store the search reads. A launch prompt is not one: it goes to the agent's
  command line as typed and nothing here draws it. A long text held by
  `CollapsibleText` ends on its last whole line, and a link below the cut that
  takes focus opens the text.

A screen that needs a style no primitive provides has found a gap in this
inventory, not a licence to write it locally. The remedy is a variant on the
owning primitive, or a new primitive with an owner — never a utility framework,
which is a second styling system wearing the costume of a shortcut and makes
the one-off cheaper than the shared thing.

## Module composition

### Work

Work presents board, list, and graph views from the same Planning read model.
It pairs a collapsible epic index with a horizontally scrollable board.
The bar above the views is two rows and no more: the view, the queue, the
search and, on the board, the grouping as compact controls on one row, then
what is drawn and how much of it beside the one primary action. The queue
folds into a menu where the row cannot hold its segments beside a usable
search. Every number in the bar counts one population — the space, or a chain
with its root — and a view that draws fewer items says what it leaves out.
Epic progress, lane state, and active work share the same semantic palette.
Aggregate epic activity belongs only to the epic index, including its compact
state; bundle headers on the board do not repeat a “working” label.
Cards do not reserve empty tag or source regions.
A board tile prints exceptions, not defaults. Its first line is a priority
glyph when the priority is not medium, a kind glyph when the item is not a
plain task, the reference, and at its end only what stops the work — the open
blocker it waits on, a stale claim; the line never wraps, and an exception short
of room keeps its glyph and says its words on hover. The title follows, at most
three lines, then up to three label chips and a count of the rest, then the
holder and the steps when there are any. Workable, medium and a plain task are
never printed: they are the norm of the columns that hold them. The title is
the open target, stretched over the whole sheet, so the sheet opens wherever it
is clicked and stays one Tab stop; the glyphs and chips lie above it as filter
buttons out of the Tab order. Graph nodes allocate separate
rows for status, title, and relationship metadata so labels cannot collide.
A card's chain section leads with a branch map: one lane per origin of work,
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
«Blocked» — stands for nothing. Chain views name a single state as the board's
column does and a group of states by the group's own word, never by a
workflow key. The graph's key stands in the field's own strip above the flow,
not in the bar, and keeps the place of a state a switch can add, so no switch
moves the bar or the field; the camera controls stand in the strip below. Neither
lies on the flow, so no framing and no pan puts a node under either. In a
phone-wide workspace the bar is one row — the filter or the chip and a «Graph
options» button that opens the switch and the key under it — the frontier count
takes the key's place in the upper strip, and the camera controls
keep one row, so the field keeps most of the screen and no camera control falls
outside it. The field opens with its drawing in view: whole where it reads at
reading size, else from its first node at the top-left at reading size; a chain
opens on its root and an open card on its item, and no opening frame leaves
empty ground beside work it cuts. The camera is the operator's. A data refresh
and any change of queue, search or switch never moves or zooms it; it moves
only when a different scope opens — another project, another chain, a branch
from a card's «Show on graph» — by the opening frame above, on the explicit
«Fit whole graph», and when after a narrowing not one drawn node is left in
sight, and then only across, at the operator's zoom: onto the whole of what is
drawn where that fits, else onto its first node as it is read. A field that
changes size follows the last rule, and leaving the graph for another view
and coming back to the same scope finds the camera where it was left. The
2.1.0 rule that framed the field afresh on every new queue or search was
withdrawn by the owner after use: each narrowing cost the operator their place
and their zoom. The keys to the chain list its
groups as a lane runs, finished first, while the card's totals line and member
list run as work is taken, what is under way first. «Show on graph» from a card
whose map has a branch chosen opens the
chain framed on that branch — the whole of its work where that reads, else its
beginning at reading size — with its members edged in the selection accent, a
chip naming the branch that lets it go, and the branch in the address; focus
goes to the graph, never to the page. The field is one Tab stop: the arrows
walk to the nearest node their way, Home and End to the first and last as the
field is read, and the camera follows. Zoomed out past reading, the graph draws each node as a block of its
state's colour with its reference, so the whole of a long chain reads as an
overview. Under the map, one line gives the totals and a second answers
whether and when the open part closes, from the last seven days, and says so
as a range when those days disagree.
The related work/session/evidence context is one grouped relationship region,
not a decorative sequence. Execution history and native session opening stay
inside work-item context; Memory is a typed reference there.

### Settings

Settings uses one section anatomy and one type scale, and its groups read as
label left, control right. Module rows state what a module is and whether it is
on; interface versions are wire facts and do not appear as interface copy.
Installation health reports observed checks with their fixes. A switch is shown
only when the Kernel actually owns that setting. Session opener choices show application identity,
availability, and a single collision-aware selector. Impossible destinations
are omitted for that client family rather than displayed as unusable choices.

## Accessibility

The target is WCAG 2.1 AA: full keyboard reach, a visible focus ring, semantic
headings and controls, a text equivalent for every chart, honored
reduced-motion, and correct behavior when text is scaled. Color is always
doubled by text or shape and is never the only carrier of a state.

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
