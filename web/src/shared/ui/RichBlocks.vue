<script setup lang="ts">
/**
 * The block half of `RichText`: paragraphs, lists, quotes, code and tables.
 *
 * One container and one gap between its blocks, so a list inside a quote keeps
 * the rhythm of the text around it. A heading is a paragraph in the strong
 * weight: the section this text stands in owns the outline (see `richText.ts`).
 */
import { useId } from 'vue'

import type { RichAlign, RichBlock, RichListItem } from '@/shared/lib/richText.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'

type List = Extract<RichBlock, { kind: 'list' }>

defineProps<{ blocks: readonly RichBlock[] }>()
defineOptions({ name: 'RichBlocks' })

const id = useId()
const listTag = (list: List) => (list.ordered ? 'ol' : 'ul')
/** A list that starts anywhere but one says so; one that starts at one says nothing. */
const listStart = (list: List) => (list.ordered && list.start !== 1 ? list.start : undefined)
const isTask = (item: RichListItem) => item.checked !== null
const isDone = (item: RichListItem) => item.checked === true
/** The words of a task item, which name its checkbox. */
const itemId = (block: number, item: number) => `${id}-${block}-${item}`
const alignClass = (align: RichAlign) => ({ center: align === 'center', end: align === 'right' })
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
      <p
        v-else-if="block.kind === 'heading'"
        class="rich-paragraph rich-heading"
      >
        <RichInlines :nodes="block.children" />
      </p>
      <pre
        v-else-if="block.kind === 'code'"
        class="rich-pre"
        >{{ block.text }}</pre>
      <blockquote
        v-else-if="block.kind === 'quote'"
        class="rich-quote"
      >
        <RichBlocks :blocks="block.children" />
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
          />
        </li>
      </component>
      <hr
        v-else-if="block.kind === 'rule'"
        class="rich-rule"
      />
      <div
        v-else-if="block.kind === 'table'"
        class="rich-table-frame"
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
                <RichInlines :nodes="cell" />
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
                <RichInlines :nodes="cell" />
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

/* A wide table scrolls inside its own frame rather than widening the card. */
.rich-table-frame {
  max-width: 100%;
  overflow-x: auto;
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
