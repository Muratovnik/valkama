/**
 * What the hover card of a work item says, in one place for the eye and the ear.
 *
 * The card draws the registry's marks for the `preview` surface and a line of
 * when; a screen reader does not see the card, and hears the same facts as
 * sentences through the reference's description instead. Both read them here, so
 * the two cannot say different things about one item.
 */
import { useI18n } from 'vue-i18n'

import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import type { PreviewRead } from '@/entities/work-item/composables/useWorkItemPreviewReads.ts'
import { surfaceMarks } from '@/entities/work-item/utils/facets.ts'
import type { FacetId, FacetMark } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** Why the card has no item to show: what a read answered instead of a record. */
type PreviewFailure = Exclude<PreviewRead['status'], 'ready'>

/** What a hover card is given: the reference it hangs from and what was read for it. */
export interface WorkItemPreviewSubject {
  /** The brief record (`validateWorkItemBrief`); null while it is read, or once the read was refused. */
  item: WorkItemBrief | null
  reference: string
  /** Why there is no item; absent while it is still being read. */
  failure?: PreviewFailure | null
  /** The project's name, for an item from somewhere other than the open space. */
  project?: string | null
  /** The reference of an open item this one waits on, where the caller knows it. */
  waitingOn?: string | null
}

/** The head's marks: the kind before the reference, the rest after it (`drawHead`). */
const HEAD: readonly FacetId[] = ['kind', 'priority', 'state', 'readiness']
/** Who holds it and how far its steps are. */
const FACTS: readonly FacetId[] = ['holder', 'steps']

const context = (subject: WorkItemPreviewSubject) => ({ waitingOn: subject.waitingOn ?? null })

const staleClaim = (item: WorkItemBrief) => item.claim_state === 'stale' && !item.state.is_terminal

const headMarks = (subject: WorkItemPreviewSubject, item: WorkItemBrief) =>
  surfaceMarks('preview', item, context(subject), HEAD)
const factMarks = (subject: WorkItemPreviewSubject, item: WorkItemBrief) =>
  surfaceMarks('preview', item, context(subject), FACTS)

export function useWorkItemPreviewWords() {
  const { t, d } = useI18n()
  const words = useMarkWords()

  /**
   * When the item last changed, or closed: a finished item's date is its close.
   * The year only when it is not this one, as the list says it.
   */
  function when(item: WorkItemBrief): { closed: boolean; iso: string; text: string } {
    const closed = item.state.is_terminal && Boolean(item.closed_at)
    const iso = (closed ? item.closed_at : null) ?? item.updated_at
    const date = new Date(iso)
    if (Number.isNaN(date.valueOf())) return { closed, iso, text: iso }
    const format = date.getFullYear() === new Date().getFullYear() ? 'day' : 'activity'
    return { closed, iso, text: d(date, format) }
  }

  /** The one line a card without an item prints. */
  function note(subject: WorkItemPreviewSubject): string {
    if (subject.failure === 'missing')
      return t('textLinks.notFound', { reference: subject.reference })
    if (subject.failure === 'unavailable') return t('workItem.preview.unavailable')
    if (subject.failure === 'failed') return t('workItem.preview.failed')
    return t('workItem.preview.loading')
  }

  const said = (mark: FacetMark) => words.say(mark.text)

  /** The card as sentences, for the reference's description while the card is open. */
  function describe(subject: WorkItemPreviewSubject): string {
    const { item } = subject
    if (!item) return note(subject)
    const holder = factMarks(subject, item).find((mark) => mark.facet === 'holder')
    const steps = factMarks(subject, item).find((mark) => mark.facet === 'steps')
    const date = when(item)
    const sentences = [
      ...headMarks(subject, item).map((mark) => said(mark)),
      item.title,
      holder &&
        (item.state.is_terminal
          ? said(holder)
          : t('workItem.preview.held', { holder: said(holder) })),
      staleClaim(item) && t('workItem.lease.mark'),
      steps && t('workItem.preview.steps', stepCount(item)),
      subject.project && t('workItem.preview.project', { project: subject.project }),
      t(date.closed ? 'workItem.preview.closed' : 'workItem.preview.updated', { date: date.text }),
    ]
    return sentences
      .filter((sentence): sentence is string => typeof sentence === 'string' && sentence !== '')
      .map((sentence) => sentence.replace(/[.…]$/u, ''))
      .join('. ')
      .concat('.')
  }

  return { describe, factMarks, headMarks, note, staleClaim, when, words }
}

function stepCount(item: WorkItemBrief) {
  return {
    done: item.checklist.filter((step) => step.done).length,
    total: item.checklist.length,
  }
}
