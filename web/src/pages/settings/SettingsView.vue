<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGeneral from '@/pages/settings/components/SettingsGeneral.vue'

import InstallationHealth from '@/widgets/settings-registry/components/InstallationHealth.vue'
import PlatformSettingsRegistry from '@/widgets/settings-registry/components/PlatformSettingsRegistry.vue'

import type { PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

type SettingsSection = 'general' | 'workspace' | 'diagnostics'

const props = defineProps<{
  locale: string
  registryState: PlatformUiState<PlatformRegistryReady>
  scope: OperatingScope
  section: string
  reloadModules: () => Promise<void>
}>()
const emit = defineEmits<{
  locale: [locale: 'en' | 'ru']
  retry: []
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

    <section
      v-else-if="activeSection === 'workspace'"
      class="settings-system"
    >
      <PlatformSettingsRegistry
        :state="registryState"
        :scope="scope"
        :reload-modules="reloadModules"
        @retry="emit('retry')"
      />
    </section>

    <InstallationHealth v-else />
  </section>
</template>

<style scoped>
.settings-page {
  display: grid;
  gap: var(--space-5);
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

.settings-system {
  display: grid;
  gap: var(--space-5);
  min-width: 0;
}
</style>
