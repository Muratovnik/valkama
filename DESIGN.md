---
name: Valkama
description: A near-black, Codex-look operations console for planning, supervising, and improving agent work.
colors:
  navigation: "#0d1117"
  navigation-raised: "#161b22"
  navigation-active: "#21262d"
  canvas: "#181818"
  surface: "#212121"
  surface-muted: "#282828"
  surface-hover: "#303030"
  surface-active: "#393939"
  surface-selected: "#22303f"
  text: "#ececec"
  text-muted: "#b3b3b3"
  text-tertiary: "#8f8f8f"
  navigation-text-muted: "#8f8f8f"
  rule: "rgb(255 255 255 / 8%)"
  rule-strong: "rgb(255 255 255 / 18%)"
  scrollbar-thumb: "#393939"
  scrollbar-thumb-hover: "#4f4f4f"
  accent: "#7cacf8"
  brand-gradient-from: "#ececec"
  brand-gradient-mid: "#b9cdf5"
  brand-gradient-to: "#7cacf8"
  brand-spark-from: "#7cacf8"
  brand-spark-to: "#ececec"
  action-primary: "#ececec"
  danger: "#ef8479"
  success: "#7bd6a1"
  warning: "#d9b06a"
  series-1: "#7fb4d3"
  series-2: "#78c7a0"
  series-3: "#d8ad62"
  series-4: "#9ea8e8"
  series-5: "#aab4bb"
typography:
  scale:
    meta: "12px"
    dense: "13px"
    interface: "14px"
    emphasis: "15px"
    section: "16px"
    module: "18px"
    page: "24px"
    figure: "28px"
  display:
    fontFamily: "'Inter Variable', 'Onest Workbench', sans-serif"
    fontSize: "1.5rem"
    lineHeight: 1.3
  interface:
    fontFamily: "'Inter Variable', 'Onest Workbench', sans-serif"
    fontSize: "1rem"
    lineHeight: 1.5
  control:
    fontFamily: "'Inter Variable', 'Onest Workbench', sans-serif"
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
  section: "24px"
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

**Creative north star (owner decision 2026-08-14): the Codex app look.**

Valkama is a dense, calm desktop workspace. Per the owner decision of
2026-08-14 it follows the visual appearance of the Codex app — near-black
low-chrome surfaces, list-first density, text-first statuses, detail beside the
work — including its composition, while never using OpenAI brand assets
(logos, proprietary typefaces, names). The former standalone "Project Console"
identity is superseded. The tokens below are the revised Codex-look palette,
adopted 2026-08-16, superseding package R7 of the 2026-08-14 recovery pass.

This is an application, not a themed dashboard. The shell is dark throughout;
hierarchy comes from tonal steps, one-pixel rules, typography, and a small set of
semantic colors. There are no paper surfaces, textures, decorative diagrams,
glass, gradients, glow, oversized marketing headings, or game-like chrome.

## System rules

- Navigation stays on the left, expands to 260px, collapses to 64px, and can
  accept more destinations without becoming a horizontal game menu.
- Spacing follows the 4/8/12/16/24 grid, and a module keeps `--size-page-gutter`
  from the panel edge. Density comes from alignment and disclosure; taking it
  from the gaps instead is what made the shell read as crowded against its own
  reference, which spends 275px on a rail and 16px inside a row.
- The context bar names the current module once. A module must not repeat the
  same title or introductory copy merely to fill space.
- The shell has two zones and they must read as two. The chrome — the
  navigation rail and the context bar — is the dark backing of the whole
  window, and the workspace is a lighter panel lying on it. Two adjacent zones
  separated only by a sub-threshold delta collapse into one dark mass, which
  this palette has now managed twice: `#0d0d0d`/`#121212` and, after the
  direction was inverted the first time, `#181818` chrome against a `#121212`
  canvas.
- The chrome carries a cold cast and the workspace stays neutral. A neutral
  `#0d0d0d` under the rail read as absence rather than as a surface — the owner
  asked twice for a color there — and the contrast between a tinted backing and
  a neutral panel is what says which of the two is the backing. The cast is a
  temperature, not a color: ten points between the coldest and warmest channel.
  A violet chrome once tried to solve the same problem and tinted every panel
  in the shell instead, which is a color the product does not mean, so the
  panel's neutrality is the half that is not negotiable.
