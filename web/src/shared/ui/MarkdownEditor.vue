<script setup lang="ts">
/**
 * The field a person writes free text in, drawn as one object: a toolbar, the
 * text, and a foot with what the host does with it. One border goes around all
 * three and the focus ring goes on that border. The form used to be assembled
 * from pieces each with its own frame and gap, and read as a set of parts with a
 * button left over at the end.
 *
 * Everything this text becomes is drawn by `RichText`, so the preview is the
 * same component the card will use — what it shows is what the card will show.
 * It lies over the text rather than replacing it: the text keeps the height, so
 * switching moves nothing, and the caret and the undo history are still there
 * when the reader comes back.
 *
 * The toolbar's mention button writes a `#`, and a `#` is what opens the list of
 * work items, whichever way it got there; choosing a row writes its reference in
 * place of the `#` query. The keys belong to the field while the list is open:
 * the arrows walk it, Enter or Tab takes the active row and Escape closes it
 * without closing the card around it.
 *
 * What a work item is and how to find one is the host's to say: the editor is a
 * text control and knows nothing about planning. So is what sending means: a
 * host with an action of its own for this text puts it in the `actions` slot, the
 * foot's end, and a host whose action stands elsewhere leaves the foot out.
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { markdownEdit } from '@/shared/lib/markdownEdits.ts'
import type { MarkdownTool, TextEdit } from '@/shared/lib/markdownEdits.ts'
import MarkdownSuggestions from '@/shared/ui/MarkdownSuggestions.vue'
import MarkdownToolbar from '@/shared/ui/MarkdownToolbar.vue'
import RichText from '@/shared/ui/RichText.vue'
import { useEditorSuggestions } from '@/shared/ui/useEditorSuggestions.ts'
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
    label: string
    modelValue: string
    disabled?: boolean
    /** Why the text was refused; shown in the foot and named by the field. */
    error?: string
    /** The section around the editor already names it; the name stays for a reader. */
    hideLabel?: boolean
    maxlength?: number
    placeholder?: string
    /**
     * The host takes focus to this field with its error, and the field's
     * description says it there: an alert as well would say it twice.
     */
    quietError?: boolean
    /** How many lines the field starts at; it grows with its text from there. */
    rows?: number
    suggest?: (query: string, signal: AbortSignal) => Promise<readonly EditorSuggestion[]>
  }>(),
  {
    disabled: false,
    error: '',
    hideLabel: false,
    maxlength: undefined,
    placeholder: '',
    quietError: false,
    rows: 3,
    suggest: undefined,
  },
)
const emit = defineEmits<{ 'submit': []; 'update:modelValue': [value: string] }>()
/**
 * The host binds this where one choice governs several fields — a question's
 * text answers are one answer being written, and two switches apart would let
 * them disagree — and to come back to writing once the text is sent.
 */
const preview = defineModel<boolean>('preview', { default: false })
const { t } = useI18n()

