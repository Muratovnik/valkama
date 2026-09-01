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

import ActivityBell from '@/widgets/activity-bell/ActivityBell.vue'

import type { PlatformActivity } from '@/shared/api/platformActivity.ts'
import type {
  PlatformContextReady,
  ProjectDirectoryResource,
} from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

const props = defineProps<{
  activities: PlatformActivity[]
  description: string
  projects: PlatformContextReady['projects']
  resources: ProjectDirectoryResource[]
  scope: OperatingScope
  title: string
  resourceRef?: EntityRef
  /** Whether an activity row leads anywhere; the shell owns that judgement. */
  activityNavigable: (item: PlatformActivity) => boolean
}>()

const emit = defineEmits<{
  'resource': [value: string]
  'scope': [value: string]
  'select-activity': [item: PlatformActivity]
}>()

const { t } = useI18n()

/**
 * A scope list long enough that finding an entry beats reading them all.
 *
 * Below seven the search field is a second control asking to be skipped.
 */
const scopeSearchable = computed(() => scopeOptions.value.length > 7)

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
      <small class="module-description">{{ description }}</small>
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
      <ActivityBell
        class="context-activity"
        :items="activities"
        :navigable="props.activityNavigable"
        @select="(item) => emit('select-activity', item)"
      />
    </div>
  </header>
</template>

<style scoped>
.context-bar {
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

  /* Side padding is the one thing the family cannot share: a control with a
     caption keeps its text off the fill, and an icon button is square. */
  :deep(.choice-trigger) {
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

/* One cluster on the right, not three tracks.
   The bar used to be four grid columns, and the resource selector's column exists
   only for projects with multiple resources — so on every other screen an
   empty track sat between the workspace selector and the bell, adding its two
   gaps to theirs. Three related controls are one group with one gap, and the
   group is what the bar lays out. */
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

/* Доска-селектор появляется только у проектов с несколькими досками; его
   ширину ограничивает сам элемент, а не грид-трек, иначе пустой трек
   резервирует место и колокольчик уезжает от правого края. */
.resource-scope {
  min-width: 180px;
  max-width: 280px;

  &:empty {
    display: none;
  }
}

/* One recipe for every control standing in the chrome.
   The selector and the bell were two different objects: 8px against 6px of
   radius, a filled `--color-surface` ground against the canvas tone, an 18% hairline
   against an 8% one, and two unrelated hovers. Read together they looked like
   two applications sharing a strip. They are one control family now, and the
   family is stated by the bar that holds them rather than by either of them,
   because "a control in the chrome looks like this" is a fact about the bar.
   A control here is a fill on the chrome's own ladder — one slate step above
   the bar at rest, one more under the pointer. The first version of this
   family drew each control as an outline on a transparent ground, which is
   the drawn-not-filled treatment the design review called out. */
.context-bar :deep(:is(.choice-trigger, .bell-trigger)) {
  /* The ground a badge overlapping one of these has to cut itself out of. The
     bar owns it for the same reason it owns the fill: which ground a chrome
     control stands on is a fact about the bar. */
  --color-count-badge-ring: var(--color-navigation-raised);

  min-height: var(--size-control-height);
  border: 0;
  color: var(--color-text);
  background: var(--color-navigation-raised);
  border-radius: var(--radius-control);
}

.context-bar
  :deep(
    :is(
      .choice-trigger:hover,
      .choice-trigger[data-state='open'],
      .bell-trigger:hover,
      .bell-trigger.active
    )
  ) {
  --color-count-badge-ring: var(--color-navigation-active);

  color: var(--color-text);
  background: var(--color-navigation-active);
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
  }

  .context-activity {
    grid-area: 1 / 2;
  }

  :is(.operating-scope, .resource-scope) :deep(.choice-select) {
    width: 100%;
  }

  .module-title {
    font-size: var(--font-size-section);
  }
}
</style>
