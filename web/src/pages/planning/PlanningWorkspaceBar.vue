<script setup lang="ts">
/**
 * The bar above the work: what is drawn and how, then how much of it.
 *
 * Two rows and no more. The first holds the controls that choose what the stage
 * draws — the view, the queue, the search and, on the board, the grouping — as
 * compact controls on one row; the second says what is drawn and how much of it,
 * with the one primary action at its end. Four rows used to stand between the
 * module title and the first card, which left a narrow window a third of its
 * height for the work.
 *
 * The queue is five segments where the row holds them beside the search, and a
 * menu where it does not; the bar's own width decides, so exactly one of the two
 * is ever shown, and the other is out of the tab order as well as out of sight.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { CensusExclusion } from '@/pages/planning/composables/usePlanningCensus.ts'
import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'

import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'

import type { WorkQueue } from '@/shared/api/planningModel.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import ScopeChip from '@/shared/ui/ScopeChip.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** A refresh is in flight. */
  busy: boolean
  /** The chain the board or the list is narrowed to; the graph names its own. */
  chain: string | null
  counts: { held: number; open: number; total: number }
  /** What the view on the stage leaves out of its own counts. */
  exclusion: CensusExclusion | null
  /** How the board is grouped; null while the board is not on the stage. */
  grouping: BoardGrouping | null
  /** How many counted items the queue and the search let through, when either narrows. */
  matches: number | null
  view: PlanningViewMode
  writable: boolean
}>()

const emit = defineEmits<{
  'create': []
  'exit-chain': []
  'group': [grouping: BoardGrouping]
  'view': [mode: PlanningViewMode]
}>()

const queue = defineModel<WorkQueue>('queue', { required: true })
const query = defineModel<string>('query', { required: true })

const { t } = useI18n()

/**
 * Clearing the search hands the caret back to the field: the button that did it
 * goes away with the text, and focus left on it would fall to the page.
 */
const search = ref<HTMLElement | null>(null)
function clearSearch() {
  query.value = ''
  search.value?.querySelector('input')?.focus()
}

const VIEW_MODES: readonly PlanningViewMode[] = ['kanban', 'list', 'graph']
const viewSegments = computed(() =>
  VIEW_MODES.map((mode) => ({ value: mode, label: t(`workItem.view.${mode}`) })),
)

const QUEUES: readonly WorkQueue[] = ['all', 'ready', 'assigned', 'blocked', 'review']
const queueSegments = computed(() =>
  QUEUES.map((value) => ({ value, label: t(`workItem.queue.${value}`) })),
)
/** The same queues as a menu, where «All» alone on the trigger would not say all of what. */
const queueMenu = computed(() =>
  queueSegments.value.map((option) =>
    option.value === 'all' ? { ...option, label: t('workItem.queueMenuAll') } : option,
  ),
)

/**
 * `aria-busy` while a refresh is in flight, and absent otherwise.
 *
 * Absent rather than `false`: the counts are not busy between refreshes, and
 * `aria-busy="false"` is a claim about a state the row is not in.
 */
const countsBusy = computed(() => (props.busy ? true : undefined))

const grouped = computed(() => props.grouping === 'epic')
function group(on: boolean) {
  emit('group', on ? 'epic' : 'none')
}

/**
 * What the view leaves out of the counts, as a sentence of its own. It was a
 * lowercase fragment run on after the counts («lane epics outside the columns:
 * 26»), which read as a third count rather than as the reason the drawing holds
 * fewer cards than the line above says.
 */
const exclusionText = computed(() => {
  const left = props.exclusion
  if (left === null) return ''
  return left.kind === 'lane-heads'
    ? t('workItem.countsExclude.laneHeads', { count: left.count }, left.count)
    : t('workItem.countsExclude.graphParents', { count: left.count, open: left.open }, left.count)
})
</script>

