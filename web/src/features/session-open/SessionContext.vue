<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { OpenAction } from '@/features/session-open/openPlan.ts'
import { openTarget } from '@/features/session-open/openPlan.ts'
import { actionKey, outcomeWords } from '@/features/session-open/placeWords.ts'

import { attachSession } from '@/shared/api/executionApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { sessionFamilyOf } from '@/shared/lib/settings.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'
const props = defineProps<{ context: ResolvedRef }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const notice = ref('')
const busy = ref(false)
const reference = ref('')
/** The plan's next action, which waits for its own click. */
const next = ref<OpenAction | null>(null)
const canonicalReference = computed(() => reference.value.trim().toUpperCase())
const attachable = computed(() => WORK_ITEM_REFERENCE.test(canonicalReference.value) && !busy.value)
async function attach() {
  if (!WORK_ITEM_REFERENCE.test(reference.value.trim().toUpperCase()) || busy.value) return
  busy.value = true
  try {
    await attachSession(
      reference.value.trim().toUpperCase(),
      props.context.session ?? props.context.value,
    )
    emit('close')
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}
async function open(action: OpenAction | null = null) {
  busy.value = true
  try {
    const context = props.context
    const family = context.client_family ?? sessionFamilyOf(context.client ?? '')
    const outcome = action
      ? await action.run()
      : await openTarget({ kind: 'session', session: context.session ?? context.value, family })
    next.value = outcome.status === 'next' ? outcome.next : null
    notice.value = outcomeWords(t, outcome)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <DialogFrame
    :open="true"
    :title="t('reference.session')"
    :context="context.value"
    :close-label="t('drawer.close')"
    @close="emit('close')"
  >
    <p>{{ context.detail }}</p>
    <div v-if="context.resolved && !context.work_item">
      <VTextInput
        v-model="reference"
        :label="t('workItem.linkOther')"
        :maxlength="20"
      />
      <VButton
        :disabled="!attachable"
        @click="attach"
        >{{ t('platform.actions.relation.attach') }}</VButton
      >
    </div>
    <p
      v-if="notice"
      role="status"
    >
      {{ notice }}
    </p>
    <template #footer>
      <VButton
        v-if="context.resolved && next"
        :disabled="busy"
        @click="open(next)"
        >{{ t(actionKey(next.steps[0]!)) }}</VButton
      >
      <VButton
        v-else-if="context.resolved"
        :disabled="busy"
        @click="open()"
        >{{ t('session.open') }}</VButton
      >
    </template>
  </DialogFrame>
</template>
