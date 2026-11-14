<script setup lang="ts">
/**
 * Where a tree's row starts: the indent of its depth and the arrow that folds
 * and opens it, or a space as wide as the arrow on a row with nothing to open,
 * so the rows of one depth start their words on one edge.
 *
 * A step of the indent is the arrow's square and the gap after it, so a row's
 * arrow stands under the start of its parent's words. A host makes the step
 * narrower through `--space-tree-step` on this component's root, as a narrow list does. The
 * indent stops growing at `levels`: a row deeper than that stands at the last
 * indent, and its host names its parent in words.
 *
 * The arrow is out of the Tab order: on the row, ← and → fold and open it. A
 * press on it folds or opens and goes no further, so the row does not take it
 * for a press that opens the row.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    depth: number
    /** Null where the row has nothing to open. */
    expanded: boolean | null
    /** What the arrow folds, as its name says it: the row's reference. */
    name: string
    /** The deepest level the indent reaches. */
    levels?: number
  }>(),
  { levels: 5 },
)

const emit = defineEmits<{ toggle: [] }>()

const { t } = useI18n()

const steps = computed(() => Math.max(0, Math.min(props.depth, props.levels - 1)))
const chevron = computed(() => (props.expanded ? 'disclosure-open' : 'disclosure-closed'))
const label = computed(() => t(props.expanded ? 'tree.fold' : 'tree.unfold', { name: props.name }))
</script>

<template>
  <span
    class="tree-lead"
    :style="{ '--tree-lead-steps': steps }"
  >
    <button
      v-if="expanded !== null"
      type="button"
      class="tree-toggle"
      tabindex="-1"
      :aria-label="label"
      @click.stop="emit('toggle')"
    >
      <VIcon
        :name="chevron"
        :size="16"
      />
    </button>
  </span>
</template>

<style scoped>
/* The arrow's square after the indent, and the gap before the row's words. */
.tree-lead {
  /* How many steps of `--space-tree-step` it stands in; the template writes it. */
  --tree-lead-steps: 0;

  display: inline-flex;
  flex: none;
  align-items: center;
  vertical-align: middle;
  box-sizing: content-box;
  inline-size: var(--space-4);
  block-size: 1lh;
  padding-inline-start: calc(var(--tree-lead-steps) * var(--space-tree-step));
  margin-inline-end: var(--space-2);
}

.tree-toggle {
  display: inline-flex;
  place-content: center center;
  inline-size: var(--space-4);
  block-size: var(--space-4);
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: none;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }
}
</style>
