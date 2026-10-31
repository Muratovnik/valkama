<script setup lang="ts">
/**
 * Why the field is empty, and the control that would fill it.
 *
 * Two different empties: a space with no work at all, and a space whose work is
 * all done and hidden. The second names what is hidden and offers it, so an
 * empty field never reads as a broken one.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** How many items the reveal would bring back. */
  count: number
  kind: 'open' | 'space'
}>()

const emit = defineEmits<{ reveal: [] }>()
const { t } = useI18n()

const message = computed(() => t(props.kind === 'space' ? 'graph.empty' : 'graph.emptyOpen'))
const action = computed(() => t('graph.showDone', { count: props.count }))
</script>

<template>
  <p
    v-if="kind === 'space'"
    class="graph-empty"
  >
    {{ message }}
  </p>
  <div
    v-else
    class="graph-empty graph-empty-reveal"
  >
    <span>{{ message }}</span>
    <button
      class="graph-reveal"
      type="button"
      @click="emit('reveal')"
    >
      {{ action }}
    </button>
  </div>
</template>

<style scoped>
.graph-empty {
  padding: var(--space-7) 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.graph-empty-reveal {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

.graph-reveal {
  min-height: var(--size-control-inline);
  padding: 0 var(--space-3);
  color: var(--color-action-primary);
  font: var(--font-chip);
  background: var(--color-control-surface);
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }
}
</style>
