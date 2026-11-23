<script setup lang="ts">
/**
 * Raising one work item by hand.
 *
 * The state is not asked for. A workflow declares its own initial state, and the
 * server puts a new item there; offering every state here would let the interface
 * disagree with the workflow. One switch is offered: «Into “Not sorted”» leaves the
 * new card in the workflow's one triage state, for work raised before it is sorted,
 * where the owner's own write would otherwise land it ready. A workflow without that
 * one state draws no switch. Everything else a new item needs is either typed or
 * defaulted by the model.
 *
 * The description is written the way the card writes it: in the markdown
 * editor, with a preview of what the card will show, `#` linking a task of the
 * space the item is created in, and Ctrl+Enter as this dialog's Create. Escape
 * closes an open `#` list first and the dialog only after.
 *
 * The fields follow the card's order (`COMPOSER_ROWS`): the kind and the priority, the project
 * and the labels, the parent, and the description last. A goal chosen with a parent is a
 * stage, and the kind's field names it so (`composerKinds`). The project is the space's: the
 * one the workspace is narrowed to, else its default. A goal or stage holds the work of any
 * project and names none, so for one the field says so and takes no choice; the server
 * refuses a container that names a project. A space with no project draws no field.
 *
 * The parent and the labels are chosen from what the space already has, searched as they
 * are typed (`SearchCombobox`): a reference typed by hand named a parent only when it was
 * spelled right, and a label typed by hand forked the one the filter menu knew. A new
 * label is still one Enter away.
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  COMPOSER_ROWS,
  composerKinds,
  labelChoices,
  parentChoices,
} from '@/features/work-item-compose/composerChoices.ts'
import type { ComposerField } from '@/features/work-item-compose/composerChoices.ts'
import { composerFailure } from '@/features/work-item-compose/composerFailure.ts'
import type { ComposerFailure } from '@/features/work-item-compose/composerFailure.ts'

import FacetChoiceMark from '@/entities/work-item/components/FacetChoiceMark.vue'
import { useFacetChoices } from '@/entities/work-item/composables/useFacetChoices.ts'
import { PRIORITY_CHOICES } from '@/entities/work-item/utils/facetChoices.ts'

import { createWorkItem } from '@/shared/api/planningApi.ts'
import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { mentionSuggest } from '@/shared/lib/mentionSuggest.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { useStandingName, useStateName } from '@/shared/lib/useStateName.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    space: string
    /** The space's work, whose goals and labels the dialog offers. */
    items?: readonly WorkItemBrief[]
    /** The project the field starts on: the one the workspace is narrowed to, else the default. */
    project?: string
    /** The space's projects, its default marked; none, or null when unread, draws no field. */
    projects?: readonly { default: boolean; display_name: string; project_id: string }[] | null
    /** The workflow's one triage state, or null where it has none to offer. */
    triage?: WorkflowState | null
  }>(),
  { items: () => [], projects: null, project: '', triage: null },
)

const emit = defineEmits<{ close: []; created: [reference: string] }>()

const { t } = useI18n()

const title = ref('')
const description = ref('')
const kind = ref<string>('task')
const priority = ref<string>('medium')
const labels = ref<string[]>([])
const parent = ref('')
const project = ref('')
const triaged = ref(false)
const busy = ref(false)
const failure = ref<ComposerFailure | null>(null)
const previewing = ref(false)
const suggest = mentionSuggest(() => props.space)
// The preview's references are text: opening one from this modal dialog put the
// card it named behind the dialog, where it could be seen and not reached.
provideReferenceLinks(() => null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    title.value = ''
    description.value = ''
    kind.value = 'task'
    priority.value = 'medium'
    labels.value = []
    parent.value = ''
    project.value = props.project
    triaged.value = false
    failure.value = null
    previewing.value = false
  },
  { immediate: true },
)

/** The kinds and the priorities as the card draws them: a glyph, a word and what it means. */
const facetChoices = useFacetChoices()
/** A goal under a parent is offered as the stage it becomes, and still sent as a goal. */
const kindOptions = computed(() =>
  facetChoices(composerKinds(parent.value !== '')).map((option) =>
    option.value === 'stage' ? { ...option, value: 'goal' } : option,
  ),
)
const priorityOptions = computed(() => facetChoices(PRIORITY_CHOICES))

const standingName = useStandingName()
const parentOptions = computed(() => parentChoices(props.items, t('compose.noGoal'), standingName))
const labelOptions = computed(() => labelChoices(props.items))
/** The rows a parent's title or the labels' chips stand in, which need more than a phone's half. */
const holdsTitles = (row: readonly ComposerField[]) =>
  row.includes('parent') || row.includes('labels')

/** A goal or stage names no project: it holds the work of any. */
const container = computed(() => kind.value === 'goal')
const projectOptions = computed(() =>
  container.value
    ? [{ value: '', label: t('compose.anyProject') }]
    : (props.projects ?? []).map((one) => ({ value: one.project_id, label: one.display_name })),
)
/** Why the field takes no choice for a goal or stage, as its accessible description. */
const anyProjectId = useId()
const projectHint = computed(() => (container.value ? anyProjectId : undefined))
const projectChoice = computed({
  get: () => (container.value ? '' : project.value),
  set: (value: string) => {
    project.value = value
  },
})
/** The project to name: none where the server reads the default without being told. */
const projectSent = computed(() => {
  const fallback = props.projects?.find((one) => one.default)?.project_id
  return container.value || project.value === fallback ? '' : project.value
})
const stateName = useStateName()
const triageLabel = computed(() =>
  props.triage ? t('compose.triage', { state: stateName(props.triage) }) : '',
)
const addLabel = (label: string) => t('compose.addLabel', { label })
const removeLabel = (label: string) => t('compose.removeLabel', { label })

