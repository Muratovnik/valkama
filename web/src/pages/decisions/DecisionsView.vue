<script setup lang="ts">
/**
 * What agents decided on their own, where a participation point let them go ahead without asking,
 * and the work they took up by assignment: one table of a period's decisions, newest first.
 *
 * The space and the project are the context bar's, as Volumes and Participation take them: the
 * page has no choice of its own of either, so the scope is chosen once. Its own filters are the
 * period — today, this week, the past four weeks or days of the reader's own — and the point of
 * participation, every point until one is chosen, in a period bar over the table (`PeriodBar`),
 * which stays in place while the table scrolls in its own frame (`DecisionsTable`). The view is
 * the page's address: a reload or a pasted link reads the same view back.
 *
 * The read goes page after page (`useDecisionsRead`). Its first wait, its failure and an empty
 * view are the product's shared state panel under the bar: a view with no decision says «The
 * agents decided nothing on their own in this period», and the bar above it is how it is left.
 * A read of another view dims the last one until its first page lands; a refresh that fails keeps
 * what is shown and says so.
 *
 * A row's card opens over the page on its System events (`AppModuleStage`), as the address
 * names it, so Back closes it and the page stays as it was.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import DecisionsTable from '@/pages/decisions/components/DecisionsTable.vue'
import { useDecisionsRead } from '@/pages/decisions/composables/useDecisionsRead.ts'
import {
  customDays,
  DECISION_PERIODS,
  localDay,
  periodBounds,
  readView,
  writeView,
} from '@/pages/decisions/utils/decisionsView.ts'
import type { DecisionsPeriod, DecisionsView } from '@/pages/decisions/utils/decisionsView.ts'

import PeriodBar from '@/widgets/period-bar/components/PeriodBar.vue'

import { DECISION_POINTS } from '@/shared/api/planningDecisionPoints.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /** The project the context bar narrows the space to; null for the whole space. */
    projectId?: string | null
    /** The module's part of the address: what `writeView` wrote, or nothing. */
    routeState?: Readonly<Record<string, string | number | boolean>>
    /** The space's key the context bar stands in; null for every space. */
    space?: string | null
  }>(),
  { projectId: null, routeState: undefined, space: null },
)
/** The view's new address, in place of the one in hand. */
const emit = defineEmits<{ state: [state: Record<string, string>] }>()

const { t } = useI18n()

const view = computed(() => readView(props.routeState))
function change(next: Partial<DecisionsView>) {
  emit('state', writeView({ ...view.value, ...next }))
}

/** The day the page was opened or last read on, the last a day of the reader's own can name. */
const now = ref(new Date())
const today = computed(() => localDay(now.value))

const periods = computed(() =>
  DECISION_PERIODS.map((value) => ({ value, label: t(`decisions.period.${value}`) })),
)
const barWords = computed(() => ({
  from: t('decisions.period.from'),
  label: t('decisions.period.label'),
  reversed: t('decisions.period.reversed'),
  to: t('decisions.period.to'),
}))
function choosePeriod(period: DecisionsPeriod) {
  change(period === 'custom' ? { period, ...customDays(new Date()) } : { period })
}

const ALL = 'all'
const points = computed(() => [
  { value: ALL, label: t('decisions.point.all') },
  ...DECISION_POINTS.map((value) => ({ value, label: t(`decisionPoints.${value}`) })),
])
function choosePoint(value: string) {
  change({ point: DECISION_POINTS.find((point) => point === value) ?? null })
}

/** What the line gives up while it has no room for all it holds. */
const ORDER = ['words', 'gaps', 'span'] as const

const read = useDecisionsRead({
  view: () => ({ ...view.value, space: props.space, project: props.projectId }),
  query: () => {
    const bounds = periodBounds(view.value, now.value)
    if (!bounds) return null
    return {
      ...bounds,
      points: view.value.point ? [view.value.point] : [],
      project: props.projectId,
      space: props.space,
    }
  },
})

/** Read the view again as of now. */
function refresh() {
  now.value = new Date()
  void read.refresh()
}
</script>

<template>
  <section
    class="decisions-page"
    :aria-label="t('decisions.title')"
  >
    <PeriodBar
      class="decisions-bar"
      :from="view.from"
      :line-room="40"
      :order="ORDER"
      :period="view.period"
      :periods="periods"
      :to="view.to"
      :today="today"
      :words="barWords"
      @days="(next) => change(next)"
      @period="choosePeriod"
    >
      <ChoiceSelect
        class="decisions-point"
        size="compact"
        :label="t('decisions.point.label')"
        :model-value="view.point ?? ALL"
        :options="points"
        @update:model-value="choosePoint"
      />
      <template #end="{ short }">
        <VButton
          v-tooltip.clipped="t('decisions.refresh')"
          class="decisions-refresh"
          size="compact"
          :class="{ 'decisions-refresh-short': short }"
          @click="refresh"
        >
          <VIcon
            name="refresh"
            :size="16"
          />
          <span class="decisions-refresh-words">{{ t('decisions.refresh') }}</span>
        </VButton>
      </template>
    </PeriodBar>
    <div
      class="decisions-panel"
      :class="{ 'decisions-pending': read.pending.value }"
    >
      <PlatformStatePanel
        :state="read.state.value"
        :empty-description="t('decisions.emptyDescription')"
        @retry="refresh"
      >
        <template #default="{ payload }">
          <DecisionsTable
            class="decisions-shown"
            :items="payload.items"
            :reading="payload.reading"
            :total="payload.total"
          />
        </template>
      </PlatformStatePanel>
    </div>
  </section>
</template>

<style scoped>
/* The bar over the panel, the whole of the module's frame: the frame does not scroll, the table's
   own frame does, and the panel only when the window is too short for the table's least. */
.decisions-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
}

.decisions-bar {
  padding: var(--space-4) var(--size-page-gutter) var(--space-4) var(--space-5);
}

.decisions-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) var(--size-page-gutter) var(--space-6) var(--space-5);
  overflow-y: auto;
  overscroll-behavior: contain;
}

@container main (width <= 586px) {
  .decisions-bar,
  .decisions-panel {
    padding-inline-start: var(--space-3);
  }
}

/* The table takes the panel's height and no more, its frame scrolling inside it; it stands at its
   own height when shorter, and never below its least, under which the panel scrolls instead. */
.decisions-shown {
  flex: 0 1 auto;
  min-block-size: 12rem;
}

/* The last view while another one's first page is on its way: drawn as it stood, dimmed. */
.decisions-pending {
  opacity: 0.5;
  transition: opacity var(--duration-quick) var(--ease-out);
}

.decisions-point {
  flex: 0 1 auto;
  min-width: 0;
}

/* A phone: the point's choice stands under the periods, as wide as its row leaves it. */
@container (width <= 30rem) {
  .decisions-point {
    grid-area: 2 / 1 / 3 / 4;
  }

  .decisions-refresh {
    grid-area: 2 / 4 / 3 / 5;
  }
}

/* A short bar says the refresh by its icon; its words stay for assistive technology. */
.decisions-refresh-short .decisions-refresh-words {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
