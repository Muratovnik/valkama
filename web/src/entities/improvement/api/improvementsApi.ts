import {
  ImprovementsContractError,
  validateApproval,
  validateImprovementActionCase,
  validateImprovementCase,
  validateImprovementJob,
  validateImprovementProfile,
  validateImprovementsSnapshot,
} from '@/entities/improvement/api/improvementsContract.ts'
import type {
  AnalyzeRequest,
  ApproveResponse,
  EvalRunRequest,
  ImprovementAction,
  ImprovementActionOptions,
  ImprovementCase,
  ImprovementCaseDetail,
  ImprovementJob,
  ImprovementProfile,
  ImprovementsReadModel,
} from '@/entities/improvement/utils/improvementDerivations.ts'
import {
  buildActionPayload,
  buildProfilePayload,
  IMPROVEMENT_ACTIONS,
  validateAction,
} from '@/entities/improvement/utils/improvementDerivations.ts'

import { secureFetch } from '@/shared/api/secureFetch.ts'
import { responseFailure, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'

const root = '/api/modules/improvements'
const SAFE_CODE = /^[a-z][a-z0-9_-]{0,63}$/u

/** A bounded API refusal. Server prose never crosses this boundary. */
class ImprovementsRequestError extends Error implements TypedFailure {
  readonly code: string
  readonly retryable: boolean
  readonly status: number | null

  constructor(failure: TypedFailure) {
    super(failure.code)
    this.name = 'ImprovementsRequestError'
    this.code = failure.code
    this.retryable = failure.retryable
    this.status = failure.status
  }
}

function requestInvalid(code: string): never {
  throw new ImprovementsRequestError({ code, retryable: false, status: null })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function responseError(response: Response, payload: unknown): ImprovementsRequestError {
  const fallback = responseFailure(response)
  if (fallback.code === 'permission_denied') return new ImprovementsRequestError(fallback)
  const candidate =
    isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string'
      ? payload.error.code.toLowerCase()
      : ''
  return new ImprovementsRequestError({
    code: SAFE_CODE.test(candidate) ? candidate : fallback.code,
    status: response.status,
    retryable:
      response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500,
  })
}

async function json(input: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await secureFetch(input, init)
  } catch (error) {
    throw new ImprovementsRequestError(typedFailure(error))
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    if (!response.ok) throw new ImprovementsRequestError(responseFailure(response))
    throw new ImprovementsContractError('improvements: expected JSON response')
  }
  if (!response.ok) throw responseError(response, payload)
  return payload
}

function requireScope(scope: string): string {
  if (!scope.trim()) return requestInvalid('invalid_scope')
  return scope
}

function requireId(id: number, code: string): number {
  if (!Number.isSafeInteger(id) || id < 1) return requestInvalid(code)
  return id
}

function query(scope: string): string {
  return new URLSearchParams({ scope: requireScope(scope) }).toString()
}

export async function fetchImprovementsSnapshot(scope: string): Promise<ImprovementsReadModel> {
  const selectedScope = requireScope(scope)
  return validateImprovementsSnapshot(await json(`${root}?${query(selectedScope)}`), selectedScope)
}

export async function saveImprovementProfile(
  profile: Partial<ImprovementProfile> & { expected_revision: number; scope: string },
): Promise<ImprovementProfile> {
  const scope = requireScope(profile.scope)
  if (!Number.isSafeInteger(profile.expected_revision) || profile.expected_revision < 0)
    return requestInvalid('invalid_profile_revision')
  const payload = buildProfilePayload({ ...profile, scope })
  const answer = await json(`${root}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return validateImprovementProfile(answer, scope)
}

export async function fetchImprovementCase(scope: string, id: number): Promise<ImprovementCase> {
  const selectedScope = requireScope(scope)
  const caseId = requireId(id, 'invalid_case_id')
  return validateImprovementCase(
    await json(`${root}/cases/${encodeURIComponent(caseId)}?${query(selectedScope)}`),
    selectedScope,
  )
}

export async function analyzeImprovements(request: AnalyzeRequest): Promise<ImprovementJob> {
  const scope = requireScope(request.scope)
  if (request.trigger !== 'manual' && request.trigger !== 'scheduled')
    return requestInvalid('invalid_analysis_trigger')
  const answer = await json(`${root}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, trigger: request.trigger }),
  })
  return validateImprovementJob(answer, { kind: 'analysis', scope })
}

