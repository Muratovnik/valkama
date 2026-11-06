<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsAlerts from '@/pages/settings/components/SettingsAlerts.vue'
import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsKindColors from '@/pages/settings/components/SettingsKindColors.vue'
import SettingsOpening from '@/pages/settings/components/SettingsOpening.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

defineProps<{ locale: string }>()
const emit = defineEmits<{ locale: [locale: 'en' | 'ru'] }>()
const { t } = useI18n()
const { settings } = storeToRefs(useSettingsStore())

const languageOptions = computed<ChoiceOption[]>(() => [
  { value: 'ru', label: t('language.ru'), icon: 'language' },
  { value: 'en', label: t('language.en'), icon: 'language' },
])

function emitLocale(value: string) {
  emit('locale', value === 'ru' ? 'ru' : 'en')
}
</script>

<template>
  <section
    class="settings-general"
    :aria-label="t('settings.section.general')"
  >
    <div class="settings-general-sheet">
      <SettingsGroup
        class="settings-general-group"
        :title="t('settings.interface')"
        :intro="t('settings.interfaceIntro')"
      >
        <SettingsRow
          :label="t('language.label')"
          :hint="t('settings.languageHint')"
        >
          <SelectionControl
            class="settings-general-control"
            mode="combobox"
            :model-value="locale"
            :options="languageOptions"
            :label="t('language.label')"
            @update:model-value="emitLocale"
          />
        </SettingsRow>
        <SettingsRow
          :label="t('settings.executionTab.label')"
          :hint="t('settings.executionTab.hint')"
        >
          <ToggleSwitch
            class="settings-general-switch"
            :model-value="settings.executionTab"
            :label="t('settings.executionTab.label')"
            :on-label="t('settings.executionTab.on')"
            :off-label="t('settings.executionTab.off')"
            @update:model-value="settings.executionTab = $event"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsKindColors class="settings-general-group" />

      <SettingsAlerts
        class="settings-general-group"
        :locale="locale"
      />

      <SettingsOpening class="settings-general-group" />
    </div>
  </section>
</template>

<style scoped>
.settings-general {
  width: 100%;
  min-width: 0;
}

.settings-general-sheet {
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);

  /* A forced palette clears the sheet; the rules between its groups stay, its edge goes. */
  @media (forced-colors: active) {
    outline: 1px solid CanvasText;
    outline-offset: -1px;
  }
}

.settings-general-group + .settings-general-group {
  border-top: 1px solid var(--color-rule-strong);
}

.settings-general-control {
  width: 100%;
  min-width: 0;
}

/* Only as wide as what it says: a press beside a switch is not on it. */
.settings-general-switch {
  justify-self: start;
}
</style>
