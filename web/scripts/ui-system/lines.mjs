/**
 * The line budget and the control-size band.
 *
 * A drawn line is a decision, so each file has a number of them it may spend; a
 * hairline used as a gap or a rule used as a ground is the same decision in
 * disguise. A control's height comes from the scale, not from a literal.
 */

/**
 * The colours a drawn line may be, all under one namespace.
 *
 * The alternation used to carry `--border-subtle`, `--border-strong` and a
 * `--status-*` family as well: six names for tokens the palette does not
 * declare, kept alive here because a regex over names cannot notice that. The
 * shared `--color-` prefix is what makes the list short enough to read, and
 * `check:ui-system` already fails on a token used but never declared, so the
 * dead branches were guarding nothing.
 */
const LINE_TOKENS =
  /var\(\s*--color-(?:rule(?:-strong)?|tooltip-border|danger|success|warning|info|action-primary|navigation|graph-line(?:-muted)?)\b|currentcolor/i

const LINE_DECLARATION =
  /(?:^|[{;])\s*border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;{}]+)/gi

export const LINE_BUDGET = new Map([
  // The shell. One floating warning toast (overlay), and the skip link that
  // surfaces over content on focus (overlay). The rail's footer divider is on
  // the rail now: `shell.css` used to draw it from outside the component it
  // separates, and drew nothing else.
  ['app/App.vue', 1],
  ['app/styles/base.css', 1],
  ['widgets/app-nav/components/AppNav.vue', 1],

  // Shared primitives. Fields keep their interactive edge; floating surfaces
  // keep the hairline that stops them melting into what they cover; internal
  // header and footer rules divide regions that share one ground. CountBadge's
  // ring is an optical cutout against the icon it overlaps, SemanticState's
  // dot draws itself in currentcolor, and PlatformStatePanel carries two status
  // edges (failure panel, degraded banner).
  ['shared/ui/VTextInput.vue', 1],
  ['shared/ui/ChoiceSelect.vue', 2],
  ['shared/ui/CommandList.vue', 1], // Search field edge; results use tone and a focus outline.
  ['shared/ui/CountBadge.vue', 1],
  ['shared/ui/DialogFrame.vue', 2],
  ['shared/ui/DrawerFrame.vue', 1],
  ['shared/ui/PlatformStatePanel.vue', 2],
  ['shared/ui/InfoTip.vue', 1],
  ['shared/ui/OverlayHeader.vue', 1],
  ['shared/ui/OverlayHost.vue', 1],
  ['shared/ui/SemanticState.vue', 1],

  // Widgets and pages: row and section dividers, table header rules, sticky
  // edges, timeline spines — plus status edges where a state names itself.
  // GraphView keeps the pan viewport frame, the floating flow controls and a
  // legend glyph whose border is the drawing itself.
  ['features/input-requests/components/RequestCard.vue', 1], // Divider between separate requests.
  // Settings General uses one earned divider between its two preference
  // groups and one row family. Diagnostics uses section and row dividers,
  // plus status edges for initial-load and refresh failures.
  ['pages/settings/components/SettingsGeneral.vue', 2],
  ['pages/settings/components/installation-health.css', 5],
  // Planning's own surfaces. Overview divides the facts from the record; the
  // list's sticky header stands on the rule that stops it melting into row one.
  ['widgets/work-item-inspector/components/InspectorDiscussion.vue', 2], // Composer divider and frozen step quote.
  ['widgets/work-item-inspector/components/InspectorSummary.vue', 1],
  ['widgets/work-item-inspector/components/InspectorOverview.css', 1],
  ['widgets/work-item-inspector/components/InspectorExecution.vue', 1],
  ['widgets/work-item-views/components/WorkItemList.vue', 1],
  ['widgets/work-item-graph/components/GraphView.vue', 1],
  // Graph cards need a neutral boundary where dependency wires meet their edges.
  ['widgets/work-item-graph/components/GraphNodeCard.vue', 1],
  ['widgets/work-item-graph/components/GraphControls.vue', 2],
  ['widgets/work-item-graph/components/GraphBar.vue', 1],
])

/**
 * The lines one file actually draws, and the ones drawn in an unnamed color.
 *
 * A transparent border is a reserved slot rather than a line, so it is not
 * counted -- unless it names a rule token, in which case it is a line whose
 * author meant it to show under some state.
 */
