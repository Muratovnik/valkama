<script setup lang="ts">
/**
 * One state of one lane: a ground with the lane's tiles in that state.
 *
 * It is as tall as what it draws, and it draws the first few tiles with the
 * rest one click away. A lane of ninety backlog items used to be ninety tiles
 * tall, and every lane under it that far down the board. The first tiles are
 * the ones the order of work puts next, so they are the ones worth seeing. A
 * tile moved from the keyboard past what the cell draws opens the cell, so the
 * tile is drawn where it went and keeps its focus.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemStack from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  blockedIds: Set<string>
  /** The lane's drop group: a tile crosses between the cells of its lane only. */
  group: string
  items: WorkItemBrief[]
  readyIds: Set<string>
  state: WorkflowState
  writable: boolean
  hintId?: string
}>()

const emit = defineEmits<{
  dragging: [active: boolean]
  edge: [reference: string, edge: 'first' | 'last']
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

const { t } = useI18n()

/** Tiles a cell draws before it asks to show the rest. */
const LIMIT = 3

/** The operator asked to see the whole cell, for as long as it is drawn. */
const whole = ref(false)
const limit = computed(() => (whole.value ? undefined : LIMIT))
const hidden = computed(() => !whole.value && props.items.length > LIMIT)
const showAllLabel = computed(() => t('workItem.lanes.showAll', { count: props.items.length }))

function placed(move: BoardMove, landing: StackLanding) {
  if (landing.keyboard && landing.position > LIMIT) whole.value = true
  emit('place', move, landing)
}
</script>

<template>
  <div
    class="lane-cell"
    :data-state="props.state.key"
  >
    <WorkItemStack
      class="lane-stack"
      :group="props.group"
      :state="props.state"
      :items="props.items"
      :limit="limit"
      :ready-ids="props.readyIds"
      :blocked-ids="props.blockedIds"
      :hint-id="props.hintId"
      :writable="props.writable"
      @dragging="emit('dragging', $event)"
      @edge="(reference, edge) => emit('edge', reference, edge)"
      @open="emit('open', $event)"
      @place="placed"
    />
    <VButton
      v-if="hidden"
      class="lane-more"
      variant="ghost"
      size="inline"
      @click="whole = true"
      >{{ showAllLabel }}</VButton
    >
  </div>
</template>

<style scoped>
/* A ground like a column's; an empty one stays a low ground, so the column
   still reads and a tile can still be dropped there. */
.lane-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.lane-stack {
  flex: 1 0 auto;
}

.lane-more {
  align-self: start;
}
</style>
