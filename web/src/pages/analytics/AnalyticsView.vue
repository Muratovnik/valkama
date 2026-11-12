<script setup lang="ts">
/**
 * What agent work was spent on in a period, and how that changed from the period before.
 *
 * A monitor screen that fills the module's frame: a bar of the period, the filters, how fresh the
 * figures are and a read of them again over the whole of it; under that a rail of the page's
 * sections — the overview, then a dimension each — and the panel of the section on show. The rail
 * and the panel scroll on their own, so the bar and the rail stay in sight while the panel is
 * read. Where the page leaves the panel beside the rail too narrow for its charts (`usePanelRoom`)
 * the rail is the screen, a list, and a section chosen there takes its place as a new place in the
 * history, so Back returns to the list. Each section's entry on the rail carries its figures
 * (`useRailTiles`).
 *
 * The view — the period, the section, the measure, a filter per dimension and whether a narrow
 * screen shows the section — is the page's address: every change is written there, and a reload
 * or a pasted link reads the same view back. The read is asked in the browser's own time, so a day
 * starts at the reader's midnight. While it is read the panel waits, fails and stands empty
 * through the product's shared state panel; the bar stays above it in every state, since changing
 * the period is how an empty one is left.
 *
 * A change the address cannot hold — a filter of more values than its link has room for — is
 * not made: the view stays as its address says, and the words where it was asked say why, so the
 * page never shows a view its link would not give back.
 *
 * A value or a day pressed in the report narrows the view to it and breaks it down by task, as a
 * new place in the history, so Back returns to the view it was pressed in.
 *
 * The page opens on its overview (`OverviewPanel`), the period at a glance; a dimension's section
 * is its whole report.
 *
 * The live period «Now» reads itself again on an interval while the page is seen
 * (`useLiveRefresh`); no other period does.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyticsBar from '@/pages/analytics/components/AnalyticsBar.vue'
import AnalyticsRail from '@/pages/analytics/components/AnalyticsRail.vue'
import DimensionPanel from '@/pages/analytics/components/DimensionPanel.vue'
import OverviewPanel from '@/pages/analytics/components/OverviewPanel.vue'
import { useLiveRefresh } from '@/pages/analytics/composables/useLiveRefresh.ts'
import { usePanelRoom } from '@/pages/analytics/composables/usePanelRoom.ts'
import { useRailTiles } from '@/pages/analytics/composables/useRailTiles.ts'
import { provideSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useUsageRead } from '@/pages/analytics/composables/useUsageRead.ts'
import type { ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

import {
  addressFits,
  localDay,
  orderFilters,
  OVERVIEW,
  readAddress,
  writeAddress,
} from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsSection, AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /** The project the page is scoped to; every figure is that project's. */
    projectId?: string | null
    /** The module's part of the address: what `writeAddress` wrote, or nothing. */
    routeState?: Readonly<Record<string, string | number | boolean>>
  }>(),
  { routeState: undefined, projectId: null },
)
/** The view's new address: a change in place, or a new place in the history (`push`). */
const emit = defineEmits<{
  state: [state: Record<string, string | number | boolean>, mode?: 'push' | 'replace']
}>()

const { t } = useI18n()
// Once per opening: the stage sets this page up each time it is navigated to.
reportAnalyticsUse('page_open')
const words = useSpendingWords()

const view = computed(() => readAddress(props.routeState))

/** Why the last change asked for was not made, and where it was asked; null once the view moves. */
const refused = ref<{ part: ReportPart | 'filters'; words: string } | null>(null)
watch(view, () => {
  refused.value = null
})
const filtersRefused = computed(() =>
  refused.value?.part === 'filters' ? refused.value.words : '',
)
const reportRefused = computed(() =>
  refused.value && refused.value.part !== 'filters'
    ? { part: refused.value.part, words: refused.value.words }
    : null,
)

/** Writes a change of the view into its address; false, with nothing written, if it does not fit. */
function change(next: Partial<AnalyticsView>, mode: 'push' | 'replace' = 'replace'): boolean {
  const changed = { ...view.value, ...next }
  if (!addressFits(changed)) return false
  emit('state', writeAddress(changed), mode)
  return true
}

/** The view narrowed to one value of a dimension, broken down by task. */
function narrow(dimension: UsageDimension, value: string | null, label: string, part: ReportPart) {
  const filters = orderFilters({ ...view.value.filters, [dimension]: [value] })
  if (change({ filters, by: 'work_item' }, 'push')) return
  refused.value = { part, words: t('analytics.drill.full', { value: label }) }
}