/** What may stand right before a `#` for it to start a word. */
const WORD_START = /(?:^|[\s([{])$/u
const inputId = useId()
const errorId = useId()
const listId = useId()

/**
 * The one place this file touches the control the text is typed in. Another
 * engine replaces this block and the `VTextInput` in the template; the toolbar,
 * the keys and the list go through it and read nothing else.
 */
const input = ref<InstanceType<typeof VTextInput> | null>(null)
const field = {
  element: () => input.value?.control() ?? null,
  text: () => input.value?.control()?.value ?? '',
  selection() {
    const control = input.value?.control()
    return { start: control?.selectionStart ?? 0, end: control?.selectionEnd ?? 0 }
  },
  focus: () => input.value?.control()?.focus(),
  /**
   * A text set from outside has its caret at the end, and the field scrolls there
   * on focus. One longer than the field opens at its beginning instead, which is
   * what the reader was looking at.
   */
  focusAtTop() {
    const control = input.value?.control()
    control?.focus()
    if (!control || control.scrollHeight <= control.clientHeight) return
    control.setSelectionRange(0, 0)
    control.scrollTop = 0
  },
  /**
   * Replace a range as typing would, which is what keeps Ctrl+Z working: the
   * browser's undo history only records what its own editing did, so assigning
   * `value` or calling `setRangeText` leaves a toolbar action nothing can take
   * back. `execCommand` is deprecated and still the one door into that editing;
   * `setRangeText` stands in where the door is gone, with the text still right.
   * Either way the change arrives as an `input` event, the way typing does.
   */
  replace({ start, end, text, selection }: TextEdit) {
    const control = input.value?.control()
    if (!control) return
    control.focus()
    control.setSelectionRange(start, end)
    const typed = document.execCommand?.(text ? 'insertText' : 'delete', false, text) ?? false
    if (!typed) {
      control.setRangeText(text, start, end)
      control.dispatchEvent(new Event('input', { bubbles: true }))
    }
    control.setSelectionRange(...selection)
  },
}

const { active, choices, close, open, track, trigger } = useEditorSuggestions({
  suggest: () => props.suggest,
  read: () => (field.element() ? { caret: field.selection().start, text: field.text() } : null),
})
const list = ref<InstanceType<typeof MarkdownSuggestions> | null>(null)
const anchor = computed(() => field.element())
const hasText = computed(() => props.modelValue.trim() !== '')
const invalid = computed(() => Boolean(props.error))
const describedBy = computed(() => (props.error ? errorId : undefined))
const errorRole = computed(() => (props.quietError ? undefined : 'alert'))
const activeId = computed(() =>
  open.value && choices.value.length ? `${listId}-${active.value}` : undefined,
)
const completion = computed(() =>
  props.suggest && open.value ? { controls: listId, activeDescendant: activeId.value } : undefined,
)
/** What the list holds, said once it arrives, since focus stays in the field. */
const announcement = computed(() => (open.value ? t('editor.found', choices.value.length) : ''))

/** Absent rather than false: `inert="false"` on an element is still inert to a stylesheet. */
const inertMark = computed(() => (preview.value ? true : undefined))

watch(preview, (showing) => {
  if (showing) close()
})

/**
 * A field that is disabled loses its focus, so sending with Ctrl+Enter left the
 * writer on the page, refused or not. Read before the render that disables it,
 * and given back only if the writer has not gone somewhere else in the meantime.
 */
let hadFocus = false
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) hadFocus = document.activeElement === field.element()
    else if (hadFocus)
      void nextTick(() => document.activeElement === document.body && field.focus())
  },
  { flush: 'pre' },
)

function edited(value: string) {
  emit('update:modelValue', value)
  track()
}

/** Make an edit whole or not at all: a limit that cut it would leave half a mark behind. */
function apply(edit: TextEdit) {
  const length = field.text().length - (edit.end - edit.start) + edit.text.length
  if (props.maxlength !== undefined && length > props.maxlength) return
  field.replace(edit)
}
function format(tool: MarkdownTool) {
  const { start, end } = field.selection()
  apply(markdownEdit(tool, field.text(), start, end))
}
/** Write a `#` after what is selected, as a word of its own; `edited` takes it from there. */
function mention() {
  const at = field.selection().end
  const text = WORD_START.test(field.text().slice(0, at)) ? '#' : ' #'
  const caret = at + text.length
  apply({ start: at, end: at, text, selection: [caret, caret] })
}

/** Write the chosen reference in place of the `#` query and put the caret after it. */
function choose(index: number) {
  const row = choices.value[index]
  const at = trigger.value
  if (!row || !at) return
  const text = `${row.reference} `
  const caret = at.start + text.length
  close()
  apply({ start: at.start, end: at.start + 1 + at.query.length, text, selection: [caret, caret] })
}

/** The toolbar's keys, by the key's place: `event.key` is «и» on a Russian layout. */
function shortcut(event: KeyboardEvent): MarkdownTool | null {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return null
  if (event.code === 'KeyB') return 'bold'
  return event.code === 'KeyI' ? 'italic' : null
}

function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    close()
    emit('submit')
    return
  }
  const tool = shortcut(event)
  if (tool) {
    event.preventDefault()
    format(tool)
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
    list.value?.revealRow(active.value)
  } else if (count && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
    event.preventDefault()
    choose(active.value)
  }
}

defineExpose({
  /** Put the caret in the field, for a host that opens the editor on purpose. */
  focus: () => field.focus(),
  /** The same for a host that opens it on a text the reader was just reading. */
  focusAtTop: () => field.focusAtTop(),
})
</script>

