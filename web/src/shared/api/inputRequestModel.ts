import { boundedList, boundedText, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { planningCoverageSchema, planningTargetSchema } from '@/shared/api/planningTarget.ts'
import { ISO, UUID } from '@/shared/api/platformApiGuards.ts'

const FIELD_ID = /^[a-z][a-z0-9_-]{0,63}$/u
const text = (max: number) => z.string().max(max)
const identifier = boundedText(FIELD_ID, 64)
const optionSchema = strictObject({
  id: identifier,
  label: z.string().min(1).max(200),
  /** Markdown, and it may run to several paragraphs: the widget folds what would crowd the labels. */
  description: z.string().min(1).max(8000).optional(),
  recommended: z.boolean().optional(),
})
/** The three words a review's line is answered with; the interface names them in the person's language. */
export const VERDICTS = ['accept', 'later', 'reject'] as const
/** The most fields one question holds, and so the most keys an answer's parts can have. */
const FIELD_LIMIT = 40
const PARENT_TYPES = new Set(['verdict', 'choice', 'multi_choice'])
const fieldSchema = strictObject({
  id: identifier,
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'choice', 'multi_choice', 'boolean', 'verdict']),
  required: z.boolean(),
  options: boundedList(optionSchema, 20),
  /** Markdown: what the field asks, or the point it decides. Folded as an option's is. */
  description: z.string().min(1).max(8000).optional(),
  /** The fields of one group stand together, drawn as one section under this heading. */
  group: z.string().min(1).max(200).optional(),
  /** Shown and answered only while the answer of `field` holds `option`. */
  under: strictObject({ field: identifier, option: identifier }).optional(),
  /** What a verdict's draft is filled with; a choice recommends on its options. */
  recommended: z.enum(VERDICTS).optional(),
}).refine((field) => {
  const choice = field.type === 'choice' || field.type === 'multi_choice'
  return (
    (choice ? field.options.length > 0 : field.options.length === 0) &&
    (field.recommended === undefined || field.type === 'verdict') &&
    new Set(field.options.map((option) => option.id)).size === field.options.length
  )
}, 'Invalid field options')
type Field = z.infer<typeof fieldSchema>

/** A field under another names an earlier field of a parent's type, under nothing itself. */
function holdsParent(fields: readonly Field[], index: number) {
  const under = fields[index]?.under
  if (!under) return true
  const parent = fields.slice(0, index).find((field) => field.id === under.field)
  if (!parent || parent.under || !PARENT_TYPES.has(parent.type)) return false
  return parent.type === 'verdict'
    ? (VERDICTS as readonly string[]).includes(under.option)
    : parent.options.some((option) => option.id === under.option)
}

const answerSchema = z.union([text(8000), boundedList(text(64), 20), z.boolean()])
const answersSchema = z
  .record(identifier, answerSchema)
  .refine((answers) => Object.keys(answers).length <= FIELD_LIMIT)
/** Text per field: an own variant (up to 8000) or a field's comment (up to 2000). */
const perField = (max: number) =>
  z
    .record(identifier, z.string().min(1).max(max))
    .refine((map) => Object.keys(map).length <= FIELD_LIMIT)
const ownSchema = perField(8000)
const fieldNotesSchema = perField(2000)

/** An answer the one in force replaced, with who gave it and through what. */
const versionSchema = strictObject({
  version: positiveInt(),
  answers: answersSchema,
  own: ownSchema,
  field_notes: fieldNotesSchema,
  note: text(8000).nullable(),
  answered_by: text(200),
  by_person: z.boolean().nullable(),
  answered_at: boundedText(ISO, 96),
})

const requestSchema = strictObject({
  request_id: boundedText(UUID, 36),
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: z.string().min(1).max(200),
  kind: z.enum(['question', 'decision']),
  prompt: z.string().min(1).max(8000),
  fields: boundedList(fieldSchema, FIELD_LIMIT).min(1),
  answers: answersSchema.nullable(),
  /** Own variants of fields with options; null while there is no answer. */
  own: ownSchema.nullable(),
  /** Comments on fields with options; null while there is no answer. */
  field_notes: fieldNotesSchema.nullable(),
  /** A comment on the whole question. It is part of the answer and answers no field. */
  note: text(8000).nullable(),
  /** 0 with no answer, 1 for the first, one more for each change. */
  answer_version: positiveInt(true),
  /** The replaced versions, oldest first. */
  history: boundedList(versionSchema, 49),
  status: z.enum(['pending', 'answered', 'declined', 'expired']),
  author: text(200),
  answered_by: text(200),
  /**
   * Whether the call that closed this was this interface's own write. It is the server's
   * fact about the call and null while none has; `answered_by` is text its caller wrote.
   */
  by_person: z.boolean().nullable(),
  execution_id: text(200).nullable(),
  session_id: text(512).nullable(),
  expires_at: boundedText(ISO, 96).nullable(),
  created_at: boundedText(ISO, 96),
  resolved_at: boundedText(ISO, 96).nullable(),
  revision: positiveInt(true),
  expired_reason: z.enum(['deadline', 'withdrawn', 'execution_closed', 'task_closed']).nullable(),
})
  .refine(
    (request) => new Set(request.fields.map((field) => field.id)).size === request.fields.length,
    'Duplicate field IDs',
  )
  .refine(
    (request) => request.fields.every((_, index) => holdsParent(request.fields, index)),
    'Invalid field parent',
  )
  .refine(
    (request) =>
      (request.status === 'answered') === (request.answers !== null) &&
      (request.answers === null) === (request.own === null) &&
      (request.answers === null) === (request.field_notes === null) &&
      (request.answers === null) === (request.answer_version === 0),
    'Invalid answer state',
  )
  .refine(
    (request) =>
      request.history.length === Math.max(0, request.answer_version - 1) &&
      request.history.every((version, index) => version.version === index + 1),
    'Invalid answer history',
  )

const entrySchema = strictObject({ target: planningTargetSchema, request: requestSchema }).refine(
  (entry) => entry.target.reference === entry.request.reference,
  'Mismatched request target',
)

const detailSchema = strictObject({
  interface_version: z.literal('valkama-planning-requests'),
  target: planningTargetSchema,
  request: requestSchema,
}).refine(
  (entry) => entry.target.reference === entry.request.reference,
  'Mismatched request target',
)

const listSchema = strictObject({
  interface_version: z.literal('valkama-planning-requests'),
  items: boundedList(entrySchema, 100),
  // One source per registered project, and the registry counts none.
  coverage: z.array(planningCoverageSchema),
  limit: positiveInt().max(100),
  has_more: z.boolean(),
})

export type InputRequestOption = z.infer<typeof optionSchema>
export type InputRequestField = z.infer<typeof fieldSchema>
export type InputAnswers = z.infer<typeof answersSchema>
export type InputRequestEntry = z.infer<typeof entrySchema>
export type InputRequestList = z.infer<typeof listSchema>

export function validateInputRequestDetail(value: unknown): InputRequestEntry {
  const { target, request } = detailSchema.parse(value)
  return { target, request }
}

export function validateInputRequestList(value: unknown): InputRequestList {
  return listSchema.parse(value)
}
