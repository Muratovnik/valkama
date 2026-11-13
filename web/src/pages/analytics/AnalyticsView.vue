<script setup lang="ts">
/**
 * What agent work was spent on in a period, and how that changed from the period before.
 *
 * A monitor screen that fills the module's frame: a bar of the period, the filters, how fresh the
 * figures are and a read of them again over the whole of it; under that a rail of the page's
 * sections — the overview, the tokens by kind, the subscription quota's five hours and week, then
 * a dimension each — and the panel of the section on show. The quota's two sections read where
 * each account's quota stands now (`QuotaPanel`), which no period or filter changes. The rail
 * and the panel scroll on their own, so the bar and the rail stay in sight while the panel is
 * read. Where the page leaves the panel beside the rail too narrow for its charts (`usePanelRoom`)
 * the rail is the screen, a list, and a section chosen there takes its place as a new place in the
 * history, so Back returns to the list. Beside the rail a section chosen on it or from a card of
 * the overview is a new place too, so Back returns to the section it was chosen in, and so is a
 * split chosen in a section's heading, so Back returns the split before; the period, the measure
 * and the filters change the place in hand. Each section's
 * entry on the rail carries its figures (`useRailTiles`).
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
 * A value or a period pressed in the report — a day, an hour or a minute — narrows the view to it
 * and breaks it down by task, as a new place in the history, so Back returns to the view it was
 * pressed in. Work with no task is broken down instead by where it came from (`useLineActions`).
 * A frame along a chart of periods sets the page's period to the periods it covers, the section
 * kept, as a new place too.
 *
 * The page opens on its overview (`OverviewPanel`), the period at a glance; a dimension's section
 * is its whole report.
 *
 * The periods still running, «Now» and «Today», read themselves again on an interval while the
 * page is seen (`useLiveRefresh`); no other period does.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyticsBar from '@/pages/analytics/components/AnalyticsBar.vue'
import AnalyticsRail from '@/pages/analytics/components/AnalyticsRail.vue'
import DimensionPanel from '@/pages/analytics/components/DimensionPanel.vue'
import OverviewPanel from '@/pages/analytics/components/OverviewPanel.vue'
import QuotaPanel from '@/pages/analytics/components/QuotaPanel.vue'
import TokenKindsPanel from '@/pages/analytics/components/TokenKindsPanel.vue'
import { provideLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useLiveRefresh } from '@/pages/analytics/composables/useLiveRefresh.ts'
import { usePanelRoom } from '@/pages/analytics/composables/usePanelRoom.ts'
import { useQuota } from '@/pages/analytics/composables/useQuota.ts'
import { useRailTiles } from '@/pages/analytics/composables/useRailTiles.ts'
import { provideReadWaits } from '@/pages/analytics/composables/useReadWaits.ts'
import { useRefusal } from '@/pages/analytics/composables/useRefusal.ts'
import { provideSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useUsageRead } from '@/pages/analytics/composables/useUsageRead.ts'
import type { OwnPeriod } from '@/pages/analytics/utils/analyticsPeriod.ts'
import type { ReportPart } from '@/pages/analytics/utils/panelAnswer.ts'

import {
  addressFits,
  isQuotaSection,
  localDay,
  orderFilters,
  OVERVIEW,
  QUOTA_SECTIONS,
  readAddress,
  TOKEN_KINDS_SECTION,
  writeAddress,
} from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsSection, AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { focusOnNothing } from '@/shared/lib/focusRight.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import WaitStatus from '@/shared/ui/WaitStatus.vue'

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
// The names Valkama keeps for accounts, read again at each opening; until they answer, and if
// they fail, an account is named by the start of its id as it would be with no name.
void useAccountNamesStore().read()
const words = useSpendingWords()

const view = computed(() => readAddress(props.routeState))

/** Why the last change asked for was not made, and where it was asked, until the view moves. */
const { filtersRefused, refuse, reportRefused } = useRefusal(() => view.value)

/**
 * Writes a change of the view into its address; false, with nothing written, if it does not fit.
 * A section opened — from the rail or a card's heading — and a narrowing are new places Back
 * returns from (`push`); the period, the measure, the filters and the second dimension change
 * the place in hand (`replace`). Each caller names which, so none falls to a default.
 */
function change(next: Partial<AnalyticsView>, mode: 'push' | 'replace'): boolean {
  const changed = { ...view.value, ...next }
  if (!addressFits(changed)) return false
  emit('state', writeAddress(changed), mode)
  return true
}

/** The view narrowed to one value of a dimension, broken down as that value is (`narrowedBy`). */
function narrow(dimension: UsageDimension, value: string | null, label: string, part: ReportPart) {
  const filters = orderFilters({ ...view.value.filters, [dimension]: [value] })
  if (change({ filters, ...lines.narrowedBy(dimension, value) }, 'push')) return
  refuse(part, t('analytics.drill.full', { value: label }))
}

/**
 * The view narrowed to one period pressed in a chart of periods — a day, an hour or a minute —
 * broken down by task; or, given the periods a frame covers, set to them with its section kept.
 * Either is a new place in the history, so Back returns the view it was set from.
 */
