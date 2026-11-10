<script setup lang="ts">
/**
 * What closing an item asks for when it has no outcome yet.
 *
 * Reached only from the refusal that asks for it, never offered beside a comment:
 * a person does not file reports here, agents do that through their tools. It
 * holds the two things the server will not close an item without and says why it
 * is asking, because whoever stands here pressed Done and was handed a form.
 * Saving carries that move on, so answering the question finishes what was
 * started. The host owns the text and the write, so a draft outlives a step back
 * to the comment, and the host answers for it from there. So it can outlive the
 * move too, and then this is only an outcome being written: no reason, and a button
 * that says what it does. A task chosen from either field's `@` list goes to the host,
 * which tells it when the outcome is saved.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The state a refused move is still waiting to go to, as a reader knows it. */
  closing: string | null
  /** Why the last save did not go through; empty when it did. */
  error: string
  pending: boolean
  suggest: (query: string, signal: AbortSignal) => Promise<readonly EditorSuggestion[]>
}>()
const emit = defineEmits<{ back: []; chose: [row: EditorSuggestion]; refresh: []; submit: [] }>()
const done = defineModel<string>('done', { required: true })
const next = defineModel<string>('next', { required: true })
const { t } = useI18n()

const titleId = useId()
const form = ref<HTMLFormElement | null>(null)
const first = ref<InstanceType<typeof MarkdownEditor> | null>(null)
/** Both fields show one view: they are one answer, and read together in the card. */
const previewing = ref(false)
const ready = computed(() => Boolean(done.value.trim() && next.value.trim()))
const title = computed(() => t(props.closing ? 'workItem.closing.title' : 'workItem.outcome'))
const action = computed(() => t(props.closing ? 'workItem.closing.send' : 'workItem.closing.save'))

/** Ctrl+Enter comes from either field, so the button's rule is checked here for both. */
function send() {
  if (ready.value && !props.pending) emit('submit')
}
defineExpose({
  /** Bring the form to the top of the card with the caret in its first field. */
  reveal() {
    form.value?.scrollIntoView?.({ block: 'start' })
    first.value?.focusAtTop()
  },
})
</script>

<template>
  <form
    ref="form"
    class="closing-form"
    :aria-labelledby="titleId"
    @submit.prevent="send"
  >
    <div class="closing-head">
      <SectionHeading
        :id="titleId"
        as="h4"
        level="panel"
        >{{ title }}</SectionHeading
      >
      <VButton
        variant="ghost"
        size="inline"
        :disabled="pending"
        @click="emit('back')"
        >{{ t('workItem.closing.back') }}</VButton
      >
      <p
        v-if="closing"
        class="closing-why"
      >
        {{ t('workItem.closing.why', { state: closing }) }}
      </p>
    </div>
    <MarkdownEditor
      ref="first"
      v-model="done"
      v-model:preview="previewing"
      :label="t('workItem.summaryDone')"
      :suggest="suggest"
      :rows="3"
      :maxlength="4000"
      :disabled="pending"
      @chose="emit('chose', $event)"
      @submit="send"
    />
    <MarkdownEditor
      v-model="next"
      v-model:preview="previewing"
      :label="t('workItem.summaryNext')"
      :suggest="suggest"
      :rows="3"
      :maxlength="4000"
      :disabled="pending"
      :error="error"
      @chose="emit('chose', $event)"
      @submit="send"
    >
      <template #actions>
        <VButton
          v-if="error"
          :disabled="pending"
          @click="emit('refresh')"
          >{{ t('workItem.refreshDraft') }}</VButton
        >
        <VButton
          type="submit"
          variant="primary"
          :disabled="pending || !ready"
          >{{ action }}</VButton
        >
      </template>
    </MarkdownEditor>
  </form>
</template>

<style scoped>
.closing-form {
  display: grid;
  gap: var(--space-3);
  scroll-margin-top: var(--space-4);
}

.closing-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  justify-content: space-between;
  align-items: center;
}

.closing-why {
  flex: 1 1 100%;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
