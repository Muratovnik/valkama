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
 * The size is the heading's rank, and the rank is its place in what the module
 * lays out: a section, or a group inside one. It used to be the surface — a drawer
 * set its sections a step smaller than a page — which put a card's section at the
 * size of a group and a group under it at the size of its section. Nothing over a
 * section is this component's: a heading over a whole screen is the module name,
 * which the context bar says once; the name of a record is the overlay header's.
 *
 * The root is the heading element itself and nothing more, so a host that pairs a
 * heading with a count keeps its own row. A `panel` heading reserves the same height
 * as an adjacent action, so adding an edit button does not change the distance
 * from the title to its content; that is all `level` says now.
 */
withDefaults(
  defineProps<{
    /** Where this sits in the document outline, which the surface decides, not the type. */
    as?: 'h2' | 'h3' | 'h4'
    /** `panel` where the heading shares its row with controls, `page` where it stands alone. */
    level?: 'page' | 'panel'
    /** The level it heads, which alone decides its size: `section`, or a `group` inside one. */
    rank?: 'section' | 'group'
  }>(),
  { level: 'page', as: 'h2', rank: 'section' },
)
</script>

<template>
  <component
    :is="as"
    class="section-heading"
    :class="[`level-${level}`, `rank-${rank}`]"
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

/* The type scale's two steps under the module name (DESIGN.md, System rules): a section
   at `section`, a group a step under it at `emphasis`. */
.rank-section {
  font: var(--font-section-title);
}

.rank-group {
  font: var(--font-panel-title);
}

/* A panel title shares its row with controls. Colour still belongs to the
   surface, reached through the class the host puts on this component's root. */
.level-panel {
  display: flex;
  align-items: center;
  min-height: var(--size-control-height);
}
</style>
