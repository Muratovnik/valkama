<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { openSession } from '@/features/session-open/sessionOpen.ts'

import { attachSession } from '@/shared/api/executionApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { openerFor } from '@/shared/lib/settings.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'
const props = defineProps<{ context: ResolvedRef }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const { settings } = storeToRefs(useSettingsStore())
const notice = ref('')
const busy = ref(false)
const reference = ref('')
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
async function open() {
  busy.value = true
  try {
    const context = props.context
    const result = await openSession(
      {
        id: context.session ?? context.value,
        client: context.client ?? '',
        client_family: context.client_family,
        cwd: context.cwd ?? '',
        session_cwd: context.session_cwd,
        space_root: context.space_root,
      },
      openerFor(context.client_family ?? context.client ?? 'other', settings.value),
    )
    notice.value = ''
    if (!result.ok) notice.value = t(`session.refused.${result.error}`)
    else if (result.mode === 'copied') notice.value = t('session.copied')
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error)
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
    <template #footer
      ><VButton
        v-if="context.resolved"
        :disabled="busy"
        @click="open"
        >{{ t('session.open') }}</VButton
      ></template
    >
  </DialogFrame>
</template>
