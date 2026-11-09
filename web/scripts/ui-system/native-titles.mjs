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
 * `v-tooltip.detail` (with a side, `v-tooltip:right.clipped`), and a render function gives the
 * kind as the directive's modifiers, `[vTooltip, text, side, { name: true }]`.
 *
 * A detail is what a hint may misuse: words the element shows, said again. So a detail is
 * registered below by file, tag and directive as written, with the reason its words are not
 * on the screen; a registered one that is gone is refused too.
 */

/** `file <tag> v-tooltip.detail="…"` or `file script [vTooltip, …]` → what it says that the screen does not. */
export const DETAIL_TOOLTIPS = new Map([
  [
    'entities/work-item/components/drawMarks.ts script [vTooltip, hint.text, undefined, { detail: true }]',
    'what a priority means; no surface prints it, and beside a glyph alone it says the priority too',
  ],
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
    `pages/planning/PlanningGrouping.vue <ToggleChip> v-tooltip.detail="t('workItem.lanes.groupingLabel')"`,
    'what the chip does to the board; its word only names the grouping',
  ],
  [
    'shared/ui/ChoiceSelect.vue <strong> v-tooltip.detail="{ text: selected?.title, words: selected?.label }"',
    'the chosen option’s hint, which no row of the field draws; while its own words are cut, they come first, whole',
  ],
  [
    'shared/ui/ChoiceSelect.vue <SelectItem> v-tooltip.detail="option.title"',
    'an option’s hint, which its row does not draw',
  ],
  [
    'shared/ui/OptionGroups.vue <div> v-tooltip.detail="entry.option.title"',
    'what a choice lets through, which its one word does not say',
  ],
  [
    'shared/ui/OverlayResizer.vue <div> v-tooltip.detail="folded?.state"',
    'that a folded edge holds a pane and how to bring it back; the edge is a line',
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
    `widgets/app-nav/components/AppNav.vue <button> v-tooltip:right.detail="t('navigation.home')"`,
    'where a press goes; the mark and the product’s name only say what it is',
  ],
  [
    'widgets/app-nav/components/NavConnectionButton.vue <button> v-tooltip:right.detail="hint"',
    'that a press refreshes now, and while the connection is lost what was lost',
  ],
  [
    'widgets/app-nav/components/NavWorkRow.vue <div> v-tooltip:right.detail="rowHint"',
    'why a muted row is muted, which no mark on it shows, under the row’s whole words while they are cut; else the whole row while its title is cut',
  ],
  [
    `widgets/app-nav/components/NavWorkTree.vue <span> v-tooltip:right.detail="{ text: t('liveWork.noProject'), words: entry.label }"`,
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
    'widgets/work-item-inspector/components/AgentsUsageSummary.vue <li> v-tooltip.detail="row.title"',
    'how a kind of tokens is counted, which the row’s figure does not say',
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
    'widgets/work-item-inspector/components/InspectorFacts.vue <span> v-tooltip.detail="holderTitle"',
    'the holder as it was written and its lease, where the card prints the shortened name',
  ],
  [
    'widgets/work-item-inspector/components/InspectorFacts.vue <span> v-tooltip.detail="follower.label"',
    'the follower as it was written, where the card prints the shortened name',
  ],
  [
    'widgets/work-item-inspector/components/UsageFacts.vue <span> v-tooltip.detail="fact.title"',
    'how a figure is counted, which the figure does not say',
  ],
])

const TOOLTIP_KINDS = new Set(['name', 'clipped', 'detail'])
/** A render function's directive: `[vTooltip, text, side, modifiers]`, nothing nested in it. */
const SCRIPT_TOOLTIP = /\[\s*vTooltip\s*,[^[\]]*\]/g
/** Its last element, the modifiers, naming one kind; a formatter may end either with a comma. */
const SCRIPT_KIND = /\{\s*(name|clipped|detail)\s*:\s*true\s*,?\s*\}\s*,?\s*\]$/

const modifierNames = (prop) => prop.modifiers.map((each) => each.content ?? each)

/** The hints one file gives, each with where it stands, how it is written and its kinds. */
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
          what: `${file} <${element.tag}> ${prop.loc.source}`,
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
  for (const entry of sources) {
    if (!/\.(?:ts|vue)$/.test(entry.file)) continue
    const descriptor = entry.file.endsWith('.vue')
      ? parse(entry.source, { filename: entry.file, sourceMap: false }).descriptor
      : null
    for (const hint of hintsOf(entry, descriptor)) {
      const where = `${entry.file}:${hint.line}: ${hint.what.slice(entry.file.length + 1)}`
      const fault = hintFault(hint, where, register)
      if (fault) violations.push(fault)
      else seen.add(hint.what)
    }
  }
  for (const what of register.keys())
    if (!seen.has(what)) violations.push(`${what}: registered as a detail, and gone`)
  return violations
}
