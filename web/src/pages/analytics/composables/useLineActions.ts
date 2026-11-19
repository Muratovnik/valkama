/**
 * What pressing a value of a breakdown does on the Analytics page, wherever it stands — a bar, a
 * sector, a segment of a period, a legend entry, a small chart's name, a row of a chart's table, a
 * row of the table beside the period before: it opens the value's side panel over the page
 * (`AnalyticsDetail`), sent out as `inspect` with the value's filter, and the page stays as it was.
 * The charts are told it through `useLineMarks`, which gives each value's mark what it does and
 * answers the press its mark sends out.
 *
 * - A value opens its panel where the read can filter by it: a value with an id — a task, a
 *   deleted task too — or work with no task, or a session's own run, which the read admits by
 *   `none`. The folded tail and unknown work open nothing.
 * - A task's value is a link to its card as well, opened the way a reference to it opens anywhere
 *   in the app (`useReferenceLinks`): a plain press opens the panel, which offers the card; a
 *   press with a modifier or the middle button is the browser's, a new tab or window on the card,
 *   as for any link. The desktop app has no tabs, so there such a press opens the card in place.
 *
 * Every opening of a task's card from the page is counted once, as `task_open`, a press the
 * browser takes to another tab included; opening a value's panel is no opening of a card, and a
 * count that cannot be written costs nothing.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

import type { UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'
import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { opensInPlace } from '@/shared/lib/linkPress.ts'
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'
import type { MarkAction } from '@/shared/ui/chartGeometry.ts'

/** The dimensions whose «none» the read admits as work with no value there. */
const NONE_ADMITTED: ReadonlySet<UsageDimension> = new Set(['work_item', 'launch_class'])

/**
 * The filter value a value's panel is read with, and the page's filter takes from it; undefined
 * for a value that opens nothing.
 */
function inspectsTo(by: UsageDimension, value: UsageGroupValue | null): string | null | undefined {
  if (!value) return undefined
  const kind = valueKind(value)
  if (kind === 'category') return value.id
  return kind === 'none' && NONE_ADMITTED.has(by) ? null : undefined
}

/** A press with the primary button and no modifier: the page's to answer, in a browser too. */
const plainPress = (event: MouseEvent) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)

/**
 * A press on a task's link: a plain one opens the value's panel (`inspect`); any other is the
 * browser's, a new tab on the card, or in the desktop app the card in place, and is counted.
 */
function follow(link: ReferenceLink, event: MouseEvent, inspect: () => void) {
  if (plainPress(event)) {
    event.preventDefault()
    inspect()
    return
  }
  if (opensInPlace(event)) {
    event.preventDefault()
    link.open()
  }
  reportAnalyticsUse('task_open')
}

/** The card itself opened from the page, as the panel's link to it opens it: counted. */
function openCard(link: ReferenceLink, event: MouseEvent) {
  if (opensInPlace(event)) {
    event.preventDefault()
    link.open()
  }
  reportAnalyticsUse('task_open')
}

export function useLineActions() {
  const { t } = useI18n()
  const resolve = useReferenceLinks()

  /** The link to a task's card, where a value of a breakdown by task is one the app opens. */
  function taskLink(by: UsageDimension, value: UsageGroupValue | null): ReferenceLink | null {
    if (by !== 'work_item' || !value?.reference || valueKind(value) !== 'category') return null
    const link = resolve({ kind: 'work-item', value: value.reference })
    return link?.href ? link : null
  }

  /** What a value that opens its panel is called, as it says what pressing it does. */
  const inspectName = (label: string) => t('analytics.detail.open', { value: label })

  return { follow, inspectName, inspectsTo, openCard, taskLink }
}

/**
 * The marks of a breakdown's values in a chart, by the key of each value's line: what pressing
 * one does, as the mark carries it (`markOf`) — a value that opens its panel a control named by
 * that, a task's a link to its card as well, the folded tail and unknown work nothing — and the
 * press its mark sends out, a link's `follow` or a control's `select`, answered here: the panel
 * asked of `inspect` with the value's filter and its name, or the card opened elsewhere.
 */
export function useLineMarks(options: {
  by: () => UsageDimension
  /** A value pressed to open its panel: its filter value, and its name. */
  inspect: (value: string | null, label: string) => void
  lines: () => readonly SpendingLine[]
}) {
  const actions = useLineActions()
  const words = useSpendingWords()
  const byKey = computed(() => new Map(options.lines().map((line) => [line.key, line])))

  /** What a press on a line acts on is called: its value, the first of a pair, which it acts as. */
  const actedOn = (line: SpendingLine, label: string) =>
    line.second && line.value ? words.valueLabel(options.by(), line.value) : label

  /**
   * A pair's mark is named by what pressing it does with its first value and described by the
   * whole pair (`actsOnPart`), so its pairs of one value stay apart for a screen reader.
   */
  function markOf(line: SpendingLine, label = words.lineLabel(options.by(), line)): MarkAction {
    if (actions.inspectsTo(options.by(), line.value) === undefined) return {}
    const action = actions.inspectName(actedOn(line, label))
    const href = actions.taskLink(options.by(), line.value)?.href
    const opens = href ? { href, action } : { actionable: true, action }
    return line.second ? { ...opens, actsOnPart: true } : opens
  }

  /** A value pressed to open its panel. */
  function select(key: string) {
    const line = byKey.value.get(key)
    const value = actions.inspectsTo(options.by(), line?.value ?? null)
    if (line && value !== undefined)
      options.inspect(value, actedOn(line, words.lineLabel(options.by(), line)))
  }

  /** A value's link pressed: its panel, or the task's card elsewhere (`follow`). */
  function follow(key: string, event: MouseEvent) {
    const link = actions.taskLink(options.by(), byKey.value.get(key)?.value ?? null)
    if (link) actions.follow(link, event, () => select(key))
  }

  return { follow, markOf, select }
}
