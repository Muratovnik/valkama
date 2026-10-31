<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDraftSource } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'
import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'

import { updateWorkItemDescription } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import CollapsibleText from '@/shared/ui/CollapsibleText.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{ changed: []; refresh: [] }>()
const { t } = useI18n()
const editing = ref(false)
const draft = ref('')
let seeded = ''
watch(
  () => props.item.work_item_id,
  () => {
    draft.value = props.item.description
    seeded = props.item.description
    editing.value = false
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
const { pending, errorKey, errorReason, submit } = useInspectorMutation(
  () => props.item.work_item_id,
  () => emit('changed'),
)
// An open editor whose text differs from what is saved is work a close would lose.
useDraftSource('description', () => editing.value && draft.value !== props.item.description)
const editLabel = computed(() =>
  t(props.item.description ? 'workItem.editDescription' : 'workItem.addDescription'),
)
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
      editing.value = false
    },
  )
}
function cancel() {
  draft.value = props.item.description
  seeded = props.item.description
  editing.value = false
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
          variant="ghost"
          @click="editing = true"
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
      <VTextInput
        v-model="draft"
        :label="t('workItem.description')"
        :rows="4"
        :maxlength="20000"
        :disabled="pending"
      />
      <p
        v-if="errorKey"
        class="description-error"
        role="alert"
      >
        {{ t(errorKey) }}
        <span
          v-if="errorReason"
          class="description-reason"
          >{{ errorReason }}</span
        >
      </p>
      <div class="description-actions">
        <VButton
          type="submit"
          variant="primary"
          :disabled="pending"
          >{{ t('workItem.saveDescription') }}</VButton
        >
        <VButton
          :disabled="pending"
          @click="cancel"
          >{{ t('workItem.cancel') }}</VButton
        >
        <VButton
          v-if="errorKey"
          :disabled="pending"
          @click="emit('refresh')"
          >{{ t('workItem.refreshDraft') }}</VButton
        >
      </div>
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

.description-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.description-copy {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  &.empty {
    color: var(--color-text-muted);
  }
}

.description-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.description-reason {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
}
</style>
