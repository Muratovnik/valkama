/**
 * A work item reference's preview: the hover card and what a screen reader hears
 * in its place, from the same facts. The reference layers provide one of these two,
 * by where the item comes from.
 */
import { h, shallowRef } from 'vue'

import WorkItemPreview from '@/entities/work-item/components/WorkItemPreview.vue'
import { useWorkItemPreviewReads } from '@/entities/work-item/composables/useWorkItemPreviewReads.ts'
import type {
  PreviewCandidate,
  PreviewRead,
} from '@/entities/work-item/composables/useWorkItemPreviewReads.ts'
import { useWorkItemPreviewWords } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'
import type { WorkItemPreviewSubject } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'

import type { ReferencePreview } from '@/shared/lib/referenceLinks.ts'

/** A preview of what `subject` answers now; it is drawn again each time that changes. */
export function useWorkItemReferencePreview() {
  const { describe } = useWorkItemPreviewWords()
  return (
    subject: () => WorkItemPreviewSubject,
    prepare?: ReferencePreview['prepare'],
  ): ReferencePreview => ({
    describe: () => describe(subject()),
    render: () => h(WorkItemPreview, subject()),
    prepare,
  })
}

/**
 * The preview of an item the page does not hold, read when it is about to show.
 *
 * What was last read is one value, because one card shows at a time. A record is
 * drawn at once from the window's cache while it is read again in the background;
 * only an item nothing is known of holds the card for its answer.
 */
export function useReadWorkItemPreview(projectTitle: (projectId: string) => string | null) {
  const previewOf = useWorkItemReferencePreview()
  const reads = useWorkItemPreviewReads()
  const last = shallowRef<{ read: PreviewRead; reference: string } | null>(null)

  return (reference: string, candidates: readonly PreviewCandidate[]): ReferencePreview => {
    const subject = (): WorkItemPreviewSubject => {
      const answered = last.value?.reference === reference ? last.value.read : null
      if (answered && answered.status !== 'ready')
        return { reference, item: null, failure: answered.status }
      const record = answered ?? reads.cached(reference, candidates)
      return {
        reference,
        item: record?.item ?? null,
        project: record ? projectTitle(record.candidate.project_id) : null,
      }
    }
    return previewOf(subject, async (signal) => {
      last.value = null
      const held = reads.cached(reference, candidates)
      const answer = reads.read(reference, candidates, signal).then(
        (read) => {
          last.value = { reference, read }
        },
        // Aborted: the card closed, and nobody is waiting for this any more.
        () => {},
      )
      if (!held) await answer
    })
  }
}
