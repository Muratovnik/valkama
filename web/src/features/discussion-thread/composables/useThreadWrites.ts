import { ref, watch } from 'vue'

import { checklistWith } from '@/features/discussion-thread/utils/stepPoints.ts'

import { replyInThread, resolveThread, setWorkItemChecklist } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

type Submit = (operation: () => Promise<unknown>, accepted?: () => void) => Promise<void>

export type ThreadParent = { reply_to: number } | { reply_to_request: string }

/**
 * What a person writes in a thread: a reply, the mark, its removal, and points of an entry's
 * list made steps of the item.
 *
 * `submit` is the host's: it owns whether a write is under way, why the last one failed
 * and what follows one that went through. A reply that also marks is two writes in a row,
 * so they can part ways: the reply stands whatever becomes of the mark, and the root it
 * could not mark stays named in `unmarked` until a later attempt gets through. That is not
 * a failed write, the reply is on the server, so it never reaches the host as one.
 */
export function useThreadWrites(identity: () => string, submit: Submit) {
  const unmarked = ref(new Set<number>())
  watch(identity, () => unmarked.value.clear())

  async function markBlank(root: number) {
    try {
      await resolveThread({ id: identity(), comment_id: root, resolution: '' })
      unmarked.value.delete(root)
    } catch {
      unmarked.value.add(root)
    }
  }

  /**
   * `words` is the reply's text and the tasks it tells in `mentions`, when it tells any;
   * `accepted` hears the id of the reply just written.
   */
  function reply(
    parent: ThreadParent,
    words: { body: string; mentions?: string[] },
    markRoot: number | null,
    accepted: (commentId: number) => void,
  ) {
    let written = 0
    return submit(
      async () => {
        const answer = await replyInThread({ id: identity(), ...words, ...parent })
        written = answer.comment_id
        if (markRoot !== null) await markBlank(markRoot)
      },
      () => accepted(written),
    )
  }

  const resolve = (root: number, decision: string, accepted: () => void) =>
    submit(
      () => resolveThread({ id: identity(), comment_id: root, resolution: decision.trim() }),
      accepted,
    )

  const reopen = (root: number) =>
    submit(() => resolveThread({ id: identity(), comment_id: root, reopen: true }))

  /** The mark a reply did not get, tried again. */
  const markAgain = (root: number, accepted: () => void) => submit(() => markBlank(root), accepted)

  /** The item's steps as read, then the points; the revision read refuses a list changed since. */
  const addSteps = (
    card: Pick<WorkItem, 'checklist' | 'revision'>,
    points: string[],
    accepted: () => void,
  ) =>
    submit(
      () =>
        setWorkItemChecklist({
          id: identity(),
          items: checklistWith(card.checklist, points),
          expected_revision: card.revision,
        }),
      accepted,
    )

  return { addSteps, markAgain, reopen, reply, resolve, unmarked }
}
