<script setup lang="ts">
/**
 * One group of the General settings: its heading, then its rows. No paragraph stands under
 * the heading to say what the group is for: its rows say it, and what a control does that
 * its words do not is its own hint, a field's hint or a `detail` on the control.
 */
import SectionHeading from '@/shared/ui/SectionHeading.vue'

defineProps<{ title: string }>()
</script>

<template>
  <section class="settings-group">
    <header class="settings-group-head">
      <SectionHeading as="h3">{{ title }}</SectionHeading>
      <slot name="note" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.settings-group {
  min-width: 0;
}

.settings-group-head {
  display: grid;
  gap: var(--space-heading-content);
  padding: var(--space-4);
  background: var(--color-surface-muted);
}
</style>
