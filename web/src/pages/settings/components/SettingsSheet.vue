<script setup lang="ts">
/**
 * The ground a Settings tab's groups of rows stand on, one sheet per tab.
 *
 * The sheet is a list of wide rows: a field's or a switch's hint stands beside it inside its own
 * row, over the row's label, rather than under the control and over the row after it, or past
 * the sheet's edge, far from it.
 */
</script>

<template>
  <div
    class="settings-sheet"
    data-hint-list="wide-rows"
  >
    <slot />
  </div>
</template>

<style scoped>
.settings-sheet {
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);

  /* A forced palette clears the sheet; the rules between its groups stay, its edge goes. */
  @media (forced-colors: active) {
    border: 1px solid currentcolor;
  }
}
</style>
