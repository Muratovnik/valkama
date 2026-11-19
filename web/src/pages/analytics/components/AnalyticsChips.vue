<script setup lang="ts">
/**
 * The filters on the Analytics bar: the filter's field (`FacetFilter`), the one the Work views
 * filter through, and each value set as a chip that takes it out (`FacetFilterChips`).
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
 * The field stands first, then the count, then the chips, which take the room the bar's line
 * leaves them (`useChipRoom`): whatever takes that room — a failure the bar says — moves neither
 * the field nor the buttons, so the field is as wide as the line decides, not as the room left.
 * The chips it has no room for are counted with the rest in «Filters: N», which opens the list of
 * every chip with the way to take them all out; beside the count the field gives up its words
 * for its short ones, as it does on a short bar (`short`). A chip names its value as the menu
 * names it, from one list.
 *
 * The list lies over the panel under the bar's line, as wide as it — the line is what it is
 * placed against — so opening it moves nothing. Escape or a press outside it closes it.
 *
 * The root is no box of its own: its parts are the line's, as they were before they were a
 * component.
 */
import { computed, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { onClickOutside, useEventListener } from '@vueuse/core'

import { useChipRoom } from '@/pages/analytics/composables/useChipRoom.ts'
import { useFilterOptions } from '@/pages/analytics/composables/useFilterOptions.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { filterKey, filterValue } from '@/pages/analytics/utils/usageValues.ts'

import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import type { OptionRow } from '@/shared/ui/choiceControls.ts'
import FacetFilter from '@/shared/ui/FacetFilter.vue'
import FacetFilterChips from '@/shared/ui/FacetFilterChips.vue'
import type { FacetChip } from '@/shared/ui/FacetFilterChips.vue'
import type { FacetSource } from '@/shared/ui/facetMenu.ts'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import { runsWithin, vTextRuns } from '@/shared/ui/textRuns.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The dimensions a filter may be set on. */
  dimensions: readonly UsageDimension[]
  filters: UsageFilters
  /** The bar is short of room for words: the field says its short ones. */
  short: boolean
  /** What each filter offers, as the read gave it. */
  values: Partial<Record<UsageDimension, FilterValues>>
}>()
/** A filter set anew, every filter taken out, or the dimensions whose values the menu shows. */
const emit = defineEmits<{
  clear: []
  filter: [dimension: UsageDimension, values: (string | null)[]]
  need: [dimensions: UsageDimension[]]
}>()

const { t } = useI18n()
const words = useSpendingWords()
const { options } = useFilterOptions()
const listId = useId()

/** What the menu's text holds: a search of the menu alone, which filters nothing. */
const text = ref('')

/** The keys of the values a dimension's filter holds. */
const chosen = (dimension: UsageDimension) =>
  (props.filters[dimension] ?? []).map((value) => filterKey(value))

/** A row of the menu and a chip name a value by its dimension and its key, as one text. */
const rowKey = (dimension: UsageDimension, key: string) => `${dimension}:${key}`

// ---------------------------------------------------------------------------
// The menu: the dimensions, and the values of the one stepped into.
// ---------------------------------------------------------------------------

/** The dimensions whose values the menu shows, which are read for it. */
const needed = ref<UsageDimension[]>([])

/** A dimension's values are waited for while they are read. */
const waiting = (dimension: UsageDimension) => props.values[dimension] === 'loading'

/**
 * Each dimension's wait, shown in the menu once it has lasted (`useLoadingPresence`). Made for
 * every dimension at once, because the menu may show any of them.
 */
const waits = Object.fromEntries(
  USAGE_DIMENSIONS.map((dimension) => [dimension, useLoadingPresence(() => waiting(dimension))]),
) as Record<UsageDimension, ReturnType<typeof useLoadingPresence>>

/** Whether the menu shows a wait: the page says the word once for all of them. */
useReadWaitReport(computed(() => needed.value.some((dimension) => waits[dimension].shown.value)))

/** What the menu says under a dimension's values: that they are read, or could not be. */
function noteOf(dimension: UsageDimension): string | null {
  if (waits[dimension].shown.value) return t('platform.states.loading')
  return props.values[dimension] === 'failed' ? t('analytics.filters.failed') : null
}

/** A value's row: its name, drawn in its runs where it holds a title, and what it leaves out. */
type ValueRow = OptionRow & { runs?: readonly TextRun[] }

