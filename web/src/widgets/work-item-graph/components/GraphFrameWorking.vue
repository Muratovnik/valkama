<script setup lang="ts">
/**
 * The work moving under a frame, in the hue of work under way, after the state on
 * its first line, where folding does not move it: for a folded frame the one sign
 * of it. Zoomed out it is «● 2» at the band's far end, grown as the reference is.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CountBadge from '@/shared/ui/CountBadge.vue'

const { count, overview = false } = defineProps<{
  count: number
  overview?: boolean
  /** The field's motion does not run, so the dots hold still. */
  still?: boolean
}>()
const { t } = useI18n()

/** A frame's counts are its epic's whole size, which no badge's «99+» may round off. */
const WHOLE = Number.MAX_SAFE_INTEGER

const word = computed(() => {
  const name = t('graph.frame.working', count)
  return ` ${name}`
})
</script>

<template>
  <span
    class="graph-frame-count graph-frame-working"
    :class="{ overview }"
    ><span
      class="work-dots"
      aria-hidden="true"
      :class="{ still }"
      ><i /><i /><i /></span
    ><CountBadge
      placement="inline"
      :limit="WHOLE"
      :value="count"
    /><template v-if="!overview">{{ word }}</template></span
  >
</template>

<style scoped>
.graph-frame-working {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  margin-inline-start: var(--space-1);
  color: var(--color-info);
  white-space: nowrap;

  &.overview {
    align-items: flex-start;
    height: calc(1lh * var(--grow, 2.2));
    margin-inline-start: auto;
    font: var(--font-drawer-title);
    font-weight: 700;
    transform: scale(var(--grow, 2.2));
    transform-origin: right top;
  }
}
</style>
