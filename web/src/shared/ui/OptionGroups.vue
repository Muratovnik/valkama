<script setup lang="ts">
/**
 * A list of options in named groups, any number of them chosen: the popup a
 * one-line field drives (`VTextInput` with `completion`).
 *
 * It never takes focus. The field keeps the caret, so typing goes on narrowing
 * the list, and names the highlighted row through `aria-activedescendant`; a
 * pointer press here is kept from stealing the caret for the same reason. The
 * host places it: this draws the surface, not where it stands.
 */
import { computed } from 'vue'

import { optionGroupItemId } from '@/shared/ui/choiceControls.ts'
import VIcon from '@/shared/ui/VIcon.vue'

interface OptionGroup {
  id: string
  name: string
  options: readonly { key: string; selected: boolean; text: string; detail?: string }[]
}

const props = defineProps<{
  /** Said in place of the list when no group has an option left. */
  empty: string
  groups: readonly OptionGroup[]
  /** The highlighted option by its place in reading order; -1 for none. */
  highlight: number
  id: string
  label: string
}>()

const emit = defineEmits<{
  'choose': [key: string]
  'update:highlight': [place: number]
}>()

/** The DOM id of an option by its place in reading order, which the arrows walk. */
const optionId = (place: number) => optionGroupItemId(props.id, place)

const rows = computed(() => {
  let place = 0
  return props.groups.map((group) => ({
    group,
    headingId: `${props.id}-group-${group.id}`,
    options: group.options.map((option) => ({ option, place: place++ })),
  }))
})

const none = computed(() => rows.value.every((row) => !row.options.length))

/** Absent rather than false: the attribute is what the style reads. */
const highlighted = (place: number) => place === props.highlight || undefined
</script>

<template>
  <div
    :id="id"
    class="option-groups"
    role="listbox"
    aria-multiselectable="true"
    :aria-label="label"
  >
    <div
      v-for="row in rows"
      :key="row.group.id"
      class="option-group"
      role="group"
      :aria-labelledby="row.headingId"
    >
      <div
        :id="row.headingId"
        class="option-group-name"
        role="presentation"
      >
        {{ row.group.name }}
      </div>
      <div
        v-for="entry in row.options"
        :id="optionId(entry.place)"
        :key="entry.option.key"
        class="option-row"
        role="option"
        tabindex="-1"
        :aria-selected="entry.option.selected"
        :data-highlighted="highlighted(entry.place)"
        @pointerdown.prevent
        @pointermove="emit('update:highlight', entry.place)"
        @click="emit('choose', entry.option.key)"
        @keydown.enter="emit('choose', entry.option.key)"
      >
        <VIcon
          class="option-check"
          name="check"
          :size="14"
        />
        <span class="option-text">{{ entry.option.text }}</span>
        <span
          v-if="entry.option.detail"
          class="option-detail"
          >{{ entry.option.detail }}</span
        >
      </div>
    </div>
    <p
      v-if="none"
      class="option-empty"
    >
      {{ empty }}
    </p>
  </div>
</template>

<style scoped>
/* The choice list's surface: the overlay edge is the one line it draws. */
.option-groups {
  max-height: min(60dvh, 420px);
  padding: var(--space-1);
  border: 1px solid var(--color-rule-strong);
  background: var(--color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--radius-control);
  box-shadow: 0 14px 34px var(--color-shadow);
}

.option-group + .option-group {
  margin-top: var(--space-1);
}

.option-group-name {
  padding: var(--space-1) var(--space-2) var(--space-half);
  color: var(--color-text-tertiary);
  font: var(--font-label);
}

.option-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-inline);
  padding: 0 var(--space-2);
  color: var(--color-text);
  font: var(--font-detail);
  border-radius: var(--radius-control);
  cursor: pointer;

  &[data-highlighted] {
    background: var(--color-surface-hover);
    outline: 1px solid var(--color-focus-ring);
    outline-offset: -1px;
  }
}

/* The check holds its place on every row, so the words line up. */
.option-check {
  flex: 0 0 auto;
  visibility: hidden;

  .option-row[aria-selected='true'] & {
    visibility: visible;
  }
}

.option-text {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.option-detail {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.option-empty {
  padding: var(--space-2);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
