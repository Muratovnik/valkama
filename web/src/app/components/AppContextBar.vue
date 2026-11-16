<script setup lang="ts">
/**
 * The top of the chrome: the module, and the scope its work is looked at in.
 *
 * It is not a band of its own — it takes the same ground as the rail beside it, so
 * the corner where the two meet is continuous. It used to paint a step lighter and
 * stop at a rule, which left the shell with three greys meeting in one corner and
 * no zone anyone could name.
 *
 * The module's name and nothing else about it. A line under it describing what
 * the module is said what the rail and the screen already show, and it took a
 * second row of the header to say it.
 *
 * The scope is chosen in two steps: «All spaces» or one space, and then, in a space
 * with more than one project to choose, one of them. A project of another space that
 * items of this one name stands in that list with its own space's key under its name.
 *
 * No caption before either selector. A control states its own subject — the
 * space by its key and name, the project by its name — so a label beside it is
 * the same word twice, and it was taking a grid track from the value that has to
 * ellipsize. The word survives as the accessible name.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ShellSpace } from '@/shared/api/platformApiTypes.ts'
import { sameSpace } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

const props = defineProps<{
  /** Null while the shell does not yet know which scope it stands in. */
  scope: OperatingScope | null
  /** Null until the spaces have been read: a scope is named by its space. */
  spaces: readonly ShellSpace[] | null
  /** Empty while the module is not yet known; the line keeps its height. */
  title: string
}>()

const emit = defineEmits<{ scope: [value: OperatingScope] }>()

const { t } = useI18n()

const GLOBAL = 'global'
const ALL_PROJECTS = 'all'
const spaceValue = (dataScopeId: string, key: string) => `space:${dataScopeId}/${key}`
const projectValue = (id: string) => `project:${id}`

/**
 * The selector is drawn once it can name the scope. Before that it keeps its box and paints
 * nothing: it said «All spaces» over a space's address until the spaces had been read, and
 * an empty frame that then filled in would be a state of its own.
 */
const scopeKnown = computed(() => props.scope !== null && props.spaces !== null)
/** With no space to choose there is no choice to show: the work area says there are none. */
const spaceChoiceShown = computed(
  () => !scopeKnown.value || props.scope?.kind === 'space' || Boolean(props.spaces?.length),
)
/** An empty heading is no heading: a reader is not told of one with nothing in it. */
const titleHidden = computed(() => (props.title ? undefined : 'true'))

/** The space the scope names, as the context lists it; undefined at the top or when absent. */
const openSpace = computed(() => {
  const { scope, spaces } = props
  return scope?.kind === 'space'
    ? spaces?.find((item) => sameSpace(item, scope.space_ref))
    : undefined
})

/**
 * A space the address names that this workstation does not have. The selector stood blank
 * over a page saying it was not found; it names the space the address asked for, marked as
 * missing and not choosable.
 */
const missingSpace = computed<ChoiceOption[]>(() => {
  const { scope } = props
  if (!scopeKnown.value || scope?.kind !== 'space' || openSpace.value) return []
  const { data_scope_id, space_key } = scope.space_ref
  return [
    {
      value: spaceValue(data_scope_id, space_key),
      label: space_key,
      description: t('platform.scope.spaceMissing'),
      icon: 'board',
      disabled: true,
    },
  ]
})

const spaceOptions = computed<ChoiceOption[]>(() => [
  { value: GLOBAL, label: t('platform.scope.global'), icon: 'client' },
  ...(props.spaces ?? []).map((space) => ({
    value: spaceValue(space.data_scope_id, space.space_key),
    label: space.space_key,
    description: space.name,
    icon: 'board' as const,
  })),
  ...missingSpace.value,
])

/**
 * A list long enough that finding an entry beats reading them all. Below seven the search
 * field is a second control asking to be skipped.
 */
const spaceSearchable = computed(() => spaceOptions.value.length > 7)

const selectedSpaceValue = computed(() => {
  const { scope } = props
  if (scope === null) return ''
  return scope.kind === 'global'
    ? GLOBAL
    : spaceValue(scope.space_ref.data_scope_id, scope.space_ref.space_key)
})

/**
 * The projects the open space can be narrowed to: its own, the default first, then those
 * of other spaces its items name, each with its own space's key. A project whose space the
 * registry does not name carries no key, and its hint says where it belongs.
 */
const projectChoices = computed<ChoiceOption[]>(() => {
  const space = openSpace.value
  if (space === undefined) return []
  return [
    ...space.projects.map((project) => ({
      value: projectValue(project.project_id),
      label: project.display_name,
      icon: 'client' as const,
    })),
    ...space.other_space_projects.map((project) => ({
      value: projectValue(project.project_id),
      label: project.display_name,
      icon: 'client' as const,
      ...(project.space_key === null
        ? { title: t('platform.scope.otherSpace') }
        : { description: project.space_key }),
    })),
  ]
})

