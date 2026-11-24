<script setup lang="ts">
/**
 * The space's projects in its window: one row each, the default chosen among them, a way to
 * add a registered project and a way to register one from a folder.
 *
 * Each row is a radio of one group, which picks the default, then the project's name, its
 * folder and its remove; the rows stand in the order of their names. The default has no remove
 * while the space has other projects: the row repeats the server's rule rather than meeting its
 * refusal. The rows share their columns, so every folder starts at one edge; a long name wraps
 * within its share of the row rather than taking the folder's room, and the radio stands on the
 * name's first line. A folder too long for its row is cut in its middle, so its last folder,
 * which tells one project from the next, stays whole while the row has room for it; it is shown
 * whole in its hint. On a narrow window the folder goes under the name.
 *
 * «Add project» is a search over the registered projects the space does not have: those in
 * no space first, then those of other spaces, which say what moving one means. What is typed
 * finds a project by its name before one only its folder matches. The default of a space that
 * keeps other projects is listed and not choosable, with its reason. «New project from folder…»
 * opens `SpaceFolderProject`.
 *
 * Every row carries `data-project` with its id; its parts are `data-part` `default`, `name`,
 * `root` (its last folder `root-tail`), `fresh`, `remove`.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  byName,
  namesFirst,
  pathParts,
  removable,
  withDefault,
  withoutProject,
  withProject,
} from '@/features/space-window/spaceDraft.ts'
import type { ProjectChoice, SpaceDraft } from '@/features/space-window/spaceDraft.ts'
import SpaceFolderProject from '@/features/space-window/SpaceFolderProject.vue'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  choices: readonly ProjectChoice[]
  disabled: boolean
  /** The ids every registered project has, which a folder's new project cannot take. */
  takenIds: readonly string[]
}>()
const draft = defineModel<SpaceDraft>({ required: true })
const { t } = useI18n()
const group = useId()

/** What is typed in «Add project», which puts the projects it names first. */
const query = ref('')
const rows = computed(() =>
  byName(draft.value.projects).map((project) => ({ ...project, path: pathParts(project.root) })),
)

const options = computed<ChoiceOption[]>(() =>
  namesFirst(props.choices, query.value).map(({ project, from, held }) => {
    const key = from?.space_key
    let description = t('spaceWindow.inNoSpace', { root: project.root })
    if (key !== undefined) description = t(held ? 'spaceWindow.held' : 'spaceWindow.moves', { key })
    return {
      value: project.project_id,
      label: project.display_name,
      description,
      disabled: held,
      icon: 'client',
    }
  }),
)

/** The search holds nothing between additions: a chosen project becomes a row, not a value. */
const picked = ref('')
const isDefault = (id: string) => draft.value.default === id

function add(id: string) {
  const choice = props.choices.find((one) => one.project.project_id === id)
  picked.value = ''
  if (choice === undefined || choice.held) return
  const { project } = choice
  draft.value = withProject(draft.value, {
    project_id: project.project_id,
    display_name: project.display_name,
    root: project.root,
    fresh: false,
  })
}

const folderOpen = ref(false)
</script>

