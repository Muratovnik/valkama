<script setup lang="ts">
/**
 * Which values the scoped settings below it show: the shared ones, or those of the space
 * chosen in the context bar, which it starts on.
 *
 * Another space is chosen in the context bar, as everywhere, not by a second choice of
 * space here. With «All spaces» there it has no space to offer: its one segment is the
 * shared values, and a line under it says where a space is chosen.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

type SettingsScope = 'global' | 'space'

const props = defineProps<{
  /** The name of the space chosen in the context bar; null for all spaces. */
  space: string | null
}>()

/** The scope asked for; with no space chosen the shared scope is in force whatever it says. */
const scope = defineModel<SettingsScope>({ default: 'space' })

const { t } = useI18n()
const noteId = useId()

const allSpaces = computed(() => props.space === null)
const shown = computed<SettingsScope>(() => (allSpaces.value ? 'global' : scope.value))
const describedBy = computed(() => (allSpaces.value ? noteId : undefined))
const options = computed(() => {
  const shared = { value: 'global' as const, label: t('settings.scoped.scope.global') }
  if (props.space === null) return [shared]
  return [
    shared,
    { value: 'space' as const, label: t('settings.scoped.scope.space', { space: props.space }) },
  ]
})

function choose(next: SettingsScope) {
  scope.value = next
}
</script>

<template>
  <SettingsRow
    :label="t('settings.scoped.scope.label')"
    :stack="allSpaces"
  >
    <SegmentedControl
      class="settings-scope-segments"
      :label="t('settings.scoped.scope.label')"
      :model-value="shown"
      :options="options"
      :aria-describedby="describedBy"
      @update:model-value="choose"
    />
    <small
      v-if="allSpaces"
      :id="noteId"
      class="settings-scope-note"
      >{{ t('settings.scoped.scope.pickSpace') }}</small
    >
  </SettingsRow>
</template>

<style scoped>
/* At its own width from the start of the column, and a space's name is as long as it was
   given: on a phone the two segments take a line each rather than run out of the row. */
.settings-scope-segments {
  flex-wrap: wrap;
  justify-self: start;
  min-width: 0;
  max-width: 100%;
}

.settings-scope-note {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
