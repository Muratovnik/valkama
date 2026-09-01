<script setup lang="ts">
/**
 * The switch that turns one capability assignment on or off.
 *
 * A row owns its own write because a model needs somewhere to be assigned. The
 * section used to hold both halves as facts about the list — `enabled` derived
 * from whichever row was rendering, `busy` derived by comparing an id against a
 * ref shared by every row — and a derived model is not a model: nothing can be
 * written to it, so the switch had to report the change a second time on the
 * side. Here it is one writable computed, and the id comparison has no reason
 * to exist because a row is only ever asked whether it is the busy one.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { setAssignmentState } from '@/shared/api/platformApi.ts'
import type { RegistryAssignment } from '@/shared/api/platformApiTypes.ts'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

const props = defineProps<{ assignment: RegistryAssignment }>()
const emit = defineEmits<{ changed: []; notice: [message: string] }>()
const { t } = useI18n()

const pending = ref(false)

/**
 * On or off, with the platform as the only source of the answer.
 *
 * The getter never shows a local guess: while the request is in flight the
 * switch still reads what the platform last said and `pending` disables it, so
 * the two states a reader can see are an answer and waiting for one.
 */
const enabledState = computed({
  get: () => props.assignment.state === 'enabled',
  set: (next) => void apply(next),
})

async function apply(enabled: boolean) {
  pending.value = true
  // A new attempt supersedes the last complaint, which is why the notice is
  // emitted empty here rather than only on failure.
  emit('notice', '')
  try {
    await setAssignmentState(props.assignment.assignment_id, enabled ? 'enabled' : 'disabled')
    emit('changed')
  } catch (error) {
    const conflict = error instanceof Error && 'status' in error && error.status === 409
    emit(
      'notice',
      t(conflict ? 'settings.mutation.assignmentConflict' : 'settings.mutation.assignmentFailed'),
    )
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <ToggleSwitch
    v-model="enabledState"
    :label="t('platform.registry.assignmentToggle')"
    :on-label="t('platform.registry.enabled')"
    :off-label="t('platform.registry.disabled')"
    :busy="pending"
  />
</template>
