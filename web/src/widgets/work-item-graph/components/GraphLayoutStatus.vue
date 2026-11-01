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
 * A failure is news either way and is said at once.
 */
import { onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { LAZY_VIEW_LOADING_DELAY_MS } from '@/shared/ui/lazyView.ts'
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

const noticed = shallowRef(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.pending,
  (pending) => {
    clearTimeout(timer)
    noticed.value = false
    if (!pending) return
    timer = setTimeout(
      () => {
        noticed.value = true
      },
      props.drawn ? RELAYOUT_NOTICE_DELAY_MS : LAZY_VIEW_LOADING_DELAY_MS,
    )
  },
  { immediate: true },
)
onScopeDispose(() => clearTimeout(timer))
</script>

<template>
  <div
    v-if="failed"
    class="graph-layout-status"
    role="alert"
  >
    <span class="graph-layout-status-text">{{ t('graph.layoutFailed') }}</span>
    <VButton
      size="inline"
      @click="emit('retry')"
      >{{ t('graph.retry') }}</VButton
    >
  </div>
  <p
    v-else-if="pending && noticed"
    class="graph-layout-status"
    role="status"
  >
    <span class="graph-layout-status-text">{{ t('graph.layoutLoading') }}</span>
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

.graph-layout-status-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
