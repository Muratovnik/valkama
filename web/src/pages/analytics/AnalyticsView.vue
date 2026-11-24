<script setup lang="ts">
/**
 * What agent work was spent on in a period, and how that changed from the period before.
 *
 * A monitor screen that fills the module's frame: a bar of the period, the filters, how fresh the
 * figures are and a read of them again over the whole of it; under that a rail of the page's
 * sections — the overview, the tokens by kind, the subscription quota's five hours and week, the
 * pauses before model requests, then a dimension each — and the panel of the section on show.
 * The quota's two sections read where each account's quota stands now (`QuotaPanel`), which no
 * filter changes; the period reaches only each window's step line, which draws every window of
 * its kind the period overlaps. The pauses read the period alone, and only while their section is
 * on show (`PausesPanel`). The rail and the panel scroll on their own, so the bar and the rail stay in sight while the panel is
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
 * A value pressed in the report — a bar, a sector, a segment, a legend entry, a name in a table —
 * opens its side panel over the page (`DetailPanel`, `useDetail`), and the page stays as it was;
 * the panel is a part of the view, so Back closes it and a reload opens it again. A task's value
 * is a link to its card as well, which a press with a modifier or the middle button opens
 * elsewhere (`useLineActions`). The panel's «Add to filter» adds the value to its dimension's
 * filter beside the values there, as choosing it in the filter's field does, with the section kept
 * and the panel closed, as a new place in the history (`usePageFilter`). A period pressed in the
 * report — a day, an hour or a minute — narrows the view to it and breaks it down by task, a new
 * place too, so Back returns to the view it was pressed in. A frame along a chart of periods sets
 * the page's period to the periods it covers, the section kept, as a new place too.
 *
 * The page opens on its overview (`OverviewPanel`), the period at a glance; a dimension's section
 * is its whole report.
 *
 * The periods still running, «Now» and «Today», read themselves again on an interval while the
 * page is seen (`useLiveRefresh`); no other period does.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AnalyticsBar from '@/pages/analytics/components/AnalyticsBar.vue'
import AnalyticsRail from '@/pages/analytics/components/AnalyticsRail.vue'
import DetailPanel from '@/pages/analytics/components/DetailPanel.vue'
import DimensionPanel from '@/pages/analytics/components/DimensionPanel.vue'
import OverviewPanel from '@/pages/analytics/components/OverviewPanel.vue'
import PausesPanel from '@/pages/analytics/components/PausesPanel.vue'
import QuotaPanel from '@/pages/analytics/components/QuotaPanel.vue'
import TokenKindsPanel from '@/pages/analytics/components/TokenKindsPanel.vue'
import { provideColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { useDetail } from '@/pages/analytics/composables/useDetail.ts'
import { useLiveRefresh } from '@/pages/analytics/composables/useLiveRefresh.ts'
import { providePageFilter } from '@/pages/analytics/composables/usePageFilter.ts'
import { usePageSections } from '@/pages/analytics/composables/usePageSections.ts'
import { usePanelRoom } from '@/pages/analytics/composables/usePanelRoom.ts'
import { useQuota } from '@/pages/analytics/composables/useQuota.ts'
import { useRailTiles } from '@/pages/analytics/composables/useRailTiles.ts'
import { provideReadWaits } from '@/pages/analytics/composables/useReadWaits.ts'
import { useRefusal } from '@/pages/analytics/composables/useRefusal.ts'
import { provideScopeWords } from '@/pages/analytics/composables/useScopeWords.ts'
import { useSectionFocus } from '@/pages/analytics/composables/useSectionFocus.ts'
import { provideSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { useUsageRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { periodStart } from '@/pages/analytics/utils/analyticsPeriod.ts'
import type { OwnPeriod } from '@/pages/analytics/utils/analyticsPeriod.ts'

import {
  addressFits,
  isQuotaSection,
  localDay,
  OVERVIEW,
  PAUSES_SECTION,
  readAddress,
  TOKEN_KINDS_SECTION,
  writeAddress,
} from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsSection, AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import WaitStatus from '@/shared/ui/WaitStatus.vue'

const props = withDefaults(
  defineProps<{
    /** Whether a card stands over the page, which the side panel waits under, closed. */
    covered?: boolean
    /** The project the page is scoped to; every figure is that project's. */
    projectId?: string | null
    /** That project's name, as the shell names it; its id where it has none. */
    projectTitle?: string | null
    /** The module's part of the address: what `writeAddress` wrote, or nothing. */
    routeState?: Readonly<Record<string, string | number | boolean>>
    /** The space the page is scoped to, by its key; every figure is of the work its board holds. */
    space?: string | null
    /** That space's name, as the app names it; its key where it has none. */
    spaceTitle?: string | null
  }>(),
  { routeState: undefined, projectId: null, space: null, covered: false },
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
 * A section opened — from the rail or a card's heading — a narrowing and the side panel opened or
 * closed are new places Back returns from (`push`); the period, the measure, the filters and the
 * second dimension change the place in hand (`replace`). Each caller names which, so none falls
 * to a default.
 */
