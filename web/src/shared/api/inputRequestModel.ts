import { boundedList, boundedText, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { planningCoverageSchema, planningTargetSchema } from '@/shared/api/planningTarget.ts'
import { ISO, UUID } from '@/shared/api/platformApiGuards.ts'

const FIELD_ID = /^[a-z][a-z0-9_-]{0,63}$/u
const text = (max: number) => z.string().max(max)
const identifier = boundedText(FIELD_ID, 64)
const optionSchema = strictObject({ id: identifier, label: z.string().min(1).max(200) })
const fieldSchema = strictObject({
  id: identifier,
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'choice', 'multi_choice', 'boolean']),
  required: z.boolean(),
  options: boundedList(optionSchema, 20),
}).refine((field) => {
  const choice = field.type === 'choice' || field.type === 'multi_choice'
  return (
    (choice ? field.options.length > 0 : field.options.length === 0) &&
    new Set(field.options.map((option) => option.id)).size === field.options.length
  )
}, 'Invalid field options')

const answerSchema = z.union([text(8000), boundedList(text(64), 20), z.boolean()])
const answersSchema = z
  .record(identifier, answerSchema)
  .refine((answers) => Object.keys(answers).length <= 12)

const requestSchema = strictObject({
  request_id: boundedText(UUID, 36),
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: z.string().min(1).max(200),
  kind: z.enum(['question', 'decision']),
  prompt: z.string().min(1).max(8000),
  fields: boundedList(fieldSchema, 12).min(1),
  answers: answersSchema.nullable(),
  status: z.enum(['pending', 'answered', 'declined', 'expired']),
  author: text(200),
  answered_by: text(200),
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
    (request) => (request.status === 'answered') === (request.answers !== null),
    'Invalid answer state',
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
  coverage: boundedList(planningCoverageSchema, 2000),
  limit: positiveInt().max(100),
  has_more: z.boolean(),
})

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
