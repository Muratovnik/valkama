<script setup lang="ts">
/**
 * The sections Valkama has declared and not yet filled, named as empty.
 *
 * Reserved, not decorative. The product fixes the section list and later layers
 * supply the records; an adapter never sends markup for one. Naming them empty
 * is how the shell stays honest about what it does not know yet — the
 * alternative is an inspector that silently grows tabs, where a reader cannot
 * tell a section that has nothing from a section that does not exist.
 */
import { useI18n } from 'vue-i18n'

import SectionHeading from '@/shared/ui/SectionHeading.vue'

const { t } = useI18n()

/**
 * Nothing is reserved any more, and this component says so.
 *
 * Every section the shell declared has arrived: `execution` and `usage` and
 * `memory` are their own, `artifacts` lives inside the first because what the
 * checkout was before an attempt belongs beside the claim it checks, and
 * `tools` lives inside the second because how often a tool ran is part of what
 * an attempt cost.
 *
 * The component stays rather than being deleted. Naming what a shell has not
 * filled is what kept it honest while the layers were being built, and the next
 * declared-but-empty section belongs here rather than in a new file.
 */
const RESERVED: readonly string[] = []
</script>

<template>
  <section class="reserved">
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('workItem.reserved') }}</SectionHeading
    >
    <p class="quiet">{{ t('workItem.reservedIntro') }}</p>
    <dl class="reserved-list">
      <div
        v-for="section in RESERVED"
        :key="section"
        class="reserved-row"
      >
        <dt class="reserved-name">{{ t(`workItem.section.${section}`) }}</dt>
        <dd class="reserved-owner">{{ t(`workItem.sectionOwner.${section}`) }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.reserved {
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-rule);
}

.quiet {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.reserved-list {
  display: grid;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
}

.reserved-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: baseline;
}

.reserved-name {
  color: var(--color-text-muted);
  font: var(--font-line);
}

.reserved-owner {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}
</style>
