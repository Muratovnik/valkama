<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * The row of state names over the lanes (`WorkItemLanes`): each state's name and how much
 * of it the lanes drawn hold, said once for all of them, for the eye; a lane's cells name
 * their own. A column that folds offers it after its count, and a folded one stands here
 * as its narrow strip (`WorkItemColumnFold`), its chevron and its count.
 */
import WorkItemColumnFold from '@/widgets/work-item-views/components/WorkItemColumnFold.vue'

import type { WorkflowState } from '@/shared/api/planningModel.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** What each state's column holds across the lanes drawn, by state id. */
  counts: ReadonlyMap<string, number>
  /** The states whose column folds, and those folded now, by state id. */
  foldable: ReadonlySet<string>
  folded: ReadonlySet<string>
  states: WorkflowState[]
}>()

const emit = defineEmits<{ fold: [state: WorkflowState] }>()

const { t } = useI18n()
const stateName = useStateName()
const countOf = (state: WorkflowState) => props.counts.get(state.state_id) ?? 0
const isFoldedState = (state: WorkflowState) => props.folded.has(state.state_id)
const canFold = (state: WorkflowState) => props.foldable.has(state.state_id)
const foldLabel = (state: WorkflowState) =>
  t('workItem.columnFold.fold', { state: stateName(state) })
</script>

<template>
  <div class="lanes-head">
    <template
      v-for="state in props.states"
      :key="state.state_id"
    >
      <WorkItemColumnFold
        v-if="isFoldedState(state)"
        :state="state"
        :count="countOf(state)"
        compact
        @unfold="emit('fold', state)"
      />
      <span
        v-else
        class="lanes-state"
      >
        <span
          class="lanes-state-words"
          aria-hidden="true"
        >
          <SemanticState
            dimension="work-item-state"
            :state="state.category"
            :label="stateName(state)"
          />
          <span class="lanes-state-count">{{ countOf(state) }}</span>
        </span>
        <VButton
          v-if="canFold(state)"
          v-tooltip.name="foldLabel(state)"
          class="lanes-fold"
          variant="ghost"
          size="inline"
          aria-expanded="true"
          :aria-label="foldLabel(state)"
          :data-column-fold="state.state_id"
          icon
          reach
          @click="emit('fold', state)"
        >
          <VIcon
            name="chevron-left"
            :size="16"
          />
        </VButton>
      </span>
    </template>
  </div>
</template>

<style scoped>
.lanes-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  min-height: var(--lanes-head-block);
  padding: 0 0 var(--space-2);
  background: var(--color-canvas);
}

.lanes-state {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  padding-inline: var(--space-3);
  scroll-snap-align: start;
}

.lanes-state-words {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.lanes-fold {
  margin-inline-start: auto;
}

.lanes-state-count {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}
</style>
