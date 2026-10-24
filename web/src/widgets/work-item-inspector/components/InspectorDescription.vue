<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useInspectorMutation } from '@/widgets/work-item-inspector/utils/useInspectorMutation.ts'

import { updateWorkItemDescription } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
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
const { pending, errorKey, submit } = useInspectorMutation(
  () => props.item.work_item_id,
  () => emit('changed'),
)
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
    <div class="description-heading">
      <SectionHeading
        as="h3"
        level="panel"
        >{{ t('workItem.description') }}</SectionHeading
      >
      <VButton
        v-if="writable && !editing"
        variant="ghost"
        @click="editing = true"
      >
        {{ editLabel }}
      </VButton>
    </div>
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
    <p
      v-else
      class="description-copy"
      :class="{ empty: !item.description }"
    >
      {{ item.description || t('workItem.noDescription') }}
    </p>
  </section>
</template>

<style scoped>
.description-section,
.description-form {
  display: grid;
  gap: var(--space-heading-content);
}

.description-heading,
.description-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.description-heading {
  justify-content: space-between;
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
</style>
