<script setup lang="ts">
/**
 * The list an `@` in an editor offers, grouped by what each row stands for — tasks,
 * then files — under the group's name, in the order the host gave them. The groups
 * are the listbox's groups (WAI-ARIA APG, grouped options), so a reader hears which
 * one a row is in; the keys walk the rows straight through, across the groups.
 *
 * It floats on the window, placed by the engine that places the choice lists:
 * under the field where the window has room, over it where it does not, never
 * taller than the room it got, and scrolled to the active row. It stood in the
 * flow under the field at its full height, so a comment field at the foot of a
 * card showed two of its eight rows, or none. It stays inside the field's own
 * dialog in the document, so the dialog still owns it.
 *
 * Focus stays in the field, which names the active row and keeps the keys; this
 * only draws and answers a pointer. A name, title or line the row cuts short shows
 * whole under the pointer, as other cut text does.
 */
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { autoUpdate, flip, hide, offset, size, useFloating } from '@floating-ui/vue'

import type { EditorSuggestion, SuggestionKind } from '@/shared/ui/MarkdownEditor.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  active: number
  /** The field the list belongs to. */
  anchor: HTMLElement | null
  choices: readonly EditorSuggestion[]
  id: string
  /** What was typed after the `@`; empty when nothing is yet. */
  query: string
}>()
const emit = defineEmits<{ choose: [index: number]; point: [index: number] }>()
const { t } = useI18n()

/** The list's distance from the field, and the margin it keeps from the window's edge. */
const LIST_GAP = 4
const WINDOW_MARGIN = 8

const list = ref<HTMLElement | null>(null)
const { x, y, middlewareData } = useFloating(toRef(props, 'anchor'), list, {
  placement: 'bottom-start',
  strategy: 'fixed',
  transform: false,
  whileElementsMounted: autoUpdate,
  middleware: [
    offset(LIST_GAP),
    flip({ padding: WINDOW_MARGIN }),
    size({
      padding: WINDOW_MARGIN,
      apply({ availableHeight, elements, rects }) {
        Object.assign(elements.floating.style, {
          width: `${rects.reference.width}px`,
          maxHeight: `${Math.max(0, availableHeight)}px`,
        })
      },
    }),
    hide(),
  ],
})
/** A field scrolled out of its panel takes its list with it. */
const detached = computed(() => middlewareData.value.hide?.referenceHidden === true)
const isActive = (index: number) => index === props.active
/** Runs of rows of one kind, each row with its place in the whole list, which the keys walk. */
const groups = computed(() => {
  const found: { kind: SuggestionKind; rows: { index: number; row: EditorSuggestion }[] }[] = []
  for (const [index, row] of props.choices.entries()) {
    const last = found.at(-1)
    if (last?.kind === row.kind) last.rows.push({ index, row })
    else found.push({ kind: row.kind, rows: [{ index, row }] })
  }
  return found
})
/** The list's one line when it has no rows: nothing matched, or nothing is typed yet. */
const emptyLine = computed(() =>
  props.query ? t('editor.noSuggestions', { query: props.query }) : t('editor.queryPrompt'),
)

defineExpose({
  /** The list holds no more than the room it got, so the row walked to is brought into it. */
  revealRow(index: number) {
    const row = list.value?.querySelectorAll('[role="option"]')[index]
    row?.scrollIntoView({ block: 'nearest', container: 'nearest' } as ScrollIntoViewOptions)
  },
})
</script>

<template>
  <div
    :id="id"
    ref="list"
    class="markdown-suggestions"
    role="listbox"
    :class="{ detached }"
    :style="{ left: `${x}px`, top: `${y}px` }"
    :aria-label="t('editor.suggestions')"
  >
    <ul
      v-for="group in groups"
      :key="group.kind"
      class="markdown-suggestion-group"
      role="group"
      :aria-labelledby="`${id}-${group.kind}`"
    >
      <li
        :id="`${id}-${group.kind}`"
        class="markdown-suggestion-heading"
        role="presentation"
      >
        {{ t(`editor.kinds.${group.kind}`) }}
      </li>
      <!-- Focus stays in the field, which names the active row; a row is pointed
           at, never focused. -->
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -->
      <li
        v-for="{ index, row } in group.rows"
        :id="`${id}-${index}`"
        :key="row.key"
        class="markdown-suggestion"
        role="option"
        :class="{ active: isActive(index) }"
        :aria-selected="isActive(index)"
        @mousedown.prevent
        @mousemove="emit('point', index)"
        @click="emit('choose', index)"
      >
        <span
          v-tooltip.clipped="row.name"
          class="markdown-suggestion-name"
          >{{ row.name }}</span
        >
        <span
          v-tooltip.clipped="row.title"
          class="markdown-suggestion-title"
          >{{ row.title }}</span
        >
        <span
          v-if="row.detail"
          v-tooltip.clipped="row.detail"
          class="markdown-suggestion-detail"
          >{{ row.detail }}</span
        >
      </li>
    </ul>
    <p
      v-if="!choices.length"
      class="markdown-suggestion-empty"
      role="presentation"
    >
      {{ emptyLine }}
    </p>
  </div>
</template>

<style scoped>
/* A sheet beside the field: the rows are the field's own continuation, so they
   take the field's width. It floats over what follows instead of pushing it
   down, and scrolls inside the room the window leaves it. */
.markdown-suggestions {
  position: fixed;
  z-index: 120;
  display: grid;
  align-content: start;
  padding: var(--space-1);
  margin: 0;
  border: 1px solid var(--color-rule-strong);
  background: var(--color-surface-sheet);
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: var(--radius-control);
  box-shadow: 0 14px 34px var(--color-shadow);
}

/* The field has scrolled out of its panel, under the head or past the foot. */
.markdown-suggestions.detached {
  visibility: hidden;
}

.markdown-suggestion-group {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;

  /* Air between the groups, not a line: the next group's name says where it starts. */
  & + & {
    margin-top: var(--space-2);
  }
}

/* The group's name: quieter than a row, and never a row the keys or a press reach. */
.markdown-suggestion-heading {
  padding: var(--space-1) var(--space-2) 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.markdown-suggestion {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr);
  gap: 0 var(--space-2);
  align-items: baseline;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-status);
  cursor: pointer;

  &.active {
    background: var(--color-surface-hover);

    /* A forced palette clears that ground, and focus stays in the field, so nothing else
       says which row Enter takes. An edge does, as it does on `OptionGroups`' rows. */
    @media (forced-colors: active) {
      outline: 1px solid Highlight;
      outline-offset: -1px;
    }
  }
}

/* A file's name can be long: it gives way at two fifths of the row, a width a task's
   number never reaches, and takes no less than one would. */
.markdown-suggestion-name {
  min-width: 8ch;
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.markdown-suggestion-title {
  color: var(--color-text);
  font: var(--font-note);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* A task's state, or the line a file was found at, which can be a long one. */
.markdown-suggestion-detail {
  grid-column: 2;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.markdown-suggestion-empty {
  padding: var(--space-1) var(--space-2);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
