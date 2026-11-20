<script setup lang="ts">
/**
 * How much work stands in each state of a scope, what each goal took and has left, the work
 * outside goals, how work flowed in a period and the done work estimates are judged by: one read
 * of `GET /api/planning/volumes` (`useVolumesRead`), drawn as sections one under another.
 *
 * The space and the project are the context bar's, as Agent decisions and Participation take
 * them, so the scope is chosen once. Its own filters are the period — today, this week, the past
 * four weeks or days of the reader's own — and a kind and a label of task, in a period bar over
 * the sections (`PeriodBar`), which stays in place while they scroll. Under the kind and label
 * filter only matching tasks add up, and the goals' count at acceptance stands as «—» with its
 * reason. The label's choice offers the labels the read itself names: a label outside it would
 * narrow nothing. The view is the page's address: a reload or a pasted link reads it back.
 *
 * On top stand the numbers (`VolumesNumbers`); an open category's opens the board narrowed to it,
 * «Waiting for me» the questions window narrowed to the page's space (`requests`), and «Commits on no card» shows their list
 * under the numbers (`VolumesCommits`), where an attach reads the page again. Under them the
 * goals' tree (`VolumesGoals`), the work outside goals (`VolumesOutside`), the flow
 * (`VolumesFlow`) and the estimates (`VolumesEstimates`).
 *
 * The first wait, a failure and a scope with no work are the product's shared state panel under
 * the bar: «There is no work in this scope». A read of another view dims the last one until its
 * answer lands; a refresh that fails keeps what is shown and says so. The panel is a container of
 * its own height, which the goals' table frame is held to (`volumes-panel`), so a bar of two rows
 * on a phone leaves it no less room than it has.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import VolumesCommits from '@/pages/volumes/components/VolumesCommits.vue'
import VolumesEstimates from '@/pages/volumes/components/VolumesEstimates.vue'
import VolumesFlow from '@/pages/volumes/components/VolumesFlow.vue'
import VolumesGoals from '@/pages/volumes/components/VolumesGoals.vue'
import VolumesNumbers from '@/pages/volumes/components/VolumesNumbers.vue'
import VolumesOutside from '@/pages/volumes/components/VolumesOutside.vue'
import { useVolumesRead } from '@/pages/volumes/composables/useVolumesRead.ts'
import type { VolumesTarget } from '@/pages/volumes/utils/volumesTargets.ts'
import { readView, writeView } from '@/pages/volumes/utils/volumesView.ts'
import type { VolumesView } from '@/pages/volumes/utils/volumesView.ts'

import PeriodBar from '@/widgets/period-bar/components/PeriodBar.vue'

import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { TASK_KINDS } from '@/shared/api/volumesReadApi.ts'
import type { Volumes } from '@/shared/api/volumesReadApi.ts'
import { customDays, localDay, periodDays, PERIODS } from '@/shared/lib/periodDays.ts'
import type { Period } from '@/shared/lib/periodDays.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /** The context bar's scope: every space, a space, or a space narrowed to a project. */
    scope: OperatingScope
    /** The module's part of the address: what `writeView` wrote, or nothing. */
    routeState?: Readonly<Record<string, string | number | boolean>>
  }>(),
  { routeState: undefined },
)
const emit = defineEmits<{
  /** The board a number opens, in the page's scope. */
  go: [route: PlatformRoute]
  /** «Waiting for me» pressed: the questions window opens, on the page's space's own. */
  requests: [space: PlanningSpaceRef | null]
  /** The view's new address, in place of the one in hand. */
  state: [state: Record<string, string>]
}>()

const { t } = useI18n()

const view = computed(() => readView(props.routeState))
function change(next: Partial<VolumesView>) {
  emit('state', writeView({ ...view.value, ...next }))
}

const space = computed(() => (props.scope.kind === 'space' ? props.scope.space_ref : null))
const project = computed(() =>
  props.scope.kind === 'space' ? (props.scope.project_ref?.project_id ?? null) : null,
)

/** The day the page was opened or last read on, the last a day of the reader's own can name. */
const now = ref(new Date())
const today = computed(() => localDay(now.value))

const periods = computed(() =>
  PERIODS.map((value) => ({ value, label: t(`volumes.period.${value}`) })),
)
const barWords = computed(() => ({
  from: t('volumes.period.from'),
  label: t('volumes.period.label'),
  reversed: t('volumes.period.reversed'),
  to: t('volumes.period.to'),
}))
function choosePeriod(period: Period) {
  change(period === 'custom' ? { period, ...customDays(new Date()) } : { period })
}

const ALL = 'all'
const kinds = computed(() => [
  { value: ALL, label: t('volumes.filter.allKinds') },
  ...TASK_KINDS.map((value) => ({ value, label: t(`workItem.kind.${value}`) })),
])
function chooseKind(value: string) {
  change({ kind: TASK_KINDS.find((kind) => kind === value) ?? null })
}

/** What the line gives up while it has no room for all it holds. */
const ORDER = ['words', 'gaps', 'span'] as const

const read = useVolumesRead({
  view: () => ({ ...view.value, scope: props.scope }),
  query: () => {
    const days = periodDays(view.value, now.value)
    if (!days) return null
    return {
      ...days,
      kinds: view.value.kind ? [view.value.kind] : [],
      labels: view.value.label ? [view.value.label] : [],
      project: project.value,
      space: space.value,
    }
  },
})

/** The read on show, or the last one while another is on its way. */
const shown = computed<Volumes | null>(() => {
  const state = read.state.value
  return state.status === 'ready' || state.status === 'degraded' ? state.payload : null
})

