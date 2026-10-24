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

async function resolve(
  entry: InputRequestEntry,
  action: 'answer' | 'decline',
  answers?: InputAnswers,
): Promise<InputRequestEntry> {
  const payload = await request(`/api/modules/planning/request/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      ...serializePlanningTarget(entry.target),
      id: entry.request.request_id,
      expected_revision: entry.request.revision,
      author: 'user',
      ...(answers === undefined ? {} : { answers }),
    }),
  })
  return validateInputRequestDetail(payload)
}

export function answerInputRequest(
  entry: InputRequestEntry,
  answers: InputAnswers,
): Promise<InputRequestEntry> {
  return resolve(entry, 'answer', answers)
}

export function declineInputRequest(entry: InputRequestEntry): Promise<InputRequestEntry> {
  return resolve(entry, 'decline')
}
