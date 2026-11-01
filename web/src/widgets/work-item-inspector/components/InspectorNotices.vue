<script setup lang="ts">
/**
 * What the card's head asks or reports before the reader goes on: a refused
 * write in the server's words, a write that failed for another reason, and the
 * question before a draft is lost. Each stands under the title at full width
 * and stays in view while the body scrolls, because a refusal of a tick far
 * down the card has to be seen however far down it was made.
 *
 * The host owns every answer; this only words and places them.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorRefusal from '@/widgets/work-item-inspector/components/InspectorRefusal.vue'
import type { RefusalNotice } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'

const props = defineProps<{
  /** Whether the draft question is open. */
  asking: boolean
  busy: boolean
  /** A write that failed without a refusal behind it; empty for none. */
  error: string
  notice: RefusalNotice | null
  /** The kinds of draft that would be lost, as the draft guard names them. */
  unsaved: readonly string[]
}>()

const emit = defineEmits<{
  discard: []
  dismiss: []
  force: []
  guard: [guard: string]
  keep: []
}>()

const { t } = useI18n()

const discardQuestion = computed(() =>
  t('workItem.discard.question', {
    drafts: props.unsaved.map((kind) => t(`workItem.discard.${kind}`)).join(', '),
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
      v-if="asking"
      tone="danger"
      :message="discardQuestion"
      :confirm-label="t('workItem.discard.confirm')"
      :cancel-label="t('workItem.discard.keep')"
      @confirm="emit('discard')"
      @cancel="emit('keep')"
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
