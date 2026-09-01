/**
 * The style and token rules: which file may own an SVG, an overlay, a selection
 * control or a text field; which weights and colors are on the scale; and whether
 * every token declared is used and every token used is declared.
 */

const svgOwners = new Set(['shared/ui/VIcon.vue', 'shared/ui/BrandMark.vue'])
const overlayOwners = new Set(['shared/ui/DialogFrame.vue', 'shared/ui/InspectorDrawer.vue'])
const dialogOwners = new Set(['shared/ui/OverlayHost.vue'])
const selectionOwners = new Set(['shared/ui/ChoiceSelect.vue'])
const segmentedOwners = new Set(['shared/ui/SegmentedControl.vue'])
/**
 * Files allowed to author a text control.
 *
 * Checkboxes, radios and the search box are excluded: the first two are a
 * different control with no styling of their own to diverge, and a search box
 * is an icon-leading control named by its placeholder rather than a field in a
 * form. What did diverge was the text field — six screens wrote their own, and no two agreed on the fill, the
 * hairline or the radius, which was 4px in three of them while the token said
 * 8px. `ChoiceSelect` keeps its own because a combobox's text box is part of
 * the selection widget rather than a field in a form.
 */
const textFieldOwners = new Set(['shared/ui/VTextInput.vue', 'shared/ui/ChoiceSelect.vue'])
/**
 * Files allowed to author a literal color.
 *
 * `tokens.css` is the palette. The two mirrors exist because canvas resolves no
 * custom property, so a chart needs the value spelled out; `designTokens.test`
 * is what keeps a mirror equal to what it mirrors. Everything else names a
 * token, including the `.ts` files — the hex rule used to read `.vue` alone,
 * which is how a whole second chart palette grew up unnoticed.
 */
const colorOwners = new Set([
  'app/styles/tokens.css',
  'shared/lib/uiSystem.ts',
  'widgets/analytics-dashboard/utils/chartOptions.ts',
  'app/App.vue',
  'widgets/analytics-dashboard/components/AnalyticsDashboard.vue',
  'entities/board/components/CardItem.vue',
  'shared/ui/ResizableInspector.vue',
])

/**
 * Files allowed to ask the window how wide it is.
 *
 * Everything else asks its container. The rail is 260px or 64px depending on a
 * state the window knows nothing about, the inspector's width is dragged by the
 * operator, and a dialog stops growing at 640px — so a viewport threshold names
 * the wrong box almost everywhere it appears, by up to 196px in the shell.
 *
 * The two exceptions are the elements that size *themselves*: the rail decides
 * its own width, and the drawer decides its own. A container query cannot
 * express either without the element asking itself. The rail's entry names the
 * component rather than `shell.css`, because the rail's rules moved home — and
 * the shell stylesheet came off this list entirely, its last width question
 * having been a 4px nudge of a focus-revealed skip link.
 */
const viewportQueryOwners = new Set([
  'widgets/app-nav/components/AppNav.vue',
  'shared/ui/OverlayHost.vue',
])

/**
 * The four status colours, which mark a state and never fill a surface.
 *
 * One prefix and four names, where this used to be a `--status-*` family the
 * palette does not declare plus the four real ones. A fixture in
 * `uiSystemGuard.test.ts` is what noticed the rename: a pattern over the old
 * spelling stops matching silently, and the rule then reports nothing at all.
 */
const SEMANTIC_COLOR = /--color-(?:danger|success|warning|info)\b/

/**
 * Declarations that paint an area rather than a mark.
 *
 * `border-inline-start` and `border-left` are excluded on purpose: a 3px edge
 * marker is how a state is carried without spending a surface on it.
 */
