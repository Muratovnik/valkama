<script setup lang="ts">
/**
 * The windows a card's writes open (`provideInspectorClosing`): put off, cancel a goal or a stage
 * with its list, confirm a close, and split a part off a task. Each closes on its own «Cancel» or
 * once its write went through, and then the card reads its item again.
 */
import { computed } from 'vue'

import { injectInspectorClosing } from '@/widgets/work-item-inspector/utils/useInspectorClosing.ts'

import CancelGoalDialog from '@/features/work-item-closing/CancelGoalDialog.vue'
import ConfirmCloseDialog from '@/features/work-item-closing/ConfirmCloseDialog.vue'
import DeferDialog from '@/features/work-item-closing/DeferDialog.vue'
import SplitDialog from '@/features/work-item-dividing/SplitDialog.vue'

import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

/** The card's space, where putting off until a card's close searches for that card. */
const props = defineProps<{ target: PlanningTarget | undefined }>()

const closing = injectInspectorClosing()
const item = computed(() => closing?.host.item.value ?? null)
const shown = computed(() => closing?.shown.value ?? null)
const deferring = computed(() => shown.value === 'defer')
const cancelling = computed(() => shown.value === 'cancel-goal')
const confirming = computed(() => shown.value === 'confirm')
const splitting = computed(() => closing?.dividing.value === 'split')
const given = computed(() => closing?.reason.value ?? '')
const state = computed(() => closing?.goal.value?.key ?? '')
const scope = computed(() => ({
  own: item.value?.work_item_id ?? '',
  space: props.target?.space_ref,
}))
const dismiss = () => closing?.dismiss()
const done = () => closing?.done()
</script>

<template>
  <template v-if="item">
    <DeferDialog
      :open="deferring"
      :item="item"
      :scope="scope"
      @close="dismiss"
      @done="done"
    />
    <CancelGoalDialog
      :open="cancelling"
      :item="item"
      :state="state"
      :given="given"
      @close="dismiss"
      @done="done"
    />
    <ConfirmCloseDialog
      :open="confirming"
      :item="item"
      :state="state"
      @close="dismiss"
      @done="done"
    />
    <SplitDialog
      :open="splitting"
      :item="item"
      @close="dismiss"
      @done="done"
    />
  </template>
</template>
