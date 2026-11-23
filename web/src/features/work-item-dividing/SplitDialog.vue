<script setup lang="ts">
/**
 * «Split off a part» of a task: a new card beside it, under the same parent and accepted as it is,
 * that takes the conditions chosen here, each with its tick. The server sets the part's parent,
 * state and acceptance from the task, so the window asks only what it is called and which of
 * the task's open conditions it takes; those done stay with the task, which did them.
 *
 * «Create» is not available until the part has a title and at least one condition, the reason
 * under the conditions: a part with none is a new card, which «New work» files. A refused write
 * keeps the window with what was chosen, its reason at the foot.
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import StepChoices from '@/entities/work-item/components/StepChoices.vue'
import { writeFailure } from '@/entities/work-item/utils/writeFailure.ts'

import { splitWorkItem } from '@/shared/api/planningDividingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ item: WorkItem; open: boolean }>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()

const title = ref('')
const chosen = ref<ReadonlySet<string>>(new Set())
const busy = ref(false)
const error = ref('')
const hintId = useId()

/** The conditions a part can take: those still open, in the task's order. */
const takeable = computed(() => props.item.checklist.filter((step) => !step.done))

// Each open starts from nothing named and nothing chosen: the part is named for what it takes.
watch(
  () => props.open,
  (opened) => {
    if (!opened) return
    title.value = ''
    chosen.value = new Set()
    error.value = ''
  },
  { immediate: true },
)

/** Why the part cannot be created yet; empty once it can. */
const blocked = computed(() => {
  if (!title.value.trim()) return t('workItem.dividing.split.untitled')
  return chosen.value.size ? '' : t('workItem.dividing.split.unchosen')
})
/** The press names the hint that says why it is unavailable, and nothing while it is not. */
const describedBy = computed(() => (blocked.value ? hintId : undefined))

async function submit() {
  if (busy.value || blocked.value) return
  busy.value = true
  error.value = ''
  try {
    await splitWorkItem({
      from: props.item.reference,
      title: title.value.trim(),
      steps: takeable.value.filter((step) => chosen.value.has(step.id)).map((step) => step.id),
    })
    emit('done')
  } catch (error_) {
    error.value = writeFailure(error_, t)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DialogFrame
    :open="open"
    :title="t('workItem.dividing.split.title')"
    :context="`${item.reference} · ${item.title}`"
    :close-label="t('workItem.dividing.split.keep')"
    :busy="busy"
    :error="error"
    @close="emit('close')"
    @submit="submit"
  >
    <div class="split-fields">
      <p class="split-intro">{{ t('workItem.dividing.split.intro') }}</p>
      <VTextInput
        v-model="title"
        class="split-title"
        :label="t('workItem.dividing.split.name')"
        :maxlength="200"
        :disabled="busy"
      />
      <section
        class="split-part"
        data-part="conditions"
      >
        <h3 class="split-heading">{{ t('workItem.dividing.split.conditions') }}</h3>
        <StepChoices
          v-model="chosen"
          :steps="takeable"
          :disabled="busy"
        />
      </section>
      <p
        v-if="blocked"
        :id="hintId"
        class="split-blocked"
      >
        {{ blocked }}
      </p>
    </div>
    <template #footer>
      <VButton @click="emit('close')">{{ t('workItem.dividing.split.keep') }}</VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="Boolean(blocked)"
        :aria-describedby="describedBy"
        >{{ t('workItem.dividing.split.submit') }}</VButton
      >
    </template>
  </DialogFrame>
</template>

<style scoped>
.split-fields,
.split-part {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.split-part {
  gap: var(--space-2);
}

.split-intro,
.split-blocked {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.split-heading {
  margin: 0;
  color: var(--color-text);
  font: var(--font-section-title);
}
</style>
