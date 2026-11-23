<script setup lang="ts">
/**
 * The line over the goals, the work outside goals, the flow and the estimates, which the page
 * shows while a store attached beside the main one holds work (the read's `attached_work`): the
 * numbers on top count that store too, and these sections count the main store's spaces alone.
 * It stands nearer the sections it speaks of than the numbers over it.
 *
 * The line carries `data-volumes-note="own-store"`.
 */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <p
    class="volumes-own-store"
    data-volumes-note="own-store"
  >
    {{ t('volumes.ownStore') }}
  </p>
</template>

<style scoped>
/* The sections' room over it, a smaller one under it. */
.volumes-own-store {
  margin: 0 0 calc(var(--space-3) - var(--space-6));
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}
</style>
