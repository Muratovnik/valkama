<script setup lang="ts">
/**
 * The line of a thread's mark: «Resolved · you · 13 Aug, 14:00 · Moved to MAIN-14».
 *
 * Each fact is one piece of the line, a dot between, and a piece that does not fit beside the
 * one before goes whole to the next line, which starts without a dot: the dot stands in the
 * room each piece's margin takes from the line, and the line clips it there. The decision is
 * words, and wraps by them on a line of its own where it does not fit. One run of text broke
 * where its line ran out: «Разобрано · вы ·» over the date at 320, a dot ending the line, and
 * the decision's first word beside the date.
 *
 * The line reads, and names its thread, as it is written: the dots a reader is told stand in
 * text of their own, unseen, so a screen reader and a copy keep them where the drawn ones go.
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
  const said = [t('threads.resolved'), who, unbroken(props.when(at))].map((words) => ({
    words,
    wraps: false,
  }))
  return text ? [...said, { words: text, wraps: true }] : said
})
</script>

<template>
  <p class="thread-mark">
    <span
      v-for="(fact, index) in facts"
      :key="index"
      class="thread-mark-fact"
      :class="{ 'is-words': fact.wraps }"
      ><span
        v-if="index"
        class="visually-hidden"
      >
        · </span
      >{{ fact.words }}</span
    >
  </p>
</template>

<style scoped>
.thread-mark {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow: clip;
}

/* The room a dot takes is the advance of " · " in the interface font, 0.85em, so the line reads
   as the one run of text it was. */
.thread-mark-fact {
  --separator: 0.85em;

  position: relative;
  min-width: 0;
  padding-inline-start: calc(var(--separator));
  margin-inline: calc(-1 * var(--separator)) calc(var(--separator));
  white-space: nowrap;

  &::before {
    content: '·' / '';
    position: absolute;
    inset-inline-start: 0;
    width: var(--separator);
    text-align: center;
  }

  &.is-words {
    overflow-wrap: anywhere;
    white-space: normal;
  }
}
</style>
