import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import type {
  InputAnswers,
  InputRequestEntry,
  InputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { readRefusal } from '@/shared/api/planningModel.ts'
import { serializePlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { WEB_AUTHOR } from '@/shared/api/webAuthor.ts'

export class InputRequestError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'InputRequestError'
    this.code = code
    this.status = status
  }
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const { response, payload } = await readJsonResponse(url, init)
  if (!response.ok) {
    const refusal = readRefusal(payload)
    throw new InputRequestError(refusal?.error.code ?? 'request_failed', response.status)
  }
  return payload
}

export async function fetchInputRequests(
  options: {
    signal?: AbortSignal
    status?: InputRequestEntry['request']['status'] | 'all'
    target?: PlanningTarget
  } = {},
): Promise<InputRequestList> {
  const { target, signal } = options
  const status = options.status ?? 'pending'
  const parameters = new URLSearchParams({
    scope_kind: target ? 'project' : 'global',
    ...(status === 'all' ? {} : { status }),
    limit: '100',
    ...(target ? { ...serializePlanningTarget(target), reference: target.reference } : {}),
  })
  return validateInputRequestList(
    await request(`/api/modules/planning/requests?${parameters}`, { signal }),
  )
}

export async function fetchInputRequest(
  target: PlanningTarget,
  id: string,
  signal?: AbortSignal,
): Promise<InputRequestEntry> {
  const parameters = new URLSearchParams({
    scope_kind: 'project',
    ...serializePlanningTarget(target),
    id,
  })
  return validateInputRequestDetail(
    await request(`/api/modules/planning/request?${parameters}`, { signal }),
  )
}

/** The parts of an answer besides the chosen values; each is left out when empty. */
interface AnswerExtras {
  /** Comments on fields with options, by field id. */
  field_notes?: Record<string, string>
  /** A comment on the whole question; it answers no field. */
  note?: string
  /** Own variants of fields with options, by field id. */
  own?: Record<string, string>
}

type AnswerBody = AnswerExtras & { answers?: InputAnswers }

function written(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (map === undefined) return undefined
  const kept = Object.entries(map)
    .map(([field, value]) => [field, value.trim()] as const)
    .filter(([, value]) => value !== '')
  return kept.length ? Object.fromEntries(kept) : undefined
}

function answerBody(answers: InputAnswers, extras: AnswerExtras): AnswerBody {
  const note = extras.note?.trim()
  const own = written(extras.own)
  const fieldNotes = written(extras.field_notes)
  return {
    answers,
    ...(own ? { own } : {}),
    ...(fieldNotes ? { field_notes: fieldNotes } : {}),
    ...(note ? { note } : {}),
  }
}

async function resolve(
  entry: InputRequestEntry,
  action: 'answer' | 'change' | 'decline',
  answer: AnswerBody = {},
): Promise<InputRequestEntry> {
  const payload = await request(`/api/modules/planning/request/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      ...serializePlanningTarget(entry.target),
      id: entry.request.request_id,
      expected_revision: entry.request.revision,
      author: WEB_AUTHOR,
      ...answer,
    }),
  })
  return validateInputRequestDetail(payload)
}

/**
 * Answer a pending question. A required field is answered by a value or an own
 * variant; the note is a comment on the whole question and stands in for none.
 */
export function answerInputRequest(
  entry: InputRequestEntry,
  answers: InputAnswers,
  note = '',
  extras: Omit<AnswerExtras, 'note'> = {},
): Promise<InputRequestEntry> {
  return resolve(entry, 'answer', answerBody(answers, { ...extras, note }))
}

/**
 * Replace the answer in force while the item is open. The request's revision
 * guards it, and an answer equal to the one in force is refused as unchanged.
 */
export function changeInputRequestAnswer(
  entry: InputRequestEntry,
  answers: InputAnswers,
  extras: AnswerExtras = {},
): Promise<InputRequestEntry> {
  return resolve(entry, 'change', answerBody(answers, extras))
}

export function declineInputRequest(entry: InputRequestEntry): Promise<InputRequestEntry> {
  return resolve(entry, 'decline')
}
