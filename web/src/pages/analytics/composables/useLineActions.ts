/**
 * What pressing a value of a breakdown does on the Analytics page, wherever it stands — a bar, a
 * segment of a period, a legend entry, a small chart's name, a row of a chart's table, a row of
 * the table beside the period before. The charts are told it through `useLineMarks`, which gives
 * each value's mark what it does and answers the press its mark sends out.
 *
 * - By task, a task's value is a link to the task, opened the way a reference to it opens
 *   anywhere in the app (`useReferenceLinks`): its address is the task's short one, and a plain
 *   press opens the card in place. Work with no task has no card, so it narrows the view to
 *   itself and breaks it down by where it came from (`narrowedBy`). A deleted task, the folded
 *   tail and unknown work lead nowhere.
 * - By any other dimension, a value the read can filter by narrows the view to it and breaks it
 *   down by task: a value with an id, or a session's own run, which the read admits by `none`.
 *   Unknown work and the folded tail narrow to nothing.
 *
 * Where a narrowing leads depends on the page's sections, which the page gives once
 * (`provideLineActions`): at a project's scope there is no section of projects to break down by.
 *
 * Every opening of a task from the page is counted once, as `task_open`, a press the browser
 * takes to another tab included; a count that cannot be written costs nothing.
 */
import { computed, inject, provide } from 'vue'
import type { InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'
import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { opensInPlace } from '@/shared/lib/linkPress.ts'
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'
import type { MarkAction } from '@/shared/ui/chartGeometry.ts'

/** The breakdown a narrowed view shows: its section, and the dimension its table crosses it with. */
interface NarrowedBreakdown {
  by: UsageDimension
  /** Set where the narrowing chooses the crossing too; absent where the view keeps its own. */
  across?: UsageDimension | null
}

/** The dimensions the page has a section of; every one where nothing says otherwise. */
const SECTIONS: InjectionKey<() => readonly UsageDimension[]> = Symbol('analytics-line-sections')

/** The filter value a value narrows the view to; undefined for one that narrows to nothing. */
function narrowsTo(by: UsageDimension, value: UsageGroupValue | null): string | null | undefined {
  if (!value) return undefined
  const kind = valueKind(value)
  if (by === 'work_item') return kind === 'none' ? null : undefined
  if (kind === 'category') return value.id
  return kind === 'none' && by === 'launch_class' ? null : undefined
}

/** Whether a narrowing is to work with no task, which has no tasks to break down by. */
const toNoTask = (dimension: UsageDimension, value: string | null) =>
  dimension === 'work_item' && value === null

/**
 * What the view narrowed to a value breaks down by: its tasks; work with no task by the project
 * crossed with the launch class, or by the launch class alone where the page has no section of
 * projects.
 */
function narrowedBy(
  dimension: UsageDimension,
  value: string | null,
  sections: readonly UsageDimension[],
): NarrowedBreakdown {
  if (!toNoTask(dimension, value)) return { by: 'work_item' }
  return sections.includes('project')
    ? { by: 'project', across: 'launch_class' }
    : { by: 'launch_class', across: null }
}

/**
 * The page gives its sections to every value pressed under it, and takes where a narrowing leads
 * from the same rule its values are named by.
 */
export function provideLineActions(sections: () => readonly UsageDimension[]) {
  provide(SECTIONS, sections)
  return {
    narrowedBy: (dimension: UsageDimension, value: string | null) =>
      narrowedBy(dimension, value, sections()),
  }
}

/** A press on a task's link: opened in place where the page answers it, and counted. */
function follow(link: ReferenceLink, event: MouseEvent) {
  if (opensInPlace(event)) {
    event.preventDefault()
    link.open()
  }
  reportAnalyticsUse('task_open')
}

export function useLineActions() {
  const { t } = useI18n()
  const resolve = useReferenceLinks()
  const sections = inject(SECTIONS, () => USAGE_DIMENSIONS)

  /** The link to a task's card, where a value of a breakdown by task is one the app opens. */
  function taskLink(by: UsageDimension, value: UsageGroupValue | null): ReferenceLink | null {
    if (by !== 'work_item' || !value?.reference || valueKind(value) !== 'category') return null
    const link = resolve({ kind: 'work-item', value: value.reference })
    return link?.href ? link : null
  }

  /**
   * What a control that narrows the view to a value is called, as it says what pressing it does:
   * «Show the tasks of opus»; «Break down the work with no task by project and launch class».
   */
  function narrowName(by: UsageDimension, value: UsageGroupValue | null, label: string) {
    const to = narrowsTo(by, value)
    if (to === undefined || !toNoTask(by, to)) return t('analytics.drill.value', { value: label })
    return narrowedBy(by, to, sections()).across
      ? t('analytics.drill.noTask')
      : t('analytics.drill.noTaskByLaunch')
  }

  return { follow, narrowName, narrowsTo, taskLink }
}

/**
 * The marks of a breakdown's values in a chart, by the key of each value's line: what pressing
 * one does, as the mark carries it (`markOf`) — a task's a link to its card, a value the read can
 * filter by a control that narrows the view to it, the folded tail and unknown work nothing —
 * and the press its mark sends out, a link's `follow` or a control's `select`, answered here: the
 * task opened in place where the page answers it, the narrowing sent to `narrow` with its name.
 */
export function useLineMarks(options: {
  by: () => UsageDimension
  lines: () => readonly SpendingLine[]
  /** A value pressed to narrow the view to it: its filter value, and its name. */
  narrow: (value: string | null, label: string) => void
}) {
  const actions = useLineActions()
  const words = useSpendingWords()
  const byKey = computed(() => new Map(options.lines().map((line) => [line.key, line])))

  /** What a press on a line acts on is called: its value, the first of a pair, which it acts as. */
  const actedOn = (line: SpendingLine, label: string) =>
    line.second && line.value ? words.valueLabel(options.by(), line.value) : label

  function markOf(line: SpendingLine, label = words.lineLabel(options.by(), line)): MarkAction {
    const href = actions.taskLink(options.by(), line.value)?.href
    if (href) return { href }
    if (actions.narrowsTo(options.by(), line.value) === undefined) return {}
    const name = actedOn(line, label)
    return { actionable: true, action: actions.narrowName(options.by(), line.value, name) }
  }

  /** A value's link pressed: the task opened, in place where the page answers it. */
  function follow(key: string, event: MouseEvent) {
    const link = actions.taskLink(options.by(), byKey.value.get(key)?.value ?? null)
    if (link) actions.follow(link, event)
  }

  /** A value pressed to narrow the view to it. */
  function select(key: string) {
    const line = byKey.value.get(key)
    const value = actions.narrowsTo(options.by(), line?.value ?? null)
    if (line && value !== undefined)
      options.narrow(value, actedOn(line, words.lineLabel(options.by(), line)))
  }

  return { follow, markOf, select }
}
