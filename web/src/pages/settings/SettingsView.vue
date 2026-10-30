<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import InstallationHealth from '@/pages/settings/components/InstallationHealth.vue'
import SettingsGeneral from '@/pages/settings/components/SettingsGeneral.vue'
import SettingsModules from '@/pages/settings/components/SettingsModules.vue'

import type { ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

type SettingsSection = 'general' | 'workspace' | 'diagnostics'

const props = defineProps<{
  locale: string
  moduleRegistrations: readonly ModuleRegistration[]
  section: string
  reloadModules: () => Promise<void>
}>()
const emit = defineEmits<{
  locale: [locale: 'en' | 'ru']
  state: [state: Record<string, string | number | boolean>]
}>()
const { t } = useI18n()
const sectionIds: readonly SettingsSection[] = ['general', 'workspace', 'diagnostics']
const activeSection = computed<SettingsSection>(() =>
  sectionIds.includes(props.section as SettingsSection)
    ? (props.section as SettingsSection)
    : 'general',
)
const sectionOptions = computed(() =>
  sectionIds.map((value) => ({ value, label: t(`settings.section.${value}`) })),
)

function selectSection(section: SettingsSection) {
  emit('state', { section })
}
</script>

<template>
  <section
    class="settings-page"
    :aria-label="t('settings.title')"
  >
    <header class="settings-page-head">
      <SegmentedControl
        class="settings-page-sections"
        :model-value="activeSection"
        :options="sectionOptions"
        :label="t('settings.sectionLabel')"
        @update:model-value="selectSection"
      />
      <p class="settings-page-intro">{{ t(`settings.sectionIntro.${activeSection}`) }}</p>
    </header>

    <SettingsGeneral
      v-if="activeSection === 'general'"
      :locale="locale"
      @locale="(value) => emit('locale', value)"
    />

    <SettingsModules
      v-else-if="activeSection === 'workspace'"
      :registrations="moduleRegistrations"
      :reload-modules="reloadModules"
    />

    <InstallationHealth v-else />
  </section>
</template>

<style scoped>
.settings-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-section);
  width: 100%;
  min-width: 0;
  color: var(--color-text);
}

.settings-page-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--size-column-gutter);
  justify-content: flex-start;
  align-items: center;
  min-width: 0;

  .settings-page-intro {
    max-width: 72ch;
    margin: 0;
    color: var(--color-text-muted);
    font: var(--font-note);
  }
}

.settings-page-sections {
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}
</style>
