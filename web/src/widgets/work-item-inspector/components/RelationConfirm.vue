<script setup lang="ts">
/**
 * The shape all three relation commands share: what it would touch, an explicit
 * tick, and an error that stays inside the dialog.
 *
 * Attaching, opening and removing were three dialogs written out three times, with
 * the same context block, the same checkbox, the same footer and the same error
 * paragraph. What differs is the sentence on the tick, the word on the action, and
 * whether there are fields above it — which is the slot.
 *
 * The tick is not a formality. Every one of these runs through an adapter against
 * something outside this store, so the operator confirms the target rather than the
 * intent, and `ConfirmationContext` is what states that target.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ConfirmationContext from '@/widgets/work-item-inspector/components/ConfirmationContext.vue'

import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  actionLabel: string
  busy: boolean
  confirmed: boolean
  confirmLabel: string
  error: string
  intro: string
  open: boolean
  projectId: string
  ready: boolean
  surfaceClass: string
  target: string
  title: string
  workItem: string
}>()

const emit = defineEmits<{
  'close': []
  'submit': []
  'update:confirmed': [value: boolean]
}>()

const { t } = useI18n()

/**
 * The tick, as something that can be ticked.
 *
 * The dialog does not own the answer — the panel that will run the command does,
 * because it is the one that clears it afterwards — so what is here is a model
 * that reads from above and writes back up. Bound as a value plus a `change`
 * listener it was neither: the checkbox reported a DOM event, the handler dug
 * `checked` back out of the event target through a cast, and nothing in the file
 * said the two halves were one thing.
 */
const consent = computed({
  get: () => props.confirmed,
  set: (next: boolean) => emit('update:confirmed', next),
})
</script>

<template>
  <DialogFrame
    :surface-class="props.surfaceClass"
    :open="props.open"
    :title="props.title"
    :subtitle="props.intro"
    :close-label="t('drawer.close')"
    :busy="props.busy"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <slot />
    <ConfirmationContext
      :project-id="props.projectId"
      :work-item="props.workItem"
      :target="props.target"
    />
    <label class="confirm-consent">
      <input
        v-model="consent"
        class="confirm-checkbox"
        type="checkbox"
      />
      <span>{{ props.confirmLabel }}</span>
    </label>
    <p
      v-if="props.error"
      class="confirm-feedback error"
      role="alert"
    >
      {{ props.error }}
    </p>
    <template #footer>
      <VButton @click="emit('close')">
        {{ t('platform.actions.cancel') }}
      </VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="!props.ready"
      >
        {{ props.actionLabel }}
      </VButton>
    </template>
  </DialogFrame>
</template>

<style scoped>
.confirm-consent {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
  font: var(--font-label);

  .confirm-checkbox {
    width: 18px;
    height: 18px;
  }
}

.confirm-feedback {
  padding: var(--space-2) var(--space-3);
  margin: 0;
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);

  &.error {
    border-inline-start: 3px solid var(--color-danger);
    color: var(--color-danger);
  }
}
</style>