<template>
  <header class="workspace-head">
    <div class="workspace-tools">
      <!-- Reaching for the switch is the intent to use it: the board and the
           list are already here, so the graph is what it would download. -->
      <SegmentedControl
        size="compact"
        :model-value="view"
        :options="viewSegments"
        :label="t('workItem.viewLabel')"
        @focusin="graphView.prefetch"
        @pointerenter="graphView.prefetch"
        @update:model-value="(mode) => emit('view', mode)"
      />
      <SegmentedControl
        v-model="queue"
        class="workspace-queue-segments"
        size="compact"
        :options="queueSegments"
        :label="t('workItem.queueLabel')"
      />
      <ChoiceSelect
        v-model="queue"
        class="workspace-queue-menu"
        size="compact"
        :options="queueMenu"
        :label="t('workItem.queueLabel')"
      />
      <div
        ref="search"
        class="workspace-search"
      >
        <VTextInput
          v-model="query"
          class="workspace-search-field"
          size="compact"
          :label="t('workItem.searchLabel')"
          :placeholder="t('workItem.searchPlaceholder')"
          hide-label
        />
        <VButton
          v-if="query"
          size="inline"
          variant="ghost"
          :aria-label="t('workItem.clearSearch')"
          :title="t('workItem.clearSearch')"
          icon
          @click="clearSearch"
          ><VIcon
            name="close"
            :size="16"
        /></VButton>
      </div>
      <!-- Grouping is on or off, so it is a switch: a pair of segments spent the
           width the search needed on saying «no grouping». -->
      <ToggleSwitch
        v-if="grouping !== null"
        :label="t('workItem.lanes.groupingLabel')"
        :model-value="grouped"
        :on-label="t('workItem.lanes.grouping.epic')"
        :off-label="t('workItem.lanes.grouping.epic')"
        @update:model-value="group"
      />
    </div>
    <div class="workspace-status">
      <ScopeChip
        v-if="chain"
        class="workspace-chip"
        :label="t('graph.chainChip', { reference: chain, count: counts.total })"
        :exit-label="t('graph.chainExit', { reference: chain })"
        @exit="emit('exit-chain')"
      />
      <p class="workspace-figures">
        <span
          class="workspace-counts"
          :aria-busy="countsBusy"
          ><span class="workspace-fact">{{ t('workItem.spaceOpen', counts) }}</span> ·
          <span class="workspace-fact">{{ t('workItem.spaceHeld', counts) }}</span></span
        >
        <span
          v-if="matches !== null"
          class="workspace-counts"
          role="status"
          >{{ t('workItem.matchCount', { count: matches, total: counts.total }) }}</span
        >
      </p>
      <p
        v-if="exclusionText"
        class="workspace-left-out"
      >
        {{ exclusionText }}
      </p>
      <VButton
        v-if="writable"
        class="workspace-action"
        variant="primary"
        @click="emit('create')"
      >
        <span aria-hidden="true">+</span>{{ t('workItem.create') }}
      </VButton>
      <p
        v-else
        class="workspace-action workspace-note"
        role="status"
        data-state="unavailable"
      >
        <VIcon
          name="info"
          class="workspace-note-icon"
          :size="16"
        />{{ t('platform.coreWrites.primaryOwnerRequired') }}
      </p>
    </div>
  </header>
</template>

<style scoped>
/* One grammar across every module: the view switcher on the left, where the eye
   starts, and the one primary action on the right. */
.workspace-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

/* Compact controls in one row, the search taking what the others leave. Where
   the row runs out it wraps whole controls, and the search keeps a width a
   reference fits in. */
.workspace-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;

  /* As tall as the grouping switch's pointer target in every view, so the work
     does not move when a view without the switch takes the stage. */
  min-height: var(--size-control-target);
}

.workspace-search {
  display: flex;
  flex: 1 1 160px;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
}

.workspace-search-field {
  flex: 1 1 auto;
}

/* Five segments need most of the row; below the width where they still leave
   the search room for a reference, the menu takes them over. */
.workspace-queue-menu {
  display: none;
  flex: 0 0 auto;
}

@container workspace (width < 1120px) {
  .workspace-queue-segments {
    display: none;
  }

  .workspace-queue-menu {
    display: block;
  }
}

/* What is drawn and how much of it, then the action. The counts wrap inside
   their own column, so the action never drops to a row of its own; what the
   view leaves out stands on the line under them, inside the action's height. */
.workspace-status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  row-gap: var(--space-half);
  align-content: center;
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-height);
}

.workspace-chip {
  grid-row: 1 / span 2;
  grid-column: 1;
  max-width: 100%;
  margin-inline-end: var(--space-3);
}

.workspace-figures {
  display: flex;
  flex-wrap: wrap;
  grid-row: 1;
  grid-column: 2;
  gap: var(--space-1) var(--space-3);
  min-width: 0;
  margin: 0;
}

.workspace-left-out {
  grid-row: 2;
  grid-column: 2;
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.workspace-action {
  grid-row: 1 / span 2;
  grid-column: 3;
  margin-inline-start: var(--space-3);
}

.workspace-counts {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* A fact never breaks inside itself: «Открыто: 319 из 1267» wrapped mid-number at 390. */
.workspace-fact {
  white-space: nowrap;
}

.workspace-note {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  max-width: 54ch;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);

  .workspace-note-icon {
    flex: 0 0 auto;
    margin-top: var(--space-hair);
  }
}

/* The chain chip takes a line of its own so the counts keep theirs beside the
   action. */
@container workspace (width <= 556px) {
  /* Dense, so the action still takes the row beside the counts while what the
     view leaves out, written between them, takes the row under both. */
  .workspace-status {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-auto-flow: row dense;
    row-gap: var(--space-2);
  }

  .workspace-chip {
    grid-column: 1 / -1;
    justify-self: start;
    margin-inline-end: 0;
  }

  .workspace-figures {
    grid-row: auto;
    grid-column: 1;
  }

  .workspace-action {
    grid-row: auto;
    grid-column: 2;
  }

  /* Beside the action the column is a third of a phone's width, and the
     sentence broke over three lines in it; under both it takes the full row. */
  .workspace-left-out {
    grid-row: auto;
    grid-column: 1 / -1;
  }
}
</style>
