<script setup lang="ts">
/**
 * The window of one Markdown document, at the address `/doc?project=…&path=…#anchor`.
 *
 * The address and the document stay one: it opens what the address names, and a link
 * followed inside writes the address over, so a reload stands where the reader stood.
 *
 * Paths and documents work here as in the viewer. A work item or a session has no card
 * to open in this window, so this layer answers for every reference above the viewer's
 * own and leaves them as the text they were.
 */
import { watch } from 'vue'

import { router } from '@/app/router.ts'

import DocumentViewer from '@/widgets/document-viewer/components/DocumentViewer.vue'
import { useDocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import { documentPageHref } from '@/shared/api/documentPage.ts'
import type { DocumentPageAddress } from '@/shared/api/documentPage.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

const props = defineProps<{ address: DocumentPageAddress }>()

provideReferenceLinks(() => null)

const view = useDocumentView()
const { go, open, place } = view
const hrefOf = (shown: DocumentPageAddress | null) => (shown ? documentPageHref(shown) : '')

watch(
  () => props.address,
  (address) => {
    if (hrefOf(address) === hrefOf(place.value)) return
    if (place.value) go(address)
    else open(address)
  },
  { immediate: true },
)

watch(place, (shown) => {
  if (shown && hrefOf(shown) !== hrefOf(props.address)) void router.replace(hrefOf(shown))
})
</script>

<template>
  <main class="document-page">
    <DocumentViewer
      :view="view"
      page
    />
  </main>
</template>

<style scoped>
/* The text's measure as one length. A `ch` counts in the font of the element that spends
   it, and the head, the status line and the text each have a font of their own; a
   registered length is computed once, here, in the font the text inherits. */
@property --document-measure {
  syntax: '<length>';
  inherits: true;
  initial-value: 0;
}

/* The whole window, on the ground a drawer has, so that a text looks the same in both. It
   is the container a drawer would be, so the viewer's own width rules hold here too. */
.document-page {
  /* One column down a wide window, as wide as a line of the text: the head and the status
     line start and end where the text does. A column of 56rem with the text kept to its
     start left the head's actions 300 px past the end of every line. */
  --document-measure: 58ch;
  --document-inset: max(var(--space-6), calc((100% - var(--document-measure)) / 2));
  --document-refusal-width: var(--document-measure);

  /* The column a table or a block of code may widen into, both ways from the text: the
     one the whole page used to be, and never wider than the window. */
  --document-column-inset: max(var(--space-6), calc((100% - 56rem) / 2));
  --document-scrollbar-gutter: stable both-edges;

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
  container: overlay / inline-size;
}
</style>
