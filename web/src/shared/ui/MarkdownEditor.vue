<script setup lang="ts">
/**
 * The field a person writes free text in: markdown, with a preview, links to
 * work items offered as they are typed, and Ctrl+Enter to send.
 *
 * Everything this text becomes is drawn by `RichText`, so the preview is the
 * same component the card will use — what it shows is what the card will show.
 * Typing `#` and a few characters asks the host's `suggest` for work items;
 * the list stands under the field rather than at the caret, so it never covers
 * the line being written, and choosing one writes its reference in place of
 * the `#` query. The keys belong to the field while the list is open: the
 * arrows walk it, Enter or Tab takes the active row and Escape closes it
 * without closing the card around it.
 *
 * What a work item is and how to find one is the host's to say: the editor is a
 * text control and knows nothing about planning.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RichText from '@/shared/ui/RichText.vue'
import VField from '@/shared/ui/VField.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

export interface EditorSuggestion {
  detail: string
  key: string
  /** What is written into the text when the row is chosen. */
  reference: string
  title: string
}

const props = withDefaults(
  defineProps<{
    /** What Ctrl+Enter does, as the host's own button says it. */
    action: string
    label: string
    modelValue: string
    disabled?: boolean
    /** Why the text was refused; shown under the field and named by it. */
    error?: string
    /** A hint of the host's own in place of the default one, or false for none. */
    hint?: string | false
    maxlength?: number
    preview?: boolean
    rows?: number
    suggest?: (query: string, signal: AbortSignal) => Promise<readonly EditorSuggestion[]>
  }>(),
  {
    disabled: false,
    error: '',
    maxlength: undefined,
    preview: false,
    rows: 3,
    hint: '',
    suggest: undefined,
  },
)
const emit = defineEmits<{ 'submit': []; 'update:modelValue': [value: string] }>()
const { t } = useI18n()

