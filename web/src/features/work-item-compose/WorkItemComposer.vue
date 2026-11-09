<script setup lang="ts">
/**
 * Raising one work item by hand.
 *
 * The state is not asked for. A workflow declares its own initial state, and the
 * server puts a new item there; offering the choice here would let the interface
 * disagree with the workflow. Everything else a new item needs is either typed
 * or defaulted by the model.
 *
 * The description is written the way the card writes it: in the markdown
 * editor, with a preview of what the card will show, `#` linking a task of the
 * space the item is created in, and Ctrl+Enter as this dialog's Create. Escape
 * closes an open `#` list first and the dialog only after.
 *
 * The epic and the labels are chosen from what the space already has, searched as they
 * are typed (`SearchCombobox`): a reference typed by hand named an epic only when it was
 * spelled right, and a label typed by hand forked the one the filter menu knew. A new
 * label is still one Enter away.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { epicChoices, labelChoices } from '@/features/work-item-compose/composerChoices.ts'

import { createWorkItem } from '@/shared/api/planningApi.ts'
import { PRIORITIES, WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { workItemSuggest } from '@/shared/lib/workItemSuggest.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    space: string
    /** The space's work, whose epics and labels the dialog offers. */
    items?: readonly WorkItemBrief[]
  }>(),
  { items: () => [] },
)

const emit = defineEmits<{ close: []; created: [reference: string] }>()

const { t } = useI18n()

const title = ref('')
const description = ref('')
const kind = ref<string>('task')
const priority = ref<string>('medium')
const labels = ref<string[]>([])
const parent = ref('')
const busy = ref(false)
const error = ref('')
const previewing = ref(false)
const suggest = workItemSuggest(() => props.space)
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
    error.value = ''
    previewing.value = false
  },
)

const kindOptions = computed(() =>
  WORK_ITEM_KINDS.map((value) => ({ value, label: t(`workItem.kind.${value}`) })),
)
const priorityOptions = computed(() =>
  PRIORITIES.map((value) => {
    const label = t(`priority.${value}`)
    return {
      value,
      label,
      title: t('priorityMeaning.hint', {
        priority: label,
        meaning: t(`priorityMeaning.meaning.${value}`),
      }),
    }
  }),
)

const epicOptions = computed(() => epicChoices(props.items, t('compose.noEpic')))
const labelOptions = computed(() => labelChoices(props.items))
const addLabel = (label: string) => t('compose.addLabel', { label })
const removeLabel = (label: string) => t('compose.removeLabel', { label })

const submittable = computed(() => title.value.trim().length > 0 && !busy.value)

async function submit() {
  if (!submittable.value) return
  busy.value = true
  error.value = ''
  try {
    const created = await createWorkItem({
      space: props.space,
      title: title.value.trim(),
      kind: kind.value,
      priority: priority.value,
      description: description.value,
      labels: labels.value,
      ...(parent.value ? { parent: parent.value } : {}),
    })
    emit('created', created.reference)
  } catch (error_) {
    error.value = error_ instanceof Error ? error_.message : String(error_)
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
      <div class="composer-pair">
        <ChoiceSelect
          v-model="kind"
          :label="t('workItem.kindLabel')"
          :options="kindOptions"
        />
        <ChoiceSelect
          v-model="priority"
          :label="t('workItem.priority')"
          :options="priorityOptions"
        />
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
      <div class="composer-pair has-titles">
        <SearchCombobox
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
        <SearchCombobox
          v-model="parent"
          :label="t('workItem.parent')"
          :options="epicOptions"
          :empty-label="t('compose.epicsEmpty')"
          :disabled="busy"
        />
      </div>
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

.composer-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);

  /* An epic's title and a row of labels need more than a phone's half: under 240px a column,
     the two stand one above the other, and each list opens as wide as its field. Side by side
     at 172px an epic's title was cut to a few words in its field and took six lines in its
     list. */
  &.has-titles {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  }
}
</style>
