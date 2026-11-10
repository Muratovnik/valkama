/**
 * How the Analytics page names what it shows: a dimension, and a value of one as a card or the
 * rail already names it — a task by its number and title, a project by its name, a session by
 * its client and the start of its id. Work with no task and a value nobody can place say so in
 * words of their own.
 */
import { useI18n } from 'vue-i18n'

import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

import type { UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'

/** How much of a session's id names it beside its client: enough to tell two apart. */
const SESSION_PREFIX = 8

export function useSpendingWords() {
  const i18n = useI18n()
  const { t } = i18n

  const dimension = (name: UsageDimension) => t(`analytics.dimensions.${name}`)

  /** What a filter's «none» admits: work on no task, or a value the store does not hold. */
  const noneLabel = (name: UsageDimension) =>
    name === 'work_item' ? t('analytics.values.none') : t('analytics.values.unknown')

  function categoryLabel(name: UsageDimension, value: UsageGroupValue & { id: string }) {
    if (name === 'work_item')
      return value.reference
        ? [value.reference, value.title].filter(Boolean).join(' ')
        : t('analytics.values.deleted')
    if (name === 'project') return value.name ?? value.id
    if (name === 'executor')
      return [value.family, value.id.slice(0, SESSION_PREFIX)].filter(Boolean).join(' · ')
    if (name === 'role' && i18n.te(`analytics.roles.${value.id}`))
      return t(`analytics.roles.${value.id}`)
    return value.id
  }

  function valueLabel(name: UsageDimension, value: UsageGroupValue) {
    const kind = valueKind(value)
    if (kind === 'none') return t('analytics.values.none')
    if (kind === 'unknown') return t('analytics.values.unknown')
    return categoryLabel(name, value as UsageGroupValue & { id: string })
  }

  return { dimension, noneLabel, valueLabel }
}
