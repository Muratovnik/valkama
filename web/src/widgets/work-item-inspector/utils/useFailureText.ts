import { useI18n } from 'vue-i18n'

import { failureMessage } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'

/** A failure in the reader's words, or in the caller's where the catalog has none of its own. */
export function useFailureText() {
  const { t } = useI18n()
  return (failure: TypedFailure, fallbackKey?: string): string => {
    const message = failureMessage(failure)
    return message.key === 'platform.failures.unknown' && fallbackKey !== undefined
      ? t(fallbackKey)
      : t(message.key, message.params ?? {})
  }
}
