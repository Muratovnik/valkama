<script setup lang="ts">
/**
 * One value of a facet as a menu draws it: the glyph and the word `drawMarks` gives the
 * chosen value on the card, so the list under a button says each value the way the button
 * says the one chosen. In the list what a value means is the option's note, so the mark
 * brings no hover text of its own; on the button, `explained`, it says it on hover, as the
 * card's priority does.
 */
import { drawMarks } from '@/entities/work-item/components/drawMarks.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import type { FacetMark } from '@/entities/work-item/utils/facets.ts'

const props = withDefaults(defineProps<{ mark: FacetMark; explained?: boolean }>(), {
  explained: false,
})

const words = useMarkWords()

const draw = () =>
  drawMarks([props.explained ? props.mark : { ...props.mark, hint: undefined }], {
    surface: 'card',
    words,
    solo: true,
  })
</script>

<template>
  <component :is="draw()" />
</template>
