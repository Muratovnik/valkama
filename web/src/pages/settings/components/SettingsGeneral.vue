<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type {
  CustomCommandError,
  OpenerCapability,
  OpenerClient,
  OpenerKind,
} from '@/shared/lib/settings.ts'
import {
  availableOpenerCapabilities,
  MAX_CUSTOM_COMMAND_LENGTH,
  NOTIFY_EVENTS,
  validateCustomCommand,
} from '@/shared/lib/settings.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ChoiceOption, ControlIconName } from '@/shared/ui/choiceControls.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

defineProps<{ locale: string }>()
const emit = defineEmits<{ locale: [locale: 'en' | 'ru'] }>()
const { t } = useI18n()
const settingsStore = useSettingsStore()
const { openerCatalog, openerCatalogFallback, openerCatalogLoading, settings } =
  storeToRefs(settingsStore)
const permission = ref<NotificationPermission>(
  typeof Notification === 'undefined' ? 'denied' : Notification.permission,
)

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

async function askPermission() {
  if (typeof Notification === 'undefined') return
  permission.value = await Notification.requestPermission()
}

onMounted(() => void settingsStore.loadOpenerCatalog())
</script>

<template>
  <section
    class="settings-general"
    :aria-label="t('settings.section.general')"
  >
    <div class="settings-general-sheet">
      <section class="settings-general-group">
        <header class="settings-general-head">
          <SectionHeading as="h3">{{ t('settings.interface') }}</SectionHeading>
          <p class="settings-general-description">{{ t('settings.interfaceIntro') }}</p>
        </header>
        <div class="settings-general-row">
          <span class="settings-general-identity">
            <strong class="settings-general-label">{{ t('language.label') }}</strong>
            <small class="settings-general-hint">{{ t('settings.languageHint') }}</small>
          </span>
          <SelectionControl
            class="settings-general-control"
            mode="combobox"
            :model-value="locale"
            :options="languageOptions"
            :label="t('language.label')"
            @update:model-value="emitLocale"
          />
        </div>
      </section>

      <section class="settings-general-group">
        <header class="settings-general-head">
          <SectionHeading as="h3">{{ t('settings.openers') }}</SectionHeading>
          <p class="settings-general-description">{{ t('settings.openersIntro') }}</p>
          <p
            v-if="openerCatalogFallback"
            class="settings-general-catalog-note"
            role="status"
          >
            {{ t('settings.openerCatalogFallback') }}
          </p>
        </header>
        <template v-if="hasAvailableOpeners || openerCatalogLoading">
          <div
            v-for="client in openerClients"
            :key="client"
            class="settings-general-row"
          >
            <span class="settings-general-identity">
              <strong class="settings-general-label">{{
                t(`settings.openerClient.${client}`)
              }}</strong>
              <small class="settings-general-hint">{{
                t(`settings.openerClientHint.${client}`)
              }}</small>
            </span>
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
          </div>
        </template>
        <DataEmptyState
          v-else
          :title="t('settings.openersEmpty')"
          :description="t('settings.openersEmptyDetail')"
          compact
        />
      </section>

      <section class="settings-general-group">
        <header class="settings-general-head">
          <SectionHeading as="h3">{{ t('settings.notifications') }}</SectionHeading>
          <p class="settings-general-description">{{ t('settings.notificationsIntro') }}</p>
        </header>
        <div class="settings-general-row">
          <span class="settings-general-identity">
            <strong class="settings-general-label">{{ t('settings.notifyEnabled') }}</strong>
            <small class="settings-general-hint">{{ t('settings.notifyEnabledHint') }}</small>
          </span>
          <ToggleSwitch
            v-model="settings.notifyEnabled"
            class="settings-general-toggle"
            :label="t('settings.notifyEnabled')"
            :on-label="t('settings.enabled')"
            :off-label="t('settings.disabled')"
          />
        </div>
        <div class="settings-general-events">
          <label
            v-for="event in NOTIFY_EVENTS"
            :key="event"
            class="settings-general-event"
          >
            <span>{{ t(`settings.event.${event}`) }}</span>
            <input
              v-model="settings.notify[event]"
              class="settings-general-checkbox"
              type="checkbox"
              :disabled="!settings.notifyEnabled"
            />
          </label>
        </div>
        <div
          v-if="permission === 'default' && settings.notifyEnabled"
          class="settings-general-permission"
        >
          <p class="settings-general-permission-copy">{{ t('settings.permissionIntro') }}</p>
          <VButton @click="askPermission">{{ t('settings.permissionAsk') }}</VButton>
        </div>
        <p
          v-else-if="permission === 'denied' && settings.notifyEnabled"
          class="settings-general-denied"
        >
          {{ t('settings.permissionDenied') }}
        </p>
      </section>
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

.settings-general-group {
  min-width: 0;

  & + .settings-general-group {
    border-top: 1px solid var(--color-rule-strong);
  }
}

.settings-general-head {
  padding: var(--space-4);
  background: var(--color-surface-muted);

  .settings-general-description,
  .settings-general-catalog-note {
    max-width: 72ch;
    margin: var(--space-1) 0 0;
    color: var(--color-text-muted);
    font: var(--font-note);
  }

  .settings-general-catalog-note {
    color: var(--color-warning);
  }
}

.settings-general-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--size-column-gutter);
  align-items: center;
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-rule);
}

.settings-general-identity {
  display: grid;
  gap: var(--space-1);
  min-width: 0;

  .settings-general-label {
    font: var(--font-label);
  }

  .settings-general-hint {
    color: var(--color-text-muted);
    font: var(--font-detail);
  }
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
  gap: var(--space-half);
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

.settings-general-toggle {
  justify-self: start;
}

.settings-general-events {
  display: grid;
}

.settings-general-event {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--size-column-gutter);
  align-items: center;
  min-height: var(--size-control-target);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-rule);
  font-size: var(--font-size-dense);

  .settings-general-checkbox {
    justify-self: start;
    width: 18px;
    height: 18px;
    accent-color: var(--color-accent);

    &:disabled {
      cursor: not-allowed;
      accent-color: var(--color-text-disabled);
    }
  }
}

.settings-general-permission {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);

  .settings-general-permission-copy {
    max-width: 58ch;
    margin: 0;
    color: var(--color-text-muted);
    font: var(--font-detail);
  }
}

.settings-general-denied {
  padding: var(--space-3) var(--space-4);
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

@container workspace (width <= 696px) {
  .settings-general-row {
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: start;
  }

  .settings-general-toggle {
    justify-self: start;
  }

  .settings-general-event {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-3);
  }
}
</style>
