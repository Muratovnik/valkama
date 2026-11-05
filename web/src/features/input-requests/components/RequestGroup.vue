<script setup lang="ts">
/**
 * The points of a review under one heading, with how many of them are decided. Its heading
 * folds the group away and brings it back; it starts open and never folds by itself, so no
 * point is answered unseen. A run of points with no heading stands as it is.
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
        <VIcon
          class="request-group-glyph"
          name="chevron-down"
          :size="16"
        />
        <span class="request-group-title">{{ title }}</span>
        <span
          v-if="total"
          class="request-group-count"
          >{{ t('requests.review.groupDecided', { done: decided, total }) }}</span
        >
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

/* The whole heading is its press, as wide as the group, its count at the far end. */
.request-group-toggle {
  display: flex;
  flex: 1 1 auto;
  gap: var(--space-2);
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

.request-group-glyph {
  flex: none;
  align-self: center;
  rotate: -90deg;

  [aria-expanded='true'] > & {
    rotate: 0deg;
  }
}

.request-group-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.request-group-count {
  flex: none;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-group-body {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
</style>
