import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDocumentLinks } from '@/entities/project-document/documentLinks.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import {
  provideReferenceLinks,
  referenceSpaceKey,
  sameCommit,
} from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'
import type { TextReference } from '@/shared/lib/textReferences.ts'

type Ref = WorkItem['refs'][number]

/**
 * The card's layer of reference links, for everything its sections show.
 *
 * - Another item of the card's own space opens the way a related item does,
 *   through the card's departure: the draft guard asks first and Back returns
 *   here. The card's own reference is text; a link to where the reader already
 *   is says nothing.
 * - A commit or a memory id is a link when this card carries it as a ref, the
 *   one record Valkama holds of either: opening it shows that record — who
 *   attached it, when, under what label — and, for a commit, what git says of
 *   it. One the card does not carry is text.
 * - A path is taken from the root of the card's space, by the document layer.
 *   It is composed here because one component holds one layer.
 */
export function useInspectorReferenceLinks(options: {
  item: () => WorkItem | null
  openFrom: (reference: string) => void
  space: () => string | undefined
}) {
  const { t } = useI18n()
  /** The ref whose record is open over the card, if any. */
  const peeked = ref<Ref | null>(null)
  const documents = useDocumentLinks(() => {
    const space = options.space()
    return space ? { space } : {}
  })

  function workItem(value: string, above: ReferenceLink | null): ReferenceLink | null {
    const own = options.item()?.reference ?? ''
    if (value === own) return null
    if (!above || referenceSpaceKey(value) !== referenceSpaceKey(own)) return above
    return { title: above.title, open: () => options.openFrom(value) }
  }

  function record({ kind, value }: TextReference): ReferenceLink | null {
    const found = options
      .item()
      ?.refs.find(
        (entry) =>
          entry.kind === kind &&
          (kind === 'commit' ? sameCommit(entry.value, value) : entry.value === value),
      )
    if (!found) return null
    return {
      title: t(kind === 'commit' ? 'textLinks.showCommit' : 'textLinks.showMemory'),
      open: () => {
        peeked.value = found
      },
    }
  }

  provideReferenceLinks((reference, parent) => {
    if (reference.kind === 'document') return documents(reference)
    if (reference.kind === 'work-item') return workItem(reference.value, parent(reference))
    if (reference.kind === 'commit' || reference.kind === 'memory') return record(reference)
    return parent(reference)
  })

  return { peeked }
}
