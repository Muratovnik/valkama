<script setup lang="ts">
/**
 * Why a field's value or a setting's change did not hold: a mark and the words, under
 * what it is about. The mark is what tells it from the hint beside it. The hint is the same
 * size in the muted ink, and the danger ink alone was all that parted the two, which a
 * forced palette repaints in one colour and a reader who does not see red never saw.
 *
 * The id is the host's, for the control that names this message as its description.
 */
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  id?: string
  /** `alert` for a failure that arrives on its own, after a press. */
  role?: 'alert'
}>()
</script>

<template>
  <small
    :id="id"
    class="field-error"
    :role="role"
  >
    <VIcon
      class="field-error-glyph"
      name="alert"
      :size="14"
    />
    <span class="field-error-words"><slot /></span>
  </small>
</template>

<style scoped>
/* The glyph stands on the first line, however many the words take. */
.field-error {
  display: flex;
  gap: var(--space-1);
  align-items: flex-start;
  min-width: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

/* As tall as the first line, with the drawing centred in it as an icon's frame keeps it. */
.field-error-glyph {
  flex: none;
  block-size: 1lh;
}

.field-error-words {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
