<script setup lang="ts">
/**
 * «New project from folder…» in the space window: the folder's path, the project's name and its
 * identifier, and the project joining the space, registered by the window's save.
 *
 * The folder suggests both: the name is the folder's own, in whatever script it is written, and
 * the identifier is that name in a project id's form, or nothing where the name leaves nothing of
 * it. Each follows the folder until the reader types one of their own. An identifier another
 * registered project or a row of the space already has is refused before it is added.
 *
 * Its fields and its own two buttons stand on a ground of their own, so that the buttons read as
 * the panel's and not as the window's foot. It is drawn while it is open, and starts empty each
 * time. It is `data-part="folder"`, its Add `add-folder`.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  folderNameOf,
  projectIdOf,
  projectIdValid,
  withFreshProject,
} from '@/features/space-window/spaceDraft.ts'
import type { SpaceDraft } from '@/features/space-window/spaceDraft.ts'

import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The ids every registered project has, which a folder's new project cannot take. */
  takenIds: readonly string[]
}>()
const emit = defineEmits<{ close: [] }>()
const draft = defineModel<SpaceDraft>({ required: true })
const { t } = useI18n()

const folder = ref('')
const name = ref('')
const id = ref('')
/** The reader typed the id, so a new folder no longer replaces it. */
const idTyped = ref(false)
/** The reader typed the name, so a new folder no longer replaces it. */
const nameTyped = ref(false)

function typeFolder(value: string) {
  folder.value = value
  if (!idTyped.value) id.value = projectIdOf(value)
  if (!nameTyped.value) name.value = folderNameOf(value)
}

function typeName(value: string) {
  name.value = value
  nameTyped.value = value.trim() !== ''
}

function typeId(value: string) {
  id.value = value.trim()
  idTyped.value = value.trim() !== ''
}

const idTaken = computed(
  () =>
    props.takenIds.includes(id.value) ||
    draft.value.projects.some((one) => one.project_id === id.value),
)
const idError = computed(() => {
  if (!id.value) return ''
  if (!projectIdValid(id.value)) return t('spaceWindow.projectIdHint')
  return idTaken.value ? t('spaceWindow.idTaken') : ''
})
const ready = computed(
  () =>
    folder.value.trim() !== '' &&
    name.value.trim() !== '' &&
    projectIdValid(id.value) &&
    !idTaken.value,
)

function add() {
  if (!ready.value) return
  draft.value = withFreshProject(draft.value, {
    project_id: id.value,
    display_name: name.value.trim(),
    canonical_root: folder.value.trim(),
  })
  emit('close')
}
</script>

<template>
  <fieldset
    class="folder-panel"
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
        autocomplete="off"
        :model-value="name"
        :label="t('spaceWindow.projectName')"
        @update:model-value="typeName"
      />
      <VTextInput
        autocomplete="off"
        :model-value="id"
        :label="t('spaceWindow.projectId')"
        :spellcheck="false"
        :error="idError"
        @update:model-value="typeId"
      />
    </div>
    <div class="folder-actions">
      <VButton @click="emit('close')">{{ t('spaceWindow.cancel') }}</VButton>
      <VButton
        data-part="add-folder"
        :disabled="!ready"
        @click="add"
        >{{ t('spaceWindow.addFolder') }}</VButton
      >
    </div>
  </fieldset>
</template>

<style scoped>
/* On the window's ground its two buttons stood right over the window's foot and read as one row
   of buttons with it. */
.folder-panel {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4);
  margin: 0;
  border: 0;
  background: var(--color-surface-muted);
  border-radius: var(--radius-card);

  /* A forced palette clears that ground, and with it the panel's edge. */
  @media (forced-colors: active) {
    outline: 1px solid CanvasText;
  }
}

/* Floated, it is not the legend drawn across the panel's top edge but the first of the panel's
   rows, inside its ground. */
.folder-legend {
  float: inline-start;
  padding: 0;
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
</style>
