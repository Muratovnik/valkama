<script setup lang="ts">
/**
 * One value of a facet as a menu draws it: the glyph and the word `drawMarks` gives the
 * chosen value on the card, so the list under a button says each value the way the button
 * says the one chosen.
 */
import { drawMarks } from '@/entities/work-item/components/drawMarks.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import type { FacetMark } from '@/entities/work-item/utils/facets.ts'

const props = defineProps<{ mark: FacetMark }>()

const words = useMarkWords()

const draw = () =>
  drawMarks([props.mark], {
    surface: 'card',
    words,
    solo: true,
  })
</script>

<template>
  <component :is="draw()" />
</template>
