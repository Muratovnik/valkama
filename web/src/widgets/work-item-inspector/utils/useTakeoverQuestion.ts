import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { holderName } from '@/shared/lib/actor.ts'

/**
 * The takeover, asked once before the override is sent, wherever its button was pressed.
 *
 * A question about a holder is over when the holder has changed: there is no longer
 * anybody to take it from.
 */
export function useTakeoverQuestion(holder: () => string, takeOver: () => void) {
  const { t } = useI18n()
  const asked = ref(false)
  const keep = () => {
    asked.value = false
  }
  watch(holder, keep)

  return {
    ask: () => {
      asked.value = true
    },
    confirm: () => {
      keep()
      takeOver()
    },
    keep,
    question: computed(() =>
      asked.value ? t('workItem.takeOverQuestion', { holder: holderName(holder()) }) : '',
    ),
  }
}