/** How long typing pauses before the host is asked, and how many rows are shown. */
const SUGGEST_DELAY = 200
const SUGGEST_LIMIT = 8
/** A `#` that starts a word, then the query up to the caret. */
const TRIGGER = /(?:^|[\s([{])#([^\s#]{1,40})$/u

const listId = useId()
const field = ref<InstanceType<typeof VTextInput> | null>(null)
/** Where the `#` stands while a query is being typed; null when none is. */
const trigger = ref<{ query: string; start: number } | null>(null)
const choices = ref<readonly EditorSuggestion[]>([])
const searched = ref(false)
const active = ref(0)
let request: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | undefined

const open = computed(() => trigger.value !== null && searched.value)
const hasText = computed(() => props.modelValue.trim() !== '')
const isActive = (index: number) => index === active.value
const activeId = computed(() =>
  open.value && choices.value.length ? `${listId}-${active.value}` : undefined,
)
const completion = computed(() =>
  props.suggest && open.value ? { controls: listId, activeDescendant: activeId.value } : undefined,
)
/** What the list holds, said once it arrives, since focus stays in the field. */
const announcement = computed(() => (open.value ? t('editor.found', choices.value.length) : ''))
const shownHint = computed(() => {
  if (props.hint === false) return ''
  return (
    props.hint || t(props.suggest ? 'editor.hintSuggest' : 'editor.hint', { action: props.action })
  )
})

function cancel() {
  clearTimeout(timer)
  request?.abort()
  request = null
}
function close() {
  cancel()
  trigger.value = null
  choices.value = []
  searched.value = false
}
onBeforeUnmount(cancel)
watch(
  () => props.preview,
  (preview) => {
    if (preview) close()
  },
)

/** Read the query at the caret, and ask for it once typing pauses. */
function track() {
  const control = field.value?.control()
  if (!props.suggest || !control) return
  const caret = control.selectionStart ?? 0
  const match = TRIGGER.exec(control.value.slice(0, caret))
  if (!match?.[1]) {
    close()
    return
  }
  const query = match[1]
  if (trigger.value?.query === query) return
  trigger.value = { query, start: caret - query.length - 1 }
  cancel()
  const suggest = props.suggest
  timer = setTimeout(() => {
    const controller = new AbortController()
    request = controller
    void suggest(query, controller.signal)
      .then((found) => {
        if (controller.signal.aborted || trigger.value?.query !== query) return
        choices.value = found.slice(0, SUGGEST_LIMIT)
        searched.value = true
        active.value = 0
      })
      .catch(() => {
        if (controller.signal.aborted) return
        choices.value = []
        searched.value = true
      })
  }, SUGGEST_DELAY)
}

function edited(value: string) {
  emit('update:modelValue', value)
  void nextTick(track)
}

/** Write the chosen reference in place of the `#` query and put the caret after it. */
async function choose(index: number) {
  const row = choices.value[index]
  const at = trigger.value
  const control = field.value?.control()
  if (!row || !at || !control) return
  const end = at.start + 1 + at.query.length
  const text = `${row.reference} `
  const value = props.modelValue.slice(0, at.start) + text + props.modelValue.slice(end)
  close()
  emit('update:modelValue', value)
  await nextTick()
  const caret = at.start + text.length
  control.focus()
  control.setSelectionRange(caret, caret)
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    close()
    emit('submit')
    return
  }
  if (!open.value) return
  const count = choices.value.length
  if (event.key === 'Escape') {
    // The list closes; the drawer or dialog the field stands in does not.
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (count && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
  } else if (count && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
    event.preventDefault()
    void choose(active.value)
  }
}

defineExpose({
  /** Put the caret in the field, for a host that opens the editor on purpose. */
  focus: () => field.value?.control()?.focus(),
})
</script>

<template>
  <div class="markdown-editor">
    <VField
      v-if="preview"
      as="div"
      :label="label"
    >
      <div class="markdown-preview">
        <RichText
          v-if="hasText"
          :source="modelValue"
        />
        <p
          v-else
          class="markdown-empty"
        >
          {{ t('editor.empty') }}
        </p>
      </div>
    </VField>
    <VTextInput
      v-else
      ref="field"
      :label="label"
      :model-value="modelValue"
      :rows="rows"
      :maxlength="maxlength"
      :disabled="disabled"
      :error="error"
      :hint="shownHint"
      :completion="completion"
      @update:model-value="edited"
      @keydown="keydown"
      @click="track"
      @keyup.left.right.home.end="track"
    />
    <p
      class="visually-hidden"
      role="status"
    >
      {{ announcement }}
    </p>
    <ul
      v-if="open && !preview"
      :id="listId"
      class="markdown-suggestions"
      role="listbox"
      :aria-label="t('editor.suggestions')"
    >
      <!-- Focus stays in the field, which names the active row; a row is pointed
           at, never focused. -->
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -->
      <li
        v-for="(row, index) in choices"
        :id="`${listId}-${index}`"
        :key="row.key"
        class="markdown-suggestion"
        role="option"
        :class="{ active: isActive(index) }"
        :aria-selected="isActive(index)"
        @mousedown.prevent
        @mousemove="active = index"
        @click="choose(index)"
      >
        <span class="markdown-suggestion-reference">{{ row.reference }}</span>
        <span class="markdown-suggestion-title">{{ row.title }}</span>
        <span class="markdown-suggestion-detail">{{ row.detail }}</span>
      </li>
      <li
        v-if="!choices.length"
        class="markdown-suggestion-empty"
        role="presentation"
      >
        {{ t('editor.noSuggestions', { query: trigger?.query ?? '' }) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.markdown-editor {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

/* The preview stands where the field stood, at least as tall, so switching to
   it does not move the form under the reader. */
.markdown-preview {
  min-height: var(--size-text-area-min-height);
  padding: var(--space-2) var(--space-3);
  font: var(--font-editor);
  background: var(--color-surface-recess);
  border-radius: var(--radius-control);
}

.markdown-empty {
  margin: 0;
  color: var(--color-text-muted);
}

/* A sheet under the field: the rows are the field's own continuation, so they
   take the field's width and no line of their own. */
.markdown-suggestions {
  display: grid;
  padding: var(--space-1);
  margin: 0;
  background: var(--color-surface-sheet);
  border-radius: var(--radius-control);
  list-style: none;
}

.markdown-suggestion {
  display: grid;
  grid-template-columns: minmax(8ch, max-content) minmax(0, 1fr);
  gap: 0 var(--space-2);
  align-items: baseline;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-status);
  cursor: pointer;

  &.active {
    background: var(--color-surface-hover);
  }
}

.markdown-suggestion-reference {
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.markdown-suggestion-title {
  color: var(--color-text);
  font: var(--font-note);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.markdown-suggestion-detail {
  grid-column: 2;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.markdown-suggestion-empty {
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
