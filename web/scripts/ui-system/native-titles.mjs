/**
 * A hint is the window's one tooltip (`v-tooltip`, `shared/ui/tooltipAnchors.ts`), never the
 * browser's `title`.
 *
 * The browser draws a `title` in its own font and colours, late, under the pointer alone and
 * never for a keyboard; the tooltip draws every hint in the product's words, on hover and on
 * focus. A hundred and twenty templates wrote `title` before the tooltip existed, so the next
 * template most likely will too.
 *
 * So a template may not give an element a `title`, written or bound. An element is an HTML or
 * SVG tag, or a component that declares no `title` prop: Vue passes the attribute through to the
 * component's root, where the browser shows it. A component's own `title` prop is its heading
 * and stays. A script may not set `title` either: `setAttribute('title', …)`, or `'title'` as a
 * key of the properties a render function gives an element. A slot's `title` is the slot's.
 *
 * A real exception is registered below by file, tag and attribute as written, with its reason;
 * a registered one that is gone is refused too, so the register says what the tree holds.
 */
import { compileScript, parse } from 'vue/compiler-sfc'

/** `file <tag> attribute` → why the browser's own tooltip is right there. */
export const NATIVE_TITLES = new Map()

const ELEMENT = 1
const IF = 9
const ELEMENT_TAG = 0
const COMPONENT_TAG = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

