<script setup lang="ts">
import { iconGlyph } from '@/shared/ui/iconGlyph.ts'

const props = withDefaults(
  defineProps<{
    /** Manifest-owned icon key. Unknown keys intentionally get one generic glyph. */
    name: string
    size?: number
    strokeWidth?: number
  }>(),
  { size: 20, strokeWidth: 1.8 },
)
</script>

<template>
  <component
    :is="iconGlyph(props.name, { size: props.size, strokeWidth: props.strokeWidth })"
    class="v-icon"
  />
</template>

<style scoped>
/* An icon is the size it is drawn at, wherever it stands. In a row short of room a flex item
   gives way, and the page's `svg { max-width: 100% }` lets a drawing go narrower than its box,
   so a glyph beside a long label was squeezed — beside «Перейти к задаче» in the narrowest
   navigation the search glyph was 13px wide of its 20 — and every row that minded wrote its own
   `flex: none`. The rule is here once, so a row cannot forget it. Its size is `size`, never a
   width a consumer's rule writes over it. The facet marks draw their glyph without this component and
   keep it whole in their own box (`facetMarks.css`). */
.v-icon {
  flex: none;
  max-inline-size: none;
}
</style>
