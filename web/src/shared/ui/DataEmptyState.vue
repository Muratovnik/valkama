<script setup lang="ts">
import VIcon from '@/shared/ui/VIcon.vue'
withDefaults(
  defineProps<{
    title: string
    /** A smaller block, for a panel or a column that holds little else. */
    compact?: boolean
    description?: string
    /**
     * One quiet line at the start of its section, for an absence among other content:
     * a section of a card under its own heading. `compact` does not apply to it.
     */
    inline?: boolean
  }>(),
  { description: '', compact: false, inline: false },
)
</script>

<!-- The one way this product says "nothing here". PlatformStatePanel delegates its
     empty status to this component, so a filtered-out table and an empty chart
     make the same quiet statement instead of two different ones. A section inside a
     card says it inline: each section had written its own muted paragraph, in two
     sizes and three tones, and none of them offered the next step. -->
<template>
  <div
    class="data-empty"
    role="status"
    :class="{ compact: compact && !inline, inline }"
  >
    <VIcon
      v-if="!inline"
      name="database"
      class="empty-mark"
      :size="24"
    />
    <div class="empty-copy">
      <strong class="empty-title">{{ title }}</strong>
      <p
        v-if="description"
        class="empty-description"
      >
        {{ description }}
      </p>
    </div>
    <slot name="action" />
  </div>
</template>

<style scoped>
/* An absence is an answer, not an object. This used to be a dashed box with
   the icon parked at its left edge, which in a wide container fell apart into
   three loose pieces — an icon at one wall, a message near the middle — and a
   border drawn around nothing is still a box competing for the eye. The
   message now stands in the middle of the space the data would occupy, on
   whatever ground the container already has. */
.data-empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  justify-content: center;
  align-items: center;
  min-height: 160px;
  padding: var(--space-8) var(--space-5);
  color: var(--color-text-muted);
  text-align: center;

  &.compact {
    min-height: 112px;
    padding-block: var(--space-6);
  }

  /* Inline it starts where the section's content starts and takes no more room than its
     words; its action follows on the same line while there is room, then under it. */
  &.inline {
    flex-flow: row wrap;
    gap: var(--space-2) var(--space-3);
    justify-content: flex-start;
    min-height: 0;
    padding: 0;
    text-align: start;
  }
}

.empty-mark {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
}

.empty-copy {
  max-width: 42rem;
}

.empty-title {
  display: block;
  font: var(--font-name);

  .inline & {
    font: var(--font-detail);
  }
}

.empty-description {
  margin: var(--space-1) 0 0;
  color: var(--color-text-tertiary);
  font: var(--font-note);

  .inline & {
    margin-block-start: var(--space-label-value);
    font: var(--font-detail);
  }
}
</style>