async function postAction(
  scope: string,
  id: number,
  action: ImprovementAction,
  options: ImprovementActionOptions,
): Promise<unknown> {
  const selectedScope = requireScope(scope)
  const caseId = requireId(id, 'invalid_case_id')
  if (!IMPROVEMENT_ACTIONS.includes(action)) return requestInvalid('invalid_case_action')
  const payload = buildActionPayload(selectedScope, action, options)
  if (validateAction(payload).length > 0) return requestInvalid('invalid_action_request')
  return json(`${root}/cases/${encodeURIComponent(caseId)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function runImprovementAction(
  scope: string,
  id: number,
  action: ImprovementAction,
  options: ImprovementActionOptions,
): Promise<ImprovementCaseDetail | ApproveResponse> {
  const answer = await postAction(scope, id, action, options)
  return action === 'approve'
    ? validateApproval(answer, { caseId: id, scope })
    : validateImprovementActionCase(answer, id)
}

export async function approveImprovement(
  scope: string,
  id: number,
  expectedRevision: number,
  reason = '',
): Promise<ApproveResponse> {
  return validateApproval(
    await postAction(scope, id, 'approve', {
      expected_revision: expectedRevision,
      reason,
    }),
    { caseId: id, scope },
  )
}

export async function startEvaluation(request: EvalRunRequest): Promise<ImprovementJob> {
  const scope = requireScope(request.scope)
  const caseId = requireId(request.case_id, 'invalid_case_id')
  const repo = request.repo.trim()
  const gitRef = request.git_ref.trim()
  if (!repo || !gitRef) return requestInvalid('invalid_evaluation_request')
  if (request.phase !== 'baseline' && request.phase !== 'candidate')
    return requestInvalid('invalid_evaluation_phase')
  const answer = await json(`${root}/eval-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, case_id: caseId, phase: request.phase, repo, git_ref: gitRef }),
  })
  return validateImprovementJob(answer, { kind: 'eval', scope })
}

export async function cancelImprovementJob(scope: string, id: number): Promise<ImprovementJob> {
  const selectedScope = requireScope(scope)
  const jobId = requireId(id, 'invalid_job_id')
  const answer = await json(`${root}/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: selectedScope }),
  })
  return validateImprovementJob(answer, { id: jobId, scope: selectedScope })
}

export interface ImprovementsStream {
  source: EventSource
  close: () => void
}

export function subscribeImprovements(
  scope: string,
  onPayload: (payload: ImprovementsReadModel) => void,
  onError?: (error: unknown) => void,
): ImprovementsStream {
  const selectedScope = requireScope(scope)
  const source = new EventSource(
    `/api/events?view=improvements&scope=${encodeURIComponent(selectedScope)}`,
  )
  let closed = false
  let streamErrorReported = false

  function report(error: unknown) {
    if (closed || streamErrorReported) return
    streamErrorReported = true
    onError?.(error)
  }

  source.addEventListener('message', (event) => {
    if (closed) return
    try {
      const payload = validateImprovementsSnapshot(JSON.parse(event.data) as unknown, selectedScope)
      streamErrorReported = false
      onPayload(payload)
    } catch (error) {
      report(
        error instanceof ImprovementsContractError
          ? error
          : new ImprovementsContractError('improvements.stream: invalid JSON payload'),
      )
    }
  })
  source.addEventListener('error', (event) => report(event))

  return {
    source,
    close: () => {
      if (closed) return
      closed = true
      source.close()
    },
  }
}

export {
  validateImprovementActionCase,
  validateImprovementCase,
  validateImprovementJob,
  validateImprovementProfile,
  validateImprovementsSnapshot,
} from '@/entities/improvement/api/improvementsContract.ts'
