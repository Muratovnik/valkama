<script setup lang="ts">
/**
 * The labels group of the Participation tab: a row for each label that has a rule or a
 * description in the scope on show, and a field that adds a rule to another one.
 *
 * Only labels with a rule are listed: a space may carry any number of labels, and few of them
 * have one. A new rule is found among the labels the space's work carries, or typed whole. A
 * rule has two fields — whether its findings are ready at once, and what the label means —
 * and a scope keeps each one or takes it from above on its own, so a change of one field
 * leaves the other as the scope's record has it. In a space a label inherits the shared rule
 * until «Own value» is switched on, as every scoped row does, and switching it off gives the
 * whole rule back. In the shared scope «Remove rule» takes a rule away; its row leaves with
 * the server's answer, and a refusal keeps it with the reason under it. A row that leaves
 * while the focus is in it hands the focus to the field that adds a rule.
 *
 * Each row carries `data-participation-label` with its label, the hook a check selects it by.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'
import SettingsScopedRow from '@/pages/settings/components/SettingsScopedRow.vue'

import type { ParticipationEdit, ParticipationLabel } from '@/shared/api/participationApi.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The labels the space's work carries, the most used first. */
  known: readonly string[]
  rules: readonly ParticipationLabel[]
  scope: 'global' | 'space'
  failureOf: (label: string) => string
}>()

const emit = defineEmits<{ edit: [edit: ParticipationEdit] }>()

const { t } = useI18n()

/** What is typed into a description until it is left, by label. */
const drafts = ref<Record<string, string>>({})
const picked = ref<string[]>([])

const addRow = useTemplateRef<{ $el: HTMLElement }>('addRow')
/** The label whose row last took the focus; not shown, so not reactive. */
let focusedIn: string | null = null

/* A focused control that leaves the page leaves the focus nowhere, on the body. */
watch(
  () => props.rules.map((rule) => rule.label),
  async (labels) => {
    if (focusedIn === null || labels.includes(focusedIn)) return
    focusedIn = null
    await nextTick()
    const focused = document.activeElement
    if (focused === null || focused === document.body)
      addRow.value?.$el.querySelector<HTMLInputElement>('input')?.focus()
  },
)

const options = computed(() => {
  const ruled = new Set(props.rules.map((rule) => rule.label))
  return props.known.filter((label) => !ruled.has(label)).map((label) => ({ value: label, label }))
})

function hintOf(rule: ParticipationLabel): string {
  if (rule.description) return rule.description
  return t(
    rule.ready ? 'settings.participation.labels.ready' : 'settings.participation.labels.waits',
  )
}

function readyWords(ready: boolean): string {
  return t(
    ready ? 'settings.participation.labels.readyOn' : 'settings.participation.labels.readyOff',
  )
}

/** In the shared scope the rule is always its own; in a space while it sets a field itself. */
function ownOf(rule: ParticipationLabel): boolean | null {
  return props.scope === 'global' || rule.own.ready || rule.own.description ? rule.ready : null
}

/** The shared rule's answer, which a space inherits; nothing in the shared scope. */
function inheritedOf(rule: ParticipationLabel): boolean | undefined {
  return props.scope === 'space' ? rule.inherited.ready : undefined
}

function isReady(value: boolean | null): boolean {
  return value === true
}

function write(label: string, ready: boolean | null, description: string | null) {
  emit('edit', { label, ready, description })
}

/*
 * A change of one field writes the other as the scope's own record holds it: null where the
 * record leaves it to the rule above, so that it stays inherited and follows that rule later.
 */
function writeReady(rule: ParticipationLabel, ready: boolean) {
  write(rule.label, ready, rule.own.description ? rule.description : null)
}

function writeDescription(rule: ParticipationLabel, description: string | null) {
  write(rule.label, rule.own.ready ? rule.ready : null, description)
}

/** «Own value» on makes the shared answer the space's own; off lets the whole rule inherit. */
function setOwn(rule: ParticipationLabel, ready: boolean | null) {
  if (ready === null) write(rule.label, null, null)
  else writeReady(rule, ready)
}

function commitDescription(rule: ParticipationLabel) {
  const typed = drafts.value[rule.label]
  if (typed === undefined) return
  drafts.value = Object.fromEntries(
    Object.entries(drafts.value).filter(([label]) => label !== rule.label),
  )
  const said = typed.trim() || null
  if (said !== rule.description) writeDescription(rule, said)
}

function press(event: KeyboardEvent, rule: ParticipationLabel) {
  if (event.key === 'Enter') commitDescription(rule)
}

/** Takes the shared rule away: both fields null. */
function remove(rule: ParticipationLabel) {
  write(rule.label, null, null)
}

/** A label chosen or typed gets a rule that its findings are ready at once. */
function add(values: string[]) {
  const label = values.at(-1)?.trim()
  picked.value = []
  if (label) write(label, true, null)
}
</script>

<template>
  <SettingsGroup :title="t('settings.participation.labels.title')">
    <SettingsScopedRow
      v-for="rule in rules"
      :key="rule.label"
      :data-participation-label="rule.label"
      :label="rule.label"
      :hint="hintOf(rule)"
      :scope="scope"
      :own="ownOf(rule)"
      :inherited="inheritedOf(rule)"
      :failure="failureOf(rule.label)"
      :words-of="readyWords"
      @focusin="focusedIn = rule.label"
      @update:own="(ready) => setOwn(rule, ready)"
    >
      <template #default="{ names, value, update }">
        <ToggleSwitch
          :aria-describedby="names['aria-describedby']"
          :aria-labelledby="names['aria-labelledby']"
          :label="t('settings.participation.labels.readyName', { label: rule.label })"
          :model-value="isReady(value)"
          :on-label="t('settings.participation.labels.readyOn')"
          :off-label="t('settings.participation.labels.readyOff')"
          @update:model-value="update"
        />
        <VTextInput
          class="participation-description"
          :label="t('settings.participation.labels.description', { label: rule.label })"
          :placeholder="t('settings.participation.labels.describe')"
          :maxlength="20000"
          :model-value="drafts[rule.label] ?? rule.description ?? ''"
          hide-label
          @update:model-value="(typed) => (drafts = { ...drafts, [rule.label]: typed })"
          @focusout="commitDescription(rule)"
          @keydown="press($event, rule)"
        />
        <VButton
          v-if="scope === 'global'"
          class="participation-remove"
          variant="ghost"
          size="compact"
          :aria-label="t('settings.participation.labels.removeName', { label: rule.label })"
          @click="remove(rule)"
        >
          {{ t('settings.participation.labels.remove') }}
        </VButton>
      </template>
    </SettingsScopedRow>
    <p
      v-if="rules.length === 0"
      class="participation-labels-empty"
    >
      {{ t('settings.participation.labels.empty') }}
    </p>
    <SettingsRow
      ref="addRow"
      :label="t('settings.participation.labels.add')"
    >
      <SearchCombobox
        :model-value="picked"
        :label="t('settings.participation.labels.add')"
        :placeholder="t('settings.participation.labels.find')"
        :options="options"
        :empty-label="t('settings.participation.labels.none')"
        :create-label="(label) => t('settings.participation.labels.create', { label })"
        :max="1"
        :maxlength="64"
        hide-label
        @update:model-value="add"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<style scoped>
.participation-description {
  width: 100%;
}

/* The choice column stacks its controls with no gap; the switch keeps its own room. */
.participation-remove {
  margin-top: var(--space-2);
}

.participation-labels-empty {
  padding: var(--space-3) var(--space-4);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
