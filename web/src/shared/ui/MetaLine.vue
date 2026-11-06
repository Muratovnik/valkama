<script setup lang="ts">
/**
 * Who wrote an entry and when: the name at the start, the time at the end.
 *
 * The time keeps the end of the name's first line while the name has at least 14ch beside it,
 * or the whole of its own width when that is less; with less room the time takes a line of its
 * own under the name, starting where the name starts, and the name the whole width. 14ch holds
 * a word of an agent's name such as "retrospective" whole. "changed · {time}" leaves a phone
 * about 10ch, and holding the time on the first line there stood an agent's name one word
 * fragment to a line, eight or ten lines of it.
 *
 * On a line of its own the time starts under the name. Held to the end it stood at the end of
 * the words' column, and in an entry's head that column ends where the icons begin: on a
 * phone, with the icons to reply and to mark beside it, the time stood in the middle of the
 * head under nothing. The two lines are one block, aligned as one.
 *
 * The name's basis is the minimum and its width stops at its own: the line breaks on the
 * basis, so a name shorter than 14ch still shares the line with a time beside it that fits,
 * and the room the name leaves goes before the time, so the time ends a line it shares.
 *
 * `after` is a short state of the entry, «ждёт ответа», said after the time, a dot between.
 * It comes last so that it is what moves to the next line when the line is full: written
 * after the name it counted as the name's width, and a short name with it took the time off
 * the first line. A line it starts has no dot: the dot stands in the room its margin takes
 * from the line, which the line clips.
 */
defineProps<{ when: string; after?: string }>()
</script>

<template>
  <div
    class="meta-line"
    :class="{ 'has-after': after }"
  >
    <span class="meta-who"><slot /></span>
    <span class="meta-when">{{ when }}</span>
    <span
      v-if="after"
      class="meta-after"
      >{{ after }}</span
    >
  </div>
</template>

<style scoped>
.meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  align-items: baseline;
  min-width: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);

  &.has-after {
    overflow: clip visible;
  }
}

.meta-who {
  flex: 1 1 14ch;
  min-width: 0;
  max-width: max-content;
  margin-inline-end: auto;
  overflow-wrap: anywhere;
}

.meta-when {
  flex: none;
  white-space: nowrap;
}

/* Its dot fills the line's gap before it, so after the time it reads as «12:31 · ждёт
   ответа», and at the start of a line it stands outside the line, clipped. */
.meta-after {
  position: relative;
  flex: none;
  padding-inline-start: var(--space-2);
  margin-inline-start: calc(-1 * var(--space-2));
  white-space: nowrap;

  &::before {
    content: '·' / '';
    position: absolute;
    inset-inline-start: 0;
    width: var(--space-2);
    text-align: center;
  }
}
</style>
