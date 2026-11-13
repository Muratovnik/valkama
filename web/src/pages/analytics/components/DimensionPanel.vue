<script setup lang="ts">
/**
 * The panel of one dimension: what one answer of the usage read says of its values. At its top the
 * period's figures, which also choose the measure (`SpendingTiles`); then every value ranked
 * (`SpendingBars`) beside a small chart of the period for each leading value on one scale
 * (`SpendingMultiples`), and the period day by day (`SpendingDays`); under them the table
 * (`SpendingTable`), which a second dimension chosen over it crosses with the first. A value has
 * one hue in the bars, the small charts and the day chart (`valueSlots`), and its name beside it.
 *
 * Where the page holds it to the panel's height (`fills`), the figures stay in view at the top and
 * the charts and the table share the rest: the charts up to a little under half of it, scrolling on
 * their own past that, the table the remainder and never less than 14rem. A wheel moves the part
 * it is over and never the panel or the page. Elsewhere, in the list's place on a narrow page or a
 * phone, the panel scrolls and the table keeps a frame of its own; where the window is tall enough
 * that frame stays at the panel's bottom edge while the figures and the charts pass under it, so its
 * heading row is in view from the start and a wheel over it moves the table alone. How much of the
 * panel's edge it covers goes up (`cover`), and the page pads its scroll by that, so a part the
 * browser brings into view, focused or scrolled to, stands over the table and never under it.
 *
 * Held, a button at the table gives it the whole panel under the figures and back (`tableWhole`),
 * which the page keeps for its whole view; unheld, every part is in the panel's scroll anyway. The
 * line under the ranked list that counts the values it leaves out gives the table the same, and the
 * focus with it.
 *
 * A value or a day pressed to narrow the view goes out with the dimension the answer was read by
 * and the part of the panel it was pressed in, which says why when it was refused. An answer whose
 * period before could not be read says so above the figures (`SpendingUnread`).
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingMultiples from '@/pages/analytics/components/SpendingMultiples.vue'
import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import SpendingUnread from '@/pages/analytics/components/SpendingUnread.vue'
import { useCrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import { useAnewDimmed, usePanelStanding } from '@/pages/analytics/composables/useReadStanding.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { valueSlots } from '@/pages/analytics/utils/dayMultiples.ts'
import { refusedIn, tileFigures } from '@/pages/analytics/utils/panelAnswer.ts'
import type { Refusal, ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import { pageDimensionOf } from '@/shared/api/analyticsApi.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import ToggleChip from '@/shared/ui/ToggleChip.vue'

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
  refused: Refusal | null
  usage: Usage
}>()
/**
 * Read the answer again; narrow the view to a value of the answer's dimension, or to a day, as
 * pressed in a part of the panel; cross the table with a second dimension, or with none. `cover`
 * says how high the table stands over the bottom edge of the scroll the panel is in, 0 for none.
 */
const emit = defineEmits<{
  'cover': [height: number]
  'day': [day: string, label: string]
  'narrow': [dimension: UsageDimension, value: string | null, label: string, part: ReportPart]
  'retry': []
  'update:across': [across: UsageDimension | null]
}>()
const { t } = useI18n()
const measure = defineModel<Measure>('measure', { required: true })
/** Whether the table takes the whole panel under the figures, where the panel is held. */
const tableWhole = defineModel<boolean>('tableWhole', { default: false })
const whole = computed(() => props.fills && tableWhole.value)
const wholeWords = computed(() =>
  t(`analytics.panel.table.${tableWhole.value ? 'collapse' : 'expand'}`),
)

/**
 * The dimension the answer was read by, not the one the page now asks for: while a new
 * breakdown is read the last one stays on screen, and its rows name only their own dimension.
 */
const by = computed<UsageDimension>(() => pageDimensionOf(props.usage) ?? 'work_item')
const before = computed(() => tileFigures(props.usage).before)

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

const root = ref<HTMLElement | null>(null)
const narrow = useNarrowCharts(root)

const noticeIn = (part: ReportPart) => refusedIn(props.refused, part)

/** The air left under a part brought into view over the table, room for its focus ring. */
const RING_ROOM = 8

const table = () => root.value?.querySelector<HTMLElement>('.dimension-table') ?? null
const cover = ref(0)

/**
 * How high the table stands over the bottom edge of the panel's scroll while it sticks there, with
 * room for a ring over it; 0 where it stands in the flow. Its height follows its rows, a crossing
 * and the window, and whether it sticks follows the window's height and the page's hold.
 */
function measureCover() {
  const sticking = table()
  const sticks = !props.fills && sticking && getComputedStyle(sticking).position === 'sticky'
  cover.value = sticks ? Math.ceil(sticking.getBoundingClientRect().height) + RING_ROOM : 0
}
useResizeObserver(table, measureCover)
useEventListener(globalThis, 'resize', measureCover)
watch(() => props.fills, measureCover, { flush: 'post' })
watch(cover, (height) => emit('cover', height), { immediate: true })
onBeforeUnmount(() => emit('cover', 0))

/** Dimmed while a new view is read in place of this answer (`readPending.css`). */
const pending = useAnewDimmed(usePanelStanding())

