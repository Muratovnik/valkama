import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { provideCommitPeek } from '@/widgets/work-item-inspector/utils/commitPeek.ts'
import { writtenCommit } from '@/widgets/work-item-inspector/utils/commitWords.ts'
import type { AttachedCommit } from '@/widgets/work-item-inspector/utils/commitWords.ts'

import { useDocumentLinks } from '@/entities/project-document/documentLinks.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { provideReferenceLinks, referenceSpaceKey } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'

type Ref = WorkItem['refs'][number]

/**
 * The card's layer of reference links, for everything its sections show.
 *
 * - Another item of the card's own space opens the way a related item does,
 *   through the card's departure: the draft guard asks first and Back returns
 *   here. Only its opening is the card's: what it shows on hover is the layer's
 *   above. The card's own reference is text; a link to where the reader already
 *   is says nothing.
 * - A commit hash is a link when it names one commit the card carries
 *   (`writtenCommit`): opening it shows that commit and what git says of it, the
 *   same as its row in «Связи», which opens it through `provideCommitPeek`.
 * - A memory id is a link when the card carries it as a ref, the one record
 *   Valkama holds of it: opening it shows who attached it, when, under what label.
 * - Anything the card does not carry is text.
 * - A path is taken from the root of the card's space, by the document layer.
 *   It is composed here because one component holds one layer.
 */
export function useInspectorReferenceLinks(options: {
  item: () => WorkItem | null
  openFrom: (reference: string) => void
  space: () => string | undefined
}) {
  const { t } = useI18n()
  /** The memory ref whose record is open over the card, if any. */
  const peeked = ref<Ref | null>(null)
  /** The attached commit open over the card, if any. */
  const commit = ref<AttachedCommit | null>(null)
  const documents = useDocumentLinks(() => {
    const space = options.space()
    return space ? { space } : {}
  })
  provideCommitPeek((chosen) => {
    commit.value = chosen
  })

  function workItem(value: string, above: ReferenceLink | null): ReferenceLink | null {
    const own = options.item()?.reference ?? ''
    if (value === own) return null
    if (!above || referenceSpaceKey(value) !== referenceSpaceKey(own)) return above
    return { ...above, open: () => options.openFrom(value) }
  }

  function memory(value: string): ReferenceLink | null {
    const found = options
      .item()
      ?.refs.find((entry) => entry.kind === 'memory' && entry.value === value)
    if (!found) return null
    return {
      title: t('textLinks.showMemory'),
      open: () => {
        peeked.value = found
      },
    }
  }

  function written(value: string): ReferenceLink | null {
    const found = writtenCommit(options.item()?.commits ?? [], value)
    if (!found) return null
    return {
      title: t('textLinks.showCommit'),
      open: () => {
        commit.value = found
      },
    }
  }

  provideReferenceLinks((reference, parent) => {
    if (reference.kind === 'document') return documents(reference)
    if (reference.kind === 'work-item') return workItem(reference.value, parent(reference))
    if (reference.kind === 'commit') return written(reference.value)
    if (reference.kind === 'memory') return memory(reference.value)
    return parent(reference)
  })

  return { commit, peeked }
}
