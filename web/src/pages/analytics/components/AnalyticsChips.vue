<script setup lang="ts">
/**
 * The filters on the Analytics bar: each value set, a chip that takes it out; the way to add a
 * filter; and the list of every filter it opens.
 *
 * The way to add a filter stands first, then the count, then the chips, which take the room the
 * bar's line leaves them (`useChipRoom`): whatever takes that room — a failure the bar says —
 * moves none of the buttons. The chips it has no room for are counted with the rest in
 * «Filters: N», which opens the same list, where each stands. Beside the count the way to add a
 * filter is its icon, and on a short bar (`short`), which already shows it so, the count stands
 * for it. A chip names its value as its field does, from one list.
 *
 * A chip taken out hands the focus to the chip that takes its place, the one before it when it
 * was the last, the count, or the way to add a filter when none is left: the focus does not fall
 * to the page with the button it was on.
 *
 * The list lies over the panel under the bar's line, as wide as it — the line is what it is
 * placed against — so opening it moves nothing. Escape or a press outside it closes it; closed,
 * its fields stay in the document.
 *
 * The root is no box of its own: its parts are the line's, as they were before they were a
 * component.
 */
import { computed, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { onClickOutside, useEventListener } from '@vueuse/core'

import AnalyticsFilters from '@/pages/analytics/components/AnalyticsFilters.vue'
import { columnGap, useChipRoom } from '@/pages/analytics/composables/useChipRoom.ts'
import { useFilterOptions } from '@/pages/analytics/composables/useFilterOptions.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'
import { filterKey } from '@/pages/analytics/utils/usageValues.ts'

import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import { placeFocus } from '@/shared/lib/scriptedFocus.ts'
import SearchComboboxChips from '@/shared/ui/SearchComboboxChips.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The dimensions a filter may be set on. */
  dimensions: readonly UsageDimension[]
  filters: UsageFilters
  /** The bar is short of room for words, and says the way to add a filter by its icon. */
  short: boolean
  /** What each filter offers, as the read gave it. */
  values: Partial<Record<UsageDimension, FilterValues>>
}>()
/** A filter set anew, or every filter taken out. */
const emit = defineEmits<{
  clear: []
  filter: [dimension: UsageDimension, values: (string | null)[]]
}>()
/** Whether the list of filters is open over the panel. */
const adding = defineModel<boolean>('adding', { required: true })

const { t } = useI18n()
const words = useSpendingWords()
const { options } = useFilterOptions()
const fieldsId = useId()

/** Each value a filter is set to, named as its field names it, in the dimensions' order. */
const chips = computed(() =>
  props.dimensions.flatMap((dimension) => {
    const values = props.filters[dimension] ?? []
    const keys = values.map((value) => filterKey(value))
    const named = options(dimension, props.values[dimension], keys)
    return values.map((value, index) => ({
      dimension,
      value,
      key: `${dimension}:${keys[index]}`,
      label: t('analytics.frame.filter', {
        dimension: words.dimension(dimension),
        value: named.find((option) => option.value === keys[index])?.label ?? value,
      }),
    }))
  }),
)

const chipNames = computed(() => chips.value.map(({ key, label }) => ({ value: key, label })))

const chipRoom = useTemplateRef<HTMLElement>('chipRoom')
const chipMeasure = useTemplateRef<HTMLElement>('chipMeasure')
/** The words of «Add a filter» in the copy that is measured, beside the copy of the count. */
const addWords = useTemplateRef<HTMLElement>('addWords')
const { folded, shown } = useChipRoom({
  chips: chipNames,
  // What «Add a filter» gives up while the count shows: its words, or on a short bar the button.
  freed() {
    const copy = addWords.value?.parentElement
    const row = chipRoom.value?.parentElement
    if (!copy || !row) return 0
    const given = props.short ? copy : addWords.value
    return (given?.getBoundingClientRect().width ?? 0) + columnGap(props.short ? row : copy)
  },
  measure: chipMeasure,
  room: chipRoom,
})

const add = useTemplateRef<InstanceType<typeof VButton>>('add')
const count = useTemplateRef<InstanceType<typeof VButton>>('count')

/** The chip taken out, while the view has not dropped it yet, to hand the focus on from. */
let leaving: { count: number; index: number } | null = null

