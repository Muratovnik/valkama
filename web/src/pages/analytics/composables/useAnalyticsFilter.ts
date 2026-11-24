/**
 * The Analytics filter on the shared filter field and chips (`FacetFilter`, `FacetFilterChips`):
 * what the field is over, its words, the chips that show the filter, and what a pick or a chip
 * taken out does to the page's filters, which the bar's host owns (`filter`). The bar places the
 * field (`AnalyticsFilterField`) and the chips (`AnalyticsChipRow`), as the Work bar places those
 * of `useWorkFilter`, under the template refs `filterField` and `filterChips`, which the focus
 * moves between: ← from the start of the text to the last chip, the last chip taken out and every
 * filter cleared back to the field, since what was pressed is gone.
 *
 * The field is the way to add a filter, its words «Add a filter»: its menu opens on the
 * dimensions the page offers, and a dimension's row steps into its values (`useFilterOptions`):
 * «none» as the read admits it — work on no task, a session's own run, a value nobody can place —
 * except for the role, which every stretch has; the values that spent anything in the period;
 * and a value chosen that the period did not spend, as one a pasted link names, under its id.
 * Choosing several of a dimension admits any of them; the filters of different dimensions all
 * apply. A dimension's values are read only when the menu shows them (`need`): the one stepped
 * into, or every one while typed text searches them all. Their wait is shown in the menu once it
 * has lasted, and said once for the page (`useReadWaitReport`); a read that failed says so there.
 *
 * A chip names its value as the menu names it, from one list, in the dimensions' order.
 */
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFilterOptions } from '@/pages/analytics/composables/useFilterOptions.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { filterKey, filterValue } from '@/pages/analytics/utils/usageValues.ts'

import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import type { OptionRow } from '@/shared/ui/choiceControls.ts'
import type { FacetChip } from '@/shared/ui/FacetFilterChips.vue'
import type { FacetSource } from '@/shared/ui/facetMenu.ts'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import { runsWithin } from '@/shared/ui/textRuns.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'

/** A value's row: its name, drawn in its runs where it holds a title, and what it leaves out. */
type ValueRow = OptionRow & { runs?: readonly TextRun[] }

/** What holds the value's place in a chip's sentence while its runs are laid in it. */
const VALUE_MARK = '\u{E000}'

/** What a chip says in its value's place until the value's name is read. */
const PENDING = '…'

/** A row of the menu and a chip name a value by its dimension and its key, as one text. */
const rowKey = (dimension: UsageDimension, key: string) => `${dimension}:${key}`

