<script setup lang="ts">
/**
 * The block half of `RichText`: paragraphs, lists, quotes, code and tables.
 *
 * One container and one gap between its blocks, so a list inside a quote keeps
 * the rhythm of the text around it. A heading is a paragraph in the strong
 * weight: the section this text stands in owns the outline (see `richText.ts`).
 *
 * `document` is a whole Markdown file read on its own, which owns its outline: a
 * heading is a heading there, at the level `parseRichDocument` gave it, a frame too
 * wide for its content is a named stop on the keyboard's way (`keyScroll`), and a table's
 * columns take the width their words ask for. A card never passes it, and nothing it draws
 * changes.
 */
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { keyScroll } from '@/shared/lib/keyScroll.ts'
import { inlineWords } from '@/shared/lib/richText.ts'
import type { RichAlign, RichBlock, RichListItem } from '@/shared/lib/richText.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'

type List = Extract<RichBlock, { kind: 'list' }>

const props = withDefaults(defineProps<{ blocks: readonly RichBlock[]; document?: boolean }>(), {
  document: false,
})
defineOptions({ name: 'RichBlocks' })

type Table = Extract<RichBlock, { kind: 'table' }>
const { t } = useI18n()
/** A Markdown table has no caption, so its head names it. */
const tableFrame = (table: Table) =>
  props.document &&
  t('textFrames.table', { columns: table.header.map((cell) => inlineWords(cell)).join(', ') })
type Code = Extract<RichBlock, { kind: 'code' }>
/** A fence that names its language names the frame too. */
const codeFrame = ({ language }: Code) =>
  props.document && (language ? t('textFrames.codeIn', { language }) : t('textFrames.code'))

const vKeyScroll = keyScroll
const id = useId()
const listTag = (list: List) => (list.ordered ? 'ol' : 'ul')
/** A list that starts anywhere but one says so; one that starts at one says nothing. */
const listStart = (list: List) => (list.ordered && list.start !== 1 ? list.start : undefined)
const isTask = (item: RichListItem) => item.checked !== null
const isDone = (item: RichListItem) => item.checked === true
/** The words of a task item, which name its checkbox. */
const itemId = (block: number, item: number) => `${id}-${block}-${item}`
const alignClass = (align: RichAlign) => ({ center: align === 'center', end: align === 'right' })
type Heading = Extract<RichBlock, { kind: 'heading' }>
const headingTag = (heading: Heading) => `h${heading.level ?? 2}`
</script>

