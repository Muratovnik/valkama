<script setup lang="ts">
/**
 * The bar above the work: one row of controls, one line of state.
 *
 * The row is the view, the filter and, on the board, the grouping, with the one
 * primary action at its end, where every module puts it. The filter is one
 * field — text and facet chips — with its two presets and its menu, because
 * the five queue segments that stood beside a search were two controls for one
 * population, and two of them repeated columns the board already draws.
 *
 * The line under it answers the filter: how much of the open work it lets
 * through, with the way back out of it. The held count rides its preset, and
 * the grouped board's lane heads say what they are themselves; the line used
 * to carry three numbers and a sentence about epics.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { CensusExclusion } from '@/pages/planning/composables/usePlanningCensus.ts'
import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'

import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'

import WorkFilterChips from '@/features/work-filter/WorkFilterChips.vue'
import WorkFilterField from '@/features/work-filter/WorkFilterField.vue'

import {
  EMPTY_WORK_FILTER,
  filterTokens,
  removeToken,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import ScopeChip from '@/shared/ui/ScopeChip.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** A refresh is in flight. */
  busy: boolean
  /** The states the workflow has, by category, for the filter menu. */
  categories: readonly WorkItemBrief['state']['category'][]
  /** The chain the board or the list is narrowed to; the graph names its own. */
  chain: string | null
  counts: { held: number; matchedClosed: number; matchedOpen: number; open: number; total: number }
  /** What the graph leaves out of its own counts. */
  exclusion: CensusExclusion | null
  /** The filter differs from the empty one. */
  filtered: boolean
  /** How the board is grouped; null while the board is not on the stage. */
  grouping: BoardGrouping | null
  /** The work the counts count, whose labels and holders the filter offers. */
  items: readonly WorkItemBrief[]
  /** The address holds the whole filter. */
  stored: boolean
  view: PlanningViewMode
  writable: boolean
}>()

const emit = defineEmits<{
  'create': []
  'exit-chain': []
  'group': [grouping: BoardGrouping]
  'view': [mode: PlanningViewMode]
}>()

const filter = defineModel<WorkFilter>('filter', { required: true })

const { t } = useI18n()

const VIEW_MODES: readonly PlanningViewMode[] = ['kanban', 'list', 'graph']
const viewSegments = computed(() =>
  VIEW_MODES.map((mode) => ({ value: mode, label: t(`workItem.view.${mode}`) })),
)
function pickView(mode: string) {
  if ((VIEW_MODES as readonly string[]).includes(mode)) emit('view', mode as PlanningViewMode)
}

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

/** «319 открытых из 1267», or what the filter let through of the open work. */
const countsText = computed(() => {
  const { matchedOpen, open, total } = props.counts
  return props.filtered
    ? t('workItem.filter.matched', { count: matchedOpen, open }, open)
    : t('workItem.filter.open', { open, total }, open)
})
/** The closed items a filter let through, which the views draw as well. */
const closedText = computed(() => {
  const count = props.counts.matchedClosed
  return props.filtered && count ? t('workItem.filter.closedToo', { count }, count) : ''
})

const tokens = computed(() => filterTokens(filter.value))
/** Where focus goes when the last chip on the narrow line is taken out. */
const field = useTemplateRef<{ focus: () => void }>('field')
function focusField() {
  field.value?.focus()
}
const chips = useTemplateRef<{ focusLast: () => boolean }>('chips')
function focusChips() {
  chips.value?.focusLast()
}
function removeChip(token: WorkFilterToken) {
  filter.value = removeToken(filter.value, token)
}

/** What the graph leaves out of the counts, as a sentence of its own. */
const exclusionText = computed(() => {
  const left = props.exclusion
  return left?.kind === 'graph-parents'
    ? t('workItem.countsExclude.graphParents', { count: left.count, open: left.open }, left.count)
    : ''
})
</script>

