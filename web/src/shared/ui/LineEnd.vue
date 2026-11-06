<script setup lang="ts">
/**
 * What ends a line of words: an icon, or a few, standing on that line, and on its first line
 * once the words wrap, whatever the height of their targets.
 *
 * It lends what it holds the baseline of the line it ends: an unseen space in the font it is
 * given, centred where its targets are. A row that aligns its items by `first baseline` then
 * meets the middle of the targets with the first line of the words. A target taller than the
 * line moves the words down by half the difference instead of standing half a line under their
 * start, and a shorter one moves itself; a row of one line is centred on its icons, as it was.
 * Aligned to the block, an icon stood up to 14px under the first line of three; started at the
 * top in a target taller than the line, up to 14px under a line of one.
 *
 * The font is the one it inherits: a host whose own font is not that of the line sets it here.
 */
</script>

<template>
  <span class="line-end"><slot /></span>
</template>

<style scoped>
.line-end {
  display: flex;
  flex: none;
  gap: var(--space-1);
  align-items: center;

  /* The baseline lent: first in the box, so the box's baseline is its, and taking no room. */
  &::before {
    content: '\a0';
    inline-size: 0;
    margin-inline-end: calc(-1 * var(--space-1));
  }
}
</style>
