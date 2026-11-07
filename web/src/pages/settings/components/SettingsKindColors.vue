<script setup lang="ts">
/**
 * The colour of each work item kind: a row per kind, its glyph and word in the colour
 * they have now, the system's colour field, and a way back to the default.
 *
 * The field is the platform's own: it opens the system picker, takes the keyboard and
 * reports `#rrggbb`, which is all this needs. A colour that reads poorly is said beside
 * it and stays chosen, because whether to keep it is the owner's to decide. A reset has
 * nothing to do once a row stands at its default, so it is disabled then, and focus goes
 * to the row's field rather than being lost with the button it was on.
 */
import { storeToRefs } from 'pinia'
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import { kindGlyph } from '@/entities/work-item/utils/facets.ts'

import { WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { DEFAULT_KIND_COLORS, kindColor, readsPoorly } from '@/shared/lib/kindColors.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

type Kind = WorkItemBrief['kind']

const { t } = useI18n()
const { settings } = storeToRefs(useSettingsStore())
const id = useId()

const pickerId = (kind: Kind) => `${id}-${kind}`

const rows = computed(() =>
  WORK_ITEM_KINDS.map((kind) => {
    const color = kindColor(settings.value.kindColors, kind)
    return {
      kind,
      color,
      word: t(`workItem.kind.${kind}`),
      glyph: kindGlyph(kind),
      chosen: kind in settings.value.kindColors,
      hintId: readsPoorly(color) ? `${id}-${kind}-hint` : undefined,
    }
  }),
)
const anyChosen = computed(() => rows.value.some((row) => row.chosen))

function write(kind: Kind, color: string | null) {
  const next = { ...settings.value.kindColors }
  if (color === null) delete next[kind]
  else next[kind] = color
  settings.value.kindColors = next
}

/** A choice of the default is no choice: the row then follows the default as any other. */
function choose(kind: Kind, event: Event) {
  const { value } = event.target as HTMLInputElement
  write(kind, value === DEFAULT_KIND_COLORS[kind] ? null : value)
}

const focusField = (kind: Kind) =>
  document.querySelector<HTMLElement>(`#${CSS.escape(pickerId(kind))}`)?.focus()

function reset(kind: Kind) {
  write(kind, null)
  focusField(kind)
}

function resetAll() {
  settings.value.kindColors = {}
  if (WORK_ITEM_KINDS[0]) focusField(WORK_ITEM_KINDS[0])
}
</script>

<template>
  <SettingsGroup
    :title="t('settings.kindColors.title')"
    :intro="t('settings.kindColors.intro')"
  >
    <SettingsRow
      v-for="row in rows"
      :key="row.kind"
      :label="row.word"
    >
      <template #label>
        <span
          class="kind-color-name"
          :data-kind="row.kind"
        >
          <VIcon
            v-if="row.glyph"
            :name="row.glyph"
            :size="14"
            :stroke-width="2"
          />
          {{ row.word }}
        </span>
      </template>
      <div class="kind-color-field">
        <input
          :id="pickerId(row.kind)"
          class="kind-color-input"
          type="color"
          :value="row.color"
          :aria-label="t('settings.kindColors.pick', { kind: row.word })"
          :aria-describedby="row.hintId"
          @input="choose(row.kind, $event)"
        />
        <span class="kind-color-value">{{ row.color }}</span>
        <VButton
          variant="ghost"
          size="compact"
          :disabled="!row.chosen"
          :aria-label="t('settings.kindColors.resetName', { kind: row.word })"
          @click="reset(row.kind)"
        >
          {{ t('settings.kindColors.reset') }}
        </VButton>
      </div>
      <small
        v-if="row.hintId"
        :id="row.hintId"
        class="kind-color-hint"
        >{{ t('settings.kindColors.poor') }}</small
      >
    </SettingsRow>
    <div class="kind-colors-foot">
      <VButton
        size="compact"
        :disabled="!anyChosen"
        @click="resetAll"
      >
        {{ t('settings.kindColors.resetAll') }}
      </VButton>
    </div>
  </SettingsGroup>
</template>

<style scoped>
.kind-color-name {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  color: var(--color-kind-ink);
}

.kind-color-field {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
}

/* The face is the colour itself, on the fill every control stands on, as tall as the compact
   reset beside it: the floor every input is given would stand it 4px taller. */
.kind-color-input {
  flex: none;
  inline-size: var(--size-control-target);
  block-size: var(--size-control-height-compact);
  min-block-size: 0;
  padding: var(--space-1);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-active);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  &::-webkit-color-swatch {
    border: 0;
    border-radius: var(--radius-status);
  }

  /* A forced palette clears the fill, and the colour is what this field is about: it
     keeps its own, inside the outline the palette gives it. Its value is in words beside. */
  @media (forced-colors: active) {
    outline: 1px solid;
    forced-color-adjust: none;
  }
}

.kind-color-value {
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-family: var(--font-family-mono);
}

.kind-color-hint {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.kind-colors-foot {
  padding: var(--space-3) var(--space-4);
}
</style>