/** The view narrowed to one day, broken down by task. */
function narrowToDay(day: string, label: string) {
  if (change({ period: 'custom', from: day, to: day, by: 'work_item' }, 'push')) return
  refused.value = { part: 'days', words: t('analytics.drill.full', { value: label }) }
}

/** The page's reads, asked once however many of its parts ask them (`useSharedUsage`). */
const shared = provideSharedUsage({ view: () => view.value, projectId: () => props.projectId })
const read = useUsageRead({ shared, view: () => view.value, projectId: () => props.projectId })

const today = computed(() => localDay(read.askedAt.value))

/** The newest record the answer on show says the store holds; undefined with no answer. */
const lastEventAt = computed(() => {
  const shown = read.state.value
  return 'payload' in shown ? shown.payload.last_event_at : undefined
})

/** The dimensions a person filters on: at a project's scope its project is already chosen. */
const filterDimensions = computed<UsageDimension[]>(() =>
  USAGE_DIMENSIONS.filter((dimension) => !(props.projectId && dimension === 'project')),
)

/** The page's sections, in the rail's order: the overview, then each dimension filtered on. */
const sections = computed<{ label: string; value: AnalyticsSection }[]>(() => [
  { value: OVERVIEW, label: t('analytics.frame.overview') },
  ...filterDimensions.value.map((value) => ({ value, label: words.dimension(value) })),
])

const overview = computed(() => view.value.by === OVERVIEW)

const sectionName = computed(
  () => sections.value.find((section) => section.value === view.value.by)?.label ?? '',
)

/** Whether the page is too narrow for the panel beside the rail, which then take turns. */
const page = ref<HTMLElement | null>(null)
const { narrow: narrowScreen, railWidth } = usePanelRoom(page)
/** The rail's column beside the panel's; one column, the screen's, while they take turns. */
const bodyColumns = computed(() =>
  narrowScreen.value ? undefined : { gridTemplateColumns: `${railWidth} minmax(0, 1fr)` },
)
const showsRail = computed(() => !narrowScreen.value || !view.value.open)
const showsPanel = computed(() => !narrowScreen.value || view.value.open)

/** A dimension's answer beside the rail is held to the panel's height, and scrolls its own parts. */
const holdsSection = computed(
  () => !overview.value && !narrowScreen.value && 'payload' in read.state.value,
)

/** A section chosen on the rail: in place beside it, or in place of the list as a new place. */
function chooseSection(by: AnalyticsSection) {
  if (narrowScreen.value) change({ by, open: true }, 'push')
  else if (by !== view.value.by) change({ by })
}

/**
 * Where focus goes as the list and a section take turns: the way back, or the section left. Only
 * a move between them does that; the page found too narrow on opening or on a resize moves none.
 */
const rail = ref<InstanceType<typeof AnalyticsRail> | null>(null)
const back = ref<InstanceType<typeof VButton> | null>(null)
watch(
  () => view.value.open,
  async (opened, was) => {
    if (opened === was || !narrowScreen.value) return
    await nextTick()
    if (opened) (back.value?.$el as HTMLElement | undefined)?.focus()
    else rail.value?.focusSelected()
  },
)

/**
 * Whether the table of a held section takes the whole panel under its figures. It belongs to the
 * page view, not to a section or a read, so a change of section, measure or period or a refresh
 * keeps it; it is no part of the address.
 */
const tableWhole = ref(false)

/** Whether the field of each dimension is open under the bar, which asks what each offers. */
const adding = ref(false)
watch(
  [adding, () => read.bounds.value],
  ([open]) => {
    if (open) void read.offer(filterDimensions.value)
  },
  { immediate: true },
)

function filter(dimension: UsageDimension, values: (string | null)[]) {
  if (change({ filters: orderFilters({ ...view.value.filters, [dimension]: values }) })) return
  refused.value = {
    part: 'filters',
    words: t('analytics.filters.full', { dimension: words.dimension(dimension) }),
  }
}

const { tiles, refresh: refreshTiles } = useRailTiles({
  dimensions: () => filterDimensions.value,
  overview: () => read.state.value,
  overviewAt: () => read.askedAt.value,
  projectId: () => props.projectId,
  shared,
  view: () => view.value,
})

/** The bar's refresh reads the page and every tile of the rail again, as of now. */
function refresh() {
  shared.renew()
  void read.retry()
  void refreshTiles()
}

/**
 * «Now» reads itself again while the page is seen, an interval after the last read of the view,
 * whatever asked it: a refresh, or a new period or filter.
 */
const live = computed(() => view.value.period === 'now')
const liveRefresh = useLiveRefresh({ live: () => live.value, refresh })
watch(
  () => read.askedAt.value,
  () => liveRefresh.restart(),
)