- `designTokens.test.ts` owns both statements as one oracle with two ways to
  pass, because there are two ways to be right. A neutral chrome has only
  lightness to separate with, so it owes a ratio of 1.6; a tinted one carries a
  second signal and may sit at 1.35, but its cast must fall between 6 and 14 —
  below that there is nothing to see, above it the shell is painted rather than
  lit. The workspace must be neutral in either case. The floor is the part that
  has been wrong before: at 1.2 the test passed both merged pairings above, and
  so certified the very defect it was written for, which is why the oracle now
  carries the failing pairings as cases rather than as prose. The three chrome
  tokens must also be tinted together, since a neutral hover on a cold ground
  is the seam rule one state deeper.
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
  as such:

  | Rung | Token | What stands there |
  | --- | --- | --- |
  | chrome | `--color-navigation` | the rail and the context bar |
  | workspace panel | `--color-canvas` | the module panel lying on the chrome |
  | ground | `--color-surface` | a lane, a list, a table |
  | sheet | `--color-surface-sheet` | a card, a row, a panel lying on a ground |
  | recess | `--color-surface-recess` | an epic well, a strip cut into a card |

  `--color-surface-sheet` and `--color-surface-recess` are roles: a container may re-point
  one — the drawer does, being its own ground — so a rule that must be one
  exact tone wherever it renders names the palette step instead. A role that
  resolves to the same tone as another role is a duplicate and fails
  `designTokens.test.ts`; the palette shipped `--surface-panel` and
  `--color-surface-sheet` painted identically until it did. A group cut into
  a ground is the one move that goes the other way: an epic bundle is a well one
  step *down* from the lane, because a second outline around cards that already
  have one would be two frames deep. What lies in a well still counts its step
  from the ground the well is cut into, not from the floor of the well, or the
  cards inside it would sink to the ground's own tone and the group would read
  as a hole with nothing in it. The neutral ramp
  is Codex's own (`#0d0d0d`/`#181818`/`#212121`/`#282828`/`#303030`/`#393939`),
  read out of the installed desktop application rather than approximated by eye,
  and so is the direction: it paints the window with an under-color and lays the
  content on it as a lighter rounded panel. The chrome runs a cold ramp parallel
  to it, on the same rungs (`#0d1117`/`#161b22`/`#21262d`), so a step means the
  same distance whichever zone it is in.
- The canvas, lists, panels, fields, and inspectors use a near-black neutral
  ladder (the Codex-look ground). Light tones are reserved for text and the
  primary action button, never for large page surfaces.
- The primary action is a light button on the dark ground; quiet accent blue
  identifies selection, focus, and links. Green, amber, and red communicate
  success, warning, and failure only, as a dot plus a text label.
- Color is never the only state signal. Every status has a stable text label
  and uses the shared semantic-state component.
- A status color may occupy a mark or an edge, never a surface. A dot, a glyph,
  the text itself, or a 3px inline-start marker carries the state; a tinted
  panel spends a whole surface on what its own sentence already says, and a
  screen holding several of them reads as a screen full of alarms.
  `check:ui-system` rejects a status color blended into a background or a
  container border.
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
  (`--color-control-surface`), hover one step further (`--color-surface-hover`); in the
  chrome the same grammar runs on the chrome's own ramp. The primary action is
  the light fill; an outlined control reads as lower emphasis than a filled one
  everywhere the pattern is documented, which is the opposite of what an
  interface means by a button.
- One rule weight, expressed as a percentage of white rather than a fixed grey,
  so a hairline reads the same on every step of the ladder.
- Statuses have exactly one owner. `uiSystem.ts` maps a typed dimension and
  state to a tone; components render the tone. A second mapping keyed on the
  same state in CSS is how `todo` came to have a dot and no border while `dev`
  had a border that disagreed with its dot.
- Charts read the same palette. Canvas resolves no custom property, so
  `chartOptions.ts` mirrors the tokens literally; the mirror is generated rather
  than maintained, and `npm run check:tokens` fails when it drifts. Slices that
  mean a name use the categorical `--series-*` ramp; a status color never stands
  in for a category.
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
  it by `scripts/sync-tokens.mjs` — the chart theme, the tone map, the favicon,
  the Windows ICO, the Electron window and its offline page, and this document's
  own frontmatter. Copies exist because canvas, a browser tab, an ICO and a
  window frame resolve no custom property, and every one of them had drifted at
  least once; tests caught that drift but could not fix it, so a palette change
  meant editing seven files by hand. Each site names an anchor that must match
  exactly once, so a moved anchor fails loudly instead of silently doing
  nothing. The document's `spacing:` block is not generated yet.
