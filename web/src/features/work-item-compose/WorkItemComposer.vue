<script setup lang="ts">
/**
 * Raising one work item by hand.
 *
 * The state is not asked for. A workflow declares its own initial state, and the
 * server puts a new item there; offering the choice here would let the interface
 * disagree with the workflow. Everything else a new item needs is either typed
 * or defaulted by the model.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { createWorkItem } from '@/shared/api/planningApi.ts'
import { PRIORITIES, WORK_ITEM_KINDS, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  open: boolean
  space: string
}>()

const emit = defineEmits<{ close: []; created: [reference: string] }>()

const { t } = useI18n()

const title = ref('')
const description = ref('')
const kind = ref<string>('task')
const priority = ref<string>('medium')
const labels = ref('')
const parent = ref('')
const busy = ref(false)
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    title.value = ''
    description.value = ''
    kind.value = 'task'
    priority.value = 'medium'
    labels.value = ''
    parent.value = ''
    error.value = ''
  },
)

const kindOptions = computed(() =>
  WORK_ITEM_KINDS.map((value) => ({ value, label: t(`workItem.kind.${value}`) })),
)
const priorityOptions = computed(() =>
  PRIORITIES.map((value) => ({ value, label: t(`priority.${value}`) })),
)

const parentValid = computed(
  () => parent.value.trim() === '' || WORK_ITEM_REFERENCE.test(parent.value.trim().toUpperCase()),
)
const submittable = computed(
  () => title.value.trim().length > 0 && parentValid.value && !busy.value,
)

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
      description: description.value.trim(),
      labels: labels.value
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
      ...(parent.value.trim() ? { parent: parent.value.trim().toUpperCase() } : {}),
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
    :subtitle="t('workItem.newSubtitle')"
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
      <VTextInput
        v-model="description"
        :label="t('workItem.description')"
        :rows="4"
        :maxlength="20000"
      />
      <div class="composer-pair">
        <VTextInput
          v-model="labels"
          :label="t('workItem.labels')"
          :hint="t('workItem.labelsHint')"
          :maxlength="512"
        />
        <VTextInput
          v-model="parent"
          :label="t('workItem.parent')"
          :hint="t('workItem.parentHint')"
          :maxlength="20"
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
}
</style>
