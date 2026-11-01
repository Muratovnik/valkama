<script setup lang="ts">
/**
 * What the shell shows when the URL does not resolve to a module.
 *
 * Three answers, and which one is right depends on why. A clean entry is still
 * waiting for the context read model that says where the operator was, so it shows
 * a wait rather than a failure. A path that names no section offers the way back
 * to «Work», named after it. A module the manifest does not carry is a URL from
 * another build or another workstation, so it offers the modules that do exist —
 * naming them is what turns a dead link into a choice.
 *
 * The card stands at the top of the stage, where every other state card stands,
 * and its actions are the product's buttons at their own width. It is the page's
 * main region, as a module's own frame is, so a landmark jump still lands on it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRouteUnavailable } from '@/shared/api/platformRoute.ts'
import { uiLoading, uiUnavailable } from '@/shared/api/platformUiState.ts'
import { failureMessage } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'

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
/** Reasons a registered module gives when it cannot open this address here. */
const CANNOT_OPEN_HERE = new Set<string>([
  'unsupported-view',
  'unsupported-scope',
  'incompatible-entity',
])
const unavailableMessage = computed(() => {
  const module = props.unavailable?.input_module_id ?? ''
  const reason = props.unavailable?.reason ?? ''
  return t(CANNOT_OPEN_HERE.has(reason) ? 'platform.route.unavailable' : 'platform.route.unknown', {
    module,
  })
})
</script>

<template>
  <main
    class="route-recovery"
    tabindex="-1"
  >
    <PlatformStatePanel
      v-if="pending"
      :state="uiLoading()"
    />
    <template v-else-if="failureReason">
      <PlatformStatePanel
        :state="uiUnavailable(failureReason)"
        :retryable="false"
      />
      <div class="route-choices">
        <VButton
          class="recovery-home"
          @click="emit('home')"
          >{{ t('navigation.home') }}</VButton
        >
      </div>
    </template>
    <template v-else-if="unavailable">
      <PlatformStatePanel
        :state="uiUnavailable(unavailableMessage)"
        :retryable="false"
      />
      <div class="route-choices">
        <VButton
          v-for="module in unavailable.recovery.available_modules"
          :key="module"
          class="recovery-choice"
          @click="emit('choose', module)"
          >{{ t(`platform.modules.${module}`) }}</VButton
        >
      </div>
    </template>
  </main>
</template>

<style scoped>
.route-recovery {
  display: grid;
  gap: var(--space-4);
  align-content: start;
  width: min(var(--size-module-column), 100%);
  padding: var(--space-6) var(--size-page-gutter) var(--space-12);
  margin: 0 auto;
  outline: none;
}

.route-choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
