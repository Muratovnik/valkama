<script setup lang="ts">
/**
 * A column folded to a narrow strip (`useColumnFolds`): a chevron, the state's name running
 * down it and its count, the whole strip one press that opens it. Over the lanes the strip
 * is a cell of the row of state names, as narrow, so it keeps the chevron and the count and
 * says its name on hover; the lanes' cells under it hold nothing until it opens.
 *
 * Its name says what the press does and to which column; the count is read after it.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkflowState } from '@/shared/api/planningModel.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  count: number
  state: WorkflowState
  /** Over the lanes: one row high, without the name running down it. */
  compact?: boolean
}>()

const emit = defineEmits<{ unfold: [] }>()

const { t } = useI18n()
const stateName = useStateName()
const name = computed(() => stateName(props.state))
const label = computed(() => t('workItem.columnFold.unfold', { state: name.value }))
const countId = `${useId()}-count`
</script>

<template>
  <button
    v-tooltip.name="label"
    class="column-fold"
    type="button"
    aria-expanded="false"
    :class="{ compact: props.compact }"
    :aria-label="label"
    :aria-describedby="countId"
    :data-column-fold="props.state.state_id"
    :data-state="props.state.key"
    @click="emit('unfold')"
  >
    <VIcon
      class="fold-chevron"
      name="chevron-right"
      :size="16"
    />
    <SemanticState
      v-if="!props.compact"
      class="fold-name"
      aria-hidden="true"
      dimension="work-item-state"
      :state="props.state.category"
      :label="name"
    />
    <span
      :id="countId"
      class="fold-count"
      >{{ props.count }}</span
    >
  </button>
</template>

<style scoped>
/* The strip is the column's ground at its narrow width, and all of it is the press. */
.column-fold {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  height: 100%;
  min-height: 0;
  padding: var(--space-3) 0;
  border: 0;
  color: var(--color-text-muted);
  font: inherit;
  background: var(--color-surface);
  border-radius: var(--radius-card);
  cursor: pointer;
  scroll-snap-align: start;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  @media (forced-colors: active) {
    border: 1px solid currentcolor;
  }

  /* Over the lanes the strip is one row of the row of state names. */
  &.compact {
    flex-direction: row;
    gap: var(--space-1);
    justify-content: center;
    height: auto;
    min-height: var(--size-control-height-compact);
    padding: 0;
    background: none;
    border-radius: var(--radius-control);

    &:hover {
      background: var(--color-surface-hover);
    }
  }
}

.fold-chevron {
  flex: 0 0 auto;
}

/* The name runs down the strip, read from the top, as a spine reads. */
.fold-name {
  writing-mode: vertical-rl;
}

.fold-count {
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}
</style>
