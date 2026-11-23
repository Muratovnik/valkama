<script setup lang="ts">
/**
 * One value of the participation setting as a scoped row: a point drawn as «Agent | Human»,
 * a switch as a switch, a number as a field saved when it is left or Enter is pressed.
 *
 * Its hint says what happens at the value shown now, so it changes with the value. The row
 * keeps nothing of the value but what is being typed into a number: the value is the host's,
 * and a change goes back to it, null to inherit again.
 *
 * Each row carries `data-participation-row` with its key, the hook a check selects a row by.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsScopedRow from '@/pages/settings/components/SettingsScopedRow.vue'

import {
  PARTICIPATION_NUMBERS,
  PARTICIPATION_POINTS,
  PARTICIPATION_SWITCHES,
} from '@/shared/api/participationApi.ts'
import type {
  Decider,
  ParticipationNumber,
  ParticipationPoint,
  ParticipationSwitch,
  ParticipationValue,
} from '@/shared/api/participationApi.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

type Value = string | number

const props = defineProps<{
  failure: string
  row: ParticipationValue
  scope: 'global' | 'space'
}>()

/** A new value of the scope's own, or null to inherit again. */
const emit = defineEmits<{ edit: [value: Value | null] }>()

const { t } = useI18n()

const point = computed(() =>
  (PARTICIPATION_POINTS as readonly string[]).includes(props.row.key)
    ? (props.row.key as ParticipationPoint)
    : null,
)
const toggle = computed(() =>
  (PARTICIPATION_SWITCHES as readonly string[]).includes(props.row.key)
    ? (props.row.key as ParticipationSwitch)
    : null,
)
const number = computed(() =>
  point.value === null && toggle.value === null ? (props.row.key as ParticipationNumber) : null,
)

const label = computed(() => {
  if (point.value !== null) return t(`settings.participation.points.${point.value}`)
  if (toggle.value !== null) return t(`settings.participation.switches.${toggle.value}.label`)
  return t(`settings.participation.numbers.${number.value}.label`)
})
const hint = computed(() => {
  const value = props.row.value
  if (point.value !== null) return t(`settings.participation.decides.${value}`)
  if (toggle.value !== null) return t(`settings.participation.switches.${toggle.value}.${value}`)
  const count = Number(value)
  return t(`settings.participation.numbers.${number.value}.hint`, { count }, count)
})

const deciders = computed(() =>
  (['agent', 'human'] as const).map((value) => ({
    value,
    label: t(`settings.participation.deciders.${value}`),
  })),
)

function wordsOf(value: Value): string {
  if (point.value !== null) return t(`settings.participation.deciders.${value}`)
  if (toggle.value !== null) return t(`settings.participation.${value}`)
  const count = Number(value)
  return t(`settings.participation.numbers.${number.value}.words`, { count }, count)
}

/** In the shared scope the value is always its own; in a space only while it is owned. */
const own = computed(() =>
  props.scope === 'global' || props.row.own ? (props.row.value as Value) : null,
)
const inherited = computed(() =>
  props.scope === 'space' ? (props.row.inherited as Value) : undefined,
)
const bounds = computed(() => (number.value === null ? null : PARTICIPATION_NUMBERS[number.value]))

function deciderOf(value: Value | null): Decider | null {
  return value === 'agent' || value === 'human' ? value : null
}

function isOn(value: Value | null): boolean {
  return value === 'on'
}

function switchValue(on: boolean): Value {
  return on ? 'on' : 'off'
}

/** What is typed into a number until it is left; null shows the value. */
const draft = ref<string | null>(null)

/** A whole number within the bounds is written; anything else gives the field its value back. */
function commit(value: Value | null, update: (value: Value) => void) {
  const typed = draft.value
  draft.value = null
  if (typed === null || bounds.value === null) return
  const count = Number(typed)
  if (!Number.isInteger(count) || count === value) return
  if (count < bounds.value.least || count > bounds.value.most) return
  update(count)
}

function press(event: KeyboardEvent, value: Value | null, update: (value: Value) => void) {
  if (event.key === 'Enter') commit(value, update)
}
</script>

<template>
  <SettingsScopedRow
    :data-participation-row="row.key"
    :label="label"
    :hint="hint"
    :scope="scope"
    :own="own"
    :inherited="inherited"
    :failure="failure"
    :words-of="wordsOf"
    @update:own="(value) => emit('edit', value)"
  >
    <template #default="{ names, value, update }">
      <SegmentedControl
        v-if="point !== null"
        :aria-describedby="names['aria-describedby']"
        :aria-labelledby="names['aria-labelledby']"
        :label="label"
        :model-value="deciderOf(value)"
        :options="deciders"
        wrap
        @update:model-value="update"
      />
      <ToggleSwitch
        v-else-if="toggle !== null"
        :aria-describedby="names['aria-describedby']"
        :aria-labelledby="names['aria-labelledby']"
        :label="label"
        :model-value="isOn(value)"
        :on-label="t('settings.participation.on')"
        :off-label="t('settings.participation.off')"
        @update:model-value="(on) => update(switchValue(on))"
      />
      <VTextInput
        v-else
        class="participation-number"
        type="number"
        inputmode="numeric"
        :label="label"
        :describedby="names['aria-describedby']"
        :min="String(bounds?.least)"
        :max="String(bounds?.most)"
        :model-value="draft ?? String(value)"
        hide-label
        @update:model-value="(typed) => (draft = typed)"
        @focusout="commit(value, update)"
        @keydown="press($event, value, update)"
      />
    </template>
  </SettingsScopedRow>
</template>

<style scoped>
.participation-number {
  max-width: 8rem;
}
</style>
