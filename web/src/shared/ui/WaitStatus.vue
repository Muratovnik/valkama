<script setup lang="ts">
/**
 * The status region a view keeps for its waits: what a screen reader hears of them, and
 * nothing the eye sees.
 *
 * It stands, empty, for as long as the view does, so a wait's word written into it is
 * announced: a region drawn together with its words is not reliably announced. The word
 * is the panel's, `platform.states.loading`, written only while `loadingPresence` says the
 * wait is shown, so a read that answers inside the delay is never heard, and the region
 * empties again with the mark. A refresh in flight over what is drawn says «Refreshing…»
 * here and nowhere on screen.
 *
 * One per view or scene, never one per block inside it: a block's own wait inside a view
 * keeps its busy mark and its visible word, and says nothing here.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    /** The wait is shown (`useLoadingPresence().shown`). */
    shown: boolean
    /** A refresh over what is drawn is under way; said only while no wait is shown. */
    refreshing?: boolean
  }>(),
  { refreshing: false },
)
const { t } = useI18n()

const said = computed(() => {
  if (props.shown) return t('platform.states.loading')
  return props.refreshing ? t('platform.states.refreshing') : ''
})
</script>

<template>
  <span
    class="visually-hidden"
    role="status"
    >{{ said }}</span
  >
</template>
