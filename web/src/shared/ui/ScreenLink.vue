<script setup lang="ts">
/**
 * A way to another screen, as the product draws one: the words in the accent ink, a chevron after
 * them, an underline under the pointer. It is a real link, so it opens in a new tab and its target
 * reads in the status bar like any other address.
 */
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ href: string }>()
</script>

<template>
  <a
    class="screen-link"
    :href="href"
    ><slot /><VIcon
      name="chevron-right"
      :size="15"
  /></a>
</template>

<style scoped>
.screen-link {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  color: var(--color-accent);
  font-size: var(--font-size-dense);
  font-weight: 600;
  text-underline-offset: 0.2em;

  &:hover {
    text-decoration: underline;
  }
}
</style>