const COMPONENT_IMPORT = /import\s+(\w+)\s+from\s+['"]([^'"]+\.vue)['"]/g
const SCRIPT_TITLE = /setAttribute\(\s*['"]title['"]|(?<![\w$])['"]title['"]\s*:/g
/** A prop named `title` in a script the compiler could not read. */
const DECLARED_TITLE = /(?<![\w$.])title\??\s*:/

function titleOf(prop) {
  if (prop.type === ATTRIBUTE && prop.name === 'title') return prop
  const bound =
    prop.type === DIRECTIVE && prop.name === 'bind' && prop.arg?.isStatic && prop.arg.content
  return bound === 'title' ? prop : null
}

function* elementsOf(node) {
  if (node.type === ELEMENT) yield node
  for (const child of node.children ?? []) yield* elementsOf(child)
  for (const branch of node.type === IF ? node.branches : []) yield* elementsOf(branch)
}

/** Where an import of a component points, as a path below the source root. */
function resolved(file, path) {
  if (path.startsWith('@/')) return path.slice(2)
  if (!path.startsWith('.')) return null
  const parts = file.split('/').slice(0, -1)
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** Whether a component declares a `title` prop, read as the compiler reads its props. */
function declaresTitle(descriptor) {
  try {
    return compileScript(descriptor, { id: descriptor.filename }).bindings?.title === 'props'
  } catch {
    // Props typed from another file: the declaration is read as written.
    const script = `${descriptor.script?.content ?? ''}${descriptor.scriptSetup?.content ?? ''}`
    return /defineProps/.test(script) && DECLARED_TITLE.test(script)
  }
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length

/** The titles a script gives an element, each as the place it stands and what it says. */
function* scriptTitles(file, scripts) {
  for (const script of scripts)
    for (const match of script.content.matchAll(SCRIPT_TITLE))
      yield {
        line: script.loc.start.line + lineOf(script.content, match.index) - 1,
        what: `${file} script ${match[0]}`,
      }
}

/** The titles a template gives an element, or a component whose root takes them. */
function* templateTitles(file, descriptor, scripts, takesTitle) {
  const imports = new Map(
    scripts.flatMap(({ content }) =>
      [...content.matchAll(COMPONENT_IMPORT)].map(([, name, path]) => [name, resolved(file, path)]),
    ),
  )
  for (const element of elementsOf(descriptor.template.ast)) {
    const title = element.props.find((prop) => titleOf(prop))
    if (!title || ![COMPONENT_TAG, ELEMENT_TAG].includes(element.tagType)) continue
    const target = element.tagType === COMPONENT_TAG ? imports.get(element.tag) : null
    if (target && takesTitle(target)) continue
    yield { line: title.loc.start.line, what: `${file} <${element.tag}> ${title.loc.source}` }
  }
}

/** The components of the tree, and whether each declares a `title` prop, read once. */
function componentsOf(sources) {
  const descriptors = new Map()
  for (const { file, source } of sources)
    if (file.endsWith('.vue'))
      descriptors.set(file, parse(source, { filename: file, sourceMap: false }).descriptor)
  const titled = new Map()
  const takesTitle = (file) => {
    if (!descriptors.has(file)) return false
    if (!titled.has(file)) titled.set(file, declaresTitle(descriptors.get(file)))
    return titled.get(file)
  }
  return { descriptors, takesTitle }
}

/** Every title one file gives an element, in its scripts and its template. */
function titlesOf({ file, source }, { descriptors, takesTitle }) {
  const descriptor = descriptors.get(file)
  const scripts = descriptor
    ? [descriptor.script, descriptor.scriptSetup].filter(Boolean)
    : [{ content: source, loc: { start: { line: 1 } } }]
  const found = [...scriptTitles(file, scripts)]
  if (descriptor?.template?.ast)
    found.push(...templateTitles(file, descriptor, scripts, takesTitle))
  return found
}

export function scanNativeTitles(sources, register = NATIVE_TITLES) {
  const components = componentsOf(sources)
  const violations = []
  const seen = new Set()
  for (const entry of sources) {
    if (!/\.(?:ts|vue)$/.test(entry.file)) continue
    for (const { line, what } of titlesOf(entry, components))
      if (register.has(what)) seen.add(what)
      else
        violations.push(
          `${entry.file}:${line}: ${what.slice(entry.file.length + 1)} gives the browser's own tooltip; write v-tooltip (shared/ui/tooltipAnchors.ts), which every hint shares`,
        )
  }
  for (const what of register.keys())
    if (!seen.has(what)) violations.push(`${what}: registered as a native title, and gone`)
  return violations
}

/*
 * Every hint states its kind, and a detail is registered.
 *
 * A hint is one of three things (`tooltipAnchors.ts`): the `name` of a control that shows no
 * words, the whole text of a `clipped` element while it is cut, or a `detail` the screen does
 * not say. The directive's default once was "show always", and the hint is far easier to see
 * than the browser's `title` it replaced, so ninety hints that had been all but invisible
 * stood over the board at every pass of the pointer: a tile's title over the tile, a label's
 * «Filter: label x» over the label, five lines over a holder's name. The kind is what makes
 * the next one a choice: a template writes `v-tooltip.name`, `v-tooltip.clipped` or
 * `v-tooltip.detail`, and a render function gives the kind as the directive's modifiers,
 * `[vTooltip, text, undefined, { name: true }]`.
 *
 * A detail is what a hint may misuse: words the element shows, said again. So a detail is
 * registered below by file, tag and directive as written, with the reason its words are not
 * on the screen; a registered one that is gone is refused too.
 */

/** `file <tag> v-tooltip.detail="…"` or `file script [vTooltip, …]` → what it says that the screen does not. */
export const DETAIL_TOOLTIPS = new Map([
  [
    `entities/work-item/components/WorkItemCopyButtons.vue <button> v-tooltip.detail="t('workItem.head.copyReferenceHint')"`,
    'that a press copies the number, which reads as a number and not as a control',
  ],
  [
    `features/input-requests/components/RequestNavigator.vue <VButton> v-tooltip.detail="t('requests.hub.toAnswer')"`,
    'where a press on the count goes: to the answer of the question it counts',
  ],
  [
    'features/session-open/ExecutorLink.vue <span> v-tooltip.detail="whole"',
    'the holder as it was written, where the line shortens its session to the start',
  ],
  [
    'features/session-open/OpenAction.vue <VButton> v-tooltip.detail="{ ...tooltip, words: name }"',
    'what a press does and, under it, the state the session is in; the button shows the holder; while its own words are cut, they come first, whole',
  ],
  [
    'pages/analytics/components/AnalyticsBar.vue <p> v-tooltip.detail="freshHint"',
    'the moment of the newest record and, for a live period, how often it reads itself again, where the bar shows only the age and the live mark',
  ],
  [
    `pages/analytics/components/RefreshFailed.vue <VButton> v-tooltip.detail="t('platform.actions.retry')"`,
    "what a press on a failure's words does, where a line short of room gave up the retry's own word",
  ],
  [
    'pages/analytics/components/RailTile.vue <span> v-tooltip.detail="{ text: leadDetail, words: lead }"',
    'the whole id of the first value a tile names by the start of it, an account; while the name is cut, it comes first, whole',
  ],
  [
    'pages/analytics/components/RailTile.vue <WindowBar> v-tooltip.detail="tile.meter.label"',
    'where steady use from the window start would stand now, which a quota tile draws only as a tick on its bar, with the share and the state the tile says',
  ],
  [
    'pages/analytics/components/QuotaAccount.vue <span> v-tooltip.detail="{ text: detail, words: name }"',
    'the whole id of the account and of its organization, where the quota panel names the account by the name its owner gave it or the start of its id; while the name is cut, it comes first, whole',
  ],
  [
    'pages/analytics/components/SpendingTable.vue <button> v-tooltip.detail="{ text: column.detail, words: column.text }"',
    "what a crossed column's heading names by a name alone: the client and the start of a session's id, an account's whole id; while the heading is cut, it comes first, whole",
  ],
  [
    'pages/analytics/components/RailTile.vue <MiniShareBar> v-tooltip.detail="tile.shares.label"',
    'every part of the share bar with its share, work on no value and the rest among them, where the tile says only the first',
  ],
  [
    'pages/analytics/components/SpendingTiles.vue <span> v-tooltip.detail="tileOf(option.value)?.rate"',
    'that the figure per hour is of an hour of agent time, and of the cost that it is an estimate at API prices, where the line says only «/h»; while its own words are cut, they come first, whole',
  ],
  [
    'pages/analytics/components/SpendingTableHead.vue <p> v-tooltip.detail="{ text: summary, words: counts }"',
    'the whole account of the rows, work on no value by name among them, and the column and way they are sorted, where the line says only how many values spent in the period and before it; while its own words are cut, they come first, whole',
  ],
  [
    `pages/settings/components/SettingsAlerts.vue <ToggleSwitch> v-tooltip.detail="t('alerts.enabledDetail')"`,
    'that a notification comes with the window closed too, and that a click on it opens the card; it stood as a paragraph over the group',
  ],
  [
    `pages/settings/components/SettingsKindColors.vue <input> v-tooltip.detail="t('settings.kindColors.kept')"`,
    'where a chosen colour is kept, which the swatch does not say; it stood as a paragraph over the group',
  ],
  [
    `pages/settings/components/SettingsAccounts.vue <VTextInput> v-tooltip.detail="t('settings.accountAliases.kept')"`,
    'where an account name is said and where it is kept, which the field does not say',
  ],
  [
    `pages/settings/components/SettingsOpening.vue <small> v-tooltip.detail="t('open.settings.lastPlaceHint')"`,
    'which place «the place» is, the last one a session was open in; it stood as a paragraph over the group',
  ],
  [
    'shared/ui/ChoiceSelect.vue <strong> v-tooltip.detail="{ text: selected?.title, words: selected?.label }"',
    'the chosen option’s hint, which no row of the field draws; while its own words are cut, they come first, whole',
  ],
  [
    'shared/ui/ChoiceSelect.vue <SelectItem> v-tooltip.detail="{ text: option.title, words: option.label }"',
    'an option’s hint, which its row does not draw; while the option’s words are cut, whatever the host draws them with, they come first, whole',
  ],
  [
    'shared/ui/OptionGroups.vue <div> v-tooltip.detail="entry.option.title"',
    'what a choice lets through, which its one word does not say',
  ],
  [
    'shared/ui/OverlayResizer.vue <div> v-tooltip.detail="{ text: folded?.state, words: folded?.name }"',
    'that a folded edge holds a pane and how to bring it back; the edge is a line; while the pane’s name on it is cut, the name comes first, whole',
  ],
  [
    'shared/ui/ChartLegend.vue <component> v-tooltip.detail="hintOf(one.key)"',
    'a legend entry prints its series’ name; its figure over the span and its share are on no mark',
  ],
  [
    `shared/ui/ChartLegend.vue <span> v-tooltip.detail="hintOf('outline')"`,
    'the entry names the mark of the period compared with; that period’s sum is on no mark',
  ],
  [
    'shared/ui/PeriodColumns.vue <component> v-tooltip.detail="periodHint(one, $props)"',
    'a period prints nothing of itself, and its segments are blocks of hue that speak through it: its sum against the period before, what changed and its series with their shares are its hint',
  ],
  [
    'shared/ui/RankedBars.vue <component> v-tooltip.detail="namedHint(row, whole, formatShare)"',
    'a row prints its name and figure; its share of the whole and the whole id of a value it names by the start are on no mark; while the name is cut, it comes first, whole',
  ],
  [
    'shared/ui/SmallMultiples.vue <component> v-tooltip.detail="nameHint(one)"',
    'a small chart prints its name and figure; its share of the whole is on no mark; while the name is cut, it comes first, whole',
  ],
  [
    'shared/ui/SmallMultiples.vue <span> v-tooltip.detail="periodHint(one, index)"',
    'a small chart’s column has no name or figure on the screen: its period and figure are its hint',
  ],
  [
    'shared/ui/StepLine.vue <span> v-tooltip.detail="point.text"',
    'a reading is a dot on a line: its moment, its share and its source are its hint',
  ],
  [
    'shared/ui/RichInlines.vue <a> v-tooltip.detail="hoverTitle(node.reference)"',
    'what a press on a link does, and the whole value a link shows the start of',
  ],
  [
    'shared/ui/SessionStart.vue <span> v-tooltip.detail="session"',
    'the whole session id, of which the line prints the start',
  ],
  [
    `widgets/app-nav/components/AppNav.vue <button> v-tooltip.detail="t('navigation.home')"`,
    'where a press goes; the mark and the product’s name only say what it is',
  ],
  [
    'widgets/app-nav/components/NavConnectionButton.vue <button> v-tooltip.detail="{ text: hint, words: status }"',
    'that a press refreshes now, and while the connection is lost what was lost; while its own words are cut, they come first, whole',
  ],
  [
    'widgets/app-nav/components/NavWorkRow.vue <div> v-tooltip.detail="rowHint"',
    'the state with how long on a one-line row, which the row does not draw, and a session’s folder its one line leaves out; a two-line row draws both, so it has none, and a cut title has its own hint',
  ],
  [
    `widgets/app-nav/components/NavWorkTree.vue <span> v-tooltip.detail="{ text: t('liveWork.noProject'), words: entry.label }"`,
    'why the space’s name is no link: no project holds it; while its own words are cut, they come first, whole',
  ],
  [
    'widgets/document-viewer/components/DocumentViewer.vue <button> v-tooltip.detail="{ text: copyHint, words: path }"',
    'that a press copies the path; while its own words are cut, they come first, whole',
  ],
  [
    `widgets/work-item-graph/components/GraphNodeCard.vue <span> v-tooltip.detail="{ text: t('workItem.parent'), words: parentReference }"`,
    'what the reference beside the number is: the item’s epic; while its own words are cut, they come first, whole',
  ],
  [
    'widgets/work-item-inspector/components/ChainBranchMap.vue <button> v-tooltip.detail="lane.lane.title"',
    'the title of the item a lane branches from; the lane is named by its reference',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <span> v-tooltip.detail="group.session"',
    'the whole session id, of which the group prints the start',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <RichText> v-tooltip.detail="hint"',
    'the exact count of an ambiguous row, which the group’s line does not repeat',
  ],
  // Both rows of an agent with no label, named by its type or by the start of its id.
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <span> v-tooltip.detail="hint"',
    'the exact count of an ambiguous row, which the group’s line does not repeat',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <time> v-tooltip.detail="facts.started.full"',
    'the whole date and time, of which the row prints the part that tells runs apart',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <time> v-tooltip.detail="facts.ended.full"',
    'the whole date and time, of which the row prints the part that tells runs apart',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <time> v-tooltip.detail="facts.activity.full"',
    'the whole date and time, of which the row prints the part that tells runs apart',
  ],
  [
    'widgets/work-item-inspector/components/InspectorAgents.vue <span> v-tooltip.detail="agent.agent_id"',
    'the whole agent id, of which the row prints the start',
  ],
  [
    'widgets/work-item-inspector/components/InspectorFacts.vue <span> v-tooltip.detail="holderHint"',
    "the holder's whole session id, where the card prints its start, and the lease behind the claim; the name only while it is cut",
  ],
  [
    'widgets/work-item-inspector/components/InspectorFacts.vue <span> v-tooltip.detail="nameHint(follower.label)"',
    "the follower's whole session id, where the card prints its start; never the name the card prints",
  ],
  [
    'widgets/work-item-inspector/components/UsageAccounts.vue <span> v-tooltip.detail="row.full"',
    'the whole organization id, of which the row prints the start',
  ],
  [
    'widgets/work-item-inspector/components/UsageFacts.vue <span> v-tooltip.detail="fact.title"',
    'how a figure is counted, which the figure does not say',
  ],
])

const TOOLTIP_KINDS = new Set(['name', 'clipped', 'detail'])
/** A render function's directive: `[vTooltip, text, argument, modifiers]`, nothing nested in it. */
const SCRIPT_TOOLTIP = /\[\s*vTooltip\s*,[^[\]]*\]/g
/** Its last element, the modifiers, naming one kind; a formatter may end either with a comma. */
const SCRIPT_KIND = /\{\s*(name|clipped|detail)\s*:\s*true\s*,?\s*\}\s*,?\s*\]$/

const modifierNames = (prop) => prop.modifiers.map((each) => each.content ?? each)

/** A key of a hint's value that would say where it stands, written out or shorthand. */
const VALUE_SIDE = /[{,]\s*(side|align|placement)\s*[:,}]/

/** The elements of a render function's directive, split at its own commas only. */
function tupleParts(tuple) {
  const parts = ['']
  let depth = 0
  let quote = ''
  for (const char of tuple.slice(1, -1)) {
    if (quote) quote = char === quote ? '' : quote
    else if (`'"\``.includes(char)) quote = char
    else if ('({'.includes(char)) depth += 1
    else if (')}'.includes(char)) depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push('')
      continue
    }
    parts[parts.length - 1] += char
  }
  return parts.map((part) => part.trim())
}

/** The side a render function's directive states, its third element, unless it is left out. */
function scriptSide(tuple) {
  const side = tupleParts(tuple)[2] ?? ''
  return side && side !== 'undefined' ? side : null
}

/** The side a template's directive states: its argument, or a key of its value. */
function templateSide(prop) {
  if (prop.arg) return prop.arg.isStatic === false ? `[${prop.arg.content}]` : prop.arg.content
  return VALUE_SIDE.exec(prop.exp?.content ?? '')?.[1] ?? null
}

/** The hints one file gives, each with where it stands, how it is written, its kinds and side. */
function* hintsOf({ file, source }, descriptor) {
  const scripts = descriptor
    ? [descriptor.script, descriptor.scriptSetup].filter(Boolean)
    : [{ content: source, loc: { start: { line: 1 } } }]
  for (const script of scripts)
    for (const match of script.content.matchAll(SCRIPT_TOOLTIP)) {
      const kind = SCRIPT_KIND.exec(match[0])?.[1]
      yield {
        kinds: kind ? [kind] : [],
        line: script.loc.start.line + lineOf(script.content, match.index) - 1,
        side: scriptSide(match[0]),
        what: `${file} script ${match[0].replaceAll(/\s+/g, ' ')}`,
      }
    }
  if (!descriptor?.template?.ast) return
  for (const element of elementsOf(descriptor.template.ast))
    for (const prop of element.props)
      if (prop.type === DIRECTIVE && prop.name === 'tooltip')
        yield {
          kinds: modifierNames(prop).filter((name) => TOOLTIP_KINDS.has(name)),
          line: prop.loc.start.line,
          side: templateSide(prop),
          what: `${file} <${element.tag}> ${prop.loc.source}`,
        }
}

/** The hints of a tree, each with the place it is reported at. */
function* treeHints(sources) {
  for (const entry of sources) {
    if (!/\.(?:ts|vue)$/.test(entry.file)) continue
    const descriptor = entry.file.endsWith('.vue')
      ? parse(entry.source, { filename: entry.file, sourceMap: false }).descriptor
      : null
    for (const hint of hintsOf(entry, descriptor))
      yield {
        ...hint,
        where: `${entry.file}:${hint.line}: ${hint.what.slice(entry.file.length + 1)}`,
      }
  }
}

/** What is wrong with one hint, if anything: its kinds, or a detail nobody registered. */
function hintFault({ kinds, what }, where, register) {
  if (kinds.length !== 1)
    return `${where} states ${kinds.length ? 'more than one kind' : 'no kind'}; a hint is one of name, clipped or detail (shared/ui/tooltipAnchors.ts)`
  if (kinds[0] !== 'detail' || register.has(what)) return null
  return `${where} is a detail nobody registered; register it in DETAIL_TOOLTIPS with what it says that the screen does not, or make it a name or clipped`
}

export function scanTooltipKinds(sources, register = DETAIL_TOOLTIPS) {
  const violations = []
  const seen = new Set()
  for (const hint of treeHints(sources)) {
    const fault = hintFault(hint, hint.where, register)
    if (fault) violations.push(fault)
    else seen.add(hint.what)
  }
  for (const what of register.keys())
    if (!seen.has(what)) violations.push(`${what}: registered as a detail, and gone`)
  return violations
}

/*
 * No hint states where it stands.
 *
 * A hint stands where its kind and the list its element stands in put it
 * (`shared/ui/hintPlacement.ts`), and a list declares itself once on its container, as
 * `data-hint-list`. A side written at each call site drifted: the rail's hints asked for the right
 * one by one, and a name added there without it stood above its icon, over the row before. So a
 * template's `v-tooltip` takes no argument, written or bound, and no key of its value says a side,
 * an alignment or a placement; a render function's directive leaves its third element out or
 * `undefined`. A real exception is registered below by file, tag and directive as written, with
 * its reason, and keeps its side; a registered one that is gone is refused too.
 */

/** `file <tag> v-tooltip:side.kind="…"` or `file script [vTooltip, …]` → why its kind cannot place it. */
export const SIDED_TOOLTIPS = new Map()

export function scanTooltipSides(sources, register = SIDED_TOOLTIPS) {
  const violations = []
  const seen = new Set()
  for (const hint of treeHints(sources)) {
    if (!hint.side) continue
    if (register.has(hint.what)) seen.add(hint.what)
    else
      violations.push(
        `${hint.where} states where it stands (${hint.side}); a hint stands where its kind and its list put it (shared/ui/hintPlacement.ts): drop it, declare the list on its container (data-hint-list), or register a real exception in SIDED_TOOLTIPS with its reason`,
      )
  }
  for (const what of register.keys())
    if (!seen.has(what)) violations.push(`${what}: registered as a sided hint, and gone`)
  return violations
}