function drawnLines(file, source) {
  let drawn = 0
  const violations = []
  for (const match of source.matchAll(LINE_DECLARATION)) {
    const value = match[1]
    if (!/\b(?:solid|dashed|double)\b/i.test(value)) continue
    if (/\btransparent\b/i.test(value) && !LINE_TOKENS.test(value)) continue
    drawn += 1
    if (!LINE_TOKENS.test(value)) {
      violations.push(
        `${file}: a drawn line names a rule token or a status color; got "${value.trim()}"`,
      )
    }
  }
  return { drawn, violations }
}

/**
 * The entries a ledger keeps for files the scanned tree does not have.
 *
 * A ledger is exact in both directions only if a file that disappeared counts as
 * lines that disappeared. Scanning the files that exist never visits the entry of
 * one that does not, so twenty-four entries outlived the screens they described
 * — retired modules and a deleted inspector head among them — and any of those
 * paths coming back would have inherited a budget nobody had argued for.
 */
function staleEntries(sources, budget, ledger) {
  const present = new Set(sources.map(({ file }) => file))
  return [...budget.keys()]
    .filter((file) => !present.has(file))
    .map((file) => `${file}: ${ledger} keeps an entry for a file the tree does not have; remove it`)
}

export function scanBorderBudget(sources, budget = LINE_BUDGET) {
  const violations = staleEntries(sources, budget, 'LINE_BUDGET')
  for (const { file, source } of sources) {
    if (!/\.(?:vue|css)$/.test(file)) continue
    const reading = drawnLines(file, source)
    violations.push(...reading.violations)
    const allowed = budget.get(file) ?? 0
    if (reading.drawn === allowed) continue
    violations.push(
      `${file}: draws ${reading.drawn} border line(s), the ledger says ${allowed} — separation is tone and air; an earned line (divider, field, overlay edge, status edge) is recorded in LINE_BUDGET with its role`,
    )
  }
  return violations
}

/**
 * The second line system, the one the ledger could not see.
 *
 * `LINE_BUDGET` counts what a file draws with `border`, which is what makes
 * every hairline an argued exception with a named role. A container that sets
 * its gap to one pixel and paints `--color-rule` behind its children draws exactly
 * the same hairlines — one per seam, and a list of eight rows draws seven —
 * for nothing, because the ledger reads borders. Seven containers were doing
 * it across five files, which is why the interface read as ruled everywhere
 * while the ledger said the product drew barely a line.
 *
 * The pair is what makes it a line: a `--color-rule` ground alone is the neutral fill
 * of a 7px status dot, and a hairline gap alone shows whatever is behind. Both
 * together is a grid of seams.
 */
const HAIRLINE_SEAM_GAP = /(?:^|[;{])\s*(?:row-|column-)?gap\s*:\s*[^;{}]*var\(\s*--space-hair\s*\)/
const RULE_AS_GROUND =
  /(?:^|[;{])\s*background(?:-color)?\s*:\s*var\(\s*--color-rule(?:-strong)?\s*\)/
/**
 * The declarations a rule makes itself, with every nested rule taken out.
 *
 * A depth scan rather than a substitution. `/[^{}]*\{[^{}]*\}/` looks like it
 * removes a nested rule, and it removes the parent's declarations along with it:
 * the leading `[^{}]*` is greedy and reaches back to the start of the body.
 * Dropping the nested selector matters too — leave `& > .cell` behind and it
 * runs into the next declaration, which then no longer follows a `;`.
 */
function ownDeclarations(body) {
  let depth = 0
  let kept = ''
  for (const character of body) {
    if (character === '{') {
      if (depth === 0) kept = kept.slice(0, kept.lastIndexOf(';') + 1)
      depth += 1
    } else if (character === '}') {
      depth -= 1
    } else if (depth === 0) {
      kept += character
    }
  }
  return kept
}

/**
 * Every rule in a stylesheet, at any depth, paired with its own declarations.
 *
 * This used to be one regex, `/([^{}]*)\{([^{}]*)\}/g`, which can only read a
 * flat stylesheet: a rule containing another rule does not match it. Under
 * native nesting that regex found nothing at all and the guard reported a clean
 * pass, which is the worst way for a check to fail. A brace walk has no opinion
 * about depth.
 */
function* eachRule(css) {
  const open = []
  let mark = 0
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index]
    if (character === '{') {
      open.push({ selector: css.slice(mark, index), start: index + 1 })
      mark = index + 1
    } else if (character === '}') {
      const rule = open.pop()
      if (rule) yield { selector: rule.selector, body: css.slice(rule.start, index) }
      mark = index + 1
    }
  }
}