<template>
  <div class="markdown-editor">
    <!-- The field is named on itself, so this says it once to the eye and once to
         a pointer, and a reader does not hear it twice. -->
    <label
      v-if="!hideLabel"
      class="markdown-label"
      aria-hidden="true"
      :for="inputId"
      >{{ label }}</label
    >
    <div
      class="markdown-surface"
      :class="{ disabled }"
    >
      <MarkdownToolbar
        v-model:preview="preview"
        :disabled="disabled"
        :mentions="Boolean(suggest)"
        @format="format"
        @mention="mention"
      />
      <div class="markdown-body">
        <!-- A row is pressed without moving focus, so leaving this means leaving the field. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <div
          class="markdown-input"
          :inert="inertMark"
          @focusout="close"
        >
          <VTextInput
            ref="input"
            :control-id="inputId"
            :label="label"
            :model-value="modelValue"
            :rows="rows"
            :maxlength="maxlength"
            :placeholder="placeholder"
            :disabled="disabled"
            :invalid="invalid"
            :describedby="describedBy"
            :completion="completion"
            bare
            hide-label
            @update:model-value="edited"
            @keydown="keydown"
            @click="track"
            @keyup.left.right.home.end="track"
          />
        </div>
        <!-- A long text scrolls here, and a keyboard has to be able to scroll it. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-noninteractive-tabindex -->
        <div
          v-if="preview"
          class="markdown-preview"
          role="group"
          tabindex="0"
          :aria-label="label"
        >
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
      </div>
      <div
        v-if="$slots.actions || error"
        class="markdown-foot"
      >
        <small
          v-if="error"
          :id="errorId"
          class="markdown-error"
          :role="errorRole"
          >{{ error }}</small
        >
        <small
          v-else
          class="markdown-hint"
          >{{ t('editor.hint') }}</small
        >
        <div
          v-if="$slots.actions"
          class="markdown-actions"
        >
          <slot name="actions" />
        </div>
      </div>
    </div>
    <p
      class="visually-hidden"
      role="status"
    >
      {{ announcement }}
    </p>
    <MarkdownSuggestions
      v-if="open && !preview"
      :id="listId"
      ref="list"
      :active="active"
      :anchor="anchor"
      :choices="choices"
      :query="trigger?.query ?? ''"
      @choose="choose"
      @point="active = $event"
    />
  </div>
</template>

<style scoped>
.markdown-editor {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.markdown-label {
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

/* The one frame: the hairline and the radius a text field has, around all three
   rows. The text is on the fill a field has, and the rows above and below it a
   step toward the ground, where the fill of a button still shows; that step is
   what parts them, with no rule. The ring answers the text alone, because a button
   in a row has a ring of its own and two at once say focus is in two places. */
.markdown-surface {
  display: grid;
  min-width: 0;
  border: 1px solid var(--color-rule-strong);
  background: var(--color-surface-sheet);
  overflow: clip;
  border-radius: var(--radius-control);

  &:hover:not(.disabled) {
    border-color: var(--color-action-primary);
  }

  &:has(.markdown-body:focus-within) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  &.disabled {
    border-color: var(--color-rule);

    .markdown-body {
      background: var(--color-control-disabled-surface);
    }
  }
}

.markdown-body {
  position: relative;
  min-width: 0;
  background: var(--color-control-surface);
}

.markdown-input[inert] {
  visibility: hidden;
}

/* Over the text, which keeps the height whatever this one would have been. */
.markdown-preview {
  position: absolute;
  inset: 0;
  padding: var(--space-2) var(--space-3);
  font: var(--font-editor);
  overflow-y: auto;

  /* The frame's ring is the one that answers focus here too. */
  &:focus-visible {
    outline: 0;
  }
}

.markdown-empty {
  margin: 0;
  color: var(--color-text-muted);
}

/* What is said about the text at the start, what is done with it at the end. The
   actions take a line of their own only where the words need the room. */
.markdown-foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
}

.markdown-hint,
.markdown-error {
  min-width: 0;
  font: var(--font-detail);
}

/* One short line: what gives way next to a wide action is the row, not this. */
.markdown-hint {
  flex: 1 1 auto;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.markdown-error {
  flex: 1 1 8rem;
  color: var(--color-danger);
  overflow-wrap: anywhere;
}

.markdown-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-inline-start: auto;
}
</style>
