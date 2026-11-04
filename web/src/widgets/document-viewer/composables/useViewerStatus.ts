/**
 * The viewer's one status line: what a press here said, for a while; else whether the text
 * shown is still the file's; else an anchor the text does not have.
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useTimeoutFn } from '@vueuse/core'

import type { DocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

/** How long what a press said stays, before the line goes back to what stands. */
const SAID_FOR_MS = 5000

export function useViewerStatus(view: DocumentView) {
  const { t, d } = useI18n()
  const { staleness } = view
  const said = ref('')
  const anchorMissing = ref('')
  const quiet = useTimeoutFn(
    () => {
      said.value = ''
    },
    SAID_FOR_MS,
    { immediate: false },
  )

  /** Emptied first, so that the same words said twice are announced twice. */
  async function say(message: string) {
    said.value = ''
    await nextTick()
    said.value = message
    quiet.start()
  }

  const staleWords = computed(() => {
    const stale = staleness.value
    if (!stale) return ''
    if (stale.kind === 'changed') {
      const at = new Date(stale.at)
      const time = Number.isNaN(at.valueOf()) ? stale.at : d(at, 'clock')
      return t('documentLinks.viewer.changed', { time })
    }
    return stale.kind === 'deleted'
      ? t('documentLinks.viewer.deleted')
      : t('documentLinks.viewer.rereadFailed')
  })
  const status = computed(() => said.value || staleWords.value || anchorMissing.value)

  return {
    anchorMissing,
    said,
    say,
    status,
    isQuiet: computed(() => status.value === ''),
    /** A text that may no longer be the file's is a warning; anything else is a report. */
    warns: computed(
      () => !said.value && staleWords.value !== '' && staleness.value?.kind !== 'changed',
    ),
  }
}
