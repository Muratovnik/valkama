/**
 * The way a card's sections open an attached commit over the card. The card's reference
 * scope shows the commit and provides this; a section that lists commits asks it. Outside a
 * card nothing opens.
 */
import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

import type { AttachedCommit } from '@/widgets/work-item-inspector/utils/commitWords.ts'

type PeekCommit = (commit: AttachedCommit) => void

const PEEK: InjectionKey<PeekCommit> = Symbol('commit-peek')

export function provideCommitPeek(peek: PeekCommit): void {
  provide(PEEK, peek)
}

export function useCommitPeek(): PeekCommit {
  return inject(PEEK, () => {})
}
