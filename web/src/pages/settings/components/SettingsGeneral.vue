<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsAlerts from '@/pages/settings/components/SettingsAlerts.vue'
import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import type {
  CustomCommandError,
  OpenerCapability,
  OpenerClient,
  OpenerKind,
} from '@/shared/lib/settings.ts'
import {
  availableOpenerCapabilities,
  MAX_CUSTOM_COMMAND_LENGTH,
  validateCustomCommand,
} from '@/shared/lib/settings.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ChoiceOption, ControlIconName } from '@/shared/ui/choiceControls.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

defineProps<{ locale: string }>()
const emit = defineEmits<{ locale: [locale: 'en' | 'ru'] }>()
const { t } = useI18n()
const settingsStore = useSettingsStore()
const { openerCatalog, openerCatalogFallback, openerCatalogLoading, settings } =
  storeToRefs(settingsStore)

const openerClients: readonly OpenerClient[] = ['claude', 'codex', 'other']
const openerIcons: Record<OpenerKind, ControlIconName> = {
  'vscode': 'vscode',
  'codex-app': 'codex',
  'terminal': 'terminal',
  'cursor': 'cursor',
  'custom': 'command',
}
const languageOptions = computed<ChoiceOption[]>(() => [
  { value: 'ru', label: t('language.ru'), icon: 'language' },
  { value: 'en', label: t('language.en'), icon: 'language' },
])
const hasAvailableOpeners = computed(() =>
  openerClients.some((client) => availableCapabilities(client).length > 0),
)

/** The selector contains only destinations this client understands and can open now. */
function openerOptions(client: OpenerClient): ChoiceOption[] {
  return availableCapabilities(client).map(({ kind }) => ({
    icon: openerIcons[kind],
    label: t(`settings.opener.${kind}`),
    value: kind,
  }))
}

function availableCapabilities(client: OpenerClient): OpenerCapability[] {
  return availableOpenerCapabilities(client, openerCatalog.value)
}

function openerAvailability(client: OpenerClient): 'ready' | 'not-observed' | 'unavailable' {
  if (openerCatalogLoading.value) return 'not-observed'
  return availableCapabilities(client).length ? 'ready' : 'unavailable'
}

function openerAvailabilityLabel(client: OpenerClient): string {
  if (openerCatalogLoading.value) return t('settings.openerAvailability.checking')
  return availableCapabilities(client).length
    ? t('settings.openerAvailability.available')
    : t('settings.openerAvailability.unavailable')
}

function openerControlDisabled(client: OpenerClient): boolean {
  return openerCatalogLoading.value || openerOptions(client).length === 0
}

function commandError(client: OpenerClient): CustomCommandError | null {
  const opener = settings.value.openers[client]
  return opener.kind === 'custom' ? validateCustomCommand(opener.command) : null
}

function commandErrorText(client: OpenerClient): string {
  const error = commandError(client)
  return error === null ? '' : t(`settings.customCommandError.${error}`)
}

function emitLocale(value: string) {
  emit('locale', value === 'ru' ? 'ru' : 'en')
}

function selectOpener(client: OpenerClient, value: string) {
  if (!availableCapabilities(client).some(({ kind }) => kind === value)) return
  settings.value.openers[client].kind = value as OpenerKind
}

function editCommand(client: OpenerClient, value: string) {
  settings.value.openers[client].command = value
}

onMounted(() => void settingsStore.loadOpenerCatalog())
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
      </SettingsGroup>

      <SettingsAlerts
        class="settings-general-group"
        :locale="locale"
      />

      <SettingsGroup
        class="settings-general-group"
        :title="t('settings.openers')"
        :intro="t('settings.openersIntro')"
      >
        <template
          v-if="openerCatalogFallback"
          #note
        >
          <p
            class="settings-general-catalog-note"
            role="status"
          >
            {{ t('settings.openerCatalogFallback') }}
          </p>
        </template>
        <template v-if="hasAvailableOpeners || openerCatalogLoading">
          <SettingsRow
            v-for="client in openerClients"
            :key="client"
            :label="t(`settings.openerClient.${client}`)"
            :hint="t(`settings.openerClientHint.${client}`)"
          >
            <span class="settings-general-opener">
              <span class="settings-general-opener-state">
                <small class="settings-general-lane-label">{{
                  t('settings.stateLanes.availability')
                }}</small>
                <SemanticState
                  dimension="integration-health"
                  :state="openerAvailability(client)"
                  :label="openerAvailabilityLabel(client)"
                />
              </span>
              <SelectionControl
                class="settings-general-control"
                mode="combobox"
                :model-value="settings.openers[client].kind"
                :options="openerOptions(client)"
                :label="t(`settings.openerClient.${client}`)"
                :placeholder="t('settings.openerAvailability.unavailable')"
                :disabled="openerControlDisabled(client)"
                @update:model-value="selectOpener(client, $event)"
              />
              <VTextInput
                v-if="settings.openers[client].kind === 'custom'"
                class="settings-general-command"
                autocomplete="off"
                :model-value="settings.openers[client].command"
                :label="t('settings.customCommand')"
                :hint="t('settings.customCommandHint')"
                :maxlength="MAX_CUSTOM_COMMAND_LENGTH"
                :placeholder="t('settings.customCommandPlaceholder')"
                @update:model-value="editCommand(client, $event)"
              />
              <p
                v-if="commandError(client)"
                class="settings-general-command-error"
                role="alert"
              >
                {{ commandErrorText(client) }}
              </p>
            </span>
          </SettingsRow>
        </template>
        <DataEmptyState
          v-else
          :title="t('settings.openersEmpty')"
          :description="t('settings.openersEmptyDetail')"
          compact
        />
      </SettingsGroup>
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
}

.settings-general-group + .settings-general-group {
  border-top: 1px solid var(--color-rule-strong);
}

.settings-general-catalog-note {
  max-width: 72ch;
  margin: 0;
  color: var(--color-warning);
  font: var(--font-note);
}

.settings-general-control,
.settings-general-command {
  width: 100%;
  min-width: 0;
}

.settings-general-opener {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.settings-general-opener-state {
  display: grid;
  gap: var(--space-label-value);
}

.settings-general-lane-label {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.settings-general-command-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
