<script setup lang="ts">
/**
 * Opening sessions and files. A session opens where it was last open, which the
 * server knows; each family sets only where it goes when that place is unknown or
 * cannot be opened, and may replace the rule with one place or the owner's own
 * command. Files and folders open in one editor.
 */
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import { EDITORS, fetchOpenPlaces } from '@/shared/api/openPlanModel.ts'
import type { Editor, OpenPlace, OpenPlaces } from '@/shared/api/openPlanModel.ts'
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

/** What this machine can open, as a plan reads it; until it is known, every place is offered. */
const installed = ref<OpenPlaces | null>(null)
const placesUnknown = ref(false)

onMounted(async () => {
  try {
    installed.value = await fetchOpenPlaces()
  } catch {
    placesUnknown.value = true
  }
})

const isMissing = (place: string) => installed.value?.[place as OpenPlace] === false

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

/**
 * A place that is not installed is not offered. One already chosen stays shown, with
 * what it means beside it, because the choice is the owner's and a plan passes it over.
 */
function offered<T extends string>(places: readonly T[], chosen: string): T[] {
  return places.filter((place) => place === chosen || !isMissing(place))
}

function fallbackOptions(family: SessionFamily): ChoiceOption[] {
  const chosen = settings.value.sessions[family].fallback
  return offered(placesFor(family), chosen).map((place) => placeOption(place))
}

/** A family Valkama cannot resume has nothing to fall back to: open by the command or not at all. */
function alwaysOptions(family: SessionFamily): ChoiceOption[] {
  const chosen = settings.value.sessions[family].always
  return offered(alwaysChoicesFor(family), chosen).map((choice) => {
    if (choice === 'custom')
      return { value: choice, label: t('open.settings.custom'), icon: ICONS.custom }
    if (choice === '') {
      return family === 'other'
        ? { value: choice, label: t('open.settings.none'), icon: 'off' }
        : { value: choice, label: t('open.settings.lastPlace'), icon: ICONS[''] }
    }
    return placeOption(choice)
  })
}

const editorOptions = computed<ChoiceOption[]>(() =>
  offered(EDITORS, settings.value.editor).map((place) => placeOption(place)),
)

/** What a chosen place that is not installed comes to. */
function missingNote(chosen: string): string {
  return chosen && isMissing(chosen)
    ? t('open.settings.notInstalled', { place: t(`open.place.${chosen}`) })
    : ''
}

/** While a place replaces the rule, the row says so: the click will not go where the session was. */
function overridden(family: SessionFamily): string {
  const always = settings.value.sessions[family].always
  if (always === '' || always === 'custom') return ''
  return t('open.settings.overridden', {
    family: t(`open.settings.family.${family}`),
    where: t(`open.where.${always}`),
  })
}

function commandError(family: SessionFamily): string {
  const opening = settings.value.sessions[family]
  const error = opening.always === 'custom' ? validateCustomCommand(opening.command) : null
  return error === null ? '' : t(`open.settings.commandError.${error}`)
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
    :title="t('open.settings.title')"
    :intro="t('open.settings.intro')"
  >
    <template
      v-if="placesUnknown"
      #note
    >
      <p
        class="settings-opening-unknown"
        role="status"
      >
        {{ t('open.settings.placesUnknown') }}
      </p>
    </template>
    <SettingsRow
      v-for="family in SESSION_FAMILIES"
      :key="family"
      :label="t(`open.settings.family.${family}`)"
      :hint="t(`open.settings.familyHint.${family}`)"
    >
      <span class="settings-opening-lanes">
        <span
          v-if="placesFor(family).length"
          class="settings-opening-lane"
        >
          <small class="settings-opening-lane-label">{{ t('open.settings.fallback') }}</small>
          <SelectionControl
            class="settings-opening-control"
            mode="combobox"
            :model-value="settings.sessions[family].fallback"
            :options="fallbackOptions(family)"
            :label="`${t(`open.settings.family.${family}`)}: ${t('open.settings.fallback')}`"
            @update:model-value="selectFallback(family, $event)"
          />
          <small
            v-if="missingNote(settings.sessions[family].fallback)"
            class="settings-opening-note"
            >{{ missingNote(settings.sessions[family].fallback) }}</small
          >
        </span>
        <span class="settings-opening-lane">
          <small class="settings-opening-lane-label">{{ t('open.settings.always') }}</small>
          <SelectionControl
            class="settings-opening-control"
            mode="combobox"
            :model-value="settings.sessions[family].always"
            :options="alwaysOptions(family)"
            :label="`${t(`open.settings.family.${family}`)}: ${t('open.settings.always')}`"
            @update:model-value="selectAlways(family, $event)"
          />
          <small
            v-if="missingNote(settings.sessions[family].always)"
            class="settings-opening-note"
            >{{ missingNote(settings.sessions[family].always) }}</small
          >
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
          :label="t('open.settings.command')"
          :hint="t('open.settings.commandHint')"
          :maxlength="MAX_CUSTOM_COMMAND_LENGTH"
          :placeholder="t('open.settings.commandPlaceholder')"
          :error="commandError(family)"
          @update:model-value="editCommand(family, $event)"
        />
      </span>
    </SettingsRow>
    <SettingsRow
      :label="t('open.settings.editor')"
      :hint="t('open.settings.editorHint')"
    >
      <SelectionControl
        class="settings-opening-control"
        mode="combobox"
        :model-value="settings.editor"
        :options="editorOptions"
        :label="t('open.settings.editor')"
        @update:model-value="selectEditor"
      />
      <small
        v-if="missingNote(settings.editor)"
        class="settings-opening-note"
        >{{ missingNote(settings.editor) }}</small
      >
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

.settings-opening-unknown {
  max-width: 72ch;
  margin: 0;
  color: var(--color-warning);
  font: var(--font-note);
}

.settings-opening-note {
  max-width: 60ch;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