export function useAnalyticsFilter(input: {
  /** Every filter taken out. */
  clear: () => void
  /** The dimensions a filter may be set on. */
  dimensions: () => readonly UsageDimension[]
  /** A filter set anew. */
  filter: (dimension: UsageDimension, values: (string | null)[]) => void
  filters: () => UsageFilters
  /** The dimensions whose values the menu shows, which are read for it. */
  need: (dimensions: UsageDimension[]) => void
  /** What each filter offers, as the read gave it. */
  values: () => Partial<Record<UsageDimension, FilterValues>>
}) {
  const { t } = useI18n()
  const words = useSpendingWords()
  const { options } = useFilterOptions()

  /** What the menu's text holds: a search of the menu alone, which filters nothing. */
  const text = ref('')

  /** The keys of the values a dimension's filter holds. */
  const chosen = (dimension: UsageDimension) =>
    (input.filters()[dimension] ?? []).map((value) => filterKey(value))

  // -------------------------------------------------------------------------
  // The menu: the dimensions, and the values of the one stepped into.
  // -------------------------------------------------------------------------

  /** The dimensions whose values the menu shows, which are read for it. */
  const needed = ref<UsageDimension[]>([])

  /**
   * Each dimension's wait, shown in the menu once it has lasted (`useLoadingPresence`). Made for
   * every dimension at once, because the menu may show any of them.
   */
  const waits = Object.fromEntries(
    USAGE_DIMENSIONS.map((dimension) => [
      dimension,
      useLoadingPresence(() => input.values()[dimension] === 'loading'),
    ]),
  ) as Record<UsageDimension, ReturnType<typeof useLoadingPresence>>

  /** Whether the menu shows a wait: the page says the word once for all of them. */
  useReadWaitReport(computed(() => needed.value.some((dimension) => waits[dimension].shown.value)))

  /** What the menu says under a dimension's values: that they are read, or could not be. */
  function noteOf(dimension: UsageDimension): string | null {
    if (waits[dimension].shown.value) return t('platform.states.loading')
    return input.values()[dimension] === 'failed' ? t('analytics.filters.failed') : null
  }

  const source: FacetSource<ValueRow> = {
    facets: () => input.dimensions().map((id) => ({ id, name: words.dimension(id) })),
    values(facet) {
      const dimension = facet as UsageDimension
      const keys = chosen(dimension)
      const note = noteOf(dimension)
      return {
        rows: options(dimension, input.values()[dimension], keys).map((option) => ({
          key: rowKey(dimension, option.value),
          text: option.label,
          ...(option.runs ? { runs: option.runs } : {}),
          ...(option.description ? { detail: option.description } : {}),
          selected: keys.includes(option.value),
        })),
        ...(note ? { note } : {}),
      }
    },
  }

  const menuWords = computed(() => ({
    facets: t('analytics.filters.dimensions'),
    back: (dimension: string) => t('analytics.filters.back', { dimension }),
    noMatch: t('analytics.filters.noMatches'),
  }))

  /** Text typed in the field: a search of the menu. */
  function type(next: string) {
    text.value = next
  }

  function need(dimensions: readonly string[]) {
    needed.value = dimensions as UsageDimension[]
    input.need(needed.value)
  }

  /** A value goes into its dimension's filter, or out if it was in. */
  function pick(key: string, facet: string | null, left: string) {
    text.value = left
    if (facet === null) return
    const dimension = facet as UsageDimension
    const value = key.slice(facet.length + 1)
    const keys = chosen(dimension)
    const next = keys.includes(value) ? keys.filter((one) => one !== value) : [...keys, value]
    input.filter(
      dimension,
      next.map((one) => filterValue(one)),
    )
  }

  // -------------------------------------------------------------------------
  // The chips.
  // -------------------------------------------------------------------------

  /**
   * A value's chip, saying its dimension and the name given; its runs, where the name has them;
   * and the two apart where the words end on the value, so a chip with no room for both can show
   * the value (`parts`).
   */
  function chipOf(
    dimension: UsageDimension,
    key: string,
    value: string,
    runs?: readonly TextRun[],
  ) {
    const said = (name: string) =>
      t('analytics.frame.filter', { dimension: words.dimension(dimension), value: name })
    const name = said(value)
    const lead = said(VALUE_MARK)
    const parted = lead.endsWith(VALUE_MARK) && lead.length > VALUE_MARK.length
    return {
      key: rowKey(dimension, key),
      name,
      removeName: t('analytics.filters.remove', { label: name }),
      ...(runs ? { runs: runsWithin(lead, VALUE_MARK, runs) } : {}),
      ...(parted
        ? { parts: { lead: lead.slice(0, -VALUE_MARK.length), value, ...(runs ? { runs } : {}) } }
        : {}),
    }
  }

  /**
   * Each value a filter is set to, named as the menu names it, in the dimensions' order. While its
   * dimension is read, a chip keeps the name it last had, the period before's; before the first
   * answer it says the name its id gives (`idLabel`), a model's or a role's, or, where only a read
   * names the value, its dimension and «…» (`pending`), never the value's id, which named it
   * «Task: 00000000-0…» until the answer came. A read that failed leaves the name it had, or the
   * id where a read alone names it.
   */
  const chips = computed<FacetChip[]>((previous) =>
    input.dimensions().flatMap((dimension) => {
      const keys = chosen(dimension)
      const read = input.values()[dimension]
      const named = options(dimension, read, keys)
      return keys.map((key): FacetChip => {
        if (!Array.isArray(read) && key !== filterKey(null)) {
          const kept = previous?.find((one) => one.key === rowKey(dimension, key) && !one.pending)
          if (kept) return kept
          const label = words.idLabel(dimension, filterValue(key) ?? key)
          if (label !== null) return chipOf(dimension, key, label)
          if (read !== 'failed') return { ...chipOf(dimension, key, PENDING), pending: true }
        }
        const option = named.find((one) => one.value === key)
        return chipOf(dimension, key, option?.label ?? key, option?.runs)
      })
    }),
  )

  /** A chip taken out: its value leaves its dimension's filter. */
  function takeOut(key: string) {
    const [dimension] = key.split(':', 1) as [UsageDimension]
    const value = key.slice(dimension.length + 1)
    input.filter(
      dimension,
      chosen(dimension)
        .filter((one) => one !== value)
        .map((one) => filterValue(one)),
    )
  }

  /** Backspace from the start of the field's text: the last chip goes. */
  function takeOutLast() {
    const last = chips.value.at(-1)
    if (last) takeOut(last.key)
  }

  // -------------------------------------------------------------------------
  // The focus between the field and the chips.
  // -------------------------------------------------------------------------

  const field = useTemplateRef<{ takeFocus: () => void }>('filterField')
  const chipRow = useTemplateRef<{ focusLast: () => boolean }>('filterChips')

  const focusField = () => field.value?.takeFocus()
  /** ← from the start of the field's text: the last chip. */
  const focusChips = () => chipRow.value?.focusLast()

  /** Every filter out: the button that did it goes with them, so the caret goes to the field. */
  function clear() {
    input.clear()
    focusField()
  }

  return {
    chips,
    clear,
    focusChips,
    focusField,
    menuWords,
    need,
    pick,
    source,
    takeOut,
    takeOutLast,
    text,
    type,
  }
}

/** The Analytics filter as the bar's parts that place it take it. */
export type AnalyticsFilter = ReturnType<typeof useAnalyticsFilter>
