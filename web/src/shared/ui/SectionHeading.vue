<script setup lang="ts">
/**
 * The heading over a section of content, and the only thing that decides its type.
 *
 * Fifteen files named a section heading and no two agreed: it existed at 13, 14,
 * 15, 16 and 18px, at weights 400, 500, 600 and 700, under nine different class
 * names. Naming the type as a token stopped the duplication but left every one of
 * those files still choosing, which is what a primitive is for — the answer moves
 * here and there is one of it.
 *
 * Two levels, because the surfaces are genuinely two: a page has room for the
 * section size, and a drawer 320px wide does not. Nothing else is a level. A
 * heading over a whole screen is the module name, which the context bar says
 * once; the name of a record is the overlay header's, and both already have an
 * owner.
 *
 * The root is the heading element itself and nothing more, so a host that pairs a
 * heading with a count keeps its own row: where the heading sits is layout, and
 * layout belongs to whoever is arranging it.
 */
withDefaults(
  defineProps<{
    /** Where this sits in the document outline, which the surface decides, not the type. */
    as?: 'h2' | 'h3' | 'h4'
    /** `page` for a section of a screen, `panel` inside a drawer or a dense panel. */
    level?: 'page' | 'panel'
  }>(),
  { level: 'page', as: 'h2' },
)
</script>

<template>
  <component
    :is="as"
    class="section-heading"
    :class="`level-${level}`"
  >
    <slot />
  </component>
</template>

<style scoped>
/* `base.css` already resets a heading's size and weight to inherit, so the margin
   is the only thing left to say besides the type. */
.section-heading {
  margin: 0;
}

.level-page {
  font: var(--font-section-title);
}

/* Type only, and no colour. A section heading is full text on one surface and
   muted on another — which of the three text tones it takes is a fact about the
   surface, so it stays with the surface, reached through the class the host puts
   on this component's root. */
.level-panel {
  font: var(--font-label);
}
</style>
