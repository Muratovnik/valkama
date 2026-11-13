<script setup lang="ts">
/**
 * The owner's switch for the poll of the usage endpoint. It is off until the owner turns
 * it on, and the words beside it say why: the endpoint is undocumented, and Anthropic's
 * terms do not explicitly permit this use. The server starts or stops the poll when the
 * switch is written, so the screen only reads and writes the setting.
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import { uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { fetchQuotaSettings, saveQuotaSettings } from '@/shared/api/quotaApi.ts'
import type { QuotaSettings } from '@/shared/api/quotaApi.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

const { t } = useI18n()
/** What is shown is what was asked for last; `saved` is what the server last confirmed. */
const shown = shallowRef<QuotaSettings | null>(null)
let saved: QuotaSettings | null = null
const loadFailed = ref(false)
const failure = ref('')
/** Writes go one after another, so an older one cannot land last. */
let writes: Promise<void> = Promise.resolve()

const panelState = computed<PlatformUiState<true>>(() =>
  loadFailed.value ? uiError(t('settings.quotaPoll.loadFailed')) : uiLoading(),
)

async function load() {
  loadFailed.value = false
  try {
    saved = await fetchQuotaSettings()
    shown.value = saved
  } catch {
    loadFailed.value = true
  }
}

function setPoll(poll: boolean) {
  if (shown.value === null) return
  shown.value = { poll }
  failure.value = ''
  writes = writes.then(async () => {
    try {
      saved = await saveQuotaSettings({ poll })
    } catch (error) {
      // A later press carries its own write and answers for itself.
      if (shown.value?.poll !== poll) return
      shown.value = saved
      const message = failureMessage(typedFailure(error))
      failure.value = t('settings.quotaPoll.saveFailed', {
        reason: t(message.key, message.params ?? {}),
      })
    }
  })
}

onMounted(load)
</script>

<template>
  <SettingsGroup :title="t('settings.quotaPoll.title')">
    <div
      v-if="!shown"
      class="settings-quota-panel"
    >
      <PlatformStatePanel
        :state="panelState"
        compact
        @retry="load"
      />
    </div>
    <SettingsRow
      v-else
      :label="t('settings.quotaPoll.label')"
      :hint="t('settings.quotaPoll.hint')"
      :failure="failure"
    >
      <ToggleSwitch
        class="settings-quota-switch"
        :model-value="shown.poll"
        :label="t('settings.quotaPoll.label')"
        :on-label="t('settings.quotaPoll.on')"
        :off-label="t('settings.quotaPoll.off')"
        @update:model-value="setPoll"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<style scoped>
/* The rows' own inset, as the alerts group gives its panel. */
.settings-quota-panel {
  padding: var(--space-4);
}

/* Only as wide as what it says: a press beside a switch is not on it. */
.settings-quota-switch {
  justify-self: start;
}
</style>
