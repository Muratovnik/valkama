<script setup lang="ts">
/**
 * The first cell of a list row: the kind's glyph in a slot of its own, in a
 * tree the row's indent and its arrow (`TreeRowLead`), the reference, which
 * opens the card, and where the priority's column has folded away the
 * priority's glyph after it.
 *
 * The glyphs come drawn, as the list draws every run of a row
 * (`useListRuns.ts`). In a flat list the reference is the row's one stop for
 * the keyboard; in a tree the row is, and the cell takes focus only from the
 * keys.
 */
import type { VNode } from 'vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import TreeRowLead from '@/shared/ui/TreeRowLead.vue'

defineProps<{
  item: WorkItemBrief
  /** The kind's glyph, drawn. */
  kind: VNode
  /** In a tree, where the row starts; null in a flat list. */
  lead: { depth: number; expanded: boolean | null; levels: number } | null
  /** The reference's id, which names the row in a tree. */
  openerId: string
  openerTab: number
  /** The priority's glyph, drawn, where its column has folded away. */
  priority: VNode | null
  cellTab?: number
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <td
    class="list-ref-cell"
    :tabindex="cellTab"
  >
    <component
      :is="kind"
      class="list-slot"
    />
    <TreeRowLead
      v-if="lead"
      class="list-lead"
      :depth="lead.depth"
      :expanded="lead.expanded"
      :levels="lead.levels"
      :name="item.reference"
      @toggle="emit('toggle')"
    />
    <button
      :id="openerId"
      type="button"
      class="list-open"
      :tabindex="openerTab"
      :data-id="item.work_item_id"
      :data-reference="item.reference"
    >
      {{ item.reference }}
    </button>
    <component
      :is="priority"
      v-if="priority"
      class="list-after"
    />
  </td>
</template>

<style scoped>
/* A line of the row, not a control standing in it: at the base rule's height it
   pushed the row's shared baseline down, and every title with it. The whole row
   is what a pointer presses, so this box only has to hold the keyboard's focus. */
.list-open {
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: var(--color-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}

/* The kind leads the reference in a slot of its own whether or not it has a
   glyph, so every reference starts where the one above it does. A slot is a
   line tall: a filtering glyph's 28px reaches into the row's padding. A filled
   slot stands on the row's baseline, which puts its glyph on the middle of the
   reference's letters; an empty one on that middle, or it would heighten the row. */
.list-slot {
  place-content: center center;
  vertical-align: baseline;
  inline-size: var(--list-slot-size);
  block-size: 1lh;
  margin-inline-end: var(--space-1);

  &:empty {
    vertical-align: middle;
  }
}

/* A narrow list steps its tree's indent by the arrow alone. */
.list-lead {
  [data-fit='narrow'] & {
    --space-tree-step: var(--space-4);
  }
}

/* The priority's glyph after the reference, where its column has folded away. */
.list-after {
  margin-inline-start: var(--space-1);
}
</style>
