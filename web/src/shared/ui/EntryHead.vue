<script setup lang="ts">
/**
 * The head of an entry of a discussion: what it says about itself, usually who wrote it and
 * when, and at the end of the line what can be done to it. That row used to stand under the
 * text of every entry.
 *
 * The words share no box with the icons, so however long a name runs it wraps inside its own
 * column, and the icons stand on its first line (`LineEnd`). A short head, whose first line is
 * the whole of its words, centres on the icons; a long one starts with its first line on their
 * middle and goes on below them. Its words are a detail line, which is the line they end.
 *
 * Where a finger is the pointer, or the screen is as narrow as a phone's, an icon is a 44px
 * target and no longer 28px. It is drawn bare, so the difference is room around the glyph, and
 * `VButton` reads the size from this token. A head with nothing to do keeps the height of its
 * words.
 */
import LineEnd from '@/shared/ui/LineEnd.vue'
</script>

<template>
  <div class="entry-head">
    <div class="entry-words"><slot /></div>
    <LineEnd class="entry-actions"><slot name="actions" /></LineEnd>
  </div>
</template>

<style scoped>
.entry-head {
  display: flex;
  gap: var(--space-2);
  align-items: first baseline;
  min-width: 0;
  font: var(--font-detail);

  @media (pointer: coarse), (width <= 620px) {
    --size-control-inline: var(--size-control-target);
  }
}

.entry-words {
  display: grid;
  flex: 1 1 0;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
}

.entry-actions:empty {
  display: none;
}
</style>
