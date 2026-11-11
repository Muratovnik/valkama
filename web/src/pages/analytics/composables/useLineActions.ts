/**
 * What pressing a value of a breakdown does on the Analytics page, wherever it stands — a bar, a
 * row of a chart's table, a row of the table beside the period before.
 *
 * - By task, a task's value is a link to the task, opened the way a reference to it opens
 *   anywhere in the app (`useReferenceLinks`): its address is the task's short one, and a plain
 *   press opens the card in place. A deleted task, work with no task, the folded tail and
 *   unknown work lead nowhere.
 * - By any other dimension, a value the read can filter by narrows the view to it and breaks it
 *   down by task: a value with an id, or a session's own run, which the read admits by `none`.
 *   Unknown work and the folded tail narrow to nothing.
 *
 * Every opening of a task from the page is counted once, as `task_open`, a press the browser
 * takes to another tab included; a count that cannot be written costs nothing.
 */
import { useI18n } from 'vue-i18n'

import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

import type { UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'
import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { opensInPlace } from '@/shared/lib/linkPress.ts'
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'

/** The filter value a value narrows the view to; undefined for one that narrows to nothing. */
function narrowsTo(by: UsageDimension, value: UsageGroupValue | null): string | null | undefined {
  if (by === 'work_item' || !value) return undefined
  const kind = valueKind(value)
  if (kind === 'category') return value.id
  return kind === 'none' && by === 'launch_class' ? null : undefined
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

  /** The link to a task's card, where a value of a breakdown by task is one the app opens. */
  function taskLink(by: UsageDimension, value: UsageGroupValue | null): ReferenceLink | null {
    if (by !== 'work_item' || !value?.reference || valueKind(value) !== 'category') return null
    const link = resolve({ kind: 'work-item', value: value.reference })
    return link?.href ? link : null
  }

  /** What a control that narrows the view to a value is called: «Show the tasks of opus». */
  const narrowName = (label: string) => t('analytics.drill.value', { value: label })

  return { follow, narrowName, narrowsTo, taskLink }
}
