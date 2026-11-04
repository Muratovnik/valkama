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
  /** The file's path, for the links in it that lead back into it. */
  path: string
  project: string
  /**
   * The text stands centred in the window, as on a page of its own, rather than from the
   * start of a pane; the page then says how long a line is.
   */
  centred?: boolean
}>()
const emit = defineEmits<{ leave: [] }>()

const documents = useDocumentLinks(
  (reference) => ({ project: props.project, exact: reference.linkFrom !== undefined }),
  () => props.path,
)
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
/** A table or a block of code is scanned, not read along, and takes the column's width. */
const isWide = (index: number) => {
  const kind = props.document.blocks[index]?.block.kind
  return kind === 'table' || kind === 'code'
}

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

/** What a reader does to move the text, which a late correction must not undo. */
const READER_MOVES = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const
/** Each bringing is numbered, so a font arriving late only finishes the newest. */
let bringing = 0

/**
 * Brings a block to the scroller's top. A text drawn before its font arrived reflows when
 * it does, and the block would then stand under the head or below the top: it is brought
 * there again, unless the reader has moved the text by then or been sent somewhere else.
 */
function bring(index: number, scroller: HTMLElement): HTMLElement | null {
  const box = boxes()[index] ?? null
  box?.scrollIntoView({ block: 'start' })
  const fonts = globalThis.document.fonts as FontFaceSet | undefined
  if (!box || fonts?.status !== 'loading') return box
  const mine = ++bringing
  const controller = new AbortController()
  for (const kind of READER_MOVES)
    scroller.addEventListener(kind, () => controller.abort(), {
      once: true,
      passive: true,
      signal: controller.signal,
    })
  void fonts.ready.then(() => {
    if (!controller.signal.aborted && mine === bringing && box.isConnected)
      box.scrollIntoView({ block: 'start' })
    controller.abort()
  })
  return box
}

/** Which block holds an element, for a place to hand over; -1 for none. */
const indexOf = (element: Element) => boxes().findIndex((box) => box.contains(element))

defineExpose({ box: (index: number) => boxes()[index] ?? null, bring, indexOf, topIndex })
</script>

<template>
  <div
    ref="root"
    class="document-text"
    :class="{ centred }"
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
      :class="{
        'is-target': isMarked(index),
        'is-wide': isWide(index),
        'starts-section': startsSection(index),
      }"
    >
      <RichBlocks
        :blocks="blocks"
        document
      />
    </div>
  </div>
</template>

<style scoped>
@property --document-text-measure {
  syntax: '<length>';
  inherits: true;
  initial-value: 0;
}

/* The text is a grid with named lines, the layout breakout of Ryan Mulligan's "Layout
   Breakouts with CSS Grid": what is read along takes `content`, a reading measure of about
   seventy letters, and a table or a block of code may take `full`, since a table is
   scanned across rather than read along and a line of code cannot wrap. In a pane or a
   drawer both start where the pane's content does, and `full` runs on to its end. A `ch`
   is a zero, wider than the average letter: 58 of them hold 71–75 letters of English and
   67–71 of Russian in this face.

   Code inside a list item stands in the list's block, which is not wide; it may still reach
   past the text's end as far as `full` runs on, and `--rich-wide-reach` tells it how far.
   The text is a container for that, so the width it is counted from is the text's own; the
   measure is a registered length, so its `ch` is counted in the text's font and not the
   code's. */
.document-text {
  --document-text-measure: 58ch;
  --rich-wide-reach: max(0px, 100cqi - var(--document-text-measure));

  display: grid;
  grid-template-columns:
    [full-start content-start] min(var(--document-text-measure), 100%)
    [content-end] minmax(0, 1fr)
    [full-end];
  row-gap: var(--space-3);
  width: 100%;
  min-width: 0;
  max-width: 88ch;
  line-height: var(--line-height-reading);
  container-type: inline-size;

  /* On a page of its own the measure stands in the middle of the window under a head of
     the same width, and `full` is the whole column the page gives: a line ran on 300 px
     past the text's end to the head's actions. The page names the measure as a length,
     so the head and the text are one width whatever font each is set in. */
  &.centred {
    --document-text-measure: var(--document-measure);
    --rich-wide-reach: max(0px, (100cqi - var(--document-text-measure)) / 2);

    grid-template-columns:
      [full-start] minmax(0, 1fr)
      [content-start] min(var(--document-text-measure), 100%)
      [content-end] minmax(0, 1fr)
      [full-end];
    max-width: none;
  }
}

.document-facts {
  grid-column: full;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-code);
  overflow-wrap: anywhere;

  .centred > & {
    grid-column: content;
  }
}

/* The mark stands in the gutter, so the text it marks stays where it was. */
.document-block {
  grid-column: content;
  min-width: 0;
  outline: none;

  /* Room above a block a link sent the reader to, for its mark and its ring: at a step
     less the ring touched the head's rule. */
  scroll-margin-block-start: var(--space-3);

  &.is-wide {
    grid-column: full;
  }

  /* Centred, a table or code no wider than the text keeps the text's width and start, and
     a wider one grows by the same on both sides, as far as the column. */
  .centred > &.is-wide {
    justify-self: center;
    width: max-content;
    min-width: min(100%, var(--document-measure));
    max-width: 100%;
  }

  /* The room above a heading is what says a section begins: the gap between blocks alone
     set it as close to the text before as to the text it heads. It stands outside the
     box, so a mark on the heading holds the heading and not the room. */
  &.starts-section {
    margin-block-start: var(--space-4);
  }

  /* The mark is a line, not only a tone, so a forced palette keeps it. How far it reaches
     into the gutter is the host's to say, which knows how wide the gutter is. */
  &.is-target {
    --document-block-reach: var(--document-mark-reach, var(--space-3));

    padding-block: var(--space-1);
    padding-inline-start: calc(var(--document-block-reach) - 2px);
    margin-block: calc(-1 * var(--space-1));
    margin-inline-start: calc(-1 * var(--document-block-reach));
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
