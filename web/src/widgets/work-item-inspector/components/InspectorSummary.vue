<script setup lang="ts">
/**
 * The closing summary: what was done, what comes next, and why this way.
 *
 * Its own component because it is the one part of Overview that holds state.
 * Everything else there shows the record; this form holds three drafts that must
 * survive a refetch, and the rule that keeps them — re-seed per item and per
 * stored summary, never per response — is only legible next to the fields it
 * governs.
 *
 * Done and next are required and why is not, because the terminal guard refuses
 * on exactly those two. The button says which promise it is keeping: a first
 * summary and a revision are different acts.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
  writable: boolean
}>()

const emit = defineEmits<{
  summary: [value: { done: string; next: string; why: string }]
}>()

const { t } = useI18n()

const done = ref('')
const next = ref('')
const why = ref('')

// The form follows the record. Editing it while a refetch lands would otherwise
// overwrite what the operator is typing, so it re-seeds per work item and per
// stored summary rather than on every response.
watch(
  [() => props.item.work_item_id, () => JSON.stringify(props.item.summary)],
  () => {
    done.value = props.item.summary?.done ?? ''
    next.value = props.item.summary?.next ?? ''
    why.value = props.item.summary?.why ?? ''
  },
  { immediate: true },
)

const complete = computed(() => done.value.trim().length > 0 && next.value.trim().length > 0)

/** Saving the first summary and revising a stored one are different promises. */
const action = computed(() =>
  props.item.summary ? t('workItem.summaryUpdate') : t('workItem.summarySave'),
)

function save() {
  if (!complete.value) return
  emit('summary', { done: done.value.trim(), next: next.value.trim(), why: why.value.trim() })
}
</script>

<template>
  <section>
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('workItem.summary') }}</SectionHeading
    >
    <p class="quiet">{{ t('workItem.summaryIntro') }}</p>
    <div class="summary-form">
      <VTextInput
        v-model="done"
        :label="t('workItem.summaryDone')"
        :disabled="!writable"
        :rows="2"
        :maxlength="4000"
      />
      <VTextInput
        v-model="next"
        :label="t('workItem.summaryNext')"
        :disabled="!writable"
        :rows="2"
        :maxlength="4000"
      />
      <VTextInput
        v-model="why"
        :label="t('workItem.summaryWhy')"
        :hint="t('workItem.summaryWhyHint')"
        :disabled="!writable"
        :rows="2"
        :maxlength="4000"
      />
      <VButton
        class="summary-action"
        variant="primary"
        :disabled="!writable || !complete"
        @click="save"
      >
        {{ action }}
      </VButton>
    </div>
  </section>
</template>

<style scoped>
.quiet {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* As in the note form: the three fields take the column, the action does not. */
.summary-form {
  display: grid;
  gap: var(--space-3);

  .summary-action {
    justify-self: start;
  }
}
</style>