const source: FacetSource<ValueRow> = {
  facets: () => props.dimensions.map((id) => ({ id, name: words.dimension(id) })),
  values(facet) {
    const dimension = facet as UsageDimension
    const keys = chosen(dimension)
    const note = noteOf(dimension)
    return {
      rows: options(dimension, props.values[dimension], keys).map((option) => ({
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

function need(dimensions: readonly string[]) {
  needed.value = dimensions as UsageDimension[]
  emit('need', needed.value)
}

/** A value goes into its dimension's filter, or out if it was in. */
function pick(key: string, facet: string | null, left: string) {
  text.value = left
  if (facet === null) return
  const dimension = facet as UsageDimension
  const value = key.slice(facet.length + 1)
  const keys = chosen(dimension)
  const next = keys.includes(value) ? keys.filter((one) => one !== value) : [...keys, value]
  emit(
    'filter',
    dimension,
    next.map((one) => filterValue(one)),
  )
}

// ---------------------------------------------------------------------------
// The chips.
// ---------------------------------------------------------------------------

/** What holds the value's place in a chip's sentence while its runs are laid in it. */
const VALUE_MARK = '\u{E000}'

/** Each value a filter is set to, named as the menu names it, in the dimensions' order. */
const chips = computed<FacetChip[]>(() =>
  props.dimensions.flatMap((dimension) => {
    const keys = chosen(dimension)
    const named = options(dimension, props.values[dimension], keys)
    return keys.map((key) => {
      const option = named.find((one) => one.value === key)
      const said = (name: string | null) =>
        t('analytics.frame.filter', { dimension: words.dimension(dimension), value: name })
      const name = said(option?.label ?? filterValue(key))
      return {
        key: rowKey(dimension, key),
        name,
        removeName: t('analytics.filters.remove', { label: name }),
        ...(option?.runs ? { runs: runsWithin(said(VALUE_MARK), VALUE_MARK, option.runs) } : {}),
      }
    })
  }),
)

const chipRoom = useTemplateRef<HTMLElement>('chipRoom')
const chipMeasure = useTemplateRef<HTMLElement>('chipMeasure')
/** The field's width, in rem, with its whole words and with its short ones. */
const FIELD_WHOLE = 11
const FIELD_SHORT = 3.88

const { folded, shown } = useChipRoom({
  chips,
  measure: chipMeasure,
  room: chipRoom,
  // What the field gives up while the count shows: its whole words' room, unless a short bar
  // already took it.
  freed: () =>
    props.short
      ? 0
      : (FIELD_WHOLE - FIELD_SHORT) *
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
})

/**
 * As wide as its words, whatever the room beside it. On a short bar and beside the count it says
 * its short word, with less air at its ends: 108px, as wide as a phone's Work filter, set a span
 * of days on two rows 70px wider than the old button's icon had, and on a phone's row a failure
 * took a third line.
 */
const fieldShort = computed(() => props.short || folded.value)
const fieldStyle = computed(() =>
  fieldShort.value
    ? { 'inlineSize': `${FIELD_SHORT}rem`, '--space-text-input-inline': 'var(--space-1)' }
    : { inlineSize: `${FIELD_WHOLE}rem` },
)

/** A chip taken out: its value leaves its dimension's filter. */
function takeOut(key: string) {
  const [dimension] = key.split(':', 1) as [UsageDimension]
  const value = key.slice(dimension.length + 1)
  emit(
    'filter',
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

const field = useTemplateRef<{ focus: () => void }>('field')
const barChips = useTemplateRef<{ focusLast: () => boolean }>('barChips')
const count = useTemplateRef<InstanceType<typeof VButton>>('count')

const focusField = () => field.value?.focus()
const focusCount = () => (count.value?.$el as HTMLElement | undefined)?.focus()

/** ← from the start of the text: the last chip on the bar, or the count when none stands there. */
function focusChips() {
  if (!barChips.value?.focusLast()) focusCount()
}

// ---------------------------------------------------------------------------
// The list of every chip, which the count opens.
// ---------------------------------------------------------------------------

const listing = ref(false)
watch(folded, (now) => {
  if (!now) listing.value = false
})

/** A press outside the list closes it; the count that opens it toggles it itself. */
const list = useTemplateRef<HTMLElement>('list')
onClickOutside(
  list,
  () => {
    listing.value = false
  },
  { ignore: [count] },
)

useEventListener(list, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  listing.value = false
  focusCount()
})
</script>

<template>
  <div
    class="analytics-chips"
    :class="{ 'analytics-chips-folded': folded, 'analytics-chips-none': !chips.length }"
  >
    <div class="analytics-bar-filters">
      <FacetFilter
        ref="field"
        v-model:text="text"
        class="analytics-filter-add"
        :style="fieldStyle"
        :chips="chips.length"
        :clear-label="t('analytics.filters.clearText')"
        :label="t('analytics.filters.label')"
        :menu-label="t('analytics.filters.menu')"
        :placeholder="t('analytics.frame.addFilter')"
        :short-placeholder="t('analytics.filters.short')"
        :source="source"
        :words="menuWords"
        @chips="focusChips"
        @need="need"
        @pick="pick"
        @remove-last="takeOutLast"
      >
        <template #value="{ option }">
          <span
            v-if="option.runs"
            v-text-runs="option.runs"
          />
          <template v-else>{{ option.text }}</template>
        </template>
      </FacetFilter>
      <VButton
        v-if="folded"
        ref="count"
        class="analytics-filter-folded"
        variant="ghost"
        size="compact"
        :aria-expanded="listing"
        :aria-controls="listId"
        @click="listing = !listing"
      >
        {{ t('analytics.frame.filtersFolded', { count: chips.length }) }}
      </VButton>
      <div
        ref="chipRoom"
        class="analytics-bar-chips"
      >
        <FacetFilterChips
          ref="barChips"
          :chips="shown"
          :label="t('analytics.filters.chips')"
          @leave="focusField"
          @remove="takeOut"
        />
      </div>
    </div>
    <div
      v-show="listing"
      :id="listId"
      ref="list"
      class="analytics-filter-body"
    >
      <FacetFilterChips
        :chips="chips"
        :label="t('analytics.filters.chips')"
        @leave="focusCount"
        @remove="takeOut"
      />
      <VButton
        class="analytics-filter-clear"
        variant="text"
        size="compact"
        @click="emit('clear')"
      >
        {{ t('analytics.filters.clear') }}
      </VButton>
    </div>
    <div
      ref="chipMeasure"
      class="analytics-chips-measure"
      inert
    >
      <FacetFilterChips
        label=""
        :chips="chips"
      />
      <VButton
        variant="ghost"
        size="compact"
        data-filter-count
      >
        {{ t('analytics.frame.filtersFolded', { count: chips.length }) }}
      </VButton>
    </div>
  </div>
</template>

<style scoped>
.analytics-chips {
  display: contents;
}

/* Room for the field and the count, whatever the room for chips. */
.analytics-bar-filters {
  display: flex;
  flex: 1 1 0;
  gap: var(--space-2);
  align-items: center;
}

/* The field is as wide as its words (`fieldStyle`), whatever the room beside it, so a failure
   that takes the chips' room moves it not at all. Its menu is as wide as a value's name needs,
   not the field's width. */
.analytics-bar-filters .analytics-filter-add {
  --size-facet-filter-menu-width: 24rem;

  flex: none;
}

/* On a phone the filter's row also holds a failure and the read again: with no filter set the
   chips' room takes no gap of it, which a live period's failure needed at 360px not to take a
   third line. */
@container (width <= 30rem) {
  .analytics-chips-none .analytics-bar-chips {
    display: none;
  }
}

/* No room of its own: what the line leaves, which `useChipRoom` fills with the chips that fit. */
.analytics-bar-chips {
  display: flex;
  flex: 1 1 0;
  gap: var(--space-2);
  align-items: center;
  inline-size: 0;
  min-inline-size: 0;
}

/* Every chip, to be measured where nobody sees it: one under another, each its own width, so the
   copy stands no wider than its widest chip and reaches past no edge. */
.analytics-chips-measure {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  display: grid;
  justify-items: start;
  inline-size: max-content;
  pointer-events: none;
  visibility: hidden;
}

/* Over the panel under the bar's line, as wide as the line, scrolling inside itself where the
   window is short. */
.analytics-filter-body {
  position: absolute;
  inset-block-start: calc(100% + var(--space-2));
  inset-inline: 0;
  display: grid;
  gap: var(--space-3);
  max-block-size: min(32rem, 70vh);
  padding: var(--space-4);
  background: var(--color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-overlay);
}

.analytics-filter-clear {
  justify-self: start;
}
</style>
