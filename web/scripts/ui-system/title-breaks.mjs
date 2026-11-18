/**
 * A work item's title is drawn through `v-work-item-title`, and any other title through
 * `v-slash-breaks`.
 *
 * A browser offers no break after a `/`, so a title such as `loading/empty/error/unavailable`
 * is one word to it and breaks wherever its line runs out: «un» above «available». The
 * directive (`shared/ui/slashBreaks.ts`) gives it a place to break after each `/`. A list of
 * the surfaces that use it is what the next surface skips: ten of the twelve the directive
 * was added to wrote the title straight into the template, as the next one most likely will.
 * A work item's title is drawn through `v-work-item-title` (`entities/work-item/components/
 * workItemTitle.ts`), which also sets the code it holds as code, on one line as on several; a
 * control that draws any text takes the title's runs from its host (`vTextRuns`).
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
 * Nor may a template draw a title through `v-slash-breaks` (`v-slash-breaks="item.title"`) unless
 * the file registers that place with why it is no work item's title. That directive breaks a title
 * after each `/` but draws its code as the backticks it was written with, so a surface that took
 * it for a work item's title drew that title past the one primitive, and nothing said so. One
 * register holds both kinds of place, each named by the element it stands in, the directive's
 * element included: `v-slash-breaks="title" in component.level-heading`. Text that is no title,
 * `v-slash-breaks="option.label"`, is not read.
 *
 * A title that reaches the template under another name is not seen here: an option's
 * `label` or runs (`SearchCombobox`, which draws every option through a directive), the card's
 * head (a title drawn into `DrawerFrame`'s title slot) and a path in free text (`RichInlines`);
 * the browser checks in `production-title-surfaces.spec.ts` and `production-title-code.spec.ts`
 * measure each of those. A dialog's context line (`OverlayHeader`) holds a title on one line
 * with an ellipsis.
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
/** The slash-break directive's value as written, in either quote. */
const SLASH_BREAKS = /(?:^|\s)v-slash-breaks\s*=\s*(?:"([^"]*)"|'([^']*)')/

const ONE_LINE = 'held to one line with an ellipsis, so it breaks nowhere'
const NOT_A_WORK_ITEM = "the interface's words, never a work item's title"

/**
 * The places that draw a title other than through `v-work-item-title`, by file and place, with
 * why: an interpolation that writes a title as text and need not break after a `/`, and a title
 * drawn through `v-slash-breaks` that is no work item's.
 */
export const OTHER_TITLES = new Map([
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
    'pages/analytics/components/PanelLevel.vue v-slash-breaks="title" in component.level-heading',
    `a level's heading while it takes the room of the others it takes in turn: ${NOT_A_WORK_ITEM}`,
  ],
  [
    'pages/analytics/components/PanelLevel.vue v-slash-breaks="title" in component.level-heading #2',
    `a level's heading: ${NOT_A_WORK_ITEM}`,
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
  [
    'shared/ui/CommandList.vue v-slash-breaks="item.title" in span.command-title',
    "a command's title its host gave no runs: a work item's title comes cut into runs, drawn through v-text-runs",
  ],
  ['shared/ui/DataEmptyState.vue {{ title }} in strong.empty-title', "an empty state's heading"],
  [
    'shared/ui/DrawerFrame.vue {{ title }} in p.drawer-frame-pinned-title.one-line > slot',
    `the pinned title's words where the title slot is left empty, ${ONE_LINE}: the card draws its title in the slot through the directive`,
  ],
  [
    'shared/ui/DrawerFrame.vue {{ title }} in h2.drawer-frame-name > slot',
    "the heading's words where its slot is left empty, which no drawer does: the card, the one drawer, draws its title in the slot through the directive",
  ],
  [
    'shared/ui/MarkdownSuggestions.vue {{ row.title }} in span.markdown-suggestion-title.one-line',
    `a file's path in a suggestion is ${ONE_LINE}; a task's title is drawn in its runs`,
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
    'shared/ui/SidePanel.vue {{ title }} in h2.side-panel-title.one-line',
    `a side panel's heading: the interface's words, ${ONE_LINE}`,
  ],
  [
    'widgets/app-nav/components/NavWorkLink.vue {{ title }} in span.nav-row-title.trimmed-word.one-line',
    `a session's row of the Work list is ${ONE_LINE}; an item's title is drawn through the directive`,
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

const namesTitle = (expression) => NAMES_TITLE.test(codeOf(expression).code)

/**
 * An element opened: a title its `v-slash-breaks` draws is a place, named by the element with
 * those around it, and the element stands open for what it holds unless it holds nothing.
 */
function openTag(tag, attributes, open, places) {
  const [, double, single] = STATIC_CLASS.exec(attributes) ?? []
  const classes = (double ?? single ?? '').split(/\s+/).filter(Boolean)
  const element = { tag, name: [tag, ...classes].join('.'), classed: classes.length > 0 }
  const [, slashed, slashedSingle] = SLASH_BREAKS.exec(attributes) ?? []
  const expression = expressionOf(slashed ?? slashedSingle ?? '')
  if (expression && namesTitle(expression))
    places.push({
      text: false,
      written: `v-slash-breaks="${expression}"`,
      anchor: anchorOf([...open, element]),
    })
  if (!VOID_ELEMENT.has(tag.toLowerCase()) && !attributes.trimEnd().endsWith('/'))
    open.push(element)
}

/**
 * Each place of a template that draws a title other than through `v-work-item-title`: a `{{ … }}`
 * whose expression names one, and an element whose `v-slash-breaks` does, by what is written and
 * the element it stands in.
 */
function titlesIn(source) {
  const template = TEMPLATE.exec(source)?.[1]?.replaceAll(HTML_COMMENT, '') ?? ''
  const open = []
  const places = []
  for (const [, body, closing, tag, attributes] of template.matchAll(PIECE)) {
    if (body !== undefined) {
      const expression = expressionOf(body)
      if (namesTitle(expression))
        places.push({ text: true, written: `{{ ${expression} }}`, anchor: anchorOf(open) })
    } else if (closing) {
      const at = open.findLastIndex((element) => element.tag === tag)
      if (at !== -1) open.length = at
    } else openTag(tag, attributes, open, places)
  }
  const seen = new Map()
  return places.map(({ text, written, anchor }) => {
    const place = anchor ? `${written} in ${anchor}` : written
    const count = (seen.get(place) ?? 0) + 1
    seen.set(place, count)
    return { text, place: count === 1 ? place : `${place} #${count}` }
  })
}

/** Where a work item's title is drawn, which every refusal names. */
const PRIMITIVE =
  "a work item's title is drawn through v-work-item-title (entities/work-item/components/workItemTitle.ts), which sets its code as code, or its runs through v-text-runs (shared/ui/textRuns.ts)"

export function scanTitleBreaks(sources, register = OTHER_TITLES) {
  const violations = []
  const seen = new Set()
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue')) continue
    for (const { text, place } of titlesIn(source)) {
      const key = `${file} ${place}`
      seen.add(key)
      if (register.has(key)) continue
      violations.push(
        text
          ? `${file}: writes ${place} as text; ${PRIMITIVE}, and any other title through v-slash-breaks (shared/ui/slashBreaks.ts), since a title is one word to the browser across each '/' and breaks in the middle of one at a phone's width; or register it in title-breaks.mjs with why it need not break`
          : `${file}: draws ${place}, which draws a work item's code as the backticks it was written with; ${PRIMITIVE}; or register it in title-breaks.mjs with why it is no work item's title`,
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