<template>
  <div class="rich-blocks">
    <template
      v-for="(block, index) in blocks"
      :key="index"
    >
      <p
        v-if="block.kind === 'paragraph'"
        class="rich-paragraph"
      >
        <RichInlines :nodes="block.children" />
      </p>
      <component
        :is="headingTag(block)"
        v-else-if="block.kind === 'heading' && document"
        class="rich-document-heading"
        :class="`level-${block.level ?? 2}`"
      >
        <RichInlines :nodes="block.children" />
      </component>
      <p
        v-else-if="block.kind === 'heading'"
        class="rich-paragraph rich-heading"
      >
        <RichInlines :nodes="block.children" />
      </p>
      <pre
        v-else-if="block.kind === 'code'"
        v-key-scroll="codeFrame(block)"
        class="rich-pre"
        >{{ block.text }}</pre>
      <blockquote
        v-else-if="block.kind === 'quote'"
        class="rich-quote"
      >
        <RichBlocks
          :blocks="block.children"
          :document="document"
        />
      </blockquote>
      <component
        :is="listTag(block)"
        v-else-if="block.kind === 'list'"
        class="rich-list"
        :class="{ ordered: block.ordered }"
        :start="listStart(block)"
      >
        <li
          v-for="(item, position) in block.items"
          :key="position"
          class="rich-item"
          :class="{ task: isTask(item) }"
        >
          <input
            v-if="isTask(item)"
            class="rich-check"
            type="checkbox"
            :checked="isDone(item)"
            :aria-labelledby="itemId(index, position)"
            disabled
          />
          <RichBlocks
            :id="itemId(index, position)"
            :blocks="item.children"
            :document="document"
          />
        </li>
      </component>
      <hr
        v-else-if="block.kind === 'rule'"
        class="rich-rule"
      />
      <div
        v-else-if="block.kind === 'table'"
        v-key-scroll="tableFrame(block)"
        class="rich-table-frame"
        :class="{ 'keeps-words': document }"
      >
        <table class="rich-table">
          <thead>
            <tr>
              <th
                v-for="(cell, column) in block.header"
                :key="column"
                class="rich-cell rich-head"
                :class="alignClass(block.align[column] ?? null)"
              >
                <span class="rich-cell-words"><RichInlines :nodes="cell" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, line) in block.rows"
              :key="line"
            >
              <td
                v-for="(cell, column) in row"
                :key="column"
                class="rich-cell"
                :class="alignClass(block.align[column] ?? null)"
              >
                <span class="rich-cell-words"><RichInlines :nodes="cell" /></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rich-blocks {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.rich-paragraph {
  margin: 0;
  overflow-wrap: anywhere;
}

.rich-heading {
  font-weight: 600;
}

/* A file's own outline, a step apart per level and all under the viewer's title. */
.rich-document-heading {
  margin: 0;
  line-height: var(--line-height-snug);
  font-weight: 600;
  overflow-wrap: anywhere;

  &.level-2 {
    font-size: var(--font-size-module);
  }

  &.level-3 {
    font-size: var(--font-size-section);
  }

  &.level-4 {
    font-size: var(--font-size-emphasis);
  }

  &.level-5,
  &.level-6 {
    font-size: var(--font-size-interface);
  }

  &.level-6 {
    color: var(--color-text-muted);
  }
}

.rich-pre {
  padding: var(--space-2) var(--space-3);
  margin: 0;
  font: var(--font-code);
  white-space: pre;
  background: var(--color-surface-recess);
  overflow-x: auto;
  border-radius: var(--radius-control);
}

/* A quote is set off by the same edge the step quote uses, and by its tone. */
.rich-quote {
  padding-inline-start: var(--space-3);
  margin: 0;
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text-muted);
}

/* The base stylesheet strips list markers for the interface's own lists; prose
   lists keep them. */
.rich-list {
  display: grid;
  gap: var(--space-1);
  padding-inline-start: var(--space-6);
  margin: 0;
  list-style: disc;

  &.ordered {
    list-style: decimal;
  }
}

.rich-item {
  display: list-item;
  min-width: 0;

  &.task {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2);
    align-items: baseline;
    margin-inline-start: calc(-1 * var(--space-6) + var(--space-1));
    list-style: none;
  }
}

.rich-check {
  margin: 0;
}

.rich-rule {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--color-rule);
}

/* A wide table scrolls inside its own frame rather than widening the card. A document's
   holds its words whole and scrolls sooner: a table squeezed to fit broke them mid-word. Each
   column there is as wide as its words ask, up to a measure a line of prose reads at: one
   floor for every column set them all equal, short ones with room to spare and long ones
   wrapped into rows of empty space. A word longer than the measure — an identifier, a
   name — widens its column instead of breaking, as a table on a code host does: broken
   mid-word it read as two words and copied as none, and the frame scrolls already. */
.rich-table-frame {
  max-width: 100%;
  overflow-x: auto;

  &.keeps-words {
    overflow-wrap: normal;

    & .rich-cell-words {
      --rich-inline-wrap: normal;

      display: block;
      width: max-content;
      min-width: min-content;
      max-width: 32ch;
    }
  }
}

/* A frame that scrolls has its edge drawn where more of it is hidden, so a column cut there
   reads as one that goes on, at the top of a tall table too, far from its scrollbar. A line
   and not a shade, so a forced palette keeps it. */
.rich-table-frame,
.rich-pre {
  &[data-more~='start'] {
    border-inline-start: 2px solid var(--color-rule-strong);
  }

  &[data-more~='end'] {
    border-inline-end: 2px solid var(--color-rule-strong);
  }
}

.rich-table {
  min-width: 100%;
}

.rich-cell {
  vertical-align: top;
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--color-rule);
  text-align: start;
}

.rich-head {
  font-weight: 600;
}

.rich-cell.center {
  text-align: center;
}

.rich-cell.end {
  text-align: end;
}
</style>
