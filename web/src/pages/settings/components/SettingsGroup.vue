<script setup lang="ts">
/** One group of the General settings: its heading, what it is for, then its rows. */
import SectionHeading from '@/shared/ui/SectionHeading.vue'

defineProps<{ intro: string; title: string }>()
</script>

<template>
  <section class="settings-group">
    <header class="settings-group-head">
      <SectionHeading as="h3">{{ title }}</SectionHeading>
      <p class="settings-group-intro">{{ intro }}</p>
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

  .settings-group-intro {
    max-width: 72ch;
    margin: 0;
    color: var(--color-text-muted);
    font: var(--font-note);
  }
}
</style>
