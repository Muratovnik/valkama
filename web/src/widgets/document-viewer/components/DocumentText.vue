<script setup lang="ts">
/**
 * A Markdown file's text, block by block, with the links in it working.
 *
 * Each top block stands in its own box, which is what a link's `#…` or `:42` lands on:
 * the box takes focus, so a screen reader reads where the reader arrived and a Tab goes
 * on from there, and the boxes are what the viewer measures to know where the reader is.
 *
 * Paths in the text are read from the document's project: a link has already been read
 * from the document's folder by the parse. A reference this layer does not own is
 * passed up; one that opens something elsewhere first closes the document, since what
 * it opens stands under it.
 */
import { computed, ref } from 'vue'

import { useDocumentLinks } from '@/entities/project-document/documentLinks.ts'

import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { RichDocument } from '@/shared/lib/richText.ts'
import RichBlocks from '@/shared/ui/RichBlocks.vue'

const props = defineProps<{
  document: RichDocument
  /** The top blocks a suffix named, marked as where the reader was sent. */
  marked: ReadonlySet<number>
  project: string
}>()
const emit = defineEmits<{ leave: [] }>()

const documents = useDocumentLinks((reference) => ({
  project: props.project,
  exact: reference.linkFrom !== undefined,
}))
provideReferenceLinks((reference, parent) => {
  if (reference.kind === 'document') return documents(reference)
  const link = parent(reference)
  if (!link || link.copies) return link
  return {
    ...link,
    open: () => {
      emit('leave')
      link.open()
    },
  }
})

/** One array per block, made once per text, so a new mark does not draw every block again. */
const singles = computed(() => props.document.blocks.map((entry) => [entry.block]))
const facts = computed(() => props.document.facts.join(' · '))
const isMarked = (index: number) => props.marked.has(index)
const startsSection = (index: number) => props.document.blocks[index]?.block.kind === 'heading'

const root = ref<HTMLElement | null>(null)

/** The top blocks, in order; the DOM order is the index. */
function boxes(): HTMLElement[] {
  return root.value ? [...root.value.querySelectorAll<HTMLElement>(':scope > .document-block')] : []
}

/**
 * The block at the scroller's top edge, by binary search over the boxes' places, as the
 * Markdown preview of VS Code finds it. -1 when there are none.
 */
function topIndex(scroller: HTMLElement): number {
  const list = boxes()
  const edge = scroller.getBoundingClientRect().top + 1
  let low = 0
  let high = list.length - 1
  let found = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const box = list[middle]
    if (box && box.getBoundingClientRect().top <= edge) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return list.length ? Math.max(found, 0) : -1
}

defineExpose({ box: (index: number) => boxes()[index] ?? null, topIndex })
</script>

<template>
  <div
    ref="root"
    class="document-text"
  >
    <p
      v-if="facts"
      class="document-facts"
    >
      {{ facts }}
    </p>
    <div
      v-for="(blocks, index) in singles"
      :key="index"
      class="document-block"
      tabindex="-1"
      :class="{ 'is-target': isMarked(index), 'starts-section': startsSection(index) }"
    >
      <RichBlocks
        :blocks="blocks"
        document
      />
    </div>
  </div>
</template>

<style scoped>
/* The text's own measure: a plan wraps near a hundred characters, and a line much
   longer than that is hard to come back from to the next one. */
.document-text {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  max-width: 88ch;
  line-height: var(--line-height-reading);
}

.document-facts {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-code);
  overflow-wrap: anywhere;
}

/* The mark stands in the gutter, so the text it marks stays where it was. */
.document-block {
  min-width: 0;
  outline: none;
  scroll-margin-block-start: var(--space-2);

  /* The room above a heading is what says a section begins: the gap between blocks alone
     set it as close to the text before as to the text it heads. It stands outside the
     box, so a mark on the heading holds the heading and not the room. */
  &.starts-section {
    margin-block-start: var(--space-4);
  }

  /* The mark is a line, not only a tone, so a forced palette keeps it. */
  &.is-target {
    padding-block: var(--space-1);
    padding-inline-start: calc(var(--space-3) - 2px);
    margin-block: calc(-1 * var(--space-1));
    margin-inline-start: calc(-1 * var(--space-3));
    border-inline-start: 2px solid var(--color-rule-strong);
    background: var(--color-surface-active);
    border-inline-start-color: var(--color-accent);
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
  }

  &.is-target.starts-section {
    margin-block-start: calc(var(--space-4) - var(--space-1));
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}
</style>
