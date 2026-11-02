<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'

import { updateWorkItemDescription } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { workItemSuggest } from '@/shared/lib/workItemSuggest.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{ changed: []; refresh: [] }>()
const { t } = useI18n()
const editing = ref(false)
const previewing = ref(false)
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const opener = ref<InstanceType<typeof VButton> | null>(null)
const draft = ref('')
const suggest = workItemSuggest(
  () => props.item.planning_space_id,
  () => props.item.work_item_id,
)
let seeded = ''
watch(
  () => props.item.work_item_id,
  () => {
    draft.value = props.item.description
    seeded = props.item.description
    editing.value = false
    previewing.value = false
  },
  { immediate: true },
)
watch(
  () => props.item.description,
  (value) => {
    if (draft.value === seeded) draft.value = value
    seeded = value
  },
)
const { pending, error, submit } = useInspectorMutation(
  () => props.item.work_item_id,
  () => emit('changed'),
)
// An open editor whose text differs from what is saved is work a close would lose.
useDraftSource('description', () => editing.value && draft.value !== props.item.description)
const editLabel = computed(() =>
  t(props.item.description ? 'workItem.editDescription' : 'workItem.addDescription'),
)
/** The button that opened the editor is gone with it, so focus goes where the writing is. */
async function edit() {
  editing.value = true
  await nextTick()
  editor.value?.focusAtTop()
}
/** The editor goes with focus inside it, and the button that opened it is back to take that. */
function closeEditor() {
  editing.value = false
  previewing.value = false
  void nextTick(() => {
    const button = opener.value?.$el as HTMLElement | undefined
    if (document.activeElement === document.body) button?.focus({ preventScroll: true })
  })
}
function save() {
  if (!props.writable) return
  void submit(
    () =>
      updateWorkItemDescription({
        id: props.item.work_item_id,
        description: draft.value,
        expected_revision: props.item.revision,
      }),
    () => {
      seeded = draft.value
      closeEditor()
    },
  )
}
function cancel() {
  draft.value = props.item.description
  seeded = props.item.description
  closeEditor()
}
</script>

<template>
  <section class="description-section">
    <SectionHeader
      class="description-heading"
      :title="t('workItem.description')"
    >
      <template
        v-if="writable && !editing"
        #actions
      >
        <VButton
          ref="opener"
          variant="ghost"
          @click="edit"
        >
          {{ editLabel }}
        </VButton>
      </template>
    </SectionHeader>
    <form
      v-if="editing && writable"
      class="description-form"
      @submit.prevent="save"
    >
      <MarkdownEditor
        ref="editor"
        v-model="draft"
        v-model:preview="previewing"
        :label="t('workItem.description')"
        :suggest="suggest"
        :rows="6"
        :maxlength="20000"
        :disabled="pending"
        :error="error"
        hide-label
        @submit="save"
      >
        <template #actions>
          <VButton
            v-if="error"
            :disabled="pending"
            @click="emit('refresh')"
            >{{ t('workItem.refreshDraft') }}</VButton
          >
          <VButton
            :disabled="pending"
            @click="cancel"
            >{{ t('workItem.cancel') }}</VButton
          >
          <VButton
            type="submit"
            variant="primary"
            :disabled="pending"
            >{{ t('workItem.saveDescription') }}</VButton
          >
        </template>
      </MarkdownEditor>
    </form>
    <CollapsibleText
      v-else-if="item.description"
      class="description-copy"
      :text="item.description"
      :lines="12"
    />
    <p
      v-else
      class="description-copy empty"
    >
      {{ t('workItem.noDescription') }}
    </p>
  </section>
</template>

<style scoped>
.description-section,
.description-form {
  display: grid;
  gap: var(--space-heading-content);
}

.description-copy {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;

  &.empty {
    color: var(--color-text-muted);
  }
}
</style>