/**
 * The values the ranked list leaves out asked for: the table takes the whole panel, as its own
 * button gives it, and the focus moves to it — to its frame where that scrolls, else its first
 * control.
 */
async function showTable() {
  tableWhole.value = true
  await nextTick()
  const table = root.value?.querySelector<HTMLElement>('.spending-table')
  const frame = table?.querySelector<HTMLElement>('.spending-table-frame[tabindex]')
  const target = frame ?? table?.querySelector<HTMLElement>('.spending-table-frame button')
  target?.focus()
}
</script>

<template>
  <div
    ref="root"
    class="dimension-panel"
    :class="{ 'read-pending': pending }"
    :data-fills="fills"
    :data-whole="whole"
  >
    <SpendingUnread
      v-if="!before"
      @retry="emit('retry')"
    />
    <SpendingTiles
      v-model:measure="measure"
      :usage="usage"
      :read-at="readAt"
    />
    <div class="dimension-body">
      <div
        v-show="!whole"
        class="dimension-charts"
      >
        <div class="dimension-pair">
          <SpendingBars
            :by="by"
            :measure="measure"
            :narrow="narrow"
            :notice="noticeIn('bars')"
            :rows="usage.rows"
            :slots="slots"
            @narrow="(value, label) => emit('narrow', by, value, label, 'bars')"
            @more="showTable"
          />
          <SpendingMultiples
            :by="by"
            :measure="measure"
            :narrow="narrow"
            :slots="slots"
            :usage="usage"
            @narrow="(value, label) => emit('narrow', by, value, label, 'bars')"
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
          @narrow="(value, label) => emit('narrow', by, value, label, 'days')"
        />
      </div>
      <SpendingTable
        class="dimension-table"
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
      >
        <template
          v-if="fills"
          #actions
        >
          <ToggleChip
            :pressed="tableWhole"
            @toggle="tableWhole = !tableWhole"
          >
            {{ wholeWords }}
          </ToggleChip>
        </template>
      </SpendingTable>
    </div>
  </div>
</template>

<style scoped>
/* The panel and its charts each stand their parts one under the next, each part as tall as what
   it holds. Unheld, as on a phone, the charts and the table stand each as tall as it is and the
   panel scrolls; a part that may shrink to nothing would otherwise share out whatever height the
   panel stretches this to. Held to a height, a row sized as auto starts at a part's declared least
   height (the tiles' control height) and finds no room to grow, so the part would spill onto the
   next. */
.dimension-panel,
.dimension-body,
.dimension-charts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: max-content;
  gap: var(--space-section);
  align-content: start;
  min-width: 0;
  min-block-size: 0;
}

/* The charts, top to bottom; the ranked list and the small charts side by side where both read
   well, the list first. The air around them is the panel's, kept inside its scroll so a focus
   ring at their edge is drawn whole. */
.dimension-charts {
  container-type: inline-size;
}

/* Held to the panel's height: the figures stand whole at the top, outside any scroll, since they
   choose what everything under them shows. The charts and the table share the rest: the charts
   take what they hold up to 45% of it and scroll inside past that, the table the remainder and
   never less than 14rem, so a few of its rows are always in view. */
.dimension-panel[data-fills='true'] {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  & > :not(.dimension-body) {
    flex: none;
  }

  & .dimension-body {
    flex: 1 1 0;
    grid-template-rows:
      fit-content(min(45%, 100% - 14rem - var(--space-4)))
      minmax(14rem, 1fr);
    gap: var(--space-4);
  }

  /* The table pressed to take it all: the charts step aside and it has the whole rest. */
  &[data-whole='true'] .dimension-body {
    grid-template-rows: minmax(0, 1fr);
  }

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

.dimension-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-section);
  align-items: start;
  min-width: 0;
}

/* Unheld, the panel scrolls as a whole. Where the window is tall enough, the table stays at its
   bottom edge, up to half the window high, on the ground the panel stands on, and what stands
   above passes under it: its heading row is in view from the start and a wheel over its frame
   moves the table alone, and the page's scroll padding by its height (`cover`) keeps what is
   brought into view above it. Scrolled to its end, the panel shows the table in its own place
   under the day chart, so nothing above it is out of reach. A short window, a phone on its side,
   keeps the table in the flow, where it would cover what it stands under. */
@media (height >= 40rem) {
  /* A part that sticks stays inside its parent's box, which here would start under the figures
     and hold the table down off the panel's edge until they scroll away: unheld, the charts and
     the table stand in the panel's own grid, with the same air between them. */
  .dimension-panel[data-fills='false'] .dimension-body {
    display: contents;
  }

  /* A part sticks inside its scroller's padding, and the page leaves the air of --space-6 under
     the panel's content (`.analytics-panel` in `AnalyticsView.vue`; change both together): held
     at 0 the table stood that high over the panel's edge, the charts showing through under it. */
  .dimension-panel[data-fills='false'] .dimension-table {
    position: sticky;
    inset-block-end: calc(-1 * var(--space-6));
    z-index: 4;
    max-block-size: 50svh;
    padding-block-start: var(--space-3);
    background: var(--color-canvas);
    box-shadow: 0 -1px var(--color-rule);
  }
}

@container (width >= 48rem) {
  .dimension-pair {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>

<style scoped src="@/pages/analytics/components/readPending.css"></style>
