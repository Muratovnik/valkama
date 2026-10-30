<script setup lang="ts">
/**
 * Which product modules this installation runs, and the switch for the ones
 * that may be turned off.
 *
 * The list is the module registrations the shell already holds from
 * `/api/modules`, so this section reads nothing of its own. A switch writes one
 * registration at the revision it was shown with, and the shell re-reads the
 * list afterwards: a conflict means someone else changed it first, and the
 * re-read is what shows their answer instead of ours.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { setModuleState } from '@/shared/api/platformApi.ts'
import type { ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  registrations: readonly ModuleRegistration[]
  reloadModules: () => Promise<void>
}>()
const { t, te } = useI18n()
const notice = ref('')
const busy = ref('')

function title(registration: ModuleRegistration): string {
  const key = registration.manifest.title_key
  return te(key) ? t(key) : registration.manifest.module_id
}

function enabled(registration: ModuleRegistration): boolean {
  return registration.state === 'enabled'
}

function updating(registration: ModuleRegistration): boolean {
  return busy.value === registration.manifest.module_id
}

function stateLabel(registration: ModuleRegistration): string {
  return t(enabled(registration) ? 'settings.enabled' : 'settings.disabled')
}

async function update(registration: ModuleRegistration, enabled: boolean) {
  if (!registration.mutable || busy.value) return
  busy.value = registration.manifest.module_id
  notice.value = ''
  try {
    await setModuleState(
      registration.manifest.module_id,
      enabled ? 'enabled' : 'disabled',
      registration.revision,
    )
    await props.reloadModules()
  } catch (error) {
    const conflict = error instanceof Error && 'status' in error && error.status === 409
    notice.value = t(
      conflict ? 'settings.mutation.moduleConflict' : 'settings.mutation.moduleFailed',
    )
    if (conflict) await props.reloadModules()
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <section
    class="settings-modules"
    aria-labelledby="settings-modules-title"
  >
    <header class="settings-modules-head">
      <SectionHeading
        id="settings-modules-title"
        as="h3"
        >{{ t('settings.modules.title') }}</SectionHeading
      >
      <p class="settings-modules-intro">{{ t('settings.modules.intro') }}</p>
    </header>
    <p
      v-if="notice"
      class="settings-modules-notice"
      role="alert"
    >
      {{ notice }}
    </p>
    <ul class="settings-modules-list">
      <li
        v-for="registration in registrations"
        :key="registration.manifest.module_id"
        class="settings-module"
      >
        <VIcon :name="registration.manifest.icon_key" />
        <span class="settings-module-identity">
          <strong class="settings-module-name">{{ title(registration) }}</strong>
          <small class="settings-module-group">{{
            t(`platform.navigation.groups.${registration.manifest.navigation_group}`)
          }}</small>
        </span>
        <ToggleSwitch
          v-if="registration.mutable"
          :model-value="enabled(registration)"
          :label="title(registration)"
          :busy="updating(registration)"
          :on-label="t('settings.enabled')"
          :off-label="t('settings.disabled')"
          @update:model-value="(enabled) => update(registration, enabled)"
        />
        <SemanticState
          v-else
          dimension="integration-intake"
          :state="registration.state"
          :label="stateLabel(registration)"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.settings-modules {
  min-width: 0;
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);
}

.settings-modules-head {
  display: grid;
  gap: var(--space-heading-content);
  padding: var(--space-4);
  background: var(--color-surface-muted);
}

.settings-modules-intro,
.settings-modules-notice {
  max-width: 72ch;
  margin: 0;
  font: var(--font-note);
}

.settings-modules-intro {
  color: var(--color-text-muted);
}

.settings-modules-notice {
  padding: var(--space-2) var(--space-4);
  color: var(--color-danger);
}

/* The list owns the tracks and every row joins them, so a switch and a fixed
   state start on one line whichever row holds the widest control. The edge
   tracks are sized by content because a subgrid's padding lands in them. */
.settings-modules-list {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 0;
  margin: 0;
  list-style: none;
}

.settings-module {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);

  & + .settings-module {
    border-top: 1px solid var(--color-rule);
  }
}

.settings-module-identity {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.settings-module-name {
  font: var(--font-label);
  overflow-wrap: break-word;
}

.settings-module-group {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