<template>
  <header class="workspace-head">
    <div class="workspace-tools">
      <!-- Reaching for the switch is the intent to use it: the board and the
           list are already here, so the graph is what it would download. -->
      <SegmentedControl
        class="workspace-view-segments"
        size="compact"
        :model-value="view"
        :options="viewSegments"
        :label="t('workItem.viewLabel')"
        @focusin="graphView.prefetch"
        @pointerenter="graphView.prefetch"
        @update:model-value="(mode) => emit('view', mode)"
      />
      <ChoiceSelect
        class="workspace-view-menu"
        size="compact"
        :model-value="view"
        :options="viewSegments"
        :label="t('workItem.viewLabel')"
        @focusin="graphView.prefetch"
        @update:model-value="pickView"
      />
      <WorkFilterField
        ref="field"
        v-model:filter="filter"
        class="workspace-filter"
        :categories="categories"
        :held="counts.held"
        :items="items"
        @chips="focusChips"
      />
      <!-- Grouping is on or off, so it is a switch; where the row is short its
           name stays the switch's accessible name and its hover text. -->
      <ToggleSwitch
        v-if="grouping !== null"
        class="workspace-grouping"
        :label="t('workItem.lanes.groupingLabel')"
        :title="t('workItem.lanes.groupingLabel')"
        :model-value="grouped"
        :on-label="t('workItem.lanes.grouping.epic')"
        :off-label="t('workItem.lanes.grouping.epic')"
        @update:model-value="group"
      />
      <VButton
        v-if="writable"
        class="workspace-action"
        variant="primary"
        :title="t('workItem.create')"
        @click="emit('create')"
      >
        <span aria-hidden="true">+</span
        ><span class="workspace-action-text">{{ t('workItem.create') }}</span>
      </VButton>
    </div>
    <div class="workspace-status">
      <ScopeChip
        v-if="chain"
        class="workspace-chip"
        :label="t('graph.chainChip', { reference: chain, count: counts.total })"
        :exit-label="t('graph.chainExit', { reference: chain })"
        @exit="emit('exit-chain')"
      />
      <div class="workspace-chips">
        <WorkFilterChips
          ref="chips"
          :tokens="tokens"
          @leave="focusField"
          @remove="removeChip"
        />
      </div>
      <p
        class="workspace-figures"
        role="status"
        :aria-busy="countsBusy"
      >
        <span class="workspace-fact">{{ countsText }}</span
        ><span
          v-if="closedText"
          class="workspace-closed"
        >
          · <span class="workspace-fact">{{ closedText }}</span></span
        ><template v-if="filtered">
          ·
          <VButton
            size="inline"
            variant="ghost"
            @click="filter = EMPTY_WORK_FILTER"
            >{{ t('workItem.filter.reset') }}</VButton
          ></template
        >
      </p>
      <p
        v-if="exclusionText"
        class="workspace-left-out"
      >
        {{ exclusionText }}
      </p>
      <p
        v-if="!stored"
        class="workspace-left-out"
      >
        {{ t('workItem.filter.incomplete') }}
      </p>
      <p
        v-if="!writable"
        class="workspace-note"
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
   starts, and the one primary action on the right. The head is the anchor the
   filter's menu spans on a phone. */
.workspace-head {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

/* One row that never wraps where it has room: the filter field gives up width
   before anything else does. As tall as the grouping switch's pointer target
   in every view, so the work does not move when the switch comes and goes. */
.workspace-tools {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-target);
}

.workspace-view-menu {
  display: none;
  flex: 0 0 auto;
}

.workspace-action {
  margin-inline-start: auto;
}

/* What the filter lets through, the way out of it, and what the view leaves
   out, each a line of its own text. */
.workspace-status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  min-width: 0;

  /* As tall as the reset beside the counts, so the work does not move when a
     filter turns on. */
  min-height: var(--size-control-inline);
}

.workspace-chip {
  max-width: 100%;
}

/* The picked facets, first on the line they explain; gone with the last one. */
.workspace-chips {
  min-width: 0;

  &:empty {
    display: none;
  }
}

/* The facts and the way out of the filter, as one line of words. */
.workspace-figures {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* A fact never breaks inside itself: «319 открытых из 1267» wrapped mid-number
   at 390. A separator rides on the start of the fact after it. */
.workspace-fact {
  white-space: nowrap;
}

.workspace-left-out {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
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

/* Where the row cannot hold the switch's word, the switch keeps its name as
   its accessible name and hover text. */
@container workspace (width < 1000px) {
  .workspace-grouping {
    --toggle-state-display: none;
  }
}

/* A phone: the view becomes a menu and the action its sign, so the view, the
   filter and the action hold the first line. The two rows give up their own
   boxes and wrap as one: the picked facets, the counts and the grouping
   switch share the second line instead of each taking one. */
@container workspace (width <= 556px) {
  .workspace-head {
    flex-flow: row wrap;
    align-items: center;

    /* The end of the first line, whatever room is left on it. Its own row
       of no height takes back the gap the wrap adds above it. */
    &::before {
      content: '';
      flex-basis: 100%;
      order: 1;
      margin-top: calc(-1 * var(--space-2));
    }
  }

  .workspace-tools,
  .workspace-status {
    display: contents;
  }

  .workspace-view-segments {
    display: none;
  }

  .workspace-view-menu {
    display: block;
  }

  .workspace-action {
    margin-inline-start: 0;
  }

  .workspace-action-text {
    position: absolute;
    width: 1px;
    height: 1px;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* The second line: the switch, then what the filter lets through. The
     closed items it lets through are a fact the wide bar has room for. */
  .workspace-grouping,
  .workspace-figures {
    order: 2;
  }

  .workspace-figures {
    flex: 1 1 auto;
  }

  .workspace-closed {
    display: none;
  }

  /* The chain and the picked facets each take a line under it. */
  .workspace-chip,
  .workspace-chips {
    flex: 1 1 100%;
    order: 3;
  }

  .workspace-left-out,
  .workspace-note {
    flex: 1 1 100%;
    order: 4;
  }
}
</style>
