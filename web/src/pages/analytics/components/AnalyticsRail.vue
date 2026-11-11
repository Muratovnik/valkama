<script setup lang="ts">
/**
 * The sections of the Analytics page, the overview first and then a dimension each: where the
 * reader goes to see one of them in the panel beside the rail.
 *
 * A section is a place on the page, so the rail is navigation — a landmark of buttons, the one on
 * show marked as the page — rather than a value chosen in a field. That entry carries the mark
 * three ways, a line on its start edge, the heavier weight and a brighter ground, so it reads
 * without its colour and in a forced palette, where the line is drawn in the system's own ink.
 *
 * On a screen too narrow for the rail beside the panel the rail is the whole screen, a list whose
 * entries each lead on to their section, which their chevron says.
 */
import { ref } from 'vue'

import type { AnalyticsSection } from '@/shared/api/analyticsAddress.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The rail's name to a reader. */
  label: string
  /** Whether the rail is the whole screen, each entry leading on to its section. */
  list: boolean
  sections: readonly { label: string; value: AnalyticsSection }[]
  /** The section on show. */
  selected: AnalyticsSection
}>()
const emit = defineEmits<{ choose: [section: AnalyticsSection] }>()

/**
 * The two marks of the entry on show, which cannot disagree: its class and `aria-current`, which
 * the other entries leave out rather than set to false.
 */
function mark(section: AnalyticsSection) {
  const current = section === props.selected
  return { 'class': { selected: current }, 'aria-current': current ? ('page' as const) : undefined }
}

const rail = ref<HTMLElement | null>(null)

/** Puts focus on the entry of the section on show, as a return to the list leaves it. */
function focusSelected() {
  rail.value?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
}
defineExpose({ focusSelected })
</script>

<template>
  <nav
    ref="rail"
    class="analytics-rail"
    :aria-label="label"
  >
    <ul class="analytics-rail-list">
      <li
        v-for="section in sections"
        :key="section.value"
      >
        <button
          type="button"
          class="analytics-rail-entry"
          :data-section="section.value"
          v-bind="mark(section.value)"
          @click="emit('choose', section.value)"
        >
          <span class="analytics-rail-name one-line">{{ section.label }}</span>
          <VIcon
            v-if="list"
            class="analytics-rail-chevron"
            name="chevron-right"
            :size="16"
          />
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.analytics-rail {
  min-width: 0;
}

.analytics-rail-list {
  display: grid;
  gap: var(--space-half);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* The name and, on a list, the chevron at the far end. The start edge keeps the room of the
   selected entry's line on every entry, so choosing one moves no word. */
.analytics-rail-entry {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: 0 var(--space-3);
  border: 0;
  border-inline-start: 3px solid transparent;
  color: var(--color-text-muted);
  font: var(--font-name);
  text-align: start;
  background: transparent;
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;
  }

  &.selected {
    color: var(--color-text);
    font-weight: 600;
    background: var(--color-surface-active);
    border-inline-start-color: var(--color-accent);

    @media (forced-colors: active) {
      border-inline-start-color: Highlight;
    }
  }
}

.analytics-rail-name {
  min-width: 0;
}

.analytics-rail-chevron {
  flex: none;
  color: var(--color-text-muted);
}
</style>
