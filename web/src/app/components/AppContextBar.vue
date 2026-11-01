<script setup lang="ts">
/**
 * The top of the chrome: module, operating scope, selected resource, and activity.
 *
 * It is not a band of its own — it takes the same ground as the rail beside it, so
 * the corner where the two meet is continuous. It used to paint a step lighter and
 * stop at a rule, which left the shell with three greys meeting in one corner and
 * no zone anyone could name.
 *
 * No caption before either selector. A control states its own subject — the
 * workspace or resource by its identifier — so a label beside it is
 * the same word twice, and it was taking a grid track from the value that has to
 * ellipsize. The word survives as the accessible name.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type {
  PlatformContextReady,
  ProjectDirectoryResource,
} from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

const props = defineProps<{
  description: string
  projects: PlatformContextReady['projects']
  resources: ProjectDirectoryResource[]
  scope: OperatingScope
  title: string
  resourceRef?: EntityRef
}>()

const emit = defineEmits<{
  resource: [value: string]
  scope: [value: string]
}>()

const { t } = useI18n()

/**
 * A scope list long enough that finding an entry beats reading them all.
 *
 * Below seven the search field is a second control asking to be skipped.
 */
const scopeSearchable = computed(() => scopeOptions.value.length > 7)

/**
 * The project the address names when this workstation does not have it. The
 * selector stood blank over a page saying that project was not found; it names
 * the project the address asked for, marked as missing and not choosable.
 */
const missingProject = computed<ChoiceOption[]>(() => {
  const scope = props.scope
  if (scope.kind !== 'project' || !props.projects.length) return []
  const id = scope.project_ref.project_id
  if (props.projects.some((project) => project.project_id === id)) return []
  const missing = t('platform.bindings.missing')
  return [
    { value: `project:${id}`, label: id, description: missing, icon: 'client', disabled: true },
  ]
})

const scopeOptions = computed<ChoiceOption[]>(() => [
  { value: 'global', label: t('platform.scope.global'), icon: 'client' },
  ...props.projects.map((project) => ({
    value: `project:${project.project_id}`,
    label: project.title,
    description:
      project.binding_state === 'mapped'
        ? project.project_id
        : t(`platform.bindings.${project.binding_state}`),
    icon: 'client' as const,
    disabled: project.binding_state !== 'mapped',
  })),
  ...missingProject.value,
])

const selectedScopeValue = computed(() =>
  props.scope.kind === 'global' ? 'global' : `project:${props.scope.project_ref.project_id}`,
)

const resourceOptions = computed<ChoiceOption[]>(() =>
  props.resources.map((resource) => ({
    value: JSON.stringify(resource.resource_ref),
    label:
      'resource_id' in resource.resource_ref
        ? resource.resource_ref.resource_id
        : resource.resource_ref.kind,
    icon: 'client',
    disabled: resource.state !== 'mapped',
  })),
)

const selectedResourceValue = computed(() =>
  props.resourceRef ? JSON.stringify(props.resourceRef) : '',
)
</script>

<template>
  <header class="context-bar">
    <div class="context-title">
      <h1 class="module-title">{{ title }}</h1>
      <small
        v-if="description"
        class="module-description"
        >{{ description }}</small
      >
    </div>
    <div class="context-controls">
      <div class="operating-scope">
        <ChoiceSelect
          :model-value="selectedScopeValue"
          :options="scopeOptions"
          :label="t('platform.scope.label')"
          :searchable="scopeSearchable"
          :search-label="t('settings.searchOptions')"
          :empty-label="t('settings.noOptions')"
          @update:model-value="(value) => emit('scope', value)"
        />
      </div>
      <div
        v-if="scope.kind === 'project' && resourceOptions.length > 1"
        class="resource-scope"
      >
        <ChoiceSelect
          :model-value="selectedResourceValue"
          :options="resourceOptions"
          :label="t('platform.scope.label')"
          :empty-label="t('platform.planning.empty')"
          @update:model-value="(value) => emit('resource', value)"
        />
      </div>
    </div>
  </header>
</template>

<style scoped>
.context-bar {
  /* A selector in the chrome runs the control grammar on the chrome's own ramp:
     the bar names the two fills and the selector's own state rules read them. */
  --color-choice-trigger-fill: var(--color-navigation-raised);
  --color-choice-trigger-fill-hover: var(--color-navigation-active);

  position: relative;
  z-index: 20;
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-3) var(--space-5);
  color: var(--color-text);
  background: var(--color-navigation);

  /* Choice selectors need space on either side of their visible values. */
  :deep(.choice-trigger) {
    min-height: var(--size-control-height);
    padding: 0 var(--space-3);
  }
}

.context-title {
  min-width: 0;
}

.module-title {
  margin: 0;
  font-size: var(--font-size-module);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.module-description {
  display: block;
  margin-top: var(--space-half);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

/* Keep the optional resource selector in the scope-control cluster so it takes
   space only when a project has multiple resources. */
.context-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: flex-end;
  justify-self: end;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}

.operating-scope {
  min-width: 220px;
  max-width: 340px;
}

.resource-scope {
  min-width: 180px;
  max-width: 280px;

  &:empty {
    display: none;
  }
}

/* The bar measures the space it was given, not the window: the rail beside it
   takes 260px or 64px, so the same window hands the bar two different widths
   and a viewport threshold could only ever describe one of them. */
@container main (width <= 764px) {
  .context-bar {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .module-description {
    display: none;
  }

  .context-controls {
    max-width: min(100%, var(--size-module-column));
  }
}

@container main (width <= 586px) {
  .context-bar {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .context-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    justify-self: stretch;
    width: 100%;
    max-width: none;
  }

  :is(.operating-scope, .resource-scope) {
    grid-column: 1;
    min-width: 0;
    max-width: none;

    & :deep(.choice-select) {
      width: 100%;
    }
  }

  .module-title {
    font-size: var(--font-size-section);
  }
}
</style>
