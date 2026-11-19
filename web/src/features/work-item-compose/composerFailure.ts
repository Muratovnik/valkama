/**
 * What the new-task dialog says when its write did not go through, in its own words: the
 * work was not created, why, and that what was typed is still in the dialog. The dialog
 * showed the error as the client caught it, the server's sentence bare or `HTTP 503` when
 * the server did not answer, which named no work and said nothing of what to do next.
 */
import { CutoverPendingError, planningRefusal } from '@/shared/api/planningApi.ts'

/** A message key and its parameters, translated where the dialog draws it. */
export interface ComposerFailure {
  key: 'compose.refused' | 'compose.noAnswer' | 'compose.failed'
  reason?: string
}

/** The server did not answer: the network refused the write, or the service was away. */
function unanswered(error: unknown): boolean {
  if (error instanceof TypeError || error instanceof CutoverPendingError) return true
  const status = error instanceof Error && 'status' in error ? error.status : null
  return typeof status === 'number' && status >= 500
}

/**
 * Why the work was not created. A refusal keeps the server's reason, which says what to
 * change; no answer, or a server error, is the server away rather than a word about the
 * work, so it asks for another try; anything else, such as an answer the client could not
 * read, says only that it was not created.
 */
export function composerFailure(error: unknown): ComposerFailure {
  const refusal = planningRefusal(error)
  if (refusal) return { key: 'compose.refused', reason: refusal.message }
  return unanswered(error) ? { key: 'compose.noAnswer' } : { key: 'compose.failed' }
}
