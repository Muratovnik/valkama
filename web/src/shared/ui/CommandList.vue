<script
  setup
  lang="ts"
  generic="Item extends { detail: string; key: string; title: string; reference?: string }"
>
/**
 * A search field over a list of results that Enter, the arrows and a pointer
 * choose from.
 *
 * A result reads as one line where the list is wide — its marks, its
 * reference, its title, and its detail at the end — and as two on a phone,
 * the title under the rest. The host may draw marks before the reference
 * (`lead`) and draw the detail itself (`detail`), from the result it gave.
 */
import { computed, onMounted, useId, useTemplateRef, watch } from 'vue'

import { ListboxContent, ListboxFilter, ListboxItem, ListboxRoot } from 'reka-ui'

import { SlashBreaks } from '@/shared/ui/SlashBreaks.ts'

const props = withDefaults(
  defineProps<{
    items: readonly Item[]
    label: string
    loading: boolean
    placeholder: string
    query: string
    resultsLabel: string
    /**
     * Start a new set of rows on its first one, so Enter opens it. False when
     * the first row is not what was asked for and Enter must not take it.
     */
    highlightFirst?: boolean
  }>(),
  { highlightFirst: true },
)
const emit = defineEmits<{
  'select': [key: string]
  'submit': []
  'update:query': [value: string]
}>()
const resultsId = useId()
const busyMark = computed(() => props.loading || undefined)
const root = useTemplateRef<{ highlightFirstItem: () => void }>('root')
const field = useTemplateRef<{ $el: unknown }>('field')

// A list mounts again each time it opens, and the query it kept stays in the
// field. Selected, the next keystroke replaces it; left at the caret it was
// extended, so "MAIN-12" plus "MAIN-7" became one string that matched nothing.
onMounted(() => {
  const input = field.value?.$el
  if (input instanceof HTMLInputElement) input.select()
})

// Reka highlights the first row as the query is typed, but the rows arrive
// after the keystroke, so it highlighted nothing and Enter opened nothing until
// an arrow key was pressed. A new set of rows starts on its first one.
watch(
  () => props.items.map((item) => item.key).join('\n'),
  (keys) => {
    if (keys && props.highlightFirst) root.value?.highlightFirstItem()
  },
  { flush: 'post' },
)

/**
 * Enter that no row took: Reka stops the event when a row is highlighted, so
 * one that reaches the root found none — the rows are still loading, or the
 * pointer left the list and took the highlight with it. Only the search field
 * submits: a button in the feedback slot keeps its own Enter.
 */
function submit(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLInputElement)) return
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  event.preventDefault()
  emit('submit')
}
</script>

<template>
  <ListboxRoot
    ref="root"
    class="command-list"
    :highlight-on-hover="true"
    @keydown.enter="submit"
  >
    <ListboxFilter
      ref="field"
      class="command-input"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="true"
      autocomplete="off"
      :model-value="query"
      :aria-label="label"
      :placeholder="placeholder"
      :aria-controls="resultsId"
      :auto-focus="true"
      :maxlength="200"
      @update:model-value="emit('update:query', $event)"
    />
    <slot name="feedback" />
    <ListboxContent
      :id="resultsId"
      class="command-results"
      :aria-label="resultsLabel"
      :aria-busy="busyMark"
    >
      <ListboxItem
        v-for="item in items"
        :key="item.key"
        class="command-result"
        :value="item.key"
        @select.prevent="emit('select', item.key)"
      >
        <span class="command-head">
          <slot
            name="lead"
            :item="item"
          />
          <span
            v-if="item.reference"
            class="command-reference"
            >{{ item.reference }}</span
          >
        </span>
        <span class="command-title"><SlashBreaks :text="item.title" /></span>
        <span class="command-detail">
          <slot
            name="detail"
            :item="item"
            >{{ item.detail }}</slot
          >
        </span>
      </ListboxItem>
    </ListboxContent>
  </ListboxRoot>
</template>

<style scoped>
.command-list {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.command-input {
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  font-size: var(--font-size-interface);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

/* The results share their columns, so every reference and every title starts
   where the one above it does, whatever marks a row leads with. */
.command-results {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-3);
  max-height: min(45dvh, 440px);
  overflow-y: auto;
  overscroll-behavior: contain;
  container-type: inline-size;

  &:empty {
    display: none;
  }
}

/* One line: the marks and the reference, the title, the detail at the end. */
.command-result {
  display: grid;
  grid-template-areas: 'head title detail';
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: var(--space-1) var(--space-3);
  align-items: baseline;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  cursor: pointer;

  &[data-highlighted] {
    background: var(--color-surface-hover);
    outline: 1px solid var(--color-focus-ring);
    outline-offset: -1px;
  }
}

/* Too narrow for one line, the detail rides beside the reference and the
   title takes the line under them. */
@container (width < 560px) {
  .command-results {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .command-result {
    grid-template-areas:
      'head detail'
      'title title';
  }

  .command-detail {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* The marks centre on the reference, and the reference stands on the first line of the title
   by its baseline: the head hands on the baseline of the one item that takes part in baseline
   alignment, not its first mark's lower edge. Centred in the row, the reference hung between
   the two lines of a long title. */
.command-head {
  display: inline-flex;
  grid-area: head;
  gap: var(--space-2);
  align-items: center;
  align-self: baseline;
  white-space: nowrap;
}

/* Two lines, then an ellipsis: a long title is a row, not a paragraph, and the
   whole of it stays the option's accessible name. */
.command-title {
  display: -webkit-box;
  grid-area: title;
  font: var(--font-name);
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.command-detail {
  grid-area: detail;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.command-reference {
  align-self: baseline;
  color: var(--color-text);
  font-family: var(--font-family-mono);
}
</style>