function narrowToPeriod(span: OwnPeriod, label: string, framed = false) {
  if (change(framed ? span : { ...span, by: 'work_item' }, 'push')) return
  refuse('days', t('analytics.drill.full', { value: label }))
}

/** The page's reads, asked once however many of its parts ask them (`useSharedUsage`). */
const shared = provideSharedUsage({ view: () => view.value, projectId: () => props.projectId })
/** The page's one status region for its read waits: it says the word while any of them shows. */
const { shown: readWaitShown } = provideReadWaits()
const read = useUsageRead({ shared, view: () => view.value, projectId: () => props.projectId })

const today = computed(() => localDay(read.askedAt.value))

/** The dimensions a person filters on: at a project's scope its project is already chosen. */
const filterDimensions = computed<UsageDimension[]>(() =>
  USAGE_DIMENSIONS.filter((dimension) => !(props.projectId && dimension === 'project')),
)
const lines = provideLineActions(() => filterDimensions.value)

/**
 * The page's sections, in the rail's order: the overview, the tokens by kind, the quota's five
 * hours and its week, then each dimension filtered on.
 */
const sections = computed<{ label: string; value: AnalyticsSection }[]>(() => [
  { value: OVERVIEW, label: t('analytics.frame.overview') },
  { value: TOKEN_KINDS_SECTION, label: t('analytics.kinds.section') },
  ...QUOTA_SECTIONS.map((value) => ({ value, label: t(`analytics.quota.sections.${value}`) })),
  ...filterDimensions.value.map((value) => ({ value, label: words.dimension(value) })),
])

const overview = computed(() => view.value.by === OVERVIEW)

const sectionName = computed(
  () => sections.value.find((section) => section.value === view.value.by)?.label ?? '',
)

/**
 * Whether the page is too narrow for the panel beside the rail, which then take turns; the rail's
 * own width beside the panel decides it with the page's.
 */
const page = ref<HTMLElement | null>(null)
const rail = ref<InstanceType<typeof AnalyticsRail> | null>(null)
const { narrow: narrowScreen } = usePanelRoom(page, rail)
const showsRail = computed(() => !narrowScreen.value || !view.value.open)
const showsPanel = computed(() => !narrowScreen.value || view.value.open)

const quotaSection = computed(() => (isQuotaSection(view.value.by) ? view.value.by : null))

/**
 * A section chosen on the rail or from a card's heading, as a new place in the history, so Back
 * returns to the section it was chosen in: beside the rail, or in place of the list.
 */
function chooseSection(by: AnalyticsSection) {
  if (narrowScreen.value) change({ by, open: true }, 'push')
  else if (by !== view.value.by) change({ by }, 'push')
}

/** The panel that shows the section on show, which a section opened from a card takes focus to. */
const panelBox = ref<HTMLElement | null>(null)

/** The overview card whose heading opened the section on show, given focus back on return. */
let openedFrom: UsageDimension | null = null

/**
 * A section opened from a card's heading. The heading goes with the overview, and the focus with
 * it to the page, so beside the rail it moves to the section's panel, which the section names; in
 * place of the list it moves to the way back, as any section chosen there does.
 */
function openFromCard(dimension: UsageDimension) {
  openedFrom = dimension
  chooseSection(dimension)
  if (!narrowScreen.value) moveFocus(panelBox.value)
}

/**
 * Back on the overview the focus returns to the heading of the card that opened the section,
 * once it is drawn, unless the reader has taken it out of the panel since: to a tile of the rail,
 * say, which the overview was chosen from.
 */
watch(
  [overview, () => read.state.value],
  () => {
    const card = openedFrom
    if (!overview.value || !card) return
    const heading = panelBox.value?.querySelector<HTMLElement>(
      `[data-card="${card}"] .overview-top-open`,
    )
    if (!heading) return
    openedFrom = null
    if (focusOnNothing() || panelBox.value?.contains(document.activeElement)) heading.focus()
  },
  { flush: 'post' },
)

/**
 * Where focus goes as the list and a section take turns: the way back, or the section left. Only
 * a move between them does that; the page found too narrow on opening or on a resize moves none.
 */
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
  const filters = orderFilters({ ...view.value.filters, [dimension]: values })
  if (change({ filters }, 'replace')) return
  refuse('filters', t('analytics.filters.full', { dimension: words.dimension(dimension) }))
}

const { tiles: usageTiles, refresh: refreshTiles } = useRailTiles({
  dimensions: () => filterDimensions.value,
  overview: () => read.state.value,
  overviewAt: () => read.askedAt.value,
  projectId: () => props.projectId,
  shared,
  view: () => view.value,
})

/** The quota of each account now, read whatever the view, on its own interval (`useQuota`). */
const quota = useQuota()
const tiles = computed(() => ({ ...usageTiles.value, ...quota.tiles.value }))