/** The project the address narrows to when the space does not list it. */
const missingProject = computed<ChoiceOption[]>(() => {
  const { scope } = props
  if (scope?.kind !== 'space' || scope.project_ref === undefined) return []
  const value = projectValue(scope.project_ref.project_id)
  if (projectChoices.value.some((option) => option.value === value)) return []
  return [
    {
      value,
      label: scope.project_ref.project_id,
      description: t('platform.bindings.missing'),
      icon: 'client',
      disabled: true,
    },
  ]
})

/**
 * The second choice is there only where it chooses something: a space with one project has
 * nothing to narrow. An address that narrows to a project keeps it on show, so a reader sees
 * what the work on screen is narrowed to.
 */
const projectChoiceShown = computed(
  () =>
    openSpace.value !== undefined &&
    (projectChoices.value.length > 1 ||
      (props.scope?.kind === 'space' && props.scope.project_ref !== undefined)),
)

const projectOptions = computed<ChoiceOption[]>(() => [
  { value: ALL_PROJECTS, label: t('platform.scope.allProjects'), icon: 'client' },
  ...projectChoices.value,
  ...missingProject.value,
])

const projectSearchable = computed(() => projectOptions.value.length > 7)

const selectedProjectValue = computed(() => {
  const { scope } = props
  return scope?.kind === 'space' && scope.project_ref !== undefined
    ? projectValue(scope.project_ref.project_id)
    : ALL_PROJECTS
})

function chooseSpace(value: string) {
  if (value === GLOBAL) {
    emit('scope', { kind: 'global' })
    return
  }
  const space = props.spaces?.find(
    (item) => spaceValue(item.data_scope_id, item.space_key) === value,
  )
  if (space)
    emit('scope', {
      kind: 'space',
      space_ref: { data_scope_id: space.data_scope_id, space_key: space.space_key },
    })
}

function chooseProject(value: string) {
  const { scope } = props
  if (scope?.kind !== 'space') return
  const space_ref = scope.space_ref
  emit(
    'scope',
    value === ALL_PROJECTS
      ? { kind: 'space', space_ref }
      : { kind: 'space', space_ref, project_ref: { project_id: value.replace(/^project:/u, '') } },
  )
}

const spaceChoice = useTemplateRef<{ show: () => void }>('spaceChoice')
/** Opens the choice of a space, for a page whose way out is to choose one. */
defineExpose({ chooseSpace: () => spaceChoice.value?.show() })
</script>

<template>
  <header class="context-bar">
    <div class="context-title">
      <h1
        class="module-title"
        :aria-hidden="titleHidden"
      >
        {{ title }}
      </h1>
    </div>
    <div class="context-controls">
      <div
        v-if="spaceChoiceShown"
        class="operating-scope"
        data-scope-choice="space"
        :class="{ 'is-unknown': !scopeKnown }"
      >
        <ChoiceSelect
          ref="spaceChoice"
          :model-value="selectedSpaceValue"
          :options="spaceOptions"
          :label="t('platform.scope.label')"
          :searchable="spaceSearchable"
          :search-label="t('settings.searchOptions')"
          :empty-label="t('settings.noOptions')"
          @update:model-value="chooseSpace"
        />
      </div>
      <div
        v-if="scopeKnown && projectChoiceShown"
        class="project-scope"
        data-scope-choice="project"
      >
        <ChoiceSelect
          :model-value="selectedProjectValue"
          :options="projectOptions"
          :label="t('platform.scope.project')"
          :searchable="projectSearchable"
          :search-label="t('settings.searchOptions')"
          :empty-label="t('settings.noOptions')"
          @update:model-value="chooseProject"
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
  /* The line a title stands on, held while it has none. */
  min-height: 1lh;
  margin: 0;
  font-size: var(--font-size-module);
  font-weight: 600;
  letter-spacing: -0.01em;
}

/* The project's choice stands in the same cluster as the space's, after it, and takes
   space only in a space that has projects to choose. */
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

  &.is-unknown {
    visibility: hidden;
  }
}

.project-scope {
  min-width: 180px;
  max-width: 280px;
}

/* The bar measures the space it was given, not the window: the rail beside it
   is its 64px icons or any width from 200 to 480px the operator drags it to, so
   the same window hands the bar many widths and a viewport threshold could only
   ever describe one of them. */
@container main (width <= 764px) {
  .context-bar {
    grid-template-columns: minmax(0, 1fr) auto;
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
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
    justify-self: stretch;
    width: 100%;
    max-width: none;
  }

  :is(.operating-scope, .project-scope) {
    grid-column: 1;
    min-width: 0;
    max-width: none;

    & :deep(.choice-select) {
      width: 100%;
    }
  }
}
</style>