/** The labels the read names, and the one chosen, which the read may no longer name. */
const labels = computed(() => {
  const named = new Set<string>()
  for (const row of shown.value?.outside.by_label ?? []) if (row.label) named.add(row.label)
  for (const row of shown.value?.estimates.rows ?? []) if (row.label) named.add(row.label)
  if (view.value.label) named.add(view.value.label)
  return [
    { value: ALL, label: t('volumes.filter.allLabels') },
    ...[...named]
      .sort((left, right) => left.localeCompare(right))
      .map((value) => ({
        value,
        label: value,
      })),
  ]
})
function chooseLabel(value: string) {
  change({ label: value === ALL ? null : value })
}

/** Whether the commits on no card are shown, and whether their list could not be read. */
const commitsOpen = ref(false)
const commitsUnread = ref(false)
/** The list is read again for another scope. */
const commitsScope = computed(() => `${space.value?.space_key ?? ''}:${project.value ?? ''}`)
function hearUnread(unread: boolean) {
  commitsUnread.value = unread
}

function open(target: VolumesTarget) {
  switch (target.kind) {
    case 'board': {
      emit('go', target.route)
      break
    }
    case 'questions': {
      emit('requests', space.value)
      break
    }
    case 'commits': {
      commitsOpen.value = !commitsOpen.value
      commitsUnread.value = false
      break
    }
    case 'none': {
      break
    }
  }
}

/** Read the view again as of now. */
function refresh() {
  now.value = new Date()
  void read.refresh()
}
</script>

<template>
  <section
    class="volumes-page"
    :aria-label="t('volumes.title')"
  >
    <PeriodBar
      class="volumes-bar"
      :from="view.from"
      :line-room="52"
      :order="ORDER"
      :period="view.period"
      :periods="periods"
      :to="view.to"
      :today="today"
      :words="barWords"
      @days="(next) => change(next)"
      @period="choosePeriod"
    >
      <div class="volumes-filters">
        <ChoiceSelect
          class="volumes-filter"
          size="compact"
          :label="t('volumes.filter.kind')"
          :model-value="view.kind ?? ALL"
          :options="kinds"
          @update:model-value="chooseKind"
        />
        <ChoiceSelect
          class="volumes-filter"
          size="compact"
          :label="t('volumes.filter.label')"
          :model-value="view.label ?? ALL"
          :options="labels"
          @update:model-value="chooseLabel"
        />
      </div>
      <template #end="{ short }">
        <VButton
          v-tooltip.clipped="t('volumes.refresh')"
          class="volumes-refresh"
          size="compact"
          :class="{ 'volumes-refresh-short': short }"
          @click="refresh"
        >
          <VIcon
            name="refresh"
            :size="16"
          />
          <span class="volumes-refresh-words">{{ t('volumes.refresh') }}</span>
        </VButton>
      </template>
    </PeriodBar>
    <div
      class="volumes-panel"
      :class="{ 'volumes-pending': read.pending.value }"
    >
      <PlatformStatePanel
        :state="read.state.value"
        :empty-description="t('volumes.emptyDescription')"
        @retry="refresh"
      >
        <template #default="{ payload }">
          <div class="volumes-shown">
            <VolumesNumbers
              :commits-open="commitsOpen"
              :commits-unread="commitsUnread"
              :counts="payload.counts"
              :now="now"
              :scope="scope"
              :view="view"
              @open="open"
            />
            <VolumesCommits
              v-if="commitsOpen"
              :key="commitsScope"
              :project="project"
              :space="space"
              @attached="refresh"
              @unread="hearUnread"
            />
            <VolumesGoals
              :goals="payload.goals"
              :measured-from="payload.measured_from"
              :space="space?.space_key ?? ''"
            />
            <VolumesOutside :outside="payload.outside" />
            <VolumesFlow
              :flow="payload.flow"
              :now="now"
            />
            <VolumesEstimates :estimates="payload.estimates" />
          </div>
        </template>
      </PlatformStatePanel>
    </div>
  </section>
</template>

<style scoped>
/* The bar over the panel, the whole of the module's frame: the frame does not scroll, the panel
   does, and it is a container of its own height, which the goals' table frame is held to. */
.volumes-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
  container: volumes-page / inline-size;
}

.volumes-bar {
  padding: var(--space-4) var(--size-page-gutter) var(--space-4) var(--space-5);
}

.volumes-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--space-3) var(--size-page-gutter) var(--space-6) var(--space-5);
  overflow-y: auto;
  overscroll-behavior: contain;
  container: volumes-panel / size;
}

@container main (width <= 586px) {
  .volumes-bar,
  .volumes-panel {
    padding-inline-start: var(--space-3);
  }
}

/* The sections one under another, a section's room between them. */
.volumes-shown {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-6);
  min-width: 0;
}

/* The last view while another one's answer is on its way: drawn as it stood, dimmed. */
.volumes-pending {
  opacity: 0.5;
  transition: opacity var(--duration-quick) var(--ease-out);
}

/* The kind and the label side by side, each as wide as its row leaves it. */
.volumes-filters {
  display: flex;
  flex: 0 1 auto;
  gap: var(--space-2);
  min-width: 0;
}

.volumes-filter {
  flex: 0 1 auto;
  min-width: 0;
}

/* A phone: the filters stand under the periods, as wide as their row leaves them. */
@container (width <= 30rem) {
  .volumes-filters {
    grid-area: 2 / 1 / 3 / 4;
  }

  .volumes-refresh {
    grid-area: 2 / 4 / 3 / 5;
  }
}

/* A short bar says the refresh by its icon; its words stay for assistive technology. */
.volumes-refresh-short .volumes-refresh-words {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  white-space: nowrap;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
