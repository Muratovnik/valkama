/**
 * The side panel over the Analytics page as the page drives it (`DetailPanel`): what opens it,
 * what closes it and what it asks of the page. The panel is the view's `detail`, so every opening
 * is a new place in the history, which Back closes, and a reload opens it again
 * (`analyticsAddress`).
 *
 * - A value pressed anywhere on the page opens its panel (`inspect`); the line under a ranked list
 *   that counts every value opens the section's whole table (`all`); a quota window's «Where the
 *   window went» opens what it went to, through the opener the page gives it (`useWindowDetail`).
 *   A value pressed in the table opens in its place, a new place too (`inspectHere`).
 * - Its Close and Escape close it, as a new place, as a card's do (`close`).
 * - Its «Narrow the page to it» narrows the view to the value and breaks it down as that value is
 *   (`narrowedBy`), with the panel closed in the same place (`narrow`).
 *
 * An opening the address cannot hold is not made, and the words where it was asked say why: in the
 * part of the report it was pressed in, under the filters for a quota window, or in the panel for
 * what was pressed there (`notice`), which stands until the view moves.
 *
 * A card opened over the page from the panel stands on the same layer, and two surfaces there
 * paint in the order they were first drawn, the panel over the card. While a card stands over the
 * page (`covered`) the panel is closed under it, its place kept, and opens again when the card goes.
 */
import { computed, inject, provide, ref, watch } from 'vue'
import type { InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

import type { provideLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

import { orderFilters } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsDetail, AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

/** What opens the panel on one window of one account, by their keys, and its name. */
type WindowOpener = (account: string, window: string, label: string) => void

const WINDOW_DETAIL: InjectionKey<WindowOpener> = Symbol('analytics-window-detail')

/** The opener a quota window's «Where the window went» asks; none outside the page. */
export const useWindowDetail = () => inject(WINDOW_DETAIL, null)

export function useDetail(options: {
  /** How the page breaks a value down once narrowed to it. */
  lines: ReturnType<typeof provideLineActions>
  /** Writes a change of the view into its address; false, with nothing written, if it does not fit. */
  change: (next: Partial<AnalyticsView>, mode: 'push' | 'replace') => boolean
  /** Whether a card stands over the page. */
  covered: () => boolean
  /** Says why a change asked in a part of the page was not made. */
  refuse: (part: ReportPart | 'filters', words: string) => void
  view: () => AnalyticsView
}) {
  const { t } = useI18n()
  const words = useSpendingWords()

  /** Why the last change asked in the panel was not made; empty otherwise. */
  const notice = ref('')
  watch(options.view, () => {
    notice.value = ''
  })

  const detail = computed(() => options.view().detail)
  /** Whether the panel stands open: it has something to show and no card stands over it. */
  const open = computed(() => detail.value !== null && !options.covered())

  /** The panel opened on `next`, or the words why not; true once it was. */
  const openOn = (next: AnalyticsDetail, label: string) =>
    options.change({ detail: next }, 'push') ? '' : t('analytics.detail.full', { value: label })

  /** A value pressed in a part of the page, by its dimension, its filter value and its name. */
  function inspect(by: UsageDimension, value: string | null, label: string, part: ReportPart) {
    const refused = openOn({ kind: 'value', by, value }, label)
    if (refused) options.refuse(part, refused)
  }

  /** Every value of the section, asked by the line under its ranked list. */
  function all(by: UsageDimension, part: ReportPart) {
    const refused = openOn({ kind: 'all', by }, words.dimension(by))
    if (refused) options.refuse(part, refused)
  }

  /** A value pressed in the panel, which opens in its place. */
  function inspectHere(by: UsageDimension, value: string | null, label: string) {
    notice.value = openOn({ kind: 'value', by, value }, label)
  }

  provide(WINDOW_DETAIL, (account, window, label) => {
    const refused = openOn({ kind: 'window', account, window }, label)
    if (refused) options.refuse('filters', refused)
  })

  function close() {
    options.change({ detail: null }, 'push')
  }

  /** The page narrowed to the value on show, by its name; said in the panel when it does not fit. */
  function narrow(by: UsageDimension, value: string | null, label: string) {
    const filters = orderFilters({ ...options.view().filters, [by]: [value] })
    const next = { filters, ...options.lines.narrowedBy(by, value), detail: null }
    if (!options.change(next, 'push')) notice.value = t('analytics.drill.full', { value: label })
  }

  return { all, close, detail, inspect, inspectHere, narrow, notice, open }
}
