<script setup lang="ts">
/**
 * A holder as a card prints it, and the way to its session: who it is, shortened as
 * everywhere, and an `OpenAction` when there is a session behind them. A person, a
 * browser or a label that cannot name a session stays the text it always was.
 */
import { computed } from 'vue'

import OpenAction from '@/features/session-open/OpenAction.vue'

import type { Executor } from '@/shared/api/executorModel.ts'
import { holderName } from '@/shared/lib/actor.ts'

const props = withDefaults(
  defineProps<{
    /** The holder as it was written. */
    holder: string
    detail?: string
    executor?: Executor | null
    size?: 'compact' | 'inline'
    variant?: 'ghost' | 'text'
  }>(),
  { detail: '', executor: null, size: 'inline', variant: 'text' },
)

const name = computed(() => holderName(props.holder))
/** The holder as it was written, which the line shortens, and what they are to the item. */
const lines = computed(() => [props.holder, props.detail].filter(Boolean).join('\n'))
</script>

<template>
  <OpenAction
    v-if="executor?.session"
    :session="executor.session"
    :executor="executor"
    :name="name"
    :detail="lines"
    :size="size"
    :variant="variant"
  />
  <span
    v-else
    class="executor-link-name"
    :title="holder"
    >{{ name }}</span
  >
</template>

<style scoped>
/* As high in its line as a button's words stand in theirs, so a step's holder reads at one
   height whether it can be pressed or not. */

/* As high in its line as a button's words stand in theirs, so a step's holder reads at one
   height whether it can be pressed or not. */
.executor-link-name {
  min-width: 0;
  padding: var(--space-1) 0 var(--space-1) var(--space-2);
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