/** Why the last write failed, below the fields; everything typed stays in them. */
const error = computed(() =>
  failure.value ? t(failure.value.key, { reason: failure.value.reason ?? '' }) : '',
)

const submittable = computed(() => title.value.trim().length > 0 && !busy.value)

async function submit() {
  if (!submittable.value) return
  busy.value = true
  failure.value = null
  try {
    const created = await createWorkItem({
      space: props.space,
      title: title.value.trim(),
      kind: kind.value,
      priority: priority.value,
      description: description.value,
      labels: labels.value,
      ...(parent.value ? { parent: parent.value } : {}),
      ...(projectSent.value ? { projects: [projectSent.value] } : {}),
      ...(props.triage && triaged.value ? { state: props.triage.key } : {}),
    })
    emit('created', created.reference)
  } catch (error_) {
    failure.value = composerFailure(error_)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DialogFrame
    :open="open"
    :busy="busy"
    :error="error"
    :title="t('workItem.newTitle')"
    :close-label="t('workItem.cancel')"
    @close="emit('close')"
    @submit="submit"
  >
    <div class="composer">
      <VTextInput
        v-model="title"
        :label="t('workItem.title')"
        :maxlength="200"
      />
      <div
        v-for="(row, place) in COMPOSER_ROWS"
        :key="place"
        class="composer-pair"
        :class="{ 'has-titles': holdsTitles(row) }"
      >
        <template
          v-for="facet in row"
          :key="facet"
        >
          <ChoiceSelect
            v-if="facet === 'kind'"
            v-model="kind"
            :label="t('workItem.kindLabel')"
            :options="kindOptions"
          >
            <template #value="{ selected }">
              <FacetChoiceMark
                v-if="selected"
                :mark="selected.mark"
              />
            </template>
            <template #option="{ option }">
              <FacetChoiceMark :mark="option.mark" />
            </template>
          </ChoiceSelect>
          <ChoiceSelect
            v-else-if="facet === 'priority'"
            v-model="priority"
            :label="t('workItem.priority')"
            :options="priorityOptions"
          >
            <template #value="{ selected }">
              <FacetChoiceMark
                v-if="selected"
                :mark="selected.mark"
              />
            </template>
            <template #option="{ option }">
              <FacetChoiceMark :mark="option.mark" />
            </template>
          </ChoiceSelect>
          <SearchCombobox
            v-else-if="facet === 'labels'"
            v-model="labels"
            :label="t('workItem.labels')"
            :placeholder="t('compose.labelsHint')"
            :options="labelOptions"
            :empty-label="t('compose.labelsEmpty')"
            :create-label="addLabel"
            :remove-label="removeLabel"
            :max="32"
            :maxlength="64"
            :disabled="busy"
          />
          <!-- Named above, as the labels beside it are, so the two inputs stand level. -->
          <VField
            v-else-if="facet === 'project' && projects?.length"
            as="div"
            :label="t('compose.project')"
          >
            <ChoiceSelect
              v-model="projectChoice"
              :label="t('compose.project')"
              :options="projectOptions"
              :disabled="busy || container"
              :describedby="projectHint"
            />
            <span
              v-if="container"
              :id="anyProjectId"
              class="visually-hidden"
              >{{ t('compose.anyProjectWhy') }}</span
            >
          </VField>
          <SearchCombobox
            v-else-if="facet === 'parent'"
            v-model="parent"
            :label="t('workItem.parent')"
            :options="parentOptions"
            :empty-label="t('compose.parentsEmpty')"
            :disabled="busy"
          />
        </template>
      </div>
      <MarkdownEditor
        v-model="description"
        v-model:preview="previewing"
        :label="t('workItem.description')"
        :suggest="suggest"
        :rows="4"
        :maxlength="20000"
        :disabled="busy"
        @submit="submit"
      />
      <ToggleSwitch
        v-if="triage"
        v-model="triaged"
        class="composer-triage"
        :label="triageLabel"
        :on-label="triageLabel"
        :off-label="triageLabel"
        :disabled="busy"
      />
    </div>

    <template #footer>
      <VButton @click="emit('close')">{{ t('workItem.cancel') }}</VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="!submittable"
        @click="submit"
      >
        {{ t('workItem.create') }}
      </VButton>
    </template>
  </DialogFrame>
</template>

<style scoped>
.composer {
  display: grid;
  gap: var(--space-3);
}

/* The switch is as wide as its words, under the description it follows. */
.composer-triage {
  justify-self: start;
}

.composer-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);

  /* A parent's title and a row of labels need more than a phone's half: under 240px a column,
     the two stand one above the other, and each list opens as wide as its field. Side by side
     at 172px a goal's title was cut to a few words in its field and took six lines in its
     list. */
  &.has-titles {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  }
}
</style>
