<script setup lang="ts">
/**
 * Free text an agent or a person wrote, drawn as the markdown it is.
 *
 * The one place a description, a comment, a report section, a question or an
 * attempt's result becomes something to read. Before it existed every one of
 * them was a `pre-wrap` paragraph, so a report arrived as a wall of plain text
 * full of paths, hashes and references nobody could follow.
 *
 * The parse is `richText.ts` and is where the trust boundary sits; this file
 * draws the tree it returns and passes references to the layers that know what
 * they are (`referenceLinks.ts`). `inline` keeps the text on its line, for a
 * label or a preview held to a line count by its host.
 *
 * The host sets the type on this component's root, as it would on the
 * paragraph this replaces.
 */
import { computed } from 'vue'

import { parseRichInline, parseRichText } from '@/shared/lib/richText.ts'
import RichBlocks from '@/shared/ui/RichBlocks.vue'
import RichInlines from '@/shared/ui/RichInlines.vue'

const props = withDefaults(defineProps<{ source: string; inline?: boolean }>(), { inline: false })

const blocks = computed(() => (props.inline ? [] : parseRichText(props.source)))
const nodes = computed(() => (props.inline ? parseRichInline(props.source) : []))
</script>

<template>
  <span
    v-if="inline"
    class="rich-text"
    ><RichInlines :nodes="nodes"
  /></span>
  <RichBlocks
    v-else
    class="rich-text"
    :blocks="blocks"
  />
</template>

<style scoped>
.rich-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
