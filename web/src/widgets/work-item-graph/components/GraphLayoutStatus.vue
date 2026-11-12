<script setup lang="ts">
/**
 * What the layout worker is doing, said in the field's upper strip.
 *
 * The strip is held one line tall whether or not anything stands in it, so
 * nothing said here moves the field. It used to be a paragraph above the
 * field, and the worker lays the graph out again on every refresh, so every
 * refresh pushed the drawing down by a line and pulled it back when the new
 * layout landed — about 43px, several times a minute on a live space.
 *
 * Work in the background shows nothing at first. Over a drawing the new layout
 * usually lands within a few hundred milliseconds, and a word that lives that
 * long is a flicker; only a layout that is still running after
 * `RELAYOUT_NOTICE_DELAY_MS` says so. With nothing drawn yet there is nothing
 * to keep, and the word comes after the shorter delay every first load takes.
 * Once said, the word stays as long as any wait's does (`loadingPresence`), so a
 * layout that lands just after it does not flash it. A failure is news either way
 * and is said at once.
 *
 * The status line stands, empty, whenever nothing failed, and the word is written
 * into it when it is said: a status region drawn together with its words is not
 * reliably announced.
 */
import { useI18n } from 'vue-i18n'

import { LOADING_DELAY_MS, useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** Whether a drawing is on the field, which a background layout must leave alone. */
  drawn: boolean
  failed: boolean
  pending: boolean
}>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()

/**
 * How long a layout over an existing drawing runs before the strip says so.
 *
 * A space of a few hundred items, or a chain of as many members, lays out
 * again in 260-370ms, so 600ms stays silent for every ordinary refresh and
 * still speaks well before the one-second mark, past which a person stops
 * reading a pause as the system working.
 */
const RELAYOUT_NOTICE_DELAY_MS = 600

const { shown: noticed } = useLoadingPresence(() => props.pending, {
  delay: () => (props.drawn ? RELAYOUT_NOTICE_DELAY_MS : LOADING_DELAY_MS),
})
</script>

<template>
  <div
    v-if="failed"
    class="graph-layout-status"
    role="alert"
  >
    <span
      v-tooltip.clipped="t('graph.layoutFailed')"
      class="graph-layout-status-text one-line"
      >{{ t('graph.layoutFailed') }}</span
    >
    <VButton
      size="inline"
      @click="emit('retry')"
      >{{ t('graph.retry') }}</VButton
    >
  </div>
  <p
    v-else
    class="graph-layout-status"
    role="status"
  >
    <span
      v-if="noticed"
      v-tooltip.clipped="t('graph.layoutLoading')"
      class="graph-layout-status-text one-line"
      >{{ t('graph.layoutLoading') }}</span
    >
  </p>
</template>

<style scoped>
/* One line of the strip and no taller: an inline button is a few pixels higher
   than the strip's line and rides into its padding rather than growing it. */
.graph-layout-status {
  display: flex;
  flex: 0 1 auto;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  height: 24px;
  margin: 0 auto 0 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}
</style>
