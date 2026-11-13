<script setup lang="ts">
/**
 * The sections of the Analytics page, the overview first and then a dimension each: where the
 * reader goes to see one of them in the panel beside the rail.
 *
 * A section is a place on the page, so the rail is navigation — a landmark of buttons, the one on
 * show marked as the page — rather than a value chosen in a field. Every entry is a box at rest,
 * and the entries take their states from the model the page's rows share (`rowStates.css`): the
 * one on show carries the mark three ways, a line inside its box on the start side, the heavier
 * weight and a brighter ground, so it reads without its colour and in a forced palette, where the
 * line is drawn in the system's own ink.
 *
 * Each entry is a tile: the section's name and, under it, its figures in the page's measure
 * (`RailTile`) — the overview's total, its change and its days; a dimension's count of values, its
 * first value with that value's share and the shares of the first few; a section of the quota,
 * beside its name the state of its tightest window, under it that window's account and share over
 * a thin bar of it. The name is the entry's
 * name to a reader and the figures its description, so the name stays what a voice command says.
 *
 * On a screen too narrow for the rail beside the panel the rail is the whole screen, a list whose
 * entries each lead on to their section, which their chevron says.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import RailTile from '@/pages/analytics/components/RailTile.vue'
import type { RailTileModel } from '@/pages/analytics/composables/useRailTiles.ts'

import { isQuotaSection, OVERVIEW } from '@/shared/api/analyticsAddress.ts'
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
 * The room each entry keeps for its count of values, a count of three figures in the reader's
 * words, held before the figures come: the rail is as wide as its entries need, so a count that
 * took its room only on arriving would widen the rail and move the panel beside it.
 */
const { t } = useI18n()
const countRoom = computed(() => t('analytics.rail.values', { count: 999 }, 999))

/** The chart a section's tile draws: the overview's days, a window of the quota, or shares. */
function chartOf(section: AnalyticsSection) {
  if (section === OVERVIEW) return 'trend' as const
  return isQuotaSection(section) ? ('window' as const) : ('shares' as const)
}

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
      chart: chartOf(section.value),
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
    :class="{ 'analytics-rail-whole': list }"
    :aria-label="label"
  >
    <ul class="analytics-rail-list">
      <li
        v-for="section in entries"
        :key="section.value"
      >
        <button
          type="button"
          class="analytics-rail-entry row-state boxed"
          :data-section="section.value"
          :aria-labelledby="section.nameId"
          :aria-describedby="section.tileId"
          v-bind="mark(section.value)"
          @click="emit('choose', section.value)"
        >
          <span class="analytics-rail-head">
            <span
              class="analytics-rail-name-room"
              :data-room="section.label"
            >
              <span
                :id="section.nameId"
                class="analytics-rail-name one-line"
                >{{ section.label }}</span
              >
            </span>
            <span
              class="analytics-rail-count"
              :data-room="countRoom"
              ><span
                v-if="section.tile?.count"
                class="analytics-rail-count-words"
                >{{ section.tile.count }}</span
              ></span
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

<style scoped src="@/shared/ui/rowStates.css"></style>

<style scoped>
/* A ground on the module's panel, which is what parts the rail from the panel and the bar, and a
   column that scrolls on its own and holds what it scrolls, a copy for a reader placed out of
   sight among it too. It keeps its scrollbar's room whether it scrolls or not, so a window too
   low for its sections narrows no entry. Beside the panel it is as wide as its entries need,
   within a range: at a constant 15rem an entry's words had 182px, and «Способ запуска» lost its
   last letters beside its count. Its entries' edge stands on the page's left line, the module
   name's inset in `AppContextBar.vue` (`AnalyticsView`). */
.analytics-rail {
  position: relative;
  min-height: 0;
  min-inline-size: 15rem;
  max-inline-size: 22rem;
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
  background: var(--color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-start-end-radius: var(--radius-card);
  scrollbar-gutter: stable;
}

/* The whole screen, as the list of sections: across it, from the page's line to its gutter. */
.analytics-rail-whole {
  min-inline-size: 0;
  max-inline-size: none;
  padding-inline: var(--space-5) var(--size-page-gutter);
  border-start-end-radius: 0;
}

/* The module's name stands a step nearer the edge in a main column of 586px or less. */
@container main (width <= 586px) {
  .analytics-rail-whole {
    padding-inline-start: var(--space-3);
  }
}

.analytics-rail-list {
  display: grid;
  gap: var(--space-half);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* The name over the tile's figures, in a box its states share with the page's rows
   (`rowStates.css`): the chosen entry's line stands inside the start padding, clear of the
   words, so choosing one moves no word. */
.analytics-rail-entry {
  display: grid;
  gap: var(--space-1);
  width: 100%;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: var(--space-2) var(--space-3);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-name);
  text-align: start;
  cursor: pointer;
}

/* Beside the panel the rail is as wide as the widest head asks (`AnalyticsView`): its figures
   ask for no width of their own and take the column the names leave them. */
.analytics-rail-tile {
  contain: inline-size;
}

/* The name, the count of values at the far end, and on a list the chevron after it. What stands
   between the name and the count is air, which gives way before either: down to the least gap,
   and only then, in a rail held to the most of its range, is the name cut, never the count. */
.analytics-rail-head {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
}

/* The name keeps the room of its chosen weight, held by a copy no one sees or reads, so the
   rail asks the same width whichever entry is chosen and choosing one cuts no name. */
.analytics-rail-name-room {
  display: grid;
  flex: 0 1 auto;
  min-width: 0;
  margin-inline-end: auto;

  &::after {
    content: attr(data-room) / '';
    grid-area: 1 / 1;
    block-size: 0;
    font-weight: 600;
    visibility: hidden;
  }
}

.analytics-rail-name {
  grid-area: 1 / 1;
}

/* The count keeps the room of three figures (`countRoom`), held by a copy no one sees or reads,
   and stands at its end. */
.analytics-rail-count {
  display: grid;
  flex: none;
  justify-items: end;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  &::before {
    content: attr(data-room) / '';
    grid-area: 1 / 1;
    block-size: 0;
    visibility: hidden;
  }
}

.analytics-rail-count-words {
  grid-area: 1 / 1;
}

.analytics-rail-chevron {
  flex: none;
  margin-inline-start: var(--space-1);
  color: var(--color-text-muted);
}
</style>
