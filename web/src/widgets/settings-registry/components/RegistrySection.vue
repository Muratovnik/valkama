<script setup lang="ts">
/**
 * One titled block of the registry: an icon, a heading, a sentence of intent, and
 * how many rows are inside.
 *
 * Eight sections repeated this header verbatim, differing only in the icon and
 * the two i18n keys — and the intro key was always the title key plus `Intro`, so
 * naming the title is enough to name both.
 */
import { useI18n } from 'vue-i18n'

import CountBadge from '@/shared/ui/CountBadge.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  count: number
  icon: string
  /** Section modifier class, e.g. `modules`, so a section can be found by name. */
  kind: string
  titleKey: string
}>()
const { t } = useI18n()
</script>

<template>
  <section
    class="registry-section"
    :class="props.kind"
  >
    <header class="registry-section-head">
      <VIcon :name="props.icon" /><span
        ><span class="registry-section-titleline"
          ><SectionHeading>{{ t(props.titleKey) }}</SectionHeading
          ><CountBadge
            placement="inline"
            :value="props.count"
        /></span>
        <p class="registry-section-intro">{{ t(`${props.titleKey}Intro`) }}</p></span
      >
    </header>
    <ul class="registry-section-list">
      <slot />
    </ul>
  </section>
</template>

<style scoped>
.registry-section {
  min-width: 0;
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);
}

.registry-section-head {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-4);
  background: var(--color-surface-muted);
}

.registry-section-intro {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.registry-section-titleline {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}

.registry-section-list {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) repeat(2, minmax(0, max-content));
  column-gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

@container workspace (width <= 556px) {
  .registry-section-list {
    grid-template-columns: 40px minmax(0, 1fr);
  }
}
</style>
