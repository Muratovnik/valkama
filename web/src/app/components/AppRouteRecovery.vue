<script setup lang="ts">
/**
 * What the shell shows when the URL does not resolve to a module.
 *
 * Three answers, and which one is right depends on why. A clean entry is still
 * waiting for the context read model that says where the operator was, so it shows
 * a wait rather than a failure. An unparseable URL is this app's own fault and
 * offers only home. A module the manifest does not carry is a URL from another
 * build or another workstation, so it offers the modules that do exist — naming
 * them is what turns a dead link into a choice.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRouteUnavailable } from '@/shared/api/platformRoute.ts'
import { uiLoading, uiUnavailable } from '@/shared/api/platformUiState.ts'
import { failureMessage } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  failure: string | TypedFailure | null
  pending: boolean
  unavailable: PlatformRouteUnavailable | null
}>()

const emit = defineEmits<{ choose: [moduleId: ModuleId]; home: [] }>()
const { t } = useI18n()
const failureReason = computed(() => {
  if (typeof props.failure === 'string') return props.failure
  if (props.failure === null) return ''
  const message = failureMessage(props.failure)
  return t(message.key, message.params ?? {})
})
const unavailableMessage = computed(() => {
  if (props.unavailable?.reason === 'disabled-module')
    return `${t('settings.disabled')}: ${props.unavailable.input_module_id}`
  if (props.unavailable?.reason === 'unsupported-view')
    return `${t('platform.actions.unavailable')} ${props.unavailable.input_module_id}`
  if (
    props.unavailable?.reason === 'unsupported-scope' ||
    props.unavailable?.reason === 'incompatible-entity'
  )
    return `${t('platform.actions.unavailable')}: ${props.unavailable.input_module_id}`
  return t('platform.route.unknown', { module: props.unavailable?.input_module_id ?? '' })
})
</script>

<template>
  <section
    v-if="pending"
    class="route-recovery"
  >
    <PlatformStatePanel :state="uiLoading()" />
  </section>
  <section
    v-else-if="failureReason"
    class="route-recovery"
  >
    <PlatformStatePanel
      :state="uiUnavailable(failureReason)"
      :retryable="false"
    />
    <button
      class="recovery-home"
      type="button"
      @click="emit('home')"
    >
      {{ t('navigation.home') }}
    </button>
  </section>
  <section
    v-else-if="unavailable"
    class="route-recovery"
  >
    <PlatformStatePanel
      :state="uiUnavailable(unavailableMessage)"
      :retryable="false"
    />
    <div class="route-choices">
      <button
        v-for="module in unavailable.recovery.available_modules"
        :key="module"
        class="recovery-choice"
        type="button"
        @click="emit('choose', module)"
      >
        {{ t(`platform.modules.${module}`) }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.route-recovery {
  display: grid;
  gap: var(--space-4);
  align-content: center;
  min-height: 100%;
  padding: var(--space-6);
}

.route-choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

:is(.recovery-home, .recovery-choice) {
  min-height: var(--size-control-height);
  padding: 0 var(--space-4);
  border: 0;
  color: var(--color-text);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;
}
</style>
