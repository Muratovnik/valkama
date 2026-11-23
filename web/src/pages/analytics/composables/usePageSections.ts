/**
 * The sections of the Analytics page, in the rail's order: the overview, the tokens by kind, the
 * quota's five hours and its week, the pauses before model requests, then each dimension filtered
 * on, each by its name; and the name of the section on show, which names the panel.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'

import {
  OVERVIEW,
  PAUSES_SECTION,
  QUOTA_SECTIONS,
  TOKEN_KINDS_SECTION,
} from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsSection } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

export function usePageSections(options: {
  /** The dimensions a person filters on, each a section of its own. */
  dimensions: () => readonly UsageDimension[]
  /** The section on show. */
  shown: () => AnalyticsSection
}) {
  const { t } = useI18n()
  const words = useSpendingWords()

  const sections = computed<{ label: string; value: AnalyticsSection }[]>(() => [
    { value: OVERVIEW, label: t('analytics.frame.overview') },
    { value: TOKEN_KINDS_SECTION, label: t('analytics.kinds.section') },
    ...QUOTA_SECTIONS.map((value) => ({ value, label: t(`analytics.quota.sections.${value}`) })),
    { value: PAUSES_SECTION, label: t('analytics.pauses.section') },
    ...options.dimensions().map((value) => ({ value, label: words.dimension(value) })),
  ])

  const sectionName = computed(
    () => sections.value.find((section) => section.value === options.shown())?.label ?? '',
  )

  return { sections, sectionName }
}
