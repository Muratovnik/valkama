<script setup lang="ts">
/**
 * The field a reply is written in, under the replies of its thread.
 *
 * The host owns the text and the write, so a draft outlives this form while another
 * thread's form is open. Cancel asks before it drops words, as a code review's reply does,
 * and Escape is Cancel: it closes an empty field, and with words in it asks the same
 * question here. The key stops at this form either way. It used to go on to the card while
 * the field held words, and the card answered it with its own question about closing the
 * whole card, which was not what the key was pressed for.
 *
 * Sending disables the form while it waits, and the browser drops focus from a control disabled
 * under it. The editor gives it back to the field; the mark beside it, from which Enter sends
 * too, takes it back itself (`useFocusThroughWait`), so a refused reply does not leave it on
 * the page.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAskedCancel } from '@/features/discussion-thread/composables/useAskedCancel.ts'

import { useFocusThroughWait } from '@/shared/lib/useFocusThroughWait.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    /** The thread can take the mark with this reply: an unmarked comment or report. */
    canMark: boolean
    error: string
    pending: boolean
    suggest?: InstanceType<typeof MarkdownEditor>['$props']['suggest']
  }>(),
  { suggest: undefined },
)
const emit = defineEmits<{ cancel: []; chose: [row: EditorSuggestion]; refresh: []; submit: [] }>()
const text = defineModel<string>('text', { required: true })
const mark = defineModel<boolean>('mark', { required: true })
const { t } = useI18n()

const form = ref<HTMLFormElement | null>(null)
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const markBox = ref<HTMLElement | null>(null)
useFocusThroughWait(
  () => markBox.value,
  () => props.pending,
)
const previewing = ref(false)
const empty = computed(() => !text.value.trim())
const { asking, cancel } = useAskedCancel(
  form,
  () => empty.value,
  () => emit('cancel'),
)
onMounted(() => editor.value?.focusAtTop())

function send() {
  if (!props.pending && !empty.value) emit('submit')
}
defineExpose({ takeFocus: () => editor.value?.focusAtTop() })
</script>

<template>
  <form
    ref="form"
    class="reply-composer"
    @submit.prevent="send"
  >
    <MarkdownEditor
      ref="editor"
      v-model="text"
      v-model:preview="previewing"
      :label="t('threads.replyField')"
      :placeholder="t('threads.replyField')"
      :suggest="suggest"
      :rows="5"
      :maxlength="8000"
      :disabled="pending"
      :error="error"
      hide-label
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
          :disabled="pending"
          @click="cancel"
          >{{ t('threads.cancel') }}</VButton
        >
        <VButton
          type="submit"
          variant="primary"
          :disabled="pending || empty"
          >{{ t('threads.send') }}</VButton
        >
      </template>
    </MarkdownEditor>
    <label
      v-if="canMark"
      ref="markBox"
      class="reply-mark"
    >
      <input
        v-model="mark"
        type="checkbox"
        :disabled="pending"
      />
      {{ t('threads.markWithReply') }}
    </label>
    <ConfirmStrip
      v-if="asking"
      tone="danger"
      :message="t('threads.dropReply')"
      :cancel-label="t('threads.keepReply')"
      :confirm-label="t('threads.confirmDrop')"
      @cancel="asking = false"
      @confirm="emit('cancel')"
    />
  </form>
</template>

<style scoped>
.reply-composer {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* The words take the press as the box does, so the line is the target: as tall as a line of
   content an action rides, where its words alone stood 17px. */
.reply-mark {
  display: flex;
  gap: var(--space-2);
  justify-self: start;
  align-items: center;
  min-block-size: var(--size-control-inline);
  color: var(--color-text-muted);
  font: var(--font-detail);
  cursor: pointer;
}
</style>
