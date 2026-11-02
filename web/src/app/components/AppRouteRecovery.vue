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
 * and its actions sit inside it, as every state panel's way out does, at the
 * product's own button width. Under the card they read as orphans, left-aligned
 * below a message that an absence centres. It is the page's
 * main region, as a module's own frame is, so a landmark jump still lands on it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRouteUnavailable } from '@/shared/api/platformRoute.ts'
import { uiEmpty, uiLoading, uiUnavailable } from '@/shared/api/platformUiState.ts'
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
/**
 * The address names nothing: a path no section owns, or a section this build
 * does not carry. That is an answer rather than an outage, so it reads as the
 * product's quiet absence, not under «Unavailable» with the failure mark — a
 * mistyped link used to look like a broken installation.
 */
const lost = computed(
  () =>
    (typeof props.failure === 'string' && props.failure !== '') ||
    props.unavailable?.reason === 'unknown-module',
)
const unavailableMessage = computed(() => {
  const module = props.unavailable?.input_module_id ?? ''
  const reason = props.unavailable?.reason ?? ''
  return t(CANNOT_OPEN_HERE.has(reason) ? 'platform.route.unavailable' : 'platform.route.unknown', {
    module,
  })
})
const failureState = computed(() =>
  lost.value ? uiEmpty(failureReason.value) : uiUnavailable(failureReason.value),
)
const unavailableState = computed(() =>
  lost.value ? uiEmpty(unavailableMessage.value) : uiUnavailable(unavailableMessage.value),
)
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
    <PlatformStatePanel
      v-else-if="failureReason"
      :state="failureState"
      :retryable="false"
    >
      <template #action>
        <div class="route-choices">
          <VButton
            class="recovery-home"
            @click="emit('home')"
            >{{ t('navigation.home') }}</VButton
          >
        </div>
      </template>
    </PlatformStatePanel>
    <PlatformStatePanel
      v-else-if="unavailable"
      :state="unavailableState"
      :retryable="false"
    >
      <template #action>
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
    </PlatformStatePanel>
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

/* The state panel drops its third column here, and a row of buttons left in the
   first would widen it until the message had no room. */
@container (width <= 560px) {
  .route-choices {
    grid-column: 1/-1;
  }
}
</style>
