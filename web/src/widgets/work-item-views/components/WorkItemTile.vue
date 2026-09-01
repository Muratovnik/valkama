<script setup lang="ts">
/**
 * One work item as a sheet: its reference, what it is, and only the facts that
 * change what a reader would do next.
 *
 * The reference leads, because `VAL-142` is what a person types and what a
 * commit message already holds. Everything else is a mark rather than a
 * sentence: an unfinished checklist, a holder, a blocked edge. A tile that
 * restated the whole record would make the wall of work unreadable, which is
 * what the inspector is for.
 *
 * Kind carries no icon. The icon set is closed and holds no glyph for a bug or
 * an epic, and three near-identical generic glyphs would be noise standing in
 * for meaning; most items are tasks, so the kind is named only when it is not.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = defineProps<{
  item: WorkItemBrief
  blocked?: boolean
  ready?: boolean
}>()

const emit = defineEmits<{ open: [reference: string] }>()

const { t } = useI18n()

/** Three labels at most: a tile is a glance, and the rest are in the inspector. */
const labels = computed(() => props.item.labels.slice(0, 3))

const steps = computed(() => ({
  done: props.item.checklist.filter((step) => step.done).length,
  total: props.item.checklist.length,
}))
</script>

<template>
  <button
    class="work-item-tile"
    type="button"
    :data-tone="statePresentation('work-item-priority', props.item.priority).tone"
    @click="emit('open', props.item.reference)"
  >
    <span class="tile-line">
      <span class="tile-reference">{{ props.item.reference }}</span>
      <span
        v-if="props.item.kind !== 'task'"
        class="tile-kind"
        >{{ t(`workItem.kind.${props.item.kind}`) }}</span
      >
      <SemanticState
        v-if="props.blocked"
        class="tile-mark"
        dimension="work-item-readiness"
        state="blocked"
        :label="t('workItem.blocked')"
      />
      <SemanticState
        v-else-if="props.ready"
        class="tile-mark"
        dimension="work-item-readiness"
        state="ready"
        :label="t('workItem.ready')"
      />
    </span>
    <strong class="tile-title">{{ props.item.title }}</strong>
    <span
      v-if="props.item.claim_ref || steps.total || props.item.labels.length"
      class="tile-facts"
    >
      <span
        v-if="props.item.claim_ref"
        class="tile-holder"
        >{{ props.item.claim_ref }}</span
      >
      <span
        v-if="steps.total"
        class="tile-steps"
        >{{ t('workItem.checklistProgress', { done: steps.done, total: steps.total }) }}</span
      >
      <span
        v-for="label in labels"
        :key="label"
        class="tile-label"
        >{{ label }}</span
      >
    </span>
  </button>
</template>

<style scoped>
/* A sheet, not a card in a frame: one tonal step above the ground it lies on,
   and no outline. The column already draws itself; a border here would be the
   third rectangle in a row. */
.work-item-tile {
  /* A grid track is min-content wide unless told otherwise, and the min-content
     of a row of labels is those labels at full length — so the tile laid itself
     out wider than its own box and clipped the result inside its padding. */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-2);
  border: 0;
  color: inherit;
  text-align: start;
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--color-surface-hover);
  }
}

/* Urgency is a bar at the leading edge, never a tinted sheet. A whole card
   coloured red reads as a broken item; a mark reads as a priority. */
.work-item-tile[data-tone='danger'] {
  box-shadow: inset 2px 0 0 0 var(--color-danger);
}

.work-item-tile[data-tone='warning'] {
  box-shadow: inset 2px 0 0 0 var(--color-warning);
}

.tile-line {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.tile-reference {
  font-variant-numeric: tabular-nums;
}

.tile-kind {
  color: var(--color-text-tertiary);
}

.tile-mark {
  margin-inline-start: auto;
}

.tile-title {
  color: var(--color-text);
  font: var(--font-strong);
  overflow-wrap: break-word;
}

.tile-facts {
  /* Centre, not baseline: a flex box hands its baseline to its first item, and
     a label chip is a padded box rather than a line of text, so baseline
     alignment drags the plain text beside it off the row they share. */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: center;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.tile-holder {
  min-width: 0;
  overflow-wrap: anywhere;
}

.tile-steps {
  font-variant-numeric: tabular-nums;
}

.tile-label {
  padding: 0 var(--space-1);
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
}
</style>
