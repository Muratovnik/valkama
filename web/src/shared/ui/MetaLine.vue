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
 * The session an agent wrote from follows its name as every surface prints a session: its
 * start (`sessionStart`), one token in the metadata font, with the whole id in its tooltip.
 * Where the server knows the session the start is the link to it that the id is in prose
 * (`RichInlines`), so a finger reaches the whole id too. The whole id is 36 characters, about
 * 274px in that font, wider than a head's column on a phone, where it broke inside itself on
 * two lines of its own; the start fits on the name's line from 320px. It is one of the name's
 * words for the state below.
 *
 * `after` is a short state of the entry, «пока без ответа», said after the time, a dot between.
 * It comes after the time, so the time stands where it stands without it. It stays beside the
 * time only where the name keeps the lines it has without it; otherwise it starts a line of its
 * own, with no dot. Flex breaks a line by the name's 14ch basis, not by its words, so left to
 * the line it kept the time's line and squeezed a long name onto one more line. No CSS asks
 * how many lines a name takes, so the line tries both places and keeps the one that costs the
 * name nothing, again whenever what the line says changes, whenever its width changes and when
 * a font face comes in. What it says includes the name, which arrives through the slot and no prop
 * names: a name renamed shorter on a read left the line's box as it was, and the mark stayed on
 * a line of its own beside room the date had for it. Only what it says: a reply's line renders
 * again with each key typed in its thread's draft, and placing it on every render laid the
 * drawer out twice per mark per key, 60 ms a key on a thread of 200 replies.
 */
import { computed, onMounted, onUpdated, ref, useTemplateRef } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import { sessionStart } from '@/shared/lib/actor.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'

const props = defineProps<{ when: string; after?: string; session?: string }>()

/** The space between the name and its session: a space in the template is dropped there. */
const apart = computed(() => (props.session ? ' ' : ''))
const start = computed(() => sessionStart(props.session ?? ''))
/** The start as a reference of its own, which the layers above answer for as the whole id. */
const drawn = computed((): RichInline[] => [
  { kind: 'reference', reference: { kind: 'session', value: start.value }, code: false },
])
provideReferenceLinks((reference, parent) => {
  const whole = props.session
  if (!whole || reference.kind !== 'session' || reference.value !== start.value)
    return parent(reference)
  const link = parent({ kind: 'session', value: whole })
  return link && { ...link, title: `${link.title}\n${whole}` }
})

const line = useTemplateRef<HTMLElement>('line')
/** The state starts a line of its own rather than follow the time. */
const ownLine = ref(false)

/** What the line said when it was last placed; empty while it has no state to place. */
let placedFor = ''

/** The time, the state and the name's words: `textContent` reads no layout. */
function saying() {
  const name = line.value?.querySelector('.meta-who')?.textContent
  return JSON.stringify([props.when, props.after, name])
}

/** Lay the state out beside the time and on its own line, read the name each way, and choose. */
function place() {
  const box = line.value
  const who = box?.querySelector('.meta-who')
  const time = box?.querySelector('.meta-when')
  const mark = box?.querySelector('.meta-after')
  placedFor = ''
  if (!who || !time || !mark) return
  placedFor = saying()
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
  if (props.after) place()
})
// After a render that changed what the line says: a new time (another language, a date shown
// another way), a new state or a new name. The render that placing causes through `ownLine`
// says the same, and so does a parent's render that changed nothing here. A mark that goes away
// forgets where it stood, so the same words coming back are placed in that render, not a frame
// later with the place they had before the width changed.
onUpdated(() => {
  if (!props.after) placedFor = ''
  else if (saying() !== placedFor) place()
})
// Placed in the next frame: changing the line inside the observer's own callback would size it
// again in the same frame, which the observer reports as a loop.
useResizeObserver(
  () => (props.after ? line.value : null),
  () => requestAnimationFrame(place),
)
// Placed again when a face comes in, where the document loads them (a test's may not): one
// swapped in changes the words' widths, and the line's box need not change its size. A face
// can come in long after the line was placed, as Cyrillic's does for a name renamed into it.
useEventListener(
  () => (props.after && 'fonts' in document ? document.fonts : null),
  'loadingdone',
  () => place(),
)
</script>

<template>
  <div
    ref="line"
    class="meta-line"
    :class="{ 'has-after': after }"
  >
    <span class="meta-who"
      ><slot />{{ apart
      }}<span
        v-if="session"
        class="meta-session"
        :title="session"
        ><RichInlines :nodes="drawn" /></span
    ></span>
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

.meta-session {
  font-family: var(--font-family-mono);
  white-space: nowrap;
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
