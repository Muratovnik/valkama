<script setup lang="ts">
/**
 * The panel of one dimension: what one answer of the usage read says of its values. At its top the
 * period's figures, which also choose the measure (`SpendingTiles`); then every value ranked
 * (`SpendingBars`) beside a small chart of the period for each leading value on one scale
 * (`SpendingMultiples`), and the period day by day (`SpendingDays`); under them the table
 * (`SpendingTable`), which a second dimension chosen over it crosses with the first. A value has
 * one hue in the bars, the small charts and the day chart (`valueSlots`), and its name beside it.
 *
 * Where the page holds it to the panel's height (`fills`), the table takes what the charts leave
 * it, never less than about half, and the charts above scroll on their own: a wheel moves the part
 * it is over and never the panel or the page. Elsewhere, as on a phone, the panel scrolls and the
 * table keeps a frame of its own.
 *
 * A value or a day pressed to narrow the view goes out with the dimension the answer was read by
 * and the part of the panel it was pressed in, which says why when it was refused. An answer whose
 * period before could not be read says so above the figures (`SpendingUnread`).
 */
import { computed, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingMultiples from '@/pages/analytics/components/SpendingMultiples.vue'
import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import SpendingUnread from '@/pages/analytics/components/SpendingUnread.vue'
import { useCrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { valueSlots } from '@/pages/analytics/utils/dayMultiples.ts'
import type { ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

const props = defineProps<{
  /** The period by account behind the answer, for where the accounts that worked changed. */
  accounts: AccountsRead
  /** The second dimension the table is crossed with, as the address holds it; null for none. */
  across: UsageDimension | null
  /** The dimensions the table may be crossed with. */
  dimensions: readonly UsageDimension[]
  /** Whether the page holds the panel to its height, so its parts scroll on their own. */
  fills: boolean
  /** The filters the answer was read with. */
  filters: UsageFilters
  /** When the answer was asked for, which says which day is not over yet. */
  readAt: Date
  /** Why the last press in a part of the panel did not narrow the view; null otherwise. */
  refused: { part: ReportPart; words: string } | null
  usage: Usage
}>()
/**
 * Read the answer again; narrow the view to a value of the answer's dimension, or to a day, as
 * pressed in a part of the panel; cross the table with a second dimension, or with none.
 */
const emit = defineEmits<{
  'day': [day: string, label: string]
  'narrow': [dimension: UsageDimension, value: string | null, label: string, part: ReportPart]
  'retry': []
  'update:across': [across: UsageDimension | null]
}>()
const measure = defineModel<Measure>('measure', { required: true })

/**
 * The dimension the answer was read by, not the one the page now asks for: while a new
 * breakdown is read the last one stays on screen, and its rows name only their own dimension.
 */
const by = computed<UsageDimension>(() => props.usage.group_by[0] ?? 'work_item')
const total = computed(() => spentOf(props.usage.total))
const before = computed(() => {
  const { comparison } = props.usage
  return comparison ? { ...comparison.period, spent: spentOf(comparison.total) } : null
})

/** The second dimension, where it is another than the section's own. */
const across = computed(() => (props.across && props.across !== by.value ? props.across : null))
const cross = useCrossRead({
  usage: () => props.usage,
  across: () => across.value,
  filters: () => props.filters,
})

const slots = computed(() =>
  valueSlots({ usage: props.usage, by: by.value, measure: measure.value }),
)

/** Under this width, in pixels, a row of a day's columns and a bar's name crowd each other. */
const NARROW = 560
const root = ref<HTMLElement | null>(null)
const width = ref<number | null>(null)
useResizeObserver(root, ([entry]) => {
  if (entry) width.value = entry.contentRect.width
})
const narrow = computed(() => width.value !== null && width.value < NARROW)

/** The words of a refusal, in the part of the panel it came from. */
const noticeIn = (part: ReportPart) => (props.refused?.part === part ? props.refused.words : '')
</script>

<template>
  <div
    ref="root"
    class="dimension-panel"
    :data-fills="fills"
  >
    <div class="dimension-charts">
      <SpendingUnread
        v-if="!before"
        @retry="emit('retry')"
      />
      <SpendingTiles
        v-model:measure="measure"
        :split="usage.total.tokens"
        :total="total"
        :before="before"
      />
      <div class="dimension-pair">
        <SpendingBars
          :by="by"
          :measure="measure"
          :narrow="narrow"
          :notice="noticeIn('bars')"
          :rows="usage.rows"
          :slots="slots"
          @narrow="(value, label) => emit('narrow', by, value, label, 'bars')"
        />
        <SpendingMultiples
          :by="by"
          :measure="measure"
          :narrow="narrow"
          :slots="slots"
          :usage="usage"
        />
      </div>
      <SpendingDays
        :accounts="accounts"
        :by="by"
        :measure="measure"
        :narrow="narrow"
        :notice="noticeIn('days')"
        :read-at="readAt"
        :usage="usage"
        @day="(day, label) => emit('day', day, label)"
      />
    </div>
    <SpendingTable
      :across="across"
      :by="by"
      :cross="cross.state.value"
      :dimensions="dimensions"
      :filters="filters"
      :measure="measure"
      :notice="noticeIn('table')"
      :usage="usage"
      @narrow="(value, label) => emit('narrow', by, value, label, 'table')"
      @reread="cross.retry"
      @update:across="(next) => emit('update:across', next)"
    />
  </div>
</template>

<style scoped>
/* Unheld, as on a phone, the charts and the table stand each as tall as it is and the panel
   scrolls; a part that may shrink to nothing would otherwise share out whatever height the panel
   stretches this to. */
.dimension-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: max-content;
  gap: var(--space-section);
  align-content: start;
  min-width: 0;
  min-block-size: 0;

  /* Held to the panel's height: the charts take what they need up to what the table leaves, and
     the table the rest, never less than about half. */
  &[data-fills='true'] {
    grid-template-rows: minmax(0, auto) minmax(min(22rem, 50%), 1fr);
    gap: var(--space-4);

    /* Positioned, so what its parts place out of the flow (words for a screen reader alone)
       scrolls and is clipped with them instead of stretching the panel's own scroll. Its air at
       the sides holds what a chart reaches past its column (the days' frame, a focus ring), so
       the charts never scroll sideways. */
    & .dimension-charts {
      position: relative;
      padding: var(--space-1) var(--space-2);
      margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-2));
      overflow-y: auto;
      overscroll-behavior: contain;
    }
  }
}

/* The charts, top to bottom; the ranked list and the small charts side by side where both read
   well, the list first. The air around them is the panel's, kept inside its scroll so a focus
   ring at their edge is drawn whole. Each part is as tall as what it holds: held to a height, a
   row sized as auto starts at a part's declared least height (the tiles' control height) and
   finds no room to grow, so the part would spill onto the next. */
.dimension-charts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: max-content;
  gap: var(--space-section);
  align-content: start;
  min-width: 0;
  min-block-size: 0;
  container-type: inline-size;
}

.dimension-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-section);
  align-items: start;
  min-width: 0;
}

@container (width >= 48rem) {
  .dimension-pair {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
