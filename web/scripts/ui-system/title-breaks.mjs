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
 * (`{{ title }}`, `{{ item.title }}`, `{{ title(entry) }}`), outside a quoted string, is
 * refused unless the file registers it below with what it is: a title held to one line that
 * ends in an ellipsis breaks nowhere, and a heading the interface writes itself is not a
 * work item's title. The element the directive sits on holds no text of its own, so a
 * title drawn through it is never seen here. A registered interpolation that is gone is
 * refused too, so the register says what the tree holds.
 *
 * A title that reaches the template under another name is not seen here: an option's
 * `label` (`SearchCombobox`, which draws every option through the directive), a run of the
 * card's title (`InspectorTitle`) and a path in free text (`RichInlines`); the browser checks
 * in `production-title-surfaces.spec.ts` measure each of those. A dialog's context line
 * (`OverlayHeader`) holds a title on one line with an ellipsis.
 */

const TEMPLATE = /<template\b[^>]*>([\s\S]*)<\/template>/
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const INTERPOLATION = /\{\{([\s\S]*?)\}\}/g
const QUOTED = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g
const NAMES_TITLE = /(?<![\w$])title(?![\w$])/

const ONE_LINE = 'held to one line with an ellipsis, so it breaks nowhere'

/**
 * The interpolations that write a title as text and need not break after a `/`, by file and
 * expression as written, with why.
 */
export const UNBROKEN_TITLES = new Map([
  ['app/components/AppContextBar.vue {{ title }}', "the module's name"],
  ['features/input-requests/components/RequestGroup.vue {{ title }}', "a review group's name"],
  [
    'features/input-requests/components/RequestHeader.vue {{ request.title }}',
    "a question's title",
  ],
  [
    'pages/planning/PlanningPortfolio.vue {{ project.title || project.project_id }}',
    "a project's name",
  ],
  ['pages/planning/PlanningPortfolio.vue {{ space.title }}', "a planning space's name"],
  ['pages/settings/components/SettingsGroup.vue {{ title }}', "a settings group's heading"],
  ['shared/ui/BrandMark.vue {{ title }}', "the mark's SVG title, which is not drawn"],
  ['shared/ui/DataEmptyState.vue {{ title }}', "an empty state's heading"],
  [
    'shared/ui/DrawerFrame.vue {{ title }}',
    `the pinned title is ${ONE_LINE}; the heading's text is its slot's, where the card draws its title through the directive`,
  ],
  ['shared/ui/MarkdownSuggestions.vue {{ row.title }}', `a suggestion is ${ONE_LINE}`],
  [
    'shared/ui/OverlayHeader.vue {{ title }}',
    `an overlay's heading: the interface's words, or a document's name ${ONE_LINE}`,
  ],
  ['shared/ui/OverlayHost.vue {{ title }}', "a pane's hidden name, which is not drawn"],
  ['shared/ui/SectionHeader.vue {{ title }}', "a section's heading"],
  [
    'shared/ui/SidePanel.vue {{ title }}',
    `a side panel's heading: the interface's words, ${ONE_LINE}`,
  ],
  [
    'widgets/app-nav/components/NavWorkRow.vue {{ row.title }}',
    `a row of the Work list is ${ONE_LINE}`,
  ],
  [
    'widgets/work-item-inspector/components/ChainMembers.vue {{ member.title }}',
    `a chain's row is ${ONE_LINE}`,
  ],
  [
    'widgets/work-item-inspector/components/InspectorActivity.vue {{ title(entry) }}',
    'what happened, in the history',
  ],
  [
    'widgets/work-item-inspector/components/InspectorOutcomeForm.vue {{ title }}',
    "a form's heading",
  ],
  [
    'widgets/work-item-inspector/components/InspectorRefusal.vue {{ notice.title }}',
    "a refusal's heading",
  ],
  ['widgets/work-item-views/components/WorkItemLaneHead.vue {{ title }}', "a lane's state"],
])

const expressionOf = (body) => body.trim().replaceAll(/\s+/g, ' ')

/** Each `{{ … }}` of a template that names a title, as written. */
function titlesIn(source) {
  const template = TEMPLATE.exec(source)?.[1]?.replaceAll(HTML_COMMENT, '') ?? ''
  return [...template.matchAll(INTERPOLATION)]
    .map((match) => expressionOf(match[1]))
    .filter((expression) => NAMES_TITLE.test(expression.replaceAll(QUOTED, "''")))
}

export function scanTitleBreaks(sources, register = UNBROKEN_TITLES) {
  const violations = []
  const seen = new Set()
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue')) continue
    for (const expression of titlesIn(source)) {
      const key = `${file} {{ ${expression} }}`
      seen.add(key)
      if (register.has(key)) continue
      violations.push(
        `${file}: writes {{ ${expression} }} as text; a title is one word to the browser across each '/', and breaks in the middle of one at a phone's width, so draw it with v-slash-breaks (shared/ui/slashBreaks.ts), or register it in title-breaks.mjs with why it need not break`,
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
