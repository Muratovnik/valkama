/**
 * `composedText` bound to the interface's language and the owner's naming of states: a
 * question's prompt and a decision's line as the reader sees them, redrawn when either changes.
 */
import { useI18n } from 'vue-i18n'

import type { PromptMessage, WhatMessage } from '@/shared/api/composedTextModel.ts'
import { promptShown, whatShown } from '@/shared/lib/composedText.ts'
import type { Say } from '@/shared/lib/composedText.ts'
import { standardState } from '@/shared/lib/stateNames.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'

export function useComposedText() {
  const { t } = useI18n()
  const stateName = useStateName()
  const say: Say = (key, values = {}, count) =>
    count === undefined ? t(key, values) : t(key, values, count)
  const state = (key: string) => stateName(standardState(key) ?? { key, name: key })
  return {
    prompt: (request: { prompt: string; prompt_message?: PromptMessage | null }) =>
      promptShown(request, say, state),
    what: (decision: { what: string; what_message?: WhatMessage | null }) =>
      whatShown(decision, say),
  }
}
