<script setup lang="ts">
/**
 * What the card asks or reports before the reader goes on: a refused write in the
 * server's words, a write that failed for another reason, and the questions before a
 * takeover or a lost draft, and the reason a cancel asks in place. Each stands under the bar at full width and stays in view
 * while the card scrolls, because a refusal of a tick far down the card has to be seen
 * however far down it was made, and the action a question is about may have been
 * pressed in the bar, which has no room for it. The cancel stands here because it is asked
 * where the state is changed, under the bar the card scrolls under.
 *
 * The questions before converting work or moving it out of its goal stand here for the same
 * reason: they are chosen in the bar's «…» menu.
 *
 * The host owns every answer; this only words and places them. The cancel's strip and the
 * dividing ones are the card's closing writes' (`provideInspectorClosing`), which own whether
 * one is asked.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorRefusal from '@/widgets/work-item-inspector/components/InspectorRefusal.vue'
import { injectInspectorClosing } from '@/widgets/work-item-inspector/utils/useInspectorClosing.ts'
import type { RefusalNotice } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import CancelReasonStrip from '@/features/work-item-closing/CancelReasonStrip.vue'
import DividingStrip from '@/features/work-item-dividing/DividingStrip.vue'

import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'

const props = defineProps<{
  /** Whether the draft question is open. */
  asking: boolean
  busy: boolean
  /** A write that failed without a refusal behind it; empty for none. */
  error: string
  notice: RefusalNotice | null
  /** The takeover question while it is asked; empty otherwise. */
  takeover: string
  /** The kinds of draft that would be lost, as the draft guard names them. */
  unsaved: readonly string[]
}>()

const emit = defineEmits<{
  'discard': []
  'dismiss': []
  'force': []
  'guard': [guard: string]
  'keep': []
  'keep-holder': []
  'take-over': []
}>()

const { t } = useI18n()
const closing = injectInspectorClosing()
const cancelling = computed(() => {
  const item = closing?.host.item.value
  const state = closing?.asking.value
  return item && state ? { item, state } : null
})
/** The question before a dividing write the «…» menu chose; the split's is a window. */
const dividing = computed(() => {
  const item = closing?.host.item.value
  const action = closing?.dividing.value
  return item && action && action !== 'split' ? { item, action } : null
})
/** Where a move out lands: the triage state the item stands in, or its workflow's first. */
const triage = computed(() => {
  const item = closing?.host.item.value
  return item?.state?.category === 'triage'
    ? item.state
    : (closing?.host.workflow()?.states.find((state) => state.category === 'triage') ?? null)
})
const keepWork = () => closing?.dismiss()
const done = () => closing?.done()
const showList = (reason: string) => closing?.list(reason)

const discardQuestion = computed(() =>
  t('workItem.discard.question', {
    drafts: props.unsaved
      .map((kind) => t(kind === 'answer' ? 'requests.answerDraft' : `workItem.discard.${kind}`))
      .join(', '),
  }),
)
</script>

<template>
  <div class="head-stack">
    <InspectorRefusal
      v-if="notice"
      :notice="notice"
      :busy="busy"
      @dismiss="emit('dismiss')"
      @force="emit('force')"
      @guard="(guard) => emit('guard', guard)"
    />
    <p
      v-if="error"
      class="head-error"
      role="alert"
    >
      {{ error }}
    </p>
    <ConfirmStrip
      v-if="takeover"
      :message="takeover"
      :confirm-label="t('workItem.takeOverConfirm')"
      :cancel-label="t('workItem.cancel')"
      @confirm="emit('take-over')"
      @cancel="emit('keep-holder')"
    />
    <ConfirmStrip
      v-if="asking"
      tone="danger"
      :message="discardQuestion"
      :confirm-label="t('workItem.discard.confirm')"
      :cancel-label="t('workItem.discard.keep')"
      @confirm="emit('discard')"
      @cancel="emit('keep')"
    />
    <CancelReasonStrip
      v-if="cancelling"
      :item="cancelling.item"
      :state="cancelling.state"
      @close="keepWork"
      @done="done"
      @list="showList"
    />
    <DividingStrip
      v-if="dividing"
      :key="dividing.action"
      :action="dividing.action"
      :item="dividing.item"
      :triage="triage"
      @close="keepWork"
      @done="done"
    />
  </div>
</template>

<style scoped>
.head-stack {
  display: grid;
  flex: 1 1 100%;
  gap: var(--space-2);
  min-width: 0;
}

.head-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