function change(next: Partial<AnalyticsView>, mode: 'push' | 'replace'): boolean {
  const changed = { ...view.value, ...next }
  if (!addressFits(changed)) return false
  emit('state', writeAddress(changed), mode)
  return true
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

/** What the context strip narrows every read of the page to; the quota is an account's and is not. */
const scope = () => ({ space: props.space, projectId: props.projectId })
/** The page's reads, asked once however many of its parts ask them (`useSharedUsage`). */
const shared = provideSharedUsage({ view: () => view.value, scope })
/** What the page's colours are ranked over: the period without its filters (`useColourPlaces`). */
const places = provideColourPlaces({ shared, view: () => view.value, scope })
/** The page's one status region for its read waits: it says the word while any of them shows. */
const { shown: readWaitShown } = provideReadWaits()
const read = useUsageRead({ places, shared, view: () => view.value, scope })

const today = computed(() => localDay(read.askedAt.value))

/** Which projects the figures are of, beside each section's heading and in the overview's «ⓘ». */
const scopeWords = provideScopeWords({
  id: () => props.projectId,
  space: () => (props.space ? (props.spaceTitle ?? props.space) : null),
  title: () => props.projectTitle ?? null,
})
/** Whether the view's read failed with nothing to show, which the panel says. */
const readFailed = computed(() => read.state.value.status === 'error')

/** The dimensions a person filters on: at a project's scope its project is already chosen. */
const filterDimensions = computed<UsageDimension[]>(() =>
  USAGE_DIMENSIONS.filter((dimension) => !(props.projectId && dimension === 'project')),
)

/** The page's sections, the name of the one on show and the rail's tiles (`usePageSections`). */
const { sections, sectionName, tiles } = usePageSections({
  dimensions: () => filterDimensions.value,
  shown: () => view.value.by,
  tiles: () => ({ ...usageTiles.value, ...quota.tiles.value }),
})

const overview = computed(() => view.value.by === OVERVIEW)

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

/** How many times the bar asked a refresh, which the pauses' panel reads again on. */
const refreshes = ref(0)

/**
 * A section chosen on the rail or from a card's heading, as a new place in the history, so Back
 * returns to the section it was chosen in: beside the rail, or in place of the list.
 */
function chooseSection(by: AnalyticsSection) {
  if (narrowScreen.value) change({ by, open: true }, 'push')
  else if (by !== view.value.by) change({ by }, 'push')
}

/** The panel that shows the section on show, and the way back to the list on a narrow page. */
const panelBox = ref<HTMLElement | null>(null)
const back = ref<InstanceType<typeof VButton> | null>(null)
const { openFromCard } = useSectionFocus({
  back: () => back.value?.$el as HTMLElement | undefined,
  choose: chooseSection,
  drawn: () => read.state.value,
  focusList: () => rail.value?.focusSelected(),
  narrow: () => narrowScreen.value,
  open: () => view.value.open,
  overview: () => overview.value,
  panel: panelBox,
})

/**
 * The dimensions whose values the filter's menu shows, which are read for it as it shows them and
 * again for a new period: none while the menu is closed.
 */
const offered = ref<readonly UsageDimension[]>([])
watch(
  [offered, () => read.bounds.value],
  ([dimensions]) => {
    if (dimensions.length) void read.offer(dimensions)
  },
  { immediate: true },
)

/**
 * The page's filters, set from their fields and added to from a value's panel or an account of the
 * quota; a value the address cannot hold is refused under the filters.
 */
const pageFilter = providePageFilter({
  change,
  full: (dimension) =>
    refuse('filters', t('analytics.filters.full', { dimension: words.dimension(dimension) })),
  view: () => view.value,
})

const { tiles: usageTiles, refresh: refreshTiles } = useRailTiles({
  dimensions: () => filterDimensions.value,
  overview: () => read.state.value,
  overviewAt: () => read.askedAt.value,
  places,
  scope,
  shared,
  view: () => view.value,
})

/**
 * The quota of each account now, read whatever the view, on its own interval (`useQuota`), with
 * each window's earlier windows since the start of the period on show, which its line draws.
 */
const quota = useQuota({ from: () => periodStart(view.value, new Date()) })

/** The side panel over the page: what opens and closes it, and what it asks of the page. */
const detail = useDetail({
  change,
  covered: () => props.covered,
  filter: pageFilter,
  refuse,
  view: () => view.value,
})

/** The bar's refresh reads the page, every tile of the rail, the quota and the pauses again. */
function refresh() {
  shared.renew()
  places.renew()
  void read.retry()
  void refreshTiles()
  void quota.refresh()
  refreshes.value += 1
}

/**
 * «Now» and «Today» read themselves again while the page is seen, an interval after the last read
 * of the view, whatever asked it: a refresh, or a new period or filter. Their period chart opens
 * on the step running (`live`).
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
      class="analytics-page-bar"
      :dimensions="filterDimensions"
      :filters-refused="filtersRefused"
      :last-event-at="read.lastEventAt.value"
      :live="live"
      :read-failed="readFailed"
      :today="today"
      :values="read.filterValues.value"
      :view="view"
      @amend="(next) => change(next, 'replace')"
      @filter="pageFilter.set"
      @need="(dimensions) => (offered = dimensions)"
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
        <PausesPanel
          v-else-if="view.by === PAUSES_SECTION"
          :view="view"
          :refreshes="refreshes"
          :project-id="projectId"
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
              :live="live"
              :read-at="read.askedAt.value"
              :measure="view.measure"
              :project-scoped="Boolean(projectId)"
              :scope="scopeWords.about"
              :refused="reportRefused"
              @update:measure="(measure) => change({ measure }, 'replace')"
              @inspect="detail.inspect"
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
              :live="live"
              :read-at="read.askedAt.value"
              :measure="view.measure"
              :refused="reportRefused"
              @update:measure="(measure) => change({ measure }, 'replace')"
              @update:across="(across) => change({ across }, 'push')"
              @inspect="detail.inspect"
              @all="detail.all"
              @step="narrowToPeriod"
              @frame="(span, label) => narrowToPeriod(span, label, true)"
              @retry="read.retry"
            />
          </template>
        </PlatformStatePanel>
      </section>
    </div>
    <DetailPanel
      :across="view.across"
      :compared="read.comparedWith.value"
      :detail="detail.detail.value"
      :filters="read.readWith.value"
      :live="live"
      :measure="view.measure"
      :notice="detail.notice.value"
      :open="detail.open.value"
      :page="read.state.value"
      :quota="quota.read.value"
      :read-at="read.askedAt.value"
      @close="detail.close"
      @inspect="detail.inspectHere"
      @add="detail.add"
    />
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
   something to scroll. It keeps its scrollbar's room whether it scrolls or not, paid for out of
   its end inset, so what it holds ends on the bar's right edge either way: with the room taken
   only while it scrolled, a section ended 10px short of the bar while it scrolled and on the
   bar's edge when it did not. */
.analytics-panel {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-content: start;
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) calc(var(--size-page-gutter) - var(--size-scrollbar)) var(--space-6)
    var(--size-page-gutter);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;

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
