<script setup lang="ts">
/**
 * The line of a thread's mark: «Resolved · you · 13 Aug, 14:00 · Moved to MAIN-14».
 *
 * Each fact is one piece of the line, a dot before it, and a piece that does not fit beside the
 * one before goes whole to the next line, which starts without a dot: the dot stands in the
 * room each piece's start takes from the one before, and the line clips it at its own start.
 * One run of text broke where its line ran out: «Разобрано · вы ·» over the date at 320, a dot
 * ending the line, and the decision's first word beside the date. A piece wider than the whole
 * line, a long name or the decision, wraps inside itself, so none of its words is cut.
 *
 * The pieces stand in the line's text, so the line reads, copies and names its thread as it is
 * written, « · » between the facts: laid out as boxes of their own, they read a line each.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { unbroken } from '@/shared/lib/unbroken.ts'

type Mark = NonNullable<WorkItem['comments'][number]['resolution']>

const props = defineProps<{ mark: Mark; when: (value: string | null) => string }>()
const { t } = useI18n()

const facts = computed(() => {
  const { by, by_person: person, at, text } = props.mark
  const who = person === true ? t('threads.you') : actorName(by)
  const said = [t('threads.resolved'), who, unbroken(props.when(at))]
  return text ? [...said, text] : said
})
</script>

<template>
  <p class="thread-mark">
    <span
      v-for="(fact, index) in facts"
      :key="index"
      class="thread-mark-fact"
      ><span
        v-if="index"
        class="thread-mark-dot"
      >
        · </span
      >{{ fact }}</span
    >
  </p>
</template>

<style scoped>
.thread-mark {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow: clip;
}

/* The room a dot takes is the advance of " · " in the interface font, 0.85em, so the line reads
   as the one run of text it was. The words of a piece are as wide as the line at most, and wrap
   inside it only there. */
.thread-mark-fact {
  --separator: 0.85em;

  display: inline-block;
  vertical-align: top;
  max-inline-size: calc(100% + var(--separator));
  padding-inline-start: calc(var(--separator));
  margin-inline: calc(-1 * var(--separator)) calc(var(--separator));
  overflow-wrap: anywhere;
}

/* Its spaces are kept, so the text reads « · » between the facts, as it is drawn. */
.thread-mark-dot {
  display: inline-block;
  inline-size: calc(var(--separator));
  margin-inline-start: calc(-1 * var(--separator));
  text-align: center;
  white-space: pre;
}
</style>
