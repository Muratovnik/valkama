/**
 * What a write to a thread answers: a comment or a reply, and a root's mark. The card
 * reads the whole item again after either, so these say only where the write landed.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  strictObject,
} from '@/shared/api/contract.ts'
import type { z } from '@/shared/api/contract.ts'
import { resolutionSchema, toldSchema, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { invalid, UUID } from '@/shared/api/platformApiGuards.ts'

/**
 * A comment write's answer: a reply names the root it landed under, a root names none,
 * and a write that told other items says who will hear each.
 */
const commentWrittenSchema = strictObject({
  work_item: boundedText(WORK_ITEM_REFERENCE, 20),
  comment_count: positiveInt(true),
  comment_id: positiveInt(),
  reply_to: positiveInt().nullable(),
  reply_to_request: boundedText(UUID, 36).nullable(),
  mentions: boundedList(toldSchema, 20).optional(),
})

/** A mark's answer: the root's mark as it now stands, null once reopened. */
const commentResolvedSchema = strictObject({
  work_item: boundedText(WORK_ITEM_REFERENCE, 20),
  comment_id: positiveInt(),
  resolution: resolutionSchema.nullable(),
})

export type CommentWritten = z.infer<typeof commentWrittenSchema>
export type CommentResolved = z.infer<typeof commentResolvedSchema>

export function validateCommentWritten(value: unknown): CommentWritten {
  return parseContract(commentWrittenSchema, value, 'planning.comment', invalid)
}

export function validateCommentResolved(value: unknown): CommentResolved {
  return parseContract(commentResolvedSchema, value, 'planning.resolution', invalid)
}