const AREA_DECLARATION =
  /(?:^|[{;])\s*(?:background|background-color|border|border-(?!inline-start|left)[\w-]+)\s*:([^;{}]*)/gi

const SOURCE_RULES = [
  {
    component: true,
    when: ({ markup }) => /<select\b/i.test(markup),
    message: 'product selections must use the shared custom control',
  },
  {
    component: true,
    owners: selectionOwners,
    when: ({ source }) =>
      /\b(?:Select|Combobox)(?:Root|Trigger|Content|Item|Portal|Viewport|Value|Input)\b/.test(
        source,
      ) && /\bfrom\s*['"]reka-ui['"]/.test(source),
    message: 'Reka selection primitives belong to ChoiceSelect',
  },
  {
    component: true,
    owners: selectionOwners,
    when: ({ markup }) => /\brole\s*=\s*["'](?:combobox|listbox|option)["']/i.test(markup),
    message: 'selection semantics belong to ChoiceSelect',
  },
  {
    // A row of mutually exclusive buttons is a segmented control. Four screens
    // grew their own before one existed, and no two agreed on height, radius or
    // what "pressed" looks like.
    component: true,
    owners: segmentedOwners,
    when: ({ markup }) => /\baria-pressed\b/.test(markup),
    message: 'a pressed-button group belongs to SegmentedControl',
  },
  {
    component: true,
    owners: textFieldOwners,
    when: ({ markup }) =>
      /<textarea\b/i.test(markup) ||
      /<input\b(?![^>]*\btype\s*=\s*["'](?:checkbox|radio|search)["'])/i.test(markup),
    message: 'a text field belongs to VTextInput',
  },
  {
    component: true,
    owners: svgOwners,
    when: ({ markup }) => /<svg\b/i.test(markup),
    message: 'generic interface icons must use VIcon',
  },
  {
    component: true,
    owners: overlayOwners,
    when: ({ source }) => /\bOverlayHost\b/.test(source),
    message: 'OverlayHost behavior belongs to the approved surface frames',
  },
  {
    component: true,
    owners: dialogOwners,
    when: ({ markup }) => /<dialog\b/i.test(markup) || /\brole\s*=\s*["']dialog["']/i.test(markup),
    message: 'dialog semantics belong to OverlayHost and shared surface frames',
  },
  {
    when: ({ source }) => /\b(?:linear|radial|conic)-gradient\s*\(/i.test(source),
    message: 'gradients are outside the Project Console visual contract',
  },
  {
    when: ({ source }) =>
      /class="[^"]*(?:\b(?:flex|grid|block|hidden|truncate|shrink-0|tabular-nums)\b(?=[^"]*\b(?:items-|justify-|gap-|grid-cols|flex-col)\b)|\b(?:gap|p[xytblr]?|m[xytblr]?|w|h|min-w|min-h|max-w|size|text|bg|border|rounded|ring|opacity|z|inset|top|left|right|bottom|space-[xy]|leading|tracking)-(?:\[|\d|xs\b|sm\b|base\b|lg\b|xl\b|full\b|px\b|auto\b))/.test(
        source,
      ),
    message: 'utility classes are not the styling system here; use tokens and named classes',
  },
  {
    // Uppercase is texture, not hierarchy. Six lane names, five table headers
    // and four kickers set in caps turn every heading into a band the eye has
    // to read past; weight and the text tones carry the same rank quietly.
    when: ({ source }) => /text-transform\s*:\s*uppercase/i.test(source),
    message: 'hierarchy comes from weight and tone, not from uppercase',
  },
  {
    when: ({ source }) =>
      /\b(?:backdrop-filter|text-shadow)\s*:|filter\s*:\s*blur\s*\(/i.test(source),
    message: 'glass and glow effects are outside the Project Console visual contract',
  },
  {
    when: ({ source }) =>
      /--(?:ink-navy|paper-blue|chalk|graphite|coral|safety-orange|ledger-[\w-]*)\b/i.test(
        source,
      ) || /\b(?:Maintenance Ledger|Cutting Table)\b/i.test(source),
    message: 'obsolete visual identity aliases are not compatibility APIs',
  },
  {
    when: ({ interfaceCopy }) =>
      /\b(?:it|this|that) does not\b|;\s*(?:it\s+)?(?:does not|doesn't|will not|won't|never)\b|;\s*[^.;\n]{0,100}\b(?:is|remains)\s+(?:unchanged|unaffected)\b|(?:он|она|это) не\s+(?:запускает|устанавливает|изменяет|останавливает|удаляет|делает)|;\s*[^.;\n]{0,100}не\s+(?:копирует|копируем|изменяется|затрагивается|запускает|устанавливает|делает)/iu.test(
        interfaceCopy,
      ),
    message:
      'state the useful behavior once instead of adding a self-justifying negative disclaimer',
  },
  {
    when: ({ interfaceCopy }) =>
      /\b(?:truthful inventory|seamless|best-in-class|cutting-edge)\b|правдив(?:ый|ая|ое)\s+(?:список|каталог|инвентаризация)/iu.test(
        interfaceCopy,
      ),
    message: 'replace generic product claims with a concrete product fact',
  },
]

/**
 * Weights come in four stops.
 *
 * Seven ad-hoc stops (620, 650, 680, 720…) crept in and made near-equal text
 * argue about emphasis. Two numbers in a `font-weight` are a variable-font range
 * registration rather than a stop; in the `font` shorthand the weight is the
 * number that precedes the size, which is the form most of this app is written
 * in.
 *
 * The size and the leading in that same shorthand belong to stylelint's
 * `declaration-property-value-allowed-list` instead: a value rule is what that
 * linter is for, and it reads the property rather than a regex over the file.
 * This one stays because the four-stop scale is not a value list — it is a
 * numeric range with an `@font-face` exception no allowed-list can express.
 */
function offScaleWeights(file, source) {
  const violations = []
  for (const [, longhand, value] of source.matchAll(/font(-weight)?\s*:\s*([^;{}]*)/gi)) {
    const numbers = value.match(/\b\d{3}\b/g) ?? []
    const weight = longhand
      ? numbers.length === 1 && numbers[0]
      : (/^\s*(?:normal\s+|italic\s+)?(\d{3})\s/.exec(value)?.[1] ?? false)
    if (weight && !['400', '500', '600', '700'].includes(weight)) {
      violations.push(`${file}: font-weight ${weight} is off the 400/500/600/700 scale`)
    }
  }
  return violations
}

/** Every window-width query in a file that is not allowed to ask. */
function viewportQueries(file, source) {
  if (viewportQueryOwners.has(file)) return []
  return [...source.matchAll(/@media\s*\(\s*(?:width|min-width|max-width)/gi)].map(
    ([, feature]) =>
      `${file}: ask the container how much room there is, not the window${feature ?? ''}`,
  )
}

/** Literal colors, named in the message so the fix does not need a second look. */
function localColors(file, source) {
  if (colorOwners.has(file)) return []
  const authoredHex = source.match(/#[0-9a-f]{3,8}\b/gi) ?? []
  if (!authoredHex.length) return []
  return [`${file}: local colors ${[...new Set(authoredHex)].join(', ')} must be semantic tokens`]
}

/** A status color used to tint a whole surface rather than to mark it. */
function tintedSurfaces(file, source) {
  const violations = []
  for (const [, value] of source.matchAll(AREA_DECLARATION)) {
    if (!value.includes('color-mix(') || !SEMANTIC_COLOR.test(value)) continue
    violations.push(
      `${file}: a status color tints a surface here; carry the state in text, a dot or a 3px inline-start marker`,
    )
  }
  return violations
}

export function scanUiSources(sources) {
  const violations = []
  for (const { file, source } of sources) {
    const component = file.endsWith('.vue')
    const subject = {
      source,
      markup: source.replaceAll(/<!--[\s\S]*?-->/g, ''),
      interfaceCopy: source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, ''),
    }
    for (const rule of SOURCE_RULES) {
      if (rule.component && !component) continue
      if (rule.owners?.has(file)) continue
      if (rule.when(subject)) violations.push(`${file}: ${rule.message}`)
    }
    violations.push(
      ...offScaleWeights(file, source),
      ...viewportQueries(file, source),
      ...localColors(file, source),
      ...tintedSurfaces(file, source),
    )
  }
  return violations
}

/**
 * Typography a rule assembles rather than names, and whether two rules assemble
 * the same thing.
 *
 * A size, a leading and a weight are read together and mean nothing apart, so a
 * type style is one decision. 139 rules were making it by hand out of 8 sizes, 5
 * leadings and 4 weights, and 22 of the resulting styles appeared more than once
 * — the same three declarations copied into two files that had no way to know
 * about each other. `tokens.css` names those 22; this is what stops the 23rd.
 *
 * A style written once is not duplication and passes: a rule is allowed to
 * assemble something no other rule assembles. What fails is the second rule to
 * assemble it, and the fix is always the same — name it in `tokens.css` and let
 * both rules say `font: var(--font-<role>)`.
 *
 * Only a rule that decides all three counts, and that is not a technicality. A
 * rule setting a size and a weight and leaving the leading open has decided two
 * things and left one to whatever it lands in, which is a different decision
 * from deciding three — and one a role token cannot express, because the `font`
 * shorthand always sets a leading. `.fact-count` is why the distinction is here:
 * it names a size and a weight on `CountBadge`'s own root, and the badge sets its
 * leading to `flat` so a number is the height of its digits. Naming a role there
 * reset that to 1.45 and grew the line box by 7px — the host saying how tall a
 * child's line box is, which is not its to say.
 *
 * The three sans families normalise to one because they were byte-equal:
 * picking between `display`, `body` and `utility` was a choice with no
 * consequence, which is how one style came to be spelled two ways and counted as
 * two.
 */
const TYPE_LONGHAND =
  /(?:^|[{;])\s*(font-size|font-weight|line-height|font-family)\s*:\s*([^;{}]+)/gi
const TYPE_SHORTHAND = /(?:^|[{;])\s*font\s*:\s*([^;{}]+)/gi

/** What the four slots of one `font` shorthand say, or null for a role and `inherit`. */
function shorthandSlots(spelling) {
  if (spelling === 'inherit' || /var\(--font-(?!size-|family-)/.test(spelling)) return null
  return {
    weight: spelling.match(/^(\d{3})\s+/)?.[1] ?? '400',
    size: spelling.match(/var\(--font-size-([a-z-]+)\)/)?.[1] ?? null,
    // A shorthand with no leading resets it to the initial value rather than
    // leaving it to inheritance, so an omitted slot is still a decision.
    leading: spelling.match(/var\(--line-height-([a-z-]+)\)/)?.[1] ?? 'normal',
    family: /mono/.test(spelling) ? 'mono' : 'sans',
  }
}

/** Which slot one longhand fills, and with what. */
function longhandSlot(property, value) {
  if (property === 'font-size') return ['size', value.match(/--font-size-([a-z-]+)/)?.[1] ?? value]
  if (property === 'font-weight') return ['weight', value]
  if (property === 'line-height')
    return ['leading', value.match(/--line-height-([a-z-]+)/)?.[1] ?? value]
  return ['family', /mono/.test(value) ? 'mono' : 'sans']
}

function assembledStyle(body) {
  const seen = { size: null, weight: null, leading: null, family: null }
  let declarations = 0
  for (const [, value] of body.matchAll(TYPE_SHORTHAND)) {
    const slots = shorthandSlots(value.trim())
    if (!slots) continue
    Object.assign(seen, slots)
    declarations += 2
  }
  for (const [, property, raw] of body.matchAll(TYPE_LONGHAND)) {
    const [slot, value] = longhandSlot(property, raw.trim())
    seen[slot] = value
    declarations += 1
  }
  if (declarations < 2) return null
  if ([seen.size, seen.weight, seen.leading].some((slot) => !slot || slot === 'inherit'))
    return null
  return `${String(seen.weight)} ${String(seen.size)}/${String(seen.leading)} ${seen.family ?? 'sans'}`
}

/** Every rule body in a source, with the selector that opens it. */
function ruleBodies(source) {
  const bodies = []
  for (const match of source.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replaceAll(/\s+/g, ' ')
    if (!selector || selector.startsWith('@') || selector.startsWith('/*')) continue
    bodies.push({ selector, body: match[2] })
  }
  return bodies
}

export function scanTypeStyles(sources) {
  const owners = new Map()
  for (const { file, source } of sources) {
    if (file === 'app/styles/tokens.css') continue
    const css = file.endsWith('.vue')
      ? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
      : source
    for (const { selector, body } of ruleBodies(css)) {
      const style = assembledStyle(body)
      if (!style) continue
      const list = owners.get(style) ?? []
      list.push(`${file} → ${selector}`)
      owners.set(style, list)
    }
  }
  const violations = []
  for (const [style, list] of [...owners].sort(([left], [right]) => byName(left, right))) {
    if (list.length < 2) continue
    violations.push(
      `${list[1]}: assembles \`${style}\` by hand, which ${list.length - 1} other rule(s) already assemble (${list[0]}) — name it in tokens.css as a --font-* role and write \`font: var(--font-<role>)\``,
    )
  }
  return violations
}

const byName = (left, right) => left.localeCompare(right)

/**
 * Every token these sources declare, resolve and name.
 *
 * `declared` keeps the first file to declare each token, `resolved` is every
 * `var()` reference, and `named` is every token mentioned as a bare string. A
 * canvas mirror consumes a token by naming it, not by resolving it, so `named`
 * proves a token is alive; it is too weak to prove one is missing, which is why
 * the dangling check reads `resolved` alone.
 */
function collectTokenUse(sources) {
  const declared = new Map()
  const resolved = new Set()
  const named = new Set()
  for (const { file, source } of sources) {
    for (const match of source.matchAll(/(--[a-z][\w-]*)\s*:/gi)) {
      if (!declared.has(match[1])) declared.set(match[1], file)
    }
    for (const match of source.matchAll(/var\(\s*(--[a-z][\w-]*)/gi)) resolved.add(match[1])
    for (const match of source.matchAll(/['"](--[a-z][\w-]*)['"]/gi)) named.add(match[1])
  }
  return { declared, named, resolved }
}

/**
 * Tokens declared and tokens used, checked against each other.
 *
 * Both directions have already failed here. `--color-navigation-text-muted` was referenced
 * by the navigation and declared nowhere, so the group headings silently
 * inherited their color; and a whole `--module-*` family sat in the palette
 * that no rule had ever read. A palette is only a contract while both halves
 * hold.
 */
export function scanTokenHygiene(sources) {
  // Without the palette in scope there is nothing to check a reference against,
  // which is the case for the guard's own fixture roots.
  const palette = sources.find((entry) => entry.file === 'app/styles/tokens.css')
  if (!palette) return []
  const { declared, resolved, named } = collectTokenUse(sources)
  const violations = []
  for (const token of [...resolved].sort(byName)) {
    if (token.startsWith('--reka-')) continue // Declared by the library at runtime.
    if (!declared.has(token)) {
      violations.push(`app/styles/tokens.css: ${token} is used but declared nowhere`)
    }
  }
  for (const [token, file] of [...declared].sort(([left], [right]) => byName(left, right))) {
    if (file === 'app/styles/tokens.css' && !resolved.has(token) && !named.has(token)) {
      violations.push(`${file}: ${token} is declared but never used`)
    }
  }
  violations.push(...scanTierBoundary(sources, palette))
  return violations
}

/**
 * The primitive tier stays inside the palette.
 *
 * Two tiers are only two tiers while nothing outside `tokens.css` names the
 * lower one. A component that reaches for `--color-gray-900` has pinned itself to a
 * step rather than to a meaning, and the next palette move goes around it — the
 * exact failure the tier split exists to end, back when the raised chrome and
 * the canvas were the same `#181818` written twice with no way to move one.
 *
 * A color primitive is one the palette declares with a literal value, which is
 * how this tells them from the size scales: `--font-size-*`, `--space-*`,
 * `--radius-*` and `--line-height-*` are primitives too and are named directly
 * on
 * purpose, so the rule reads the value rather than the name.
 */
function scanTierBoundary(sources, palette) {
  const primitives = new Set()
  for (const [, name, value] of palette.source.matchAll(/^\s*(--[a-z][\w-]*)\s*:\s*([^;]+);/gm)) {
    if (/^(?:#[0-9a-f]{3,8}|rgb\()/i.test(value.trim())) primitives.add(name)
  }
  const violations = []
  for (const { file, source } of sources) {
    if (file === palette.file) continue
    const reached = new Set()
    for (const [, name] of source.matchAll(/var\(\s*(--[a-z][\w-]*)/gi)) {
      if (primitives.has(name)) reached.add(name)
    }
    for (const name of [...reached].sort((left, right) => left.localeCompare(right))) {
      violations.push(`${file}: ${name} is a palette primitive; name the semantic token for it`)
    }
  }
  return violations
}

/**
 * The line budget: separation is tone and air, and a drawn border is an earned
 * exception with a named owner.
 *
 * The review that forced this counted 151 one-pixel lines across 42 files —
 * every control outlined, every panel boxed, boxes inside boxes — which is the
 * signature the owner's designer called out: color and fill differentiate, a
 * border on everything is what a generator does. Refactoring UI names the
 * remedy (fewer borders — tone, shadow or space instead), and Radix, Primer
 * and Material each reserve lines for the same few roles. Those roles are what
 * this ledger admits:
 *
 *   divider — a hairline between rows or sections that share one ground
 *             (`--color-rule`/`--color-rule`), never beside a tone change;
 *   field   — the interactive edge of a place to type
 *             (`--color-rule-strong`/`--color-rule-strong`);
 *   overlay — the hairline keeping a floating surface from melting into what
 *             it covers, lighter than both grounds;
 *   status  — a 2-3px edge or an indicator in a color that carries real state.
 *
 * The ledger is exact on purpose: a file that draws one more line than its
 * entry fails, and one that draws fewer fails too, so an entry stays a record
 * of the interface rather than a ceiling to grow into. Change the interface,
 * then change the ledger in the same commit, naming the role the line plays.
 */
/* `--color-graph-line` is a legend glyph: the border there is not separation, it is
   the drawing itself — a sample of the edge stroke beside its label. */
