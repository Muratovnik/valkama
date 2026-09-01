<script setup lang="ts">
/**
 * Every project the platform knows, at global scope, with its Planning spaces.
 *
 * Project identity leads each row. Binding state is a separate operational
 * fact, and an unbound project routes to the canonical Settings recovery view.
 */
import { useI18n } from 'vue-i18n'

import type { PlatformPlanningReady } from '@/shared/api/platformPlanningTypes.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ projects: PlatformPlanningReady['projects'] }>()
const emit = defineEmits<{ 'open-project': [projectId: string] }>()
const { t } = useI18n()

function bindingRecoveryRoute(projectId: string) {
  return serializePlatformRoute({
    module_id: 'settings',
    scope: { kind: 'project', project_ref: { project_id: projectId } },
  })
}
</script>

<template>
  <section class="portfolio-grid">
    <article
      v-for="project in projects"
      :key="project.project_id"
      class="portfolio-project"
    >
      <header class="project-head">
        <div>
          <strong class="project-id">{{ project.project_id }}</strong
          ><small class="project-title">{{ project.title }}</small>
        </div>
        <SemanticState
          dimension="project-binding"
          variant="badge"
          :label="t(`platform.bindings.${project.binding_state}`)"
          :state="project.binding_state"
        />
      </header>
      <ul class="project-spaces">
        <li
          v-for="space in project.planning_spaces"
          :key="`${space.space_ref.data_scope_id}:${space.space_ref.space_key}`"
          class="project-space"
        >
          <span class="space-name">{{ space.title }}</span>
          <span class="space-count">{{
            t('platform.planning.workItemCount', { count: space.work_item_count })
          }}</span>
        </li>
        <li
          v-if="!project.planning_spaces.length"
          class="space-none"
        >
          {{ t('platform.planning.noSpaces') }}
        </li>
      </ul>
      <VButton
        v-if="project.binding_state === 'mapped'"
        class="open-project"
        @click="emit('open-project', project.project_id)"
      >
        {{ t('platform.planning.openProject')
        }}<VIcon
          name="chevron-right"
          :size="15"
        />
      </VButton>
      <a
        v-else
        class="binding-recovery"
        :href="bindingRecoveryRoute(project.project_id)"
      >
        {{ t('platform.planning.reviewBinding')
        }}<VIcon
          name="chevron-right"
          :size="15"
        />
      </a>
    </article>
  </section>
</template>

<style scoped>
.portfolio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}

.portfolio-project {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  padding: var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.project-head {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: flex-start;
}

.project-id {
  display: block;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-emphasis);
}

.project-title {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.project-spaces {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.project-space {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  font-size: var(--font-size-dense);
}

:is(.space-count, .space-none) {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

/* The action stands at the foot of the card rather than filling it: a project is
   a thing you read first and enter second. */
:is(.open-project, .binding-recovery) {
  justify-self: start;
}

.binding-recovery {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  color: var(--color-accent);
  font-size: var(--font-size-dense);
  font-weight: 600;
  text-underline-offset: 0.2em;
}
</style>
