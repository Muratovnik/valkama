<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: boolean
    offLabel: string
    onLabel: string
    busy?: boolean
    disabled?: boolean
    showStateLabel?: boolean
  }>(),
  { disabled: false, busy: false, showStateLabel: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

/** Absent rather than false, because `aria-busy="false"` is a claim and not a default. */
const busyMark = computed(() => props.busy || undefined)

/** The switch says which way it is thrown, in the caller's own words. */
const stateLabel = computed(() => (props.modelValue ? props.onLabel : props.offLabel))

function toggle(current: boolean) {
  emit('update:modelValue', !current)
}
</script>

<template>
  <button
    class="toggle-switch"
    type="button"
    role="switch"
    :aria-label="label"
    :aria-checked="modelValue"
    :aria-busy="busyMark"
    :disabled="disabled || busy"
    @click="toggle(modelValue)"
  >
    <span
      class="toggle-track"
      aria-hidden="true"
      ><span class="toggle-knob"
    /></span>
    <span
      v-if="showStateLabel"
      class="toggle-state"
      >{{ stateLabel }}</span
    >
  </button>
</template>

<style scoped>
.toggle-switch {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;

  /* A 22px track with nothing to widen it, so the height here is the pointer
     target rather than the drawing. */
  min-height: var(--size-control-target);
  padding: var(--space-1);
  border: 0;
  color: var(--color-text);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
}

.toggle-track {
  position: relative;
  width: 38px;
  height: 22px;
  background: var(--color-surface-active);

  /* A pill, not an 11px corner: the track is round because it is 22px tall,
     and spelling half its height here is a second place to change when it
     is not. */
  border-radius: 999px;
  transition: background var(--duration-quick) var(--ease-out);
}

.toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  background: var(--color-surface);
  border-radius: 50%;
  transition: transform var(--duration-quick) var(--ease-out);
}

.toggle-switch[aria-checked='true'] .toggle-track {
  /* On is a selected value, not a successful system health check. Checkbox,
     radio and switch therefore share the interaction accent. */
  background: var(--color-accent);
}

.toggle-switch[aria-checked='true'] .toggle-knob {
  transform: translateX(16px);
}

.toggle-state {
  min-width: 92px;
  font: var(--font-label);
  text-align: left;
}

@media (prefers-reduced-motion: reduce) {
  .toggle-track,
  .toggle-knob {
    transition: none;
  }
}
</style>
