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
 * Each entry is a tile: the section's name and, under it, its figures in the page's measure
 * (`RailTile`) — the overview's total, its change and its days; a dimension's count of values, its
 * first value with that value's share and the shares of the first few. The name is the entry's
 * name to a reader and the figures its description, so the name stays what a voice command says.
 *
 * On a screen too narrow for the rail beside the panel the rail is the whole screen, a list whose
 * entries each lead on to their section, which their chevron says.
 */
import { computed, ref, useId } from 'vue'

import RailTile from '@/pages/analytics/components/RailTile.vue'
import type { RailTileModel } from '@/pages/analytics/composables/useRailTiles.ts'

import { OVERVIEW } from '@/shared/api/analyticsAddress.ts'
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
  /** Each section's figures; a section without them shows its name alone. */
  tiles: Partial<Record<AnalyticsSection, RailTileModel>>
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

const ids = useId()

/**
 * The sections with the figures each has, if any, the ids that name an entry by its name and
 * describe it by its figures, and the chart its tile draws: the overview's days, a dimension's
 * shares.
 */
const entries = computed(() =>
  props.sections.map((section) => {
    const tile = props.tiles[section.value]
    return {
      ...section,
      tile,
      nameId: `${ids}-${section.value}-name`,
      tileId: tile ? `${ids}-${section.value}-tile` : undefined,
      chart: section.value === OVERVIEW ? ('trend' as const) : ('shares' as const),
    }
  }),
)

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
        v-for="section in entries"
        :key="section.value"
      >
        <button
          type="button"
          class="analytics-rail-entry"
          :data-section="section.value"
          :aria-labelledby="section.nameId"
          :aria-describedby="section.tileId"
          v-bind="mark(section.value)"
          @click="emit('choose', section.value)"
        >
          <span class="analytics-rail-head">
            <span
              :id="section.nameId"
              class="analytics-rail-name one-line"
              >{{ section.label }}</span
            >
            <span
              v-if="section.tile?.count"
              class="analytics-rail-count"
              >{{ section.tile.count }}</span
            >
            <VIcon
              v-if="list"
              class="analytics-rail-chevron"
              name="chevron-right"
              :size="16"
            />
          </span>
          <RailTile
            v-if="section.tile"
            :id="section.tileId"
            class="analytics-rail-tile"
            :chart="section.chart"
            :tile="section.tile"
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

/* The name over the tile's figures. The start edge keeps the room of the selected entry's line
   on every entry, so choosing one moves no word. */
.analytics-rail-entry {
  display: grid;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: var(--space-2) var(--space-3);
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

/* The name, the count of values at the far end, and on a list the chevron after it. */
.analytics-rail-head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.analytics-rail-name {
  flex: 1 1 auto;
  min-width: 0;
}

.analytics-rail-count {
  flex: none;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.analytics-rail-chevron {
  flex: none;
  color: var(--color-text-muted);
}
</style>
