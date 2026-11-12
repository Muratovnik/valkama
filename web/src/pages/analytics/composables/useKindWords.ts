/**
 * The words of the tokens by kind: a kind's name — the one the table of a dimension heads its
 * column with, or, for a kind the tokens figure leaves out, a name that says so — and a count of
 * tokens as the page writes one, or the words for a kind no request reported.
 */
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { KindLine } from '@/pages/analytics/utils/tokenKinds.ts'

export function useKindWords() {
  const { t } = useI18n()
  const words = useSpendingWords()

  /** A kind by its name, «not counted» said in the name of one the tokens figure leaves out. */
  const name = (line: Pick<KindLine, 'counted' | 'kind'>) =>
    line.counted
      ? t(`analytics.panel.table.kinds.${line.kind}`)
      : t(`analytics.kinds.apart.${line.kind}`)

  /** So many tokens, compact as the summary writes them; words for none reported. */
  const count = (tokens: number | null) =>
    tokens === null ? t('analytics.days.absent.tokens') : words.scale('tokens', tokens)

  return { count, name }
}