/** The bar's refresh reads the page, every tile of the rail and the quota again, as of now. */
function refresh() {
  shared.renew()
  void read.retry()
  void refreshTiles()
  void quota.refresh()
}

/**
 * «Now» and «Today» read themselves again while the page is seen, an interval after the last read
 * of the view, whatever asked it: a refresh, or a new period or filter.
 */
const live = computed(() => view.value.period === 'now' || view.value.period === 'today')
const liveRefresh = useLiveRefresh({ live: () => live.value, refresh })
watch(
  () => read.askedAt.value,
  () => liveRefresh.restart(),
)

/** What an empty answer suggests: a longer period, and a filter taken out only when one is set. */
const emptyDescription = computed(() => {
  if (!read.bounds.value) return t('analytics.period.incomplete')
  const filtered = Object.values(view.value.filters).some((values) => values?.length)
  return filtered ? t('analytics.empty.description') : t('analytics.empty.unfiltered')
})
</script>

<template>
  <section
    ref="page"
    class="analytics-page"
    :class="{ 'analytics-narrow': narrowScreen }"
    :aria-label="t('analytics.title')"
  >
    <!-- Always in the markup, empty until a wait has lasted: the page's waits are said here once. -->
    <WaitStatus
      class="analytics-read-wait"
      :shown="readWaitShown"
    />
    <AnalyticsBar
      v-model:adding="adding"
      class="analytics-page-bar"
      :dimensions="filterDimensions"
      :filters-refused="filtersRefused"
      :last-event-at="read.lastEventAt.value"
      :live="live"
      :today="today"
      :values="read.filterValues.value"
      :view="view"
      @amend="(next) => change(next, 'replace')"
      @filter="filter"
      @refresh="refresh"
    />

    <div class="analytics-body">
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
        ref="panelBox"
        class="analytics-panel"
        tabindex="-1"
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
        </div>
        <QuotaPanel
          v-if="quotaSection"
          :read="quota.read.value"
          :section="quotaSection"
          :now="quota.now.value"
          @retry="quota.refresh"
        />
        <PlatformStatePanel
          v-else
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
              @update:measure="(measure) => change({ measure }, 'replace')"
              @narrow="narrow"
              @step="narrowToPeriod"
              @frame="(span, label) => narrowToPeriod(span, label, true)"
              @open="openFromCard"
              @retry="read.retry"
            />
            <TokenKindsPanel
              v-else-if="view.by === TOKEN_KINDS_SECTION"
              :usage="payload"
              @retry="read.retry"
            />
            <DimensionPanel
              v-else
              :usage="payload"
              :accounts="read.accounts.value"
              :across="view.across"
              :dimensions="filterDimensions"
              :filters="read.readWith.value"
              :read-at="read.askedAt.value"
              :measure="view.measure"
              :refused="reportRefused"
              @update:measure="(measure) => change({ measure }, 'replace')"
              @update:across="(across) => change({ across }, 'push')"
              @narrow="narrow"
              @step="narrowToPeriod"
              @frame="(span, label) => narrowToPeriod(span, label, true)"
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
   panel, which is what parts it from the panel and the bar: a step of tone and air, no line.

   The page stands on one grid of columns with the module's name over it. Its left line is
   where the context bar starts that name, its inset in `AppContextBar.vue`, a step narrower in
   a main column of 586px or less: the bar's first control and the edge of the rail's entries
   (`AnalyticsRail`) stand on it, and taking turns, a section too. The bar and the panel end on
   one right edge, the module's gutter in from the page's. */
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
  padding: var(--space-4) var(--size-page-gutter) var(--space-4) var(--space-5);
}

/* One column while the list and a section take turns; beside each other, the rail's column is
   as wide as the rail asks, and the panel has the rest (`usePanelRoom` reads the rail's width to
   decide which). What the panel raises over itself — a table's held heading — stays inside it,
   under the list of filters the bar opens over it. */
.analytics-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 0;
  isolation: isolate;
}

/* The rail's ground, its scroll and its width are its own (`AnalyticsRail`), on the page's left
   line. The panel holds what it scrolls, a copy for a reader placed out of sight among it too:
   placed against the frame, a table's hidden caption stood far under it and gave the frame
   something to scroll. */
.analytics-panel {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-content: start;
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) var(--size-page-gutter) var(--space-6);
  overflow-y: auto;
  overscroll-behavior: contain;

  /* Focus taken to the section after a key rings the panel inside its edge, which the window
     and the rail would cut outside it. */
  &:focus-visible {
    outline-offset: calc(-1 * (var(--size-focus-ring) + 2px));
  }
}

/* One at a time: the list of sections on its ground across the screen, or the section in its
   place, both on the page's left line. */
.analytics-narrow .analytics-body {
  grid-template-columns: minmax(0, 1fr);
}

.analytics-narrow .analytics-panel {
  padding-inline-start: var(--space-5);
}

@container main (width <= 586px) {
  .analytics-page-bar,
  .analytics-narrow .analytics-panel {
    padding-inline-start: var(--space-3);
  }
}

.analytics-panel-head {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
}
</style>