const emptyDescription = computed(() =>
  read.bounds.value ? t('analytics.empty.description') : t('analytics.period.incomplete'),
)
</script>

<template>
  <section
    ref="page"
    class="analytics-page"
    :class="{ 'analytics-narrow': narrowScreen }"
    :aria-label="t('analytics.title')"
  >
    <AnalyticsBar
      v-model:adding="adding"
      class="analytics-page-bar"
      :dimensions="filterDimensions"
      :filters-refused="filtersRefused"
      :last-event-at="lastEventAt"
      :live="live"
      :today="today"
      :values="read.filterValues.value"
      :view="view"
      @amend="(next) => change(next)"
      @filter="filter"
      @refresh="refresh"
    />

    <div
      class="analytics-body"
      :style="bodyColumns"
    >
      <AnalyticsRail
        v-show="showsRail"
        ref="rail"
        class="analytics-page-rail"
        :label="t('analytics.frame.sections')"
        :list="narrowScreen"
        :sections="sections"
        :selected="view.by"
        :tiles="tiles"
        @choose="chooseSection"
      />
      <section
        v-show="showsPanel"
        class="analytics-panel"
        :class="{ 'analytics-panel-held': holdsSection }"
        :aria-label="sectionName"
      >
        <div
          v-if="narrowScreen"
          class="analytics-panel-head"
        >
          <VButton
            ref="back"
            class="analytics-panel-back"
            variant="text"
            size="compact"
            @click="change({ open: false }, 'push')"
          >
            <VIcon
              name="chevron-left"
              :size="16"
            />
            {{ t('analytics.frame.back') }}
          </VButton>
          <p class="analytics-panel-name">
            {{ sectionName }}
          </p>
        </div>
        <PlatformStatePanel
          :state="read.state.value"
          :empty-description="emptyDescription"
          @retry="read.retry"
        >
          <template #default="{ payload }">
            <OverviewPanel
              v-if="overview"
              :usage="payload"
              :accounts="read.accounts.value"
              :compared="read.comparedWith.value"
              :period="read.bounds.value"
              :filters="read.readWith.value"
              :read-at="read.askedAt.value"
              :measure="view.measure"
              :project-scoped="Boolean(projectId)"
              :refused="reportRefused"
              @update:measure="(measure) => change({ measure })"
              @narrow="narrow"
              @day="narrowToDay"
              @open="chooseSection"
              @retry="read.retry"
            />
            <DimensionPanel
              v-else
              v-model:table-whole="tableWhole"
              :usage="payload"
              :accounts="read.accounts.value"
              :across="view.across"
              :dimensions="filterDimensions"
              :fills="holdsSection"
              :filters="read.readWith.value"
              :read-at="read.askedAt.value"
              :measure="view.measure"
              :refused="reportRefused"
              @update:measure="(measure) => change({ measure })"
              @update:across="(across) => change({ across })"
              @narrow="narrow"
              @day="narrowToDay"
              @retry="read.retry"
            />
          </template>
        </PlatformStatePanel>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* The bar over the rail and the panel, the whole of the module's frame: the frame does not
   scroll, the rail and the panel do, each on its own. The rail is a ground on the module's
   panel, which is what parts it from the panel and the bar: a step of tone and air, no line. */
.analytics-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
}

.analytics-page-bar {
  padding: var(--space-4) var(--size-page-gutter);
}

/* One column while the list and a section take turns; beside each other, the rail's width is
   set where the room for them is measured (`usePanelRoom`). */
.analytics-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}

/* Each of the two holds what it scrolls, a copy for a reader placed out of sight among it too:
   placed against the frame, a table's hidden caption stood far under it and gave the frame
   something to scroll. */
.analytics-page-rail {
  position: relative;
  min-height: 0;
  padding: var(--space-3);
  background: var(--color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-start-end-radius: var(--radius-card);
}

.analytics-panel {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-content: start;
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) var(--size-page-gutter) var(--space-12);
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* A dimension's section stands in the panel's whole height and scrolls its own parts, so the
   panel itself holds still. */
.analytics-panel-held {
  grid-template-rows: minmax(0, 1fr);
}

/* One at a time: the list of sections on its ground across the screen, or the section in its
   place. */
.analytics-narrow {
  & .analytics-page-rail {
    padding-inline: var(--size-page-gutter);
    border-start-end-radius: 0;
  }
}

.analytics-panel-head {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
}

.analytics-panel-name {
  margin: 0;
  font: var(--font-section-title);
}
</style>
