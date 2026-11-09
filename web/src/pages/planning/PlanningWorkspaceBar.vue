<script setup lang="ts">
/**
 * The bar above the work: one row of controls, one line of state.
 *
 * The row is the view and its menu, then the filter, with the one primary action
 * at its end, where every module puts it. The menu stands by the view because what
 * it holds arranges what is drawn — the board's grouping — or brings a whole view
 * back, a saved one (`PlanningViewMenu`); everything to the right of it narrows
 * what is drawn, so the two are not read as one set of filters. The filter is one
 * field — text and facet chips — and the menu it opens, because the five queue
 * segments that stood beside a search were two controls for one population, and two
 * of them repeated columns the board already draws. The two presets that stood
 * beside it, and the grouping that stood among them, read as three filters; the
 * presets are conditions in the filter's menu now.
 *
 * The line under it answers the filter: how much of the open work it lets
 * through, with the way back out of it. The held count rides its condition in the
 * filter's menu. On the grouped board the line also says how many epics are drawn
 * as rows, the one thing its columns do not count.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { CensusExclusion } from '@/pages/planning/composables/usePlanningCensus.ts'
import PlanningViewMenu from '@/pages/planning/PlanningViewMenu.vue'
import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'

import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'

import WorkFilterChips from '@/features/work-filter/WorkFilterChips.vue'
import WorkFilterField from '@/features/work-filter/WorkFilterField.vue'

import {
  EMPTY_WORK_FILTER,
  filterTokens,
  negateToken,
  removeToken,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import ScopeChip from '@/shared/ui/ScopeChip.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
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
  /** The module's address state, which a saved view keeps. */
  routeState: Record<string, string | number | boolean> | undefined
  /** The address holds the whole filter. */
  stored: boolean
  view: PlanningViewMode
  /** The planning space the views are saved in. */
  viewPlace: string
  writable: boolean
  /** The space is being read, so the bar has nothing to count yet and says no number. */
  reading?: boolean
}>()

const emit = defineEmits<{
  'create': []
  'exit-chain': []
  /** Search every project for the filter's text, from the last row of its menu. */
  'find': [text: string]
  'group': [grouping: BoardGrouping]
  /** A saved view chosen: the address state it keeps. */
  'state': [state: Record<string, string | number | boolean>]
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
const countsBusy = computed(() => (props.busy || props.reading ? true : undefined))
/** The held condition's count, which a space still being read does not have. */
const heldCount = computed(() => (props.reading ? null : props.counts.held))

/** «319 открытых из 1267», or what the filter let through of the open work. */
const countsText = computed(() => {
  const { matchedOpen, open, total } = props.counts
  return props.filtered
    ? t('workItem.filter.matched', { matched: matchedOpen, open }, open)
    : t('workItem.filter.open', { open, total }, open)
})
/**
 * The closed items a filter let through, said only when it let through no open
 * one: beside open matches they are the views' own extra items and the line
 * does not carry them.
 */
const closedText = computed(() => {
  const closed = props.counts.matchedClosed
  return props.filtered && props.counts.matchedOpen === 0 && closed
    ? t('workItem.filter.closedToo', { closed }, closed)
    : ''
})
/**
 * The epics the grouped board draws as rows, counted by the census exclusion the
 * counts already use: the board's columns do not hold them.
 */
const rowsText = computed(() => {
  const left = props.exclusion
  return props.grouping === 'epic' && left?.kind === 'lane-heads'
    ? t('workItem.countsExclude.laneHeads', { epics: left.count }, left.count)
    : ''
})

const tokens = computed(() => filterTokens(filter.value))
const labelsAny = computed(() => filter.value.labelsMatch === 'any')
/** Where focus goes when the last chip on the narrow line is taken out. */
const field = useTemplateRef<{ focus: () => void }>('field')
function focusField() {
  field.value?.focus()
}
/** Reset takes the button that did it away, so the caret goes to the field. */
function reset() {
  filter.value = EMPTY_WORK_FILTER
  focusField()
}
const chips = useTemplateRef<{ focusLast: () => boolean }>('chips')
function focusChips() {
  chips.value?.focusLast()
}
function removeChip(token: WorkFilterToken) {
  filter.value = removeToken(filter.value, token)
}
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
      <PlanningViewMenu
        :grouping="grouping"
        :place="viewPlace"
        :state="routeState"
        @group="(value) => emit('group', value)"
        @state="(state) => emit('state', state)"
      />
      <WorkFilterField
        ref="field"
        v-model:filter="filter"
        class="workspace-filter"
        :categories="categories"
        :held="heldCount"
        :items="items"
        @chips="focusChips"
        @find="(text) => emit('find', text)"
      />
      <VButton
        v-if="writable"
        v-tooltip.clipped="t('workItem.create')"
        class="workspace-action"
        variant="primary"
        reach
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
          :labels-any="labelsAny"
          :tokens="tokens"
          @leave="focusField"
          @negate="(token) => (filter = negateToken(filter, token))"
          @remove="removeChip"
        />
      </div>
      <p
        class="workspace-figures"
        role="status"
        :aria-busy="countsBusy"
      >
        <span
          v-if="!reading"
          class="workspace-fact"
          >{{ countsText }}</span
        ><span
          v-if="closedText"
          class="workspace-closed"
        >
          · <span class="workspace-fact">{{ closedText }}</span></span
        ><span
          v-if="rowsText"
          class="workspace-rows"
        >
          · <span class="workspace-fact">{{ rowsText }}</span></span
        ><template v-if="filtered">
          ·
          <VButton
            size="inline"
            variant="ghost"
            @click="reset"
            >{{ t('workItem.filter.reset') }}</VButton
          ></template
        >
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

/* One row of one height that never wraps where it has room: the filter field
   gives up width before anything else does. */
.workspace-tools {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-height-compact);
}

.workspace-view-menu {
  display: none;
  flex: 0 0 auto;
}

.workspace-action {
  min-height: var(--size-control-height-compact);
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

/* The facts and the way out of the filter, as one line of words. A line tall while the
   space is read and there is no fact yet, so the bar does not move when one arrives. */
.workspace-figures {
  min-width: 0;
  min-block-size: 1lh;
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
    margin-top: var(--space-hair);
  }
}

/* A phone: the view becomes a menu and the action its sign, so the view, its
   menu, the filter and the action hold the first line. The two rows give up their
   own boxes and wrap as one: the picked facets and the counts share the second
   line instead of each taking one. */
@container workspace (width <= 624px) {
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

  /* The action is its sign alone here, so it reaches as an icon button does (`reach`). */
  .workspace-action-text {
    position: absolute;
    width: 1px;
    height: 1px;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* The second line: what the filter lets through. As tall as the reset that joins
     it, as the wide bar's line is, so the work does not move when a filter turns on. */
  .workspace-figures {
    flex: 1 1 auto;
    align-content: center;
    order: 2;
    min-block-size: var(--size-control-inline);
  }

  /* The closed items and the epics drawn as rows are facts the wide bar has room
     for: on a phone the line keeps the counts and the reset, and a third
     fact would make the bar taller while a filter turns on. */
  .workspace-closed,
  .workspace-rows {
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
