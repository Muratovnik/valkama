<script setup lang="ts">
/**
 * Opening sessions and files. A session opens where it was last open, which the
 * server knows; each family sets only where it goes when that place is unknown or
 * cannot be opened, and may replace the rule with one place or the owner's own
 * command. Files and folders open in one editor.
 */
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import { EDITORS } from '@/shared/api/openPlanModel.ts'
import type { Editor, OpenPlace } from '@/shared/api/openPlanModel.ts'
import type { AlwaysChoice, SessionFamily } from '@/shared/lib/settings.ts'
import {
  alwaysChoicesFor,
  MAX_CUSTOM_COMMAND_LENGTH,
  placesFor,
  SESSION_FAMILIES,
  validateCustomCommand,
} from '@/shared/lib/settings.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import type { ChoiceOption, ControlIconName } from '@/shared/ui/choiceControls.ts'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const { t } = useI18n()
const { settings } = storeToRefs(useSettingsStore())

const ICONS: Record<OpenPlace | 'custom' | '', ControlIconName> = {
  '': 'last-place',
  'vscode': 'vscode',
  'vscode-insiders': 'vscode',
  'cursor': 'cursor',
  'windsurf': 'vscode',
  'terminal': 'terminal',
  'claude-desktop': 'claude',
  'codex-app': 'codex',
  'custom': 'command',
}

function placeOption(place: OpenPlace): ChoiceOption {
  return { value: place, label: t(`open.place.${place}`), icon: ICONS[place] }
}

function fallbackOptions(family: SessionFamily): ChoiceOption[] {
  return placesFor(family).map((place) => placeOption(place))
}

/** A family Valkama cannot resume has nothing to fall back to: open by the command or not at all. */
function alwaysOptions(family: SessionFamily): ChoiceOption[] {
  return alwaysChoicesFor(family).map((choice) => {
    if (choice === 'custom')
      return { value: choice, label: t('settings.opening.custom'), icon: ICONS.custom }
    if (choice === '') {
      return family === 'other'
        ? { value: choice, label: t('settings.opening.none'), icon: 'off' }
        : { value: choice, label: t('settings.opening.lastPlace'), icon: ICONS[''] }
    }
    return placeOption(choice)
  })
}

const editorOptions = computed<ChoiceOption[]>(() => EDITORS.map((place) => placeOption(place)))

/** While a place replaces the rule, the row says so: the click will not go where the session was. */
function overridden(family: SessionFamily): string {
  const always = settings.value.sessions[family].always
  if (always === '' || always === 'custom') return ''
  return t('settings.opening.overridden', {
    family: t(`settings.opening.family.${family}`),
    place: t(`open.place.${always}`),
  })
}

function commandError(family: SessionFamily): string {
  const opening = settings.value.sessions[family]
  const error = opening.always === 'custom' ? validateCustomCommand(opening.command) : null
  return error === null ? '' : t(`settings.opening.commandError.${error}`)
}

function selectFallback(family: SessionFamily, value: string) {
  if (!placesFor(family).includes(value as OpenPlace)) return
  settings.value.sessions[family].fallback = value as OpenPlace
}

function selectAlways(family: SessionFamily, value: string) {
  if (!alwaysChoicesFor(family).includes(value as AlwaysChoice)) return
  settings.value.sessions[family].always = value as AlwaysChoice
}

function editCommand(family: SessionFamily, value: string) {
  settings.value.sessions[family].command = value
}

function selectEditor(value: string) {
  if (EDITORS.includes(value as Editor)) settings.value.editor = value as Editor
}
</script>

<template>
  <SettingsGroup
    :title="t('settings.opening.title')"
    :intro="t('settings.opening.intro')"
  >
    <SettingsRow
      v-for="family in SESSION_FAMILIES"
      :key="family"
      :label="t(`settings.opening.family.${family}`)"
      :hint="t(`settings.opening.familyHint.${family}`)"
    >
      <span class="settings-opening-lanes">
        <span
          v-if="placesFor(family).length"
          class="settings-opening-lane"
        >
          <small class="settings-opening-lane-label">{{ t('settings.opening.fallback') }}</small>
          <SelectionControl
            class="settings-opening-control"
            mode="combobox"
            :model-value="settings.sessions[family].fallback"
            :options="fallbackOptions(family)"
            :label="`${t(`settings.opening.family.${family}`)}: ${t('settings.opening.fallback')}`"
            @update:model-value="selectFallback(family, $event)"
          />
        </span>
        <span class="settings-opening-lane">
          <small class="settings-opening-lane-label">{{ t('settings.opening.always') }}</small>
          <SelectionControl
            class="settings-opening-control"
            mode="combobox"
            :model-value="settings.sessions[family].always"
            :options="alwaysOptions(family)"
            :label="`${t(`settings.opening.family.${family}`)}: ${t('settings.opening.always')}`"
            @update:model-value="selectAlways(family, $event)"
          />
        </span>
        <p
          v-if="overridden(family)"
          class="settings-opening-note"
        >
          {{ overridden(family) }}
        </p>
        <VTextInput
          v-if="settings.sessions[family].always === 'custom'"
          class="settings-opening-control"
          autocomplete="off"
          :model-value="settings.sessions[family].command"
          :label="t('settings.opening.command')"
          :hint="t('settings.opening.commandHint')"
          :maxlength="MAX_CUSTOM_COMMAND_LENGTH"
          :placeholder="t('settings.opening.commandPlaceholder')"
          :error="commandError(family)"
          @update:model-value="editCommand(family, $event)"
        />
      </span>
    </SettingsRow>
    <SettingsRow
      :label="t('settings.opening.editor')"
      :hint="t('settings.opening.editorHint')"
    >
      <SelectionControl
        class="settings-opening-control"
        mode="combobox"
        :model-value="settings.editor"
        :options="editorOptions"
        :label="t('settings.opening.editor')"
        @update:model-value="selectEditor"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<style scoped>
.settings-opening-lanes {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.settings-opening-lane {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.settings-opening-lane-label {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.settings-opening-control {
  width: 100%;
  min-width: 0;
}

.settings-opening-note {
  max-width: 60ch;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
