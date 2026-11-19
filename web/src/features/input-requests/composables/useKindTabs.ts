import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { KIND_ORDER } from '@/features/input-requests/utils/questionKinds.ts'
import type {
  QuestionKind,
  QuestionRecord,
} from '@/features/input-requests/utils/questionRecord.ts'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'

type Tab = 'all' | QuestionKind

/**
 * The tabs of kinds over the list of questions: «All» and one per kind the list holds in place,
 * each with how many of its questions wait, in the order of the kinds.
 *
 * A kind with no question in place has no tab. One that empties while it is open, its last
 * question answered and put aside, gives way to «All», which stays chosen when the kind comes
 * back. A list of one kind offers no tabs at all: «All» would be that kind again.
 */
export function useKindTabs(
  records: () => readonly QuestionRecord[],
  waiting: () => ReadonlySet<string>,
) {
  const { t } = useI18n()
  const chosen = ref<string>('all')
  const kinds = computed(() =>
    KIND_ORDER.filter((kind) => records().some((record) => record.kind === kind)),
  )
  const offered = computed(() => kinds.value.length > 1)
  /** The tab shown: the one chosen while its kind holds a question beside another, else «All». */
  const tab = computed<Tab>(() =>
    offered.value && kinds.value.includes(chosen.value as QuestionKind)
      ? (chosen.value as QuestionKind)
      : 'all',
  )
  watch(tab, (shown) => {
    chosen.value = shown
  })
  const waits = (kind: Tab) =>
    records().filter(
      (record) =>
        (kind === 'all' || record.kind === kind) && waiting().has(requestIdentity(record.entry)),
    ).length
  const options = computed(() =>
    (['all', ...kinds.value] as Tab[]).map((value) => ({
      value,
      label: t('requests.kinds.tab', { kind: t(`requests.kinds.${value}`), n: waits(value) }),
    })),
  )
  /** Whether a question of this kind stands in the tab shown. */
  const shows = (kind: QuestionKind) => tab.value === 'all' || tab.value === kind
  return { chosen, offered, options, shows, tab }
}
