<script setup lang="ts">
/**
 * The item's description, and its editor. A task chosen from the editor's `@` list is
 * told when the description is saved, as a comment's is, while its number still stands
 * in the text; the server tells only those the saved text did not name before.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'

import { updateWorkItemDescription } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { useCommentMentions } from '@/shared/lib/mentionSuggest.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{ changed: []; refresh: [] }>()
const { t } = useI18n()
const editing = ref(false)
const previewing = ref(false)
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const opener = ref<InstanceType<typeof VButton> | null>(null)
const draft = ref('')
const mentions = useCommentMentions(props, draft)
let seeded = ''
watch(
  () => props.item.work_item_id,
  () => {
    draft.value = props.item.description
    seeded = props.item.description
    editing.value = false
    previewing.value = false
    mentions.forget()
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
/** Edit what is written, or add the first words: the icon the action is drawn as. */
const editGlyph = computed(() => (props.item.description ? 'edit' : 'plus'))
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
        ...mentions.told(),
      }),
    () => {
      seeded = draft.value
      mentions.forget()
      closeEditor()
    },
  )
}
function cancel() {
  draft.value = props.item.description
  seeded = props.item.description
  mentions.forget()
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
        #actions="{ size }"
      >
        <VButton
          ref="opener"
          v-tooltip.name="editLabel"
          variant="ghost"
          :size="size"
          :aria-label="editLabel"
          icon
          @click="edit"
        >
          <VIcon :name="editGlyph" />
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
        :suggest="mentions.suggest"
        :rows="6"
        :maxlength="20000"
        :disabled="pending"
        :error="error"
        hide-label
        @chose="mentions.chose"
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
    <DataEmptyState
      v-else
      :title="t('workItem.noDescription')"
      inline
    />
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
}
</style>
