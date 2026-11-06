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
 * `after` is a short state of the entry, «пока без ответа», said after the time, a dot between.
 * It comes after the time, so the time stands where it stands without it. It stays beside the
 * time only where the name keeps the lines it has without it; otherwise it starts a line of its
 * own, with no dot. Flex breaks a line by the name's 14ch basis, not by its words, so left to
 * the line it kept the time's line and squeezed a long name onto one more line. No CSS asks
 * how many lines a name takes, so the line tries both places and keeps the one that costs the
 * name nothing, again whenever it is drawn anew and whenever its width changes. Drawn anew
 * covers the name, which arrives through the slot and no prop names: a name renamed shorter on
 * a read left the line's box as it was, and the mark stayed on a line of its own beside room
 * the date had for it.
 */
import { onMounted, onUpdated, ref, useTemplateRef } from 'vue'

import { useResizeObserver } from '@vueuse/core'

const props = defineProps<{ when: string; after?: string }>()

const line = useTemplateRef<HTMLElement>('line')
/** The state starts a line of its own rather than follow the time. */
const ownLine = ref(false)

/** Lay the state out beside the time and on its own line, read the name each way, and choose. */
function place() {
  const box = line.value
  const who = box?.querySelector('.meta-who')
  const time = box?.querySelector('.meta-when')
  const mark = box?.querySelector('.meta-after')
  if (!who || !time || !mark) return
  mark.classList.remove('own-line')
  const beside = who.getBoundingClientRect().height
  const withTime = Math.abs(mark.getBoundingClientRect().top - time.getBoundingClientRect().top) < 1
  mark.classList.add('own-line')
  const alone = who.getBoundingClientRect().height
  const own = !withTime || beside > alone + 0.5
  mark.classList.toggle('own-line', own)
  ownLine.value = own
}

onMounted(() => {
  if (!props.after) return
  place()
  // Placed again once the fonts are in, where the document loads them: a test's may not.
  if ('fonts' in document) void document.fonts.ready.then(place)
})
// After every render: a new time, a new state or a new name. Placing sets `ownLine`, which
// renders once more and places the same way again, so it settles there.
onUpdated(place)
// Placed in the next frame: changing the line inside the observer's own callback would size it
// again in the same frame, which the observer reports as a loop.
useResizeObserver(
  () => (props.after ? line.value : null),
  () => requestAnimationFrame(place),
)
</script>

<template>
  <div
    ref="line"
    class="meta-line"
    :class="{ 'has-after': after }"
  >
    <span class="meta-who"><slot /></span>
    <span class="meta-when">{{ when }}</span>
    <span
      v-if="after"
      class="meta-after"
      :class="{ 'own-line': ownLine }"
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

/* Beside the time it takes back the line's gap and stands a text separator's width after it,
   0.85em, the advance of " · " in the interface font, its dot centred in that room: it reads
   «12:31 · пока без ответа» as the card's other " · " read, where the line's 8px gap read tighter.
   On a line of its own the room and its dot stand before the line, clipped.
   It never moves by a transition: the line reads each place in the task that tries it, and
   the reduced-motion rule gives every property one, which kept the margin of the place just
   left for that read; a line at the edge of fitting then chose the other place every frame. */
.meta-after {
  --separator: 0.85em;

  flex: none;
  margin-inline-start: calc(-1 * var(--space-2));
  white-space: nowrap;
  transition-property: none;

  &::before {
    content: '·' / '';
    display: inline-block;
    width: var(--separator);
    text-align: center;
  }

  &.own-line {
    flex-basis: 100%;
    margin-inline-start: calc(-1 * var(--separator));
  }
}
</style>
