/**
 * A title is drawn through `v-slash-breaks`.
 *
 * A browser offers no break after a `/`, so a title such as `loading/empty/error/unavailable`
 * is one word to it and breaks wherever its line runs out: «un» above «available». The
 * directive (`shared/ui/slashBreaks.ts`) gives it a place to break after each `/`. A list of
 * the surfaces that use it is what the next surface skips: ten of the twelve the directive
 * was added to wrote the title straight into the template, as the next one most likely will.
 *
 * So a template may not write a title as text. A `{{ … }}` whose expression names `title`
 * (`{{ title }}`, `{{ item.title }}`, `{{ title(entry) }}`, `{{ `${item.title} ·` }}`),
 * outside the words of a quoted string, is refused unless the file registers it below with
 * what it is: a title held to one line that ends in an ellipsis breaks nowhere, and a heading
 * the interface writes itself is not a work item's title. An entry is one place, named by the
 * element it stands in: the pinned title and the heading of one drawer are two answers, so
 * they are `{{ title }} in p.drawer-frame-pinned-title` and `{{ title }} in h2.drawer-frame-name
 * > slot`, each with a reason of its own, and two that swap keep theirs. Only places alike in
 * both expression and element are told apart by their order, as `#2`. The element the directive
 * sits on holds no text of its own, so a title drawn through it is never seen here. A
 * registered interpolation that is gone is refused too, so the register says what the tree
 * holds.
 *
 * A title that reaches the template under another name is not seen here: an option's
 * `label` (`SearchCombobox`, which draws every option through the directive), a run of the
 * card's title (`InspectorTitle`) and a path in free text (`RichInlines`); the browser checks
 * in `production-title-surfaces.spec.ts` measure each of those. A dialog's context line
 * (`OverlayHeader`) holds a title on one line with an ellipsis.
 */

const TEMPLATE = /<template\b[^>]*>([\s\S]*)<\/template>/
const HTML_COMMENT = /<!--[\s\S]*?-->/g
/** An interpolation, or a tag read past its quoted attribute values. */
const PIECE = /\{\{([\s\S]*?)\}\}|<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
/** A `class` as written, not a bound `:class`. */
const STATIC_CLASS = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)')/
const VOID_ELEMENT = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'wbr'])
/** A quoted string from its opening quote. */
const QUOTED = /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/
const NAMES_TITLE = /(?<![\w$])title(?![\w$])/

const ONE_LINE = 'held to one line with an ellipsis, so it breaks nowhere'

/**
 * The interpolations that write a title as text and need not break after a `/`, by file and
 * expression as written, with why.
 */
export const UNBROKEN_TITLES = new Map([
  ['app/components/AppContextBar.vue {{ title }} in h1.module-title', "the module's name"],
  [
    'features/input-requests/components/RequestGroup.vue {{ title }} in span.request-group-title',
    "a review group's name",
  ],
  [
    'features/input-requests/components/RequestHeader.vue {{ request.title }} in SectionHeading.request-title',
    "a question's title",
  ],
  [
    'pages/planning/PlanningPortfolio.vue {{ project.title || project.project_id }} in strong.project-title',
    "a project's name",
  ],
  [
    'pages/planning/PlanningPortfolio.vue {{ space.title }} in span.space-name',
    "a planning space's name",
  ],
  [
    'pages/settings/components/SettingsGroup.vue {{ title }} in header.settings-group-head > SectionHeading',
    "a settings group's heading",
  ],
  [
    'shared/ui/BrandMark.vue {{ title }} in svg.brand-mark-svg > title',
    "the mark's SVG title, which is not drawn",
  ],
  ['shared/ui/DataEmptyState.vue {{ title }} in strong.empty-title', "an empty state's heading"],
  [
    'shared/ui/DrawerFrame.vue {{ title }} in p.drawer-frame-pinned-title',
    `the pinned title is ${ONE_LINE}`,
  ],
  [
    'shared/ui/DrawerFrame.vue {{ title }} in h2.drawer-frame-name > slot',
    "the heading's words where its slot is left empty, which no drawer does: the card, the one drawer, draws its title in the slot through the directive",
  ],
  [
    'shared/ui/MarkdownSuggestions.vue {{ row.title }} in span.markdown-suggestion-title',
    `a suggestion is ${ONE_LINE}`,
  ],
  [
    'shared/ui/OverlayHeader.vue {{ title }} in component.overlay-header-name',
    `an overlay's heading: the interface's words, or a document's name ${ONE_LINE}`,
  ],
  [
    'shared/ui/OverlayHost.vue {{ title }} in span.visually-hidden',
    "a pane's hidden name, which is not drawn",
  ],
  [
    'shared/ui/SectionHeader.vue {{ title }} in SectionHeading.section-header-title',
    "a section's heading",
  ],
  [
    'shared/ui/SidePanel.vue {{ title }} in h2.side-panel-title',
    `a side panel's heading: the interface's words, ${ONE_LINE}`,
  ],
  [
    'widgets/app-nav/components/NavWorkRow.vue {{ row.title }} in span.nav-row-title',
    `a row of the Work list is ${ONE_LINE}`,
  ],
  [
    'widgets/work-item-inspector/components/ChainMembers.vue {{ member.title }} in span.chain-row-title',
    `a chain's row is ${ONE_LINE}`,
  ],
  [
    'widgets/work-item-inspector/components/InspectorActivity.vue {{ title(entry) }} in span.entry-title',
    'what happened, in the history',
  ],
  [
    'widgets/work-item-inspector/components/InspectorOutcomeForm.vue {{ title }} in div.closing-head > SectionHeading',
    "a form's heading",
  ],
  [
    'widgets/work-item-inspector/components/InspectorRefusal.vue {{ notice.title }} in strong.refusal-title',
    "a refusal's heading",
  ],
  [
    'widgets/work-item-views/components/WorkItemLaneHead.vue {{ title }} in span.lane-title',
    `the epic's title over its lane is ${ONE_LINE}`,
  ],
])

