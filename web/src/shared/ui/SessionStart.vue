<script setup lang="ts">
/**
 * The session an agent wrote from, as every surface prints a session beside a name: its start
 * (`sessionStart`), one token in the metadata font, with the whole id in its tooltip. Where the
 * server knows the session the start is the link to it that the id is in prose (`RichInlines`),
 * so a finger reaches the whole id too. The whole id is 36 characters, about 274px in that
 * font, wider than a head's column on a phone, where it broke inside itself on two lines of
 * its own; the start keeps to one line there.
 */
import { computed } from 'vue'

import { sessionStart } from '@/shared/lib/actor.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'

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
    class="session-start"
    :title="session"
    ><RichInlines :nodes="drawn"
  /></span>
</template>

<style scoped>
/* Set solid, so the line's own leading decides its height. At 13px the browser rounds the
   metadata font's ascent to 12px against the interface font's 13, and with the line's leading
   the id's box reached a pixel past the name's: a line holding it stood 17.9px, one without
   16.9px. Its letters keep the name's baseline. */
.session-start {
  font-family: var(--font-family-mono);
  line-height: var(--line-height-flat);
  white-space: nowrap;
}
</style>
