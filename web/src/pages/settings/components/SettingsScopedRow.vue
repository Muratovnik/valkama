<script setup lang="ts" generic="Value extends string | number | boolean">
/**
 * A setting that holds a shared value and, in a space, that space's own one: what it is on
 * the left, its choice on the right, as `SettingsRow`.
 *
 * In the shared scope the row is a plain setting. In a space it inherits the shared value
 * until «Own value» is switched on: inheriting, it says the shared value in words and draws
 * no choice; owning, the choice starts from the shared value and the name carries a quiet
 * «own». Switching it off is the way back to the shared value, in one write: a separate
 * reset would be a second control for the same state.
 *
 * The row keeps no value of its own. What it shows is what the host says (`own`,
 * `inherited`), and a change goes back to it as `update:own`, null to inherit; so a write that does not hold takes the value back by the host putting the
 * confirmed one back, and the reason stands under the row (`failure`). Nothing here is
 * disabled while a write is out, because a disabled control drops the keyboard's focus.
 *
 * The default slot draws the choice — a `SegmentedControl`, a `ToggleSwitch` or a number
 * field — from `value`, hands a new one to `update`, and binds `names` on it, so that the
 * row's name labels the choice and its hint describes it.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsRow from '@/pages/settings/components/SettingsRow.vue'

import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

const props = withDefaults(
  defineProps<{
    /** One sentence on what happens at the value in force now. */
    hint: string
    label: string
    /** The value this scope holds itself; null while a space inherits the shared one. */
    own: Value | null
    scope: 'global' | 'space'
    /** Why the last change did not hold; it stands under the choice. */
    failure?: string
    /** The shared value; only in a space's scope. */
    inherited?: Value
    /** A choice wider than half the row (`SettingsRow`). */
    wide?: boolean
    /** The words for a value, as the inherited one is said. */
    wordsOf?: (value: Value) => string
  }>(),
  { inherited: undefined, failure: '', wordsOf: String, wide: false },
)

/** A new own value, or null to inherit the shared one again. */
const emit = defineEmits<{ 'update:own': [own: Value | null] }>()

defineSlots<{
  default: (scope: {
    names: { 'aria-describedby': string | undefined; 'aria-labelledby': string }
    value: Value | null
    update: (value: Value) => void
  }) => unknown
}>()

const { t } = useI18n()
const labelId = useId()
const hintId = useId()

const inSpace = computed(() => props.scope === 'space')
const owned = computed(() => inSpace.value && props.own !== null)
const choiceShown = computed(() => !inSpace.value || owned.value)
const value = computed(() => props.own ?? props.inherited ?? null)
const sharedWords = computed(() =>
  props.inherited === undefined
    ? ''
    : t('settings.scoped.shared', { value: props.wordsOf(props.inherited) }),
)
const names = computed(() => ({
  'aria-labelledby': labelId,
  'aria-describedby': props.hint ? hintId : undefined,
}))

function update(next: Value) {
  emit('update:own', next)
}

/** Owning starts from the shared value; letting go inherits it again. */
function setOwned(on: boolean) {
  if (!on) emit('update:own', null)
  else if (props.inherited !== undefined) emit('update:own', props.inherited)
}
</script>

<template>
  <SettingsRow
    :label="label"
    :hint="hint"
    :hint-id="hintId"
    :label-id="labelId"
    :failure="failure"
    :stack="inSpace"
    :wide="wide"
  >
    <!-- A space, not a margin, between the two: the name is also what labels the choice. -->
    <template #label
      >{{ label }}
      <small
        v-if="owned"
        class="settings-scoped-mark"
        >{{ t('settings.scoped.ownMark') }}</small
      ></template
    >
    <div
      v-if="inSpace"
      class="settings-scoped-own"
    >
      <ToggleSwitch
        :model-value="owned"
        :label="t('settings.scoped.ownName', { label })"
        :on-label="t('settings.scoped.own')"
        :off-label="t('settings.scoped.own')"
        @update:model-value="setOwned"
      />
      <span
        v-if="sharedWords"
        class="settings-scoped-shared"
        >{{ sharedWords }}</span
      >
    </div>
    <!-- At its own width from the start of the column, as a switch beside it is: a choice
         stretched over the column drew a track far wider than its segments. -->
    <div
      v-if="choiceShown"
      class="settings-scoped-choice"
    >
      <slot
        :value="value"
        :update="update"
        :names="names"
      />
    </div>
  </SettingsRow>
</template>

<style scoped>
.settings-scoped-mark {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.settings-scoped-own {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  min-width: 0;
}

.settings-scoped-choice {
  display: grid;
  justify-items: start;
  min-width: 0;
}

.settings-scoped-shared {
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
