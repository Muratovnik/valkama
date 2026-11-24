<script setup lang="ts">
/**
 * A name of two parts on one line, such as a pair of a chart split by a second dimension,
 * «claude-opus-5-5 · high»: short of room the first part gives way, cut with an ellipsis, and
 * the end that tells the pairs apart (`end`, the separator and the second part) stays whole.
 * Cut from its end as any one-line name is, «claude-opus-5-5 · …» stood twice in one chart, and
 * the reader could not tell the two rows apart.
 *
 * The end gives way only when even it is wider than the line, and then from its own end, after
 * the first part has kept room for its ellipsis alone, so the line still shows that something
 * stands before it. A name with no end, or one `end` does not close, is plain text, cut by the
 * host's own rule.
 *
 * Stacked (`stacked`), as a list of names of free text asks, a part takes a line of its own, the
 * end under the start, and each is cut at its own end: a task's title is on either side of a pair
 * there, and each part's start, a task's reference, stays whole on its line.
 *
 * Whole (`whole`), as a model's id asks, the start is never cut: the end follows it on its line
 * while there is room for its first words, and takes the next line otherwise, cut at its own end.
 *
 * The words are the name's whole text, in order, as the element around it reads them: a host
 * that names a control by its content, or reads it into a hint while it is cut, gets the whole
 * pair. `innerText` alone breaks a line between the two parts, which are boxes of their own. The
 * host keeps the line itself: its box, its ink and the hint that says the name whole.
 *
 * A name that holds a work item's title comes with its runs (`runs`, `titleRuns`), and is drawn in
 * them (`textRuns.ts`): the title's code as code, without its backticks, its reference whole. Each
 * part is drawn in its own share of the runs, cut where the end starts (`cutRuns`). A name with no
 * runs is drawn as the text it is, so a chart, its table and its hint draw any name through this.
 */
import { computed } from 'vue'

import { cutRuns, vTextRuns } from '@/shared/ui/textRuns.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'

const props = defineProps<{
  /** The whole name. */
  name: string
  /** The end of `name` that stays whole while the rest gives way, « · high». */
  end?: string
  /**
   * The name as the runs it is drawn in, where it holds a work item's title; `writtenText` of them
   * is `name`.
   */
  runs?: readonly TextRun[]
  /** A part a line, each cut at its own end. */
  stacked?: boolean
  /** The start never cut, the end beside it or under it. */
  whole?: boolean
}>()

/** What gives way: the name before its end, or null where the name has no end to keep. */
const start = computed(() =>
  props.end && props.name.length > props.end.length && props.name.endsWith(props.end)
    ? props.name.slice(0, -props.end.length)
    : null,
)

/** The runs of the part that gives way and of the end, where the name has runs and an end. */
const parts = computed(() =>
  props.runs && start.value !== null ? cutRuns(props.runs, start.value.length) : null,
)
</script>

<template>
  <span
    v-if="start !== null"
    class="pair-name"
    :class="{ 'pair-stacked': stacked, 'pair-whole': whole }"
    ><template v-if="parts"
      ><span
        v-text-runs="parts[0]"
        class="pair-start one-line" /><span
        v-text-runs="parts[1]"
        class="pair-end one-line" /></template
    ><template v-else
      ><span class="pair-start one-line">{{ start }}</span
      ><span class="pair-end one-line">{{ end }}</span></template
    ></span
  >
  <span
    v-else-if="runs"
    v-text-runs="runs"
  />
  <template v-else>{{ name }}</template>
</template>

<style scoped>
/* As wide as the line at most, so its parts give way inside it rather than past its end. A line
   decoration does not reach into a box of its own, so it takes the host's: the underline of a
   name that opens something stays under both parts. */
.pair-name {
  display: inline-flex;
  vertical-align: top;
  max-inline-size: 100%;
  text-decoration: inherit;
}

.pair-start {
  flex: 0 1 auto;
}

/* Whole while the line can hold it beside the first part's ellipsis; its leading space is kept,
   which a line would drop at the start of a box of its own. */
.pair-end {
  flex: none;
  max-inline-size: calc(100% - 1em);
  white-space: pre;
}

/* The start whole on its line; the end takes what the line leaves, down to a few words, and
   the next line where it leaves fewer. */
.pair-whole {
  display: flex;
  flex-wrap: wrap;

  & .pair-start {
    flex: none;
    overflow: visible;
    text-overflow: clip;
  }

  & .pair-end {
    flex: 1 1 0;
    min-inline-size: min(100%, 6em);
    max-inline-size: 100%;
  }
}

/* A part a line, the whole width each; the end's leading space falls at its line's start and
   collapses there. */
.pair-stacked {
  display: flex;
  flex-direction: column;

  & .pair-end {
    max-inline-size: 100%;
    white-space: nowrap;
  }
}
</style>