- Spacing follows 4/8/12/16/24px. Density is achieved with alignment and
  disclosure, not tiny type or cramped targets.
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
  `session-ledger`, `skills-catalog` and `filters`. A shared primitive queries
  the nearest unnamed container, because it stands in more than one of them.
  The two exceptions are the elements that size themselves — the rail and the
  drawer — and `check:ui-system` owns that list.
- Styling has one system: semantic tokens plus class names that say what the
  element is. A utility framework is not a second system to fall back to, and a
  class named after its own declarations is the same mistake by another route.
  Tokens live in `tokens.css`, element defaults in `base.css`, application
  chrome in `shell.css`, and everything else in its component's scoped block.
- The stylesheet language is CSS, and nesting is native and shallow. Chromium
  150 — what the desktop app runs — ships nesting, `:has()`, `@container` and
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
  reloading graph were both this one invariant, violated in two places.
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

Each module owns a distinct icon. Settings is a destination like any other and
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
  palette across Planning, Sessions, Improvements, Analytics, and Skills.
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
  (light on dark, one per surface), secondary, ghost, danger. A screen does not
  restyle a bare `<button>` for an ordinary action.
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

A screen that needs a style no primitive provides has found a gap in this
inventory, not a licence to write it locally. The remedy is a variant on the
owning primitive, or a new primitive with an owner — never a utility framework,
which is a second styling system wearing the costume of a shortcut and makes
the one-off cheaper than the shared thing.

## Module composition

### Planning

Planning pairs a collapsible epic index with a horizontally scrollable board.
Epic progress, lane state, and active work share the same semantic palette.
Aggregate epic activity belongs only to the epic index, including its compact
state; bundle headers on the board do not repeat a “working” label.
Cards do not reserve empty tag or source regions. Graph nodes allocate separate
rows for status, title, and relationship metadata so labels cannot collide.
The related work/session/evidence context is one grouped relationship region,
not a decorative sequence.

### Sessions

Sessions is a centered, bounded ledger of mutually exclusive attention,
working, waiting, and recent groups. Its compact table uses client, session,
activity, and acknowledgement columns. Clicking a row opens the persistent
inspector; acknowledgement stays a separate quiet control. When the inspector
is closed, the ledger keeps a readable maximum width instead of stretching
across the whole monitor.

### Improvements

Improvements uses a compact job ledger, a single readiness summary, and a
list/detail case workspace. Profile settings live in the shared dialog opened
beside Run analysis. Case states use the shared semantic primitive; the same
state never changes shape or color between rows.

### Analytics

Analytics groups flow, agent usage, and card age into distinct sections. Charts
reserve most of their panel for data, keep readable labels, and offer only
meaningful alternative encodings. Data tables open in the shared inspector;
they do not expand the page. Every chart retains a textual/table equivalent and
shows data-quality notices only when they affect the current metric.

### Settings

Settings uses one section anatomy and one type scale, and its groups read as
label left, control right. Registry rows state what a thing is and what state
it is in; interface versions and lineage version numbers are wire facts and do
not appear as interface copy. A registry state is the shared semantic primitive
under the `registry-lifecycle` dimension, never a word coloured by the screen's
own stylesheet, and registry metadata such as an operating level or a
provenance is plain text rather than a bordered capsule. Integrations separate
observed health from Kernel-owned intake state. A switch is shown only when the
Kernel actually owns that setting. Session opener choices show application identity,
availability, and a single collision-aware selector. Impossible destinations
are omitted for that client family rather than displayed as unusable choices.

### Skills

Skills is a dense searchable, filterable inventory table with details in the
shared resizable overlay drawer. The inventory has stable identity, scope,
and aggregate-status columns; it never grows a column per client. Client
availability and activation controls are generated from the selected skill's
client catalog in the drawer, which never reallocates inventory width.
Project-owned user-scoped sources are
attributed to their project even when their runtime projection is global.
Validation or availability failures show their concrete reason beside the
affected skill. The default inventory remains metadata-only. An explicit
selection may request one bounded `SKILL.md` body for the drawer; the server
strips frontmatter, returns no absolute path, and never reads referenced files
or executes content. Script contents never cross either contract.

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
zones are far enough apart to be two zones, whether a sheet still sits above its
ground, and whether the drawing in three renderers is still one drawing.
