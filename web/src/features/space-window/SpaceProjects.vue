<script setup lang="ts">
/**
 * The space's projects in its window: one row each, the default chosen among them, a way to
 * add a registered project and a way to register one from a folder.
 *
 * Each row is a radio of one group, which picks the default, then the project's name, its
 * folder and its remove. The default has no remove while the space has other projects: the
 * row repeats the server's rule rather than meeting its refusal. A folder too long for its
 * row is cut at its end and shown whole in its hint. The rows share their columns, so every
 * folder starts at one edge. On a narrow window the folder goes under the name.
 *
 * «Add project» is a search over the registered projects the space does not have: those in
 * no space first, then those of other spaces, which say what moving one means. The default of
 * a space that keeps other projects is listed and not choosable, with its reason.
 *
 * Every row carries `data-project` with its id; its parts are `data-part` `default`, `name`,
 * `root`, `fresh`, `remove`.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  projectIdOf,
  projectIdValid,
  removable,
  withDefault,
  withFreshProject,
  withoutProject,
  withProject,
} from '@/features/space-window/spaceDraft.ts'
import type { ProjectChoice, SpaceDraft } from '@/features/space-window/spaceDraft.ts'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  choices: readonly ProjectChoice[]
  disabled: boolean
  /** The ids every registered project has, which a folder's new project cannot take. */
  takenIds: readonly string[]
}>()
const draft = defineModel<SpaceDraft>({ required: true })
const { t } = useI18n()
const group = useId()

const options = computed<ChoiceOption[]>(() =>
  props.choices.map(({ project, from, held }) => {
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
const folder = ref('')
const folderName = ref('')
const folderId = ref('')
/** The reader typed the id, so a new folder no longer replaces it. */
const idTyped = ref(false)

function typeFolder(value: string) {
  folder.value = value
  const id = projectIdOf(value)
  if (!idTyped.value) folderId.value = id
  if (!folderName.value || folderName.value === projectIdOf(folderName.value)) folderName.value = id
}

function typeId(value: string) {
  folderId.value = value.trim()
  idTyped.value = value.trim() !== ''
}

const idTaken = computed(
  () =>
    props.takenIds.includes(folderId.value) ||
    draft.value.projects.some((one) => one.project_id === folderId.value),
)
const idError = computed(() => {
  if (!folderId.value) return ''
  if (!projectIdValid(folderId.value)) return t('spaceWindow.projectIdHint')
  return idTaken.value ? t('spaceWindow.idTaken') : ''
})
const folderReady = computed(
  () =>
    folder.value.trim() !== '' &&
    folderName.value.trim() !== '' &&
    projectIdValid(folderId.value) &&
    !idTaken.value,
)

function closeFolder() {
  folderOpen.value = false
  folder.value = ''
  folderName.value = ''
  folderId.value = ''
  idTyped.value = false
}

function addFolder() {
  if (!folderReady.value) return
  draft.value = withFreshProject(draft.value, {
    project_id: folderId.value,
    display_name: folderName.value.trim(),
    canonical_root: folder.value.trim(),
  })
  closeFolder()
}
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
        v-for="project in draft.projects"
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
          class="project-root one-line"
          data-part="root"
          >{{ project.root }}</span
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
    <fieldset
      v-if="folderOpen"
      class="projects-folder"
      data-part="folder"
    >
      <legend class="folder-legend">{{ t('spaceWindow.fromFolder') }}</legend>
      <VTextInput
        autocomplete="off"
        :model-value="folder"
        :label="t('spaceWindow.folder')"
        :hint="t('spaceWindow.folderHint')"
        :spellcheck="false"
        @update:model-value="typeFolder"
      />
      <div class="folder-names">
        <VTextInput
          v-model="folderName"
          autocomplete="off"
          :label="t('spaceWindow.projectName')"
        />
        <VTextInput
          autocomplete="off"
          :model-value="folderId"
          :label="t('spaceWindow.projectId')"
          :spellcheck="false"
          :error="idError"
          @update:model-value="typeId"
        />
      </div>
      <div class="folder-actions">
        <VButton @click="closeFolder">{{ t('spaceWindow.cancel') }}</VButton>
        <VButton
          data-part="add-folder"
          :disabled="!folderReady"
          @click="addFolder"
          >{{ t('spaceWindow.addFolder') }}</VButton
        >
      </div>
    </fieldset>
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

/* The radio, the name, the folder, the marks and the remove on one line; the folder takes
   what the line has left and is cut at its end. The rows borrow the list's columns, so the
   longest name sets where every folder starts. */
.project-rows {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto var(--size-control-height);
  gap: var(--space-1) var(--space-3);
  min-width: 0;
}

.project-row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  row-gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-height);
}

.project-default {
  margin: 0;
}

.project-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.project-root {
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.project-marks {
  display: flex;
  gap: var(--space-2);
}

.project-mark {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}

.project-remove {
  justify-self: end;
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

.projects-folder {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

.folder-legend {
  padding: 0;
  margin-block-end: var(--space-2);
  font: var(--font-label);
}

.folder-names {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}

.folder-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: flex-end;
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
  }

  .project-marks {
    grid-area: marks;
  }

  .project-remove {
    grid-area: remove;
  }
}
</style>
