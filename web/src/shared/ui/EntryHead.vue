<script setup lang="ts">
/**
 * The head of an entry of a discussion: what it says about itself, usually who wrote it and
 * when, and at the end of the line what can be done to it. That row used to stand under the
 * text of every entry.
 *
 * The words share no box with the icons, so however long a name runs it wraps inside its own
 * column and the icons hold the top of the row at the end, where a thumb finds them. A short
 * head centres on the icons; a long one starts at their top and goes on below them.
 *
 * Where a finger is the pointer, or the screen is as narrow as a phone's, an icon is a 44px
 * target and no longer 28px. It is drawn bare, so the difference is room around the glyph, and
 * `VButton` reads the size from this token. A head with nothing to do keeps the height of its
 * words.
 */
</script>

<template>
  <div class="entry-head">
    <div class="entry-words"><slot /></div>
    <div class="entry-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.entry-head {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  min-width: 0;

  @media (pointer: coarse), (width <= 620px) {
    --size-control-inline: var(--size-control-target);
  }
}

.entry-words {
  display: grid;
  flex: 1 1 0;
  grid-template-columns: minmax(0, 1fr);
  align-content: center;
  min-width: 0;
  min-block-size: var(--size-control-inline);
}

.entry-actions {
  display: flex;
  flex: none;
  gap: var(--space-1);

  &:empty {
    display: none;
  }
}

.entry-head:has(> .entry-actions:empty) > .entry-words {
  min-block-size: 0;
}
</style>