function takeOut(index: number) {
  const chip = chips.value[index]
  if (!chip) return
  const kept = (props.filters[chip.dimension] ?? []).filter((value) => value !== chip.value)
  leaving = { index, count: chips.value.length }
  emit('filter', chip.dimension, kept)
}

watch(
  chips,
  (now) => {
    const left = leaving
    if (!left || now.length >= left.count) return
    leaving = null
    const removers = chipRoom.value?.querySelectorAll('button') ?? []
    const next =
      removers[Math.min(left.index, removers.length - 1)] ??
      ((folded.value ? count.value : add.value)?.$el as HTMLElement | undefined)
    placeFocus(next)
  },
  { flush: 'post' },
)

/**
 * A press outside the list closes it. A press on a field's list of values, which stands outside
 * it in the page, keeps the focus in the field, and that is how it is told from a press on the
 * page; the buttons that open the list toggle it themselves.
 */
const fields = useTemplateRef<HTMLElement>('fields')
onClickOutside(
  fields,
  () => {
    if (!fields.value?.contains(document.activeElement)) adding.value = false
  },
  { ignore: [add, count] },
)

useEventListener(fields, 'keydown', (event: KeyboardEvent) => {
  // A field's open list hears Escape first, and closes alone.
  if (event.key !== 'Escape' || event.defaultPrevented) return
  adding.value = false
  placeFocus(add.value?.$el as HTMLElement | undefined)
})

const removeLabel = (label: string) => t('analytics.filters.remove', { label })
</script>

<template>
  <div
    class="analytics-chips"
    :class="{ 'analytics-chips-short': short, 'analytics-chips-folded': folded }"
  >
    <div class="analytics-bar-filters">
      <VButton
        ref="add"
        v-tooltip.clipped="t('analytics.frame.addFilter')"
        class="analytics-filter-add"
        variant="ghost"
        size="compact"
        :aria-expanded="adding"
        :aria-controls="fieldsId"
        @click="adding = !adding"
      >
        <VIcon
          name="plus"
          :size="16"
        />
        <span class="analytics-filter-add-words">{{ t('analytics.frame.addFilter') }}</span>
      </VButton>
      <VButton
        v-if="folded"
        ref="count"
        class="analytics-filter-folded"
        variant="ghost"
        size="compact"
        :aria-expanded="adding"
        :aria-controls="fieldsId"
        @click="adding = !adding"
      >
        {{ t('analytics.frame.filtersFolded', { count: chips.length }) }}
      </VButton>
      <div
        ref="chipRoom"
        class="analytics-bar-chips"
      >
        <SearchComboboxChips
          :chips="shown"
          :disabled="false"
          :remove-label="removeLabel"
          @remove="takeOut"
        />
      </div>
    </div>
    <div
      v-show="adding"
      :id="fieldsId"
      ref="fields"
      class="analytics-filter-body"
    >
      <AnalyticsFilters
        :dimensions="dimensions"
        :filters="filters"
        :values="values"
        @filter="(dimension, chosen) => emit('filter', dimension, chosen)"
      />
      <VButton
        v-if="chips.length"
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
      <SearchComboboxChips
        :chips="chipNames"
        :disabled="true"
        :remove-label="removeLabel"
      />
      <VButton
        variant="ghost"
        size="compact"
      >
        {{ t('analytics.frame.filtersFolded', { count: chips.length }) }}
      </VButton>
      <VButton
        variant="ghost"
        size="compact"
      >
        <VIcon
          name="plus"
          :size="16"
        />
        <span ref="addWords">{{ t('analytics.frame.addFilter') }}</span>
      </VButton>
    </div>
  </div>
</template>

<style scoped>
.analytics-chips {
  display: contents;
}

/* Room for the count and the way to add a filter, whatever the room for chips. */
.analytics-bar-filters {
  display: flex;
  flex: 1 1 0;
  gap: var(--space-2);
  align-items: center;
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

.analytics-chips-short.analytics-chips-folded .analytics-filter-add {
  display: none;
}

/* The words stay in the button for assistive technology, hidden from sight, and its hint names
   it. */
:is(.analytics-chips-short, .analytics-chips-folded) .analytics-filter-add-words {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
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
