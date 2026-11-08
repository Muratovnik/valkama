<script setup lang="ts">
/**
 * The session an agent wrote from, as every surface prints a session beside a name: its start
 * (`sessionStart`), one token in the metadata font, with the whole id in its tooltip. Where the
 * server knows the session the start is the link to it that the id is in prose (`RichInlines`),
 * so a finger reaches the whole id too. The whole id is 36 characters, about 274px in that
 * font, wider than a head's column on a phone, where it broke inside itself on two lines of
 * its own; the start keeps to one line there.
 *
 * Its link reaches no lower than its words, and its ring stands 1px off them: under a start the
 * time of an entry can take the next line, and the ring round the usual reach crossed the tops of
 * its digits by 2px at 320–430px. Round the words the ring of any link, 2px off them, still
 * crossed them by 0.1px; 1px off them it clears them by 0.9px, and on the words with no gap it
 * read as their underline.
 */
import { computed } from 'vue'

import { sessionStart } from '@/shared/lib/actor.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

/** The whole id of the session. */
const props = defineProps<{ session: string }>()

const start = computed(() => sessionStart(props.session))
/** The start as a reference of its own, which the layers above answer for as the whole id. */
const drawn = computed((): RichInline[] => [
  { kind: 'reference', reference: { kind: 'session', value: start.value }, code: false },
])
provideReferenceLinks((reference, parent) => {
  if (reference.kind !== 'session' || reference.value !== start.value) return parent(reference)
  const link = parent({ kind: 'session', value: props.session })
  return link && { ...link, title: `${link.title}\n${props.session}` }
})
</script>

<template>
  <span
    v-tooltip="session"
    class="session-start"
    ><RichInlines :nodes="drawn"
  /></span>
</template>

<style scoped>
/* Set solid, so the line's own leading decides its height. At 13px the browser rounds the
   metadata font's ascent to 12px against the interface font's 13, and with the line's leading
   the id's box reached a pixel past the name's: a line holding it stood 17.9px, one without
   16.9px. Its letters keep the name's baseline. */
.session-start {
  --rich-reference-below: 0;
  --rich-reference-ring: var(--space-hair);

  font-family: var(--font-family-mono);
  line-height: var(--line-height-flat);
  white-space: nowrap;
}
</style>