const expressionOf = (body) => body.trim().replaceAll(/\s+/g, ' ')

/**
 * An expression with the words of its strings taken out: what a template literal puts in its
 * `${…}` is code again, and stays.
 */
function codeOf(expression, start = 0, substitution = false) {
  let code = ''
  let depth = 0
  let index = start
  while (index < expression.length) {
    const character = expression[index]
    if (character === "'" || character === '"') {
      const words = QUOTED.exec(expression.slice(index))?.[0] ?? expression.slice(index)
      code += "''"
      index += words.length
      continue
    }
    if (character === '`') {
      const literal = templateCode(expression, index)
      code += literal.code
      index = literal.end
      continue
    }
    if (character === '{') depth += 1
    else if (character === '}') {
      if (substitution && depth === 0) return { code, end: index }
      depth -= 1
    }
    code += character
    index += 1
  }
  return { code, end: index }
}

/** A template literal from its backtick: no words, and the code of each `${…}`. */
function templateCode(expression, start) {
  let code = "''"
  let index = start + 1
  while (index < expression.length && expression[index] !== '`') {
    if (expression.startsWith('${', index)) {
      const inner = codeOf(expression, index + 2, true)
      code += ` ${inner.code} `
      index = inner.end + 1
    } else index += expression[index] === '\\' ? 2 : 1
  }
  return { code, end: index + 1 }
}

/**
 * Where an interpolation stands: its element, and the elements around it out to the first with
 * a static class, as `h2.drawer-frame-name > slot`. That survives two places swapping, where a
 * count of an expression's occurrences handed each the other's reason.
 */
function anchorOf(open) {
  const path = []
  for (const element of open.toReversed()) {
    path.unshift(element.name)
    if (element.classed) break
  }
  return path.join(' > ')
}

/** Each `{{ … }}` of a template that names a title, by expression and the element it stands in. */
function titlesIn(source) {
  const template = TEMPLATE.exec(source)?.[1]?.replaceAll(HTML_COMMENT, '') ?? ''
  const open = []
  const places = []
  for (const [, body, closing, tag, attributes] of template.matchAll(PIECE)) {
    if (body !== undefined) {
      const expression = expressionOf(body)
      if (NAMES_TITLE.test(codeOf(expression).code)) places.push([expression, anchorOf(open)])
    } else if (closing) {
      const at = open.findLastIndex((element) => element.tag === tag)
      if (at !== -1) open.length = at
    } else if (!VOID_ELEMENT.has(tag.toLowerCase()) && !attributes.trimEnd().endsWith('/')) {
      const [, double, single] = STATIC_CLASS.exec(attributes) ?? []
      const classes = (double ?? single ?? '').split(/\s+/).filter(Boolean)
      open.push({ tag, name: [tag, ...classes].join('.'), classed: classes.length > 0 })
    }
  }
  const seen = new Map()
  return places.map(([expression, anchor]) => {
    const place = anchor ? `{{ ${expression} }} in ${anchor}` : `{{ ${expression} }}`
    const count = (seen.get(place) ?? 0) + 1
    seen.set(place, count)
    return count === 1 ? place : `${place} #${count}`
  })
}

export function scanTitleBreaks(sources, register = UNBROKEN_TITLES) {
  const violations = []
  const seen = new Set()
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue')) continue
    for (const place of titlesIn(source)) {
      const key = `${file} ${place}`
      seen.add(key)
      if (register.has(key)) continue
      violations.push(
        `${file}: writes ${place} as text; a title is one word to the browser across each '/', and breaks in the middle of one at a phone's width, so draw it with v-slash-breaks (shared/ui/slashBreaks.ts), or register it in title-breaks.mjs with why it need not break`,
      )
    }
  }
  for (const key of register.keys()) {
    if (!seen.has(key))
      violations.push(
        `title-breaks.mjs: registers ${key}, which the tree no longer writes; drop it`,
      )
  }
  return violations
}
