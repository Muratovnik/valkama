<script setup lang="ts">
/**
 * Saying that this observed session belongs to a work item.
 *
 * Typed by a person, and that is the design rather than a missing feature. A
 * session Valkama did not launch can be matched to work by time, by working
 * directory, or by whichever journal is newest, and each of those is wrong
 * exactly when two agents are working near each other — which is when anyone
 * looks. The reference is checked against the shape the server accepts before
 * the request, so a typo answers here instead of as a refusal.
 *
 * The attempt this records is `attached`: Valkama did not spawn the process,
 * did not read its result and did not see the checkout, so it makes no claim
 * about what was delivered.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { attachSession } from '@/shared/api/executionApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ attached: [reference: string] }>()

const { t } = useI18n()
const reference = ref('')
const busy = ref(false)
const failure = ref('')

const typed = computed(() => reference.value.trim().toUpperCase())
const attachable = computed(() => !busy.value && WORK_ITEM_REFERENCE.test(typed.value))

async function attach() {
  if (!attachable.value) return
  busy.value = true
  failure.value = ''
  try {
    await attachSession(typed.value, props.sessionId)
    emit('attached', typed.value)
    reference.value = ''
  } catch (error) {
    failure.value = t('execution.attachFailed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form
    class="session-attach"
    @submit.prevent="attach"
  >
    <VTextInput
      v-model="reference"
      :label="t('execution.attach')"
      :hint="t('execution.attachHint')"
      :maxlength="20"
      :disabled="busy"
    />
    <VButton
      type="submit"
      :disabled="!attachable"
    >
      {{ t('execution.attachConfirm') }}
    </VButton>
  </form>
  <p
    v-if="failure"
    class="session-attach-error"
    role="alert"
  >
    {{ failure }}
  </p>
</template>

<style scoped>
.session-attach {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: end;
  width: 100%;
}

.session-attach-error {
  margin: var(--space-2) 0 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
