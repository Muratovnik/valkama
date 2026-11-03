import { ref, watch } from 'vue'

import { replyInThread, resolveThread } from '@/shared/api/planningApi.ts'

type Submit = (operation: () => Promise<unknown>, accepted?: () => void) => Promise<void>

export type ThreadParent = { reply_to: number } | { reply_to_request: string }

/**
 * What a person writes in a thread: a reply, the mark, its removal.
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

  /** `accepted` hears the id of the reply just written. */
  function reply(
    parent: ThreadParent,
    body: string,
    markRoot: number | null,
    accepted: (commentId: number) => void,
  ) {
    let written = 0
    return submit(
      async () => {
        const answer = await replyInThread({ id: identity(), body, ...parent })
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

  return { markAgain, reopen, reply, resolve, unmarked }
}