export function scanHiddenRules(sources) {
  const violations = []
  for (const { file, source } of sources) {
    if (!/\.(?:vue|css)$/.test(file)) continue
    const css = source.replaceAll(/\/\*[\s\S]*?\*\//g, '')
    for (const { selector, body } of eachRule(css)) {
      const declarations = ownDeclarations(body)
      if (!HAIRLINE_SEAM_GAP.test(declarations) || !RULE_AS_GROUND.test(declarations)) continue
      const rule = (selector.split('\n').pop() ?? '').trim().replaceAll(/\s+/g, ' ')
      violations.push(
        `${file}: ${rule} draws a hairline at every seam by letting a rule-colored ground through a one-pixel gap, and the line ledger counts none of them; separate with air and a ground of its own`,
      )
    }
  }
  return violations
}

/**
 * How tall a control stands, from the two tokens that say it.
 *
 * The type ramp, the spacing ladder, the radii and the motion scale all became
 * tokens with a linter behind them. Height never did, so it drifted the way
 * every one of those had drifted before someone froze it: 44px was written out
 * in twenty-four places, and where a control could not afford 44 the file
 * invented 30, 32, 36, 38 or 52 on the spot. The visible cost was a 48px tab
 * track standing beside a 44px button in the same toolbar — a wrapper is taller
 * than what it wraps whenever the inner element owns the height.
 *
 * The band is 28-56px, which is the range a control occupies: below it are
 * dots, badges, hairlines and glyphs, above it are panels, rows and charts.
 * Inside it a literal is almost always a control that has opted out of the
 * scale, so the remedy is `--size-control-height`, `--size-control-height-compact`, or
 * `--size-control-target` where the number is the pointer area rather than the
 * drawing.
 *
 * The ledger is exact in both directions, like `LINE_BUDGET`: a file that
 * writes one more literal fails, and one that writes fewer fails until its
 * entry is corrected. What it holds today is the debt this pass did not
 * reach — screens outside the reviewed surfaces — recorded so it cannot grow.
 */
const CONTROL_SIZE_DECLARATION =
  /(?:^|[{;])\s*(?:(?:min-)?(?:height|block-size)|--size-[\w-]*(?:control|filter)[\w-]*)\s*:\s*(\d+)px\s*(?=[;}]|$)/gm

const CONTROL_BAND = { low: 28, high: 56 }

export const CONTROL_SIZE_BUDGET = new Map([
  // Overlay and inspector headers, both 56px: a surface header is a band rather
  // than a control, and it is the one size the two tokens do not describe.
  ['shared/ui/OverlayHost.vue', 1],

  // The debt. Every entry is a control that named its own number before the
  // tokens existed; card #333 empties this list. Nothing here is a new
  // decision — the counts are what the tree already writes.
  //
  // Settings came off it by asking what its 52px was for: a row holding one line
  // of text and a checkbox, with 8px of padding beside the number that supplied
  // the rest of the height. The height is the line and the air around it, so it
  // is the padding, and the ledger is exact in both directions — which is how
  // removing the literal shows up here as a failure until this entry goes too.
  ['widgets/work-item-graph/components/GraphView.vue', 1],
  ['widgets/work-item-graph/components/GraphControls.vue', 1],
])

export function scanControlSizes(sources, budget = CONTROL_SIZE_BUDGET) {
  const violations = staleEntries(sources, budget, 'CONTROL_SIZE_BUDGET')
  for (const { file, source } of sources) {
    if (!/\.(?:vue|css)$/.test(file)) continue
    if (file === 'app/styles/tokens.css') continue
    let literals = 0
    for (const [, value] of source.matchAll(CONTROL_SIZE_DECLARATION)) {
      const size = Number(value)
      if (size < CONTROL_BAND.low || size > CONTROL_BAND.high) continue
      literals += 1
    }
    const allowed = budget.get(file) ?? 0
    if (literals !== allowed) {
      violations.push(
        `${file}: writes ${literals} literal control height(s) in the ${CONTROL_BAND.low}-${CONTROL_BAND.high}px band, the ledger says ${allowed} — name --size-control-height, --size-control-height-compact, or --size-control-target for a pointer area`,
      )
    }
  }
  return violations
}

/**
 * The layer order. A file may import from a layer strictly below its own and
 * from nowhere else, which is what makes any layer removable from the top
 * without touching what is underneath it.
 */
