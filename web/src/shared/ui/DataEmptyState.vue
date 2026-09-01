<script setup lang="ts">
import VIcon from '@/shared/ui/VIcon.vue'
withDefaults(
  defineProps<{
    title: string
    compact?: boolean
    description?: string
  }>(),
  { description: '', compact: false },
)
</script>

<!-- The one way this product says "nothing here". PlatformStatePanel delegates its
     empty status to this component, so a filtered-out table and an empty chart
     make the same quiet statement instead of two different ones. -->
<template>
  <div
    class="data-empty"
    role="status"
    :class="{ compact }"
  >
    <VIcon
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
}

.empty-description {
  margin: var(--space-1) 0 0;
  color: var(--color-text-tertiary);
  font: var(--font-note);
}
</style>
