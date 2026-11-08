<script setup lang="ts">
/**
 * The points of a review under one heading, with how many of them are decided. Its heading
 * folds the group away and brings it back; it starts open and never folds by itself, so no
 * point is answered unseen. A run of points with no heading stands as it is. A titled group is
 * one question of its block to the rail of the list (`RequestRail`).
 *
 * The heading's words start where its rows start, as the review's count above them does, and
 * its chevron ends the line after the count, pointing down while the group is folded and up
 * while it is open, as a thread's fold does. Before the words, the chevron drew its stroke
 * four pixels into the column and put the words twenty-four pixels in, an edge nothing else
 * in the column stands on.
 */
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  decided: number
  /** The group's heading, or null for points written with none. */
  title: string | null
  total: number
}>()
const open = defineModel<boolean>('open', { default: true })
const { t } = useI18n()
const id = useId()
const bodyId = `${id}-body`
</script>

<template>
  <section
    v-if="title !== null"
    class="request-group"
    :aria-labelledby="id"
    :data-rail-question="title"
  >
    <SectionHeading
      as="h4"
      level="panel"
      class="request-group-heading"
    >
      <button
        :id="id"
        class="request-group-toggle"
        type="button"
        :aria-controls="bodyId"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span class="request-group-title">{{ title }}</span>
        <span
          v-if="total"
          class="request-group-count"
          >{{ t('requests.review.groupDecided', { done: decided, total }) }}</span
        >
        <VIcon
          class="request-group-glyph"
          name="chevron-down"
          :size="16"
        />
      </button>
    </SectionHeading>
    <div
      v-show="open"
      :id="bodyId"
      class="request-group-body"
    >
      <slot />
    </div>
  </section>
  <div
    v-else
    class="request-group-body"
  >
    <slot />
  </div>
</template>

<style scoped>
.request-group {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.request-group-heading {
  min-width: 0;
}

/* The whole heading is its press, as wide as the group, its count at the far end. One row of
   words, baseline to baseline; `align-content` centres that row's first line in the 40px press,
   and the chevron is as tall as one line, so it stays on the first line however the title wraps. */
.request-group-toggle {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-columns: auto;
  grid-auto-flow: column;
  gap: var(--space-2);
  align-content: center;
  align-items: baseline;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: start;
  background: transparent;
  cursor: pointer;
}

/* One line tall, so its drawn chevron, centred in the box, sits on the first line's centre. */
.request-group-glyph {
  align-self: start;
  block-size: 1lh;
  color: var(--color-text-muted);

  /* A forced palette clears the ground and leaves a glyph its own muted ink, so the chevron
     that says open or closed names the system ink itself (DESIGN.md, the forced palette). */
  @media (forced-colors: active) {
    color: CanvasText;
    forced-color-adjust: none;
  }

  [aria-expanded='true'] > & {
    rotate: 180deg;
  }
}

.request-group-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.request-group-count {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-group-body {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
</style>