<template>
  <section
    class="space-projects"
    :aria-label="t('spaceWindow.projects')"
  >
    <h3 class="projects-head">{{ t('spaceWindow.projects') }}</h3>
    <p
      v-if="!draft.projects.length"
      class="projects-none"
    >
      {{ t('spaceWindow.noProjects') }}
    </p>
    <div
      v-else
      class="project-rows"
      role="radiogroup"
      :aria-label="t('spaceWindow.defaultGroup')"
    >
      <div
        v-for="project in rows"
        :key="project.project_id"
        class="project-row"
        :data-project="project.project_id"
      >
        <input
          :id="`${group}-${project.project_id}`"
          class="project-default"
          data-part="default"
          type="radio"
          :name="group"
          :value="project.project_id"
          :checked="isDefault(project.project_id)"
          :disabled="disabled"
          @change="draft = withDefault(draft, project.project_id)"
        />
        <label
          class="project-name"
          data-part="name"
          :for="`${group}-${project.project_id}`"
          >{{ project.display_name }}</label
        >
        <span
          v-tooltip.clipped="project.root"
          class="project-root"
          data-part="root"
          ><span
            v-if="project.path.head"
            class="root-head one-line"
            >{{ project.path.head }}</span
          ><span
            class="root-tail one-line"
            data-part="root-tail"
            :class="{ 'is-whole': !project.path.head }"
            >{{ project.path.tail }}</span
          ></span
        >
        <span class="project-marks">
          <span
            v-if="draft.default === project.project_id"
            class="project-mark"
            >{{ t('spaceWindow.default') }}</span
          >
          <span
            v-if="project.fresh"
            class="project-mark"
            data-part="fresh"
            >{{ t('spaceWindow.fresh') }}</span
          >
        </span>
        <VButton
          v-if="removable(draft, project.project_id)"
          v-tooltip.name="t('spaceWindow.removeProject', { name: project.display_name })"
          class="project-remove"
          data-part="remove"
          variant="ghost"
          size="compact"
          :disabled="disabled"
          :aria-label="t('spaceWindow.removeProject', { name: project.display_name })"
          icon
          @click="draft = withoutProject(draft, project.project_id)"
        >
          <VIcon
            name="close"
            :size="15"
          />
        </VButton>
        <span
          v-else
          class="project-remove"
          aria-hidden="true"
        />
      </div>
    </div>
    <div class="projects-add">
      <SearchCombobox
        class="projects-search"
        :model-value="picked"
        :options="options"
        :label="t('spaceWindow.add')"
        :placeholder="t('spaceWindow.addPlaceholder')"
        :empty-label="t('spaceWindow.addEmpty')"
        :disabled="disabled"
        hide-label
        @update:model-value="add"
        @search="query = $event"
      />
      <VButton
        v-if="!folderOpen"
        variant="ghost"
        data-part="from-folder"
        :disabled="disabled"
        @click="folderOpen = true"
        >{{ t('spaceWindow.fromFolder') }}</VButton
      >
    </div>
    <SpaceFolderProject
      v-if="folderOpen"
      v-model="draft"
      :taken-ids="takenIds"
      @close="folderOpen = false"
    />
  </section>
</template>

<style scoped>
.space-projects {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.projects-head {
  margin: 0;
  font: var(--font-label);
}

.projects-none {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

/* The radio, the name, the folder, the marks and the remove on one line. The rows borrow the
   list's columns, so the longest name sets where every folder starts, up to its share of the
   row: a longer one wraps there. The folder takes what the line has left. Sized to its longest
   name alone, the name's column took the whole row and left every folder none. */
.project-rows {
  --project-name-share: 40%;

  display: grid;
  grid-template-columns:
    auto fit-content(var(--project-name-share)) minmax(0, 1fr) auto
    var(--size-control-height);
  gap: var(--space-1) var(--space-3);
  min-width: 0;
}

/* Each part stands on the row's first line, the middle of a control's height, however many
   lines a long name wraps to: centred on the whole row, the radio stood between a wrapped
   name's lines. Words are set down by half of what their line leaves of that height. */
.project-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  row-gap: var(--space-2);
  align-items: start;
  min-height: var(--size-control-height);
}

.project-default {
  inline-size: var(--font-size-interface);
  block-size: var(--font-size-interface);
  margin: calc(var(--size-control-height) / 2 - var(--font-size-interface) / 2) 0 0;
}

.project-name,
.project-root {
  padding-block: calc(var(--size-control-height) / 2 - 0.5lh);
}

.project-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* Cut in its middle: what comes before its last folder gives way first, ending in «…», and
   the last folder, with the separator before it, stays whole while the row has room for it,
   then is cut at its end too. A little of the start is always left, so the «…» says a part is
   missing. */
.project-root {
  display: flex;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
  white-space: nowrap;
}

.root-head {
  flex: 0 1 auto;
  min-width: 0;
}

.root-tail {
  --root-head-least: 1.5em;

  flex: 0 0 auto;
  max-width: calc(100% - var(--root-head-least));

  &.is-whole {
    max-width: 100%;
  }
}

/* Smaller words than the name's, centred on the same middle: a line of the control's height. */
.project-marks {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-height);
}

.project-mark {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.project-remove {
  justify-self: end;
  margin-block-start: calc(var(--size-control-height) / 2 - var(--size-control-height-compact) / 2);
}

.projects-add {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: start;
}

.projects-search {
  flex: 1 1 240px;
  min-width: 0;
}

/* A narrow window: the folder goes under the name, beside the radio's column. */
@container overlay (width < 520px) {
  .project-rows {
    grid-template-columns: auto minmax(0, 1fr) auto var(--size-control-height);
  }

  .project-row {
    grid-template-areas:
      'radio name marks remove'
      '. root root .';
    row-gap: 0;
  }

  .project-default {
    grid-area: radio;
  }

  .project-name {
    grid-area: name;
  }

  .project-root {
    grid-area: root;
    padding-block: 0;
  }

  .project-marks {
    grid-area: marks;
  }

  .project-remove {
    grid-area: remove;
  }
}
</style>
