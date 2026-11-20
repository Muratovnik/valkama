import { readCancelList } from '@/shared/api/inputRequestAction.ts'
import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import type {
  InputAnswers,
  InputRequestEntry,
  InputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { readRefusal } from '@/shared/api/planningRefusal.ts'
import { serializePlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { validatePlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { WEB_AUTHOR } from '@/shared/api/webAuthor.ts'

export class InputRequestError extends Error {
  readonly code: string
  /** The server's bracketed word on why, such as `item_closed`; empty when it gave none. */
  readonly reason: string
  readonly status: number
  /** What an answer that cancels work would close, handed back to be confirmed by its token. */
  readonly cancelList: CancelList | null

  constructor(code: string, status: number, reason = '', cancelList: CancelList | null = null) {
    super(code)
    this.name = 'InputRequestError'
    this.code = code
    this.reason = reason
    this.status = status
    this.cancelList = cancelList
  }
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const { response, payload } = await readJsonResponse(url, init)
  if (!response.ok) {
    const refusal = readRefusal(payload)
    const listed = readCancelList(payload)
    throw new InputRequestError(
      refusal?.error.code ?? (listed ? 'cancel_list' : 'request_failed'),
      response.status,
      /^\[([a-z_]+)\]/u.exec(refusal?.error.message ?? '')?.[1],
      listed,
    )
  }
  return payload
}

/**
 * What the questions window is narrowed to: a space read as its board holds it — its cards and
 * other spaces' cards that name one of its projects — and the one project it is narrowed to, if
 * any. It holds what the Volumes page's «Waiting for me» counts for the same scope.
 */
export interface QuestionScope {
  /** A project's id, which keeps the cards that name it; null for the whole space. */
  project: string | null
  space: PlanningSpaceRef
}

/** The most questions one page of the server's list holds. */
const PAGE = 200

const entryIdentity = (entry: InputRequestEntry) =>
  `${entry.target.space_ref.data_scope_id}/${entry.request.request_id}`

/**
 * Every question the read names, page after page while the server says more follow.
 *
 * A page that brings nothing new ends the read with `has_more` still true, so a list that
 * moved under the read says it is incomplete rather than reading forever; a source one
 * page could not read stays unavailable in the whole. The line that a space's triage is
 * due belongs to the whole list, and only the first page carries it.
 */
export async function fetchInputRequests(
  options: {
    /** A space as its board holds it, and its project: `other_spaces` and `project_id`. */
    scope?: QuestionScope
    signal?: AbortSignal
    status?: InputRequestEntry['request']['status'] | 'all'
    target?: PlanningTarget
  } = {},
): Promise<InputRequestList> {
  const { target, signal } = options
  const scope = options.scope
  const space = scope ? validatePlanningSpaceRef(scope.space) : undefined
  const status = options.status ?? 'pending'
  const query = {
    scope_kind: target || space ? 'space' : 'global',
    ...(status === 'all' ? {} : { status }),
    limit: String(PAGE),
    ...(target ? { ...serializePlanningTarget(target), reference: target.reference } : {}),
    ...(space && !target ? { ...space, other_spaces: 'true' } : {}),
    ...(scope?.project && !target ? { project_id: scope.project } : {}),
  }
  const read = async (offset: number) => {
    const parameters = new URLSearchParams({
      ...query,
      ...(offset ? { offset: String(offset) } : {}),
    })
    return validateInputRequestList(
      await request(`/api/modules/planning/requests?${parameters}`, { signal }),
    )
  }
  let page = await read(0)
  const due = page.triage_due
  let offset = page.items.length
  const items = [...page.items]
  const seen = new Set(items.map((entry) => entryIdentity(entry)))
  const skipped = new Map<string, InputRequestList['coverage'][number]>()
  const note = (list: InputRequestList) => {
    for (const source of list.coverage) {
      const key = JSON.stringify(source.space_ref)
      if (source.status === 'unavailable' && !skipped.has(key)) skipped.set(key, source)
    }
  }
  note(page)
  while (page.has_more) {
    page = await read(offset)
    note(page)
    offset += page.items.length
    const fresh = page.items.filter((entry) => !seen.has(entryIdentity(entry)))
    if (!fresh.length) break
    for (const entry of fresh) seen.add(entryIdentity(entry))
    items.push(...fresh)
  }
  const coverage = page.coverage.map(
    (source) => skipped.get(JSON.stringify(source.space_ref)) ?? source,
  )
  return { ...page, items, coverage, triage_due: due }
}

export async function fetchInputRequest(
  target: PlanningTarget,
  id: string,
  signal?: AbortSignal,
): Promise<InputRequestEntry> {
  const parameters = new URLSearchParams({
    scope_kind: 'space',
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
