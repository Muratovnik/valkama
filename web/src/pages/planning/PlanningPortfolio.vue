<script setup lang="ts">
/**
 * Every space this workstation has, at «All spaces», with its projects.
 *
 * The space's name leads each card and its key stands under it, as the space choice names
 * it. Under them its work and its projects in one line, and the way in at the foot: a space
 * is a thing you read first and enter second.
 */
import { useI18n } from 'vue-i18n'

import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ spaces: PlatformPlanningReady['spaces'] }>()
const emit = defineEmits<{ 'open-space': [space: PlanningSpaceRef] }>()
const { t } = useI18n()

/** The space's projects in one line, or that it has none. */
function projectsLine(space: PlatformPlanningReady['spaces'][number]): string {
  const names = space.projects.map((project) => project.display_name)
  return names.length ? names.join(' · ') : t('platform.planning.noProjects')
}
</script>

<template>
  <section class="portfolio-grid">
    <article
      v-for="space in spaces"
      :key="`${space.space_ref.data_scope_id}:${space.space_ref.space_key}`"
      class="portfolio-space"
    >
      <header class="space-head">
        <strong class="space-title">{{ space.title }}</strong>
        <small class="space-key">{{ space.space_ref.space_key }}</small>
      </header>
      <!-- A space whose store could not be read has no count to show. -->
      <span
        v-if="space.work_item_count !== null"
        class="space-count"
        >{{ t('platform.planning.workItemCount', { count: space.work_item_count }) }}</span
      >
      <div class="space-projects">
        <span class="projects-label">{{ t('platform.planning.projects') }}</span>
        <span class="projects-names">{{ projectsLine(space) }}</span>
      </div>
      <VButton
        class="open-space"
        @click="emit('open-space', space.space_ref)"
      >
        {{ t('platform.planning.openSpace')
        }}<VIcon
          name="chevron-right"
          :size="15"
        />
      </VButton>
    </article>
  </section>
</template>

<style scoped>
.portfolio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}

.portfolio-space {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  padding: var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.space-head {
  display: grid;
  gap: var(--space-1);
}

.space-title {
  font: var(--font-name);
}

.space-key {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.space-count {
  font-size: var(--font-size-dense);
}

.space-projects {
  display: grid;
  gap: var(--space-1);
  font-size: var(--font-size-dense);
}

.projects-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

/* The action stands at the foot of the card rather than filling it. */
.open-space {
  justify-self: start;
}
</style>
