<script setup lang="ts">
/**
 * The one line that marks a thread resolved: an optional decision and the way on or back.
 *
 * The mark can be taken back, so nothing here asks twice. Enter sends, as a one-line form
 * does; Escape goes back, and takes only this form with it, not the card around it. A write
 * disables the field, which drops focus on the page, so a refused one gives it back there.
 *
 * The hint names the card's own space and no number in it: a fixed example key read as a
 * task of whatever space the card was in.
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'

import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  error: string
  pending: boolean
  /** The key of the card's space, for the hint. */
  spaceKey: string
}>()
const emit = defineEmits<{ cancel: []; refresh: []; submit: [] }>()
const text = defineModel<string>('text', { required: true })
const { t } = useI18n()

const form = ref<HTMLFormElement | null>(null)
const field = ref<InstanceType<typeof VTextInput> | null>(null)
onMounted(() => field.value?.control()?.focus({ preventScroll: true }))

let hadFocus = false
watch(
  () => props.pending,
  (pending) => {
    if (pending) hadFocus = form.value?.contains(document.activeElement) ?? false
    else if (hadFocus)
      void nextTick(() => {
        if (document.activeElement === document.body) field.value?.control()?.focus()
      })
  },
  { flush: 'pre' },
)

function send() {
  if (!props.pending) emit('submit')
}
useEventListener(form, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  emit('cancel')
})
</script>

<template>
  <form
    ref="form"
    class="resolve-form"
    @submit.prevent="send"
  >
    <VTextInput
      ref="field"
      v-model="text"
      class="resolve-field"
      :label="t('threads.decision')"
      :placeholder="t('threads.decisionHint', { key: spaceKey })"
      :maxlength="280"
      :disabled="pending"
    />
    <div class="resolve-actions">
      <VButton
        type="submit"
        variant="primary"
        :disabled="pending"
        >{{ t('threads.markResolved') }}</VButton
      >
      <VButton
        :disabled="pending"
        @click="emit('cancel')"
        >{{ t('threads.cancel') }}</VButton
      >
    </div>
    <p
      v-if="error"
      class="resolve-error"
      role="alert"
    >
      {{ error }}
      <VButton
        variant="ghost"
        size="inline"
        :disabled="pending"
        @click="emit('refresh')"
        >{{ t('workItem.refreshDraft') }}</VButton
      >
    </p>
  </form>
</template>

<style scoped>
/* A row while it fits, and the field over its buttons where it does not: the buttons line
   up with the control, under the label both of them answer to. */
.resolve-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: flex-end;
  min-width: 0;
}

.resolve-field {
  flex: 1 1 16rem;
  min-width: 0;
}

.resolve-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.resolve-error {
  flex: 1 0 100%;
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
