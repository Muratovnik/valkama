/** Strict runtime contracts for the Improvements HTTP and SSE surface. */

import type {
  ApproveResponse,
  ImprovementCase,
  ImprovementCaseDetail,
  ImprovementJob,
  ImprovementJobKind,
  ImprovementProfile,
  ImprovementsReadModel,
} from '@/entities/improvement/utils/improvementDerivations.ts'
import {
  ANALYZER_EFFORTS,
  IMPROVEMENT_CATEGORIES,
  IMPROVEMENT_EVIDENCE_SOURCE_KINDS,
  IMPROVEMENT_JOB_KINDS,
  IMPROVEMENT_JOB_STATES,
  IMPROVEMENT_STATES,
  IMPROVEMENTS_INTERFACE_VERSION,
} from '@/entities/improvement/utils/improvementDerivations.ts'

import { parseContract, strictObject, z } from '@/shared/api/contract.ts'

const text = (max = 4096) => z.string().max(max)
const positiveInt = z.number().int().positive()
const nonnegativeInt = z.number().int().nonnegative()
const timestamp = text(120).refine((value) => Number.isFinite(Date.parse(value)), {
  message: 'expected timestamp',
})
const nullableTimestamp = timestamp.nullable()
const opaqueObject = z.record(z.string().max(120), z.unknown())

const signalSummarySchema = strictObject({
  last_recorded_at: nullableTimestamp,
  session_count: nonnegativeInt,
  source_counts: strictObject({
    agentmemory_lesson: nonnegativeInt,
    execution_result: nonnegativeInt,
    session_event: nonnegativeInt,
    user_feedback: nonnegativeInt,
  }),
  total: nonnegativeInt,
})

const profileSchema = strictObject({
  allowed_targets: z.tuple([
    z.literal('instructions'),
    z.literal('skill'),
    z.literal('tool-contract'),
    z.literal('hook-lifecycle'),
    z.literal('validator-eval'),
    z.literal('documentation-process'),
  ]),
  analyzer_client: z.enum(['codex', 'claude']),
  analyzer_model: text(120),
  capabilities: strictObject({ can_analyze: z.boolean(), can_approve: z.boolean() }),
  enabled: z.boolean(),
  excluded_targets: z.tuple([z.literal('product-code')]),
  expected_behavior: text(2000),
  interface_version: z.literal(IMPROVEMENTS_INTERFACE_VERSION),
  limits: strictObject({
    lookback_days: positiveInt,
    max_chars: positiveInt,
    max_sessions: positiveInt,
  }),
  planning_space: text(200),
  purpose: text(2000),
  reasoning_effort: z.enum(ANALYZER_EFFORTS),
  revision: nonnegativeInt,
  schedule: strictObject({
    interval_hours: positiveInt,
    mode: z.enum(['manual', 'scheduled']),
  }),
  scope: text(240).min(1),
})

const caseSummaryShape = {
  case_key: text(240).min(1),
  category: z.enum(IMPROVEMENT_CATEGORIES),
  first_seen: timestamp,
  id: positiveInt,
  last_seen: timestamp,
  planning_work_item: text(240).min(1).nullable(),
  revision: nonnegativeInt,
  session_count: nonnegativeInt,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  signal_count: nonnegativeInt,
  state: z.enum(IMPROVEMENT_STATES),
  title: text(512).min(1),
  trend: text(120),
  updated_at: timestamp,
}
const caseSummarySchema = strictObject(caseSummaryShape)

const jobSchema = strictObject({
  client: text(120),
  created_at: timestamp,
  error_code: text(120),
  finished_at: nullableTimestamp,
  id: positiveInt,
  kind: z.enum(IMPROVEMENT_JOB_KINDS),
  result_summary: text(2000),
  scope: text(240).min(1),
  started_at: nullableTimestamp,
  state: z.enum(IMPROVEMENT_JOB_STATES),
})

const evidenceSchema = strictObject({
  at: timestamp,
  client: text(120),
  event_type: text(120),
  excerpt: text(1200),
  id: positiveInt,
  pointer: text(1000).min(1),
  session_id: text(240),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  source_hash: text(128).min(1),
  source_kind: z.enum(IMPROVEMENT_EVIDENCE_SOURCE_KINDS),
})

const evalRunSchema = strictObject({
  case_id: positiveInt,
  created_at: timestamp,
  git_ref: text(240).min(1),
  id: positiveInt,
  job_id: positiveInt.nullable(),
  pack_hash: text(128),
  pack_version: positiveInt.nullable(),
  patch_hash: text(128).nullable(),
  phase: z.enum(['baseline', 'candidate']),
  repo: text().min(1),
  result: opaqueObject,
  result_json: text(256_000),
  run_identity: text(128),
})

const historySchema = strictObject({
  at: timestamp,
  from_state: z.enum(IMPROVEMENT_STATES).nullable(),
  reason: text(2000),
  to_state: z.enum(IMPROVEMENT_STATES),
})

const monitoringSchema = strictObject({
  baseline_rate: z.number().finite().nonnegative(),
  case_id: positiveInt,
  comparable_sessions: nonnegativeInt,
  high_critical_count: nonnegativeInt,
  recurrence_count: nonnegativeInt,
  started_at: timestamp,
  updated_at: timestamp,
})
  .refine(({ started_at, updated_at }) => Date.parse(updated_at) >= Date.parse(started_at), {
    message: 'updated_at must not precede started_at',
    path: ['updated_at'],
  })
  .nullable()

const caseDetailShape = {
  ...caseSummaryShape,
  eval_runs: z.array(evalRunSchema).max(1000),
  evaluation_pack: opaqueObject.nullable(),
  evidence: z.array(evidenceSchema).max(10_000),
  history: z.array(historySchema).max(10_000),
  monitoring: monitoringSchema,
  proposal: opaqueObject.nullable(),
}
const caseDetailSchema = strictObject(caseDetailShape)

const caseSchema = strictObject({
  ...caseDetailShape,
  interface_version: z.literal(IMPROVEMENTS_INTERFACE_VERSION),
  scope: text(240).min(1),
  signal_summary: signalSummarySchema,
})

const snapshotSchema = strictObject({
  cases: z.array(caseSummarySchema).max(100),
  interface_version: z.literal(IMPROVEMENTS_INTERFACE_VERSION),
  jobs: z.array(jobSchema).max(10_000),
  profile: profileSchema,
  scope: text(240).min(1),
  signal_summary: signalSummarySchema,
})

const approvalSchema = strictObject({
  case: caseDetailSchema,
  created: z.boolean(),
  epic_work_item: text(240).min(1),
  interface_version: z.literal(IMPROVEMENTS_INTERFACE_VERSION),
  launched: z.literal(false),
  work_item: text(240).min(1),
})

export class ImprovementsContractError extends Error {
  readonly code = 'improvements_contract_invalid'
}

function invalid(path: string, detail: string): never {
  throw new ImprovementsContractError(`${path}: ${detail}`)
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, path: string): z.infer<T> {
  return parseContract(schema, value, path, invalid)
}

function requireScope(actual: string, expected: string, path: string): void {
  if (actual !== expected) invalid(`${path}.scope`, 'unexpected scope')
}

export function validateImprovementsSnapshot(value: unknown, scope: string): ImprovementsReadModel {
  const parsed = parse(snapshotSchema, value, 'improvements')
  requireScope(parsed.scope, scope, 'improvements')
  requireScope(parsed.profile.scope, scope, 'improvements.profile')
  for (const [index, job] of parsed.jobs.entries())
    requireScope(job.scope, scope, `improvements.jobs[${index}]`)
  return parsed as ImprovementsReadModel
}

export function validateImprovementProfile(value: unknown, scope: string): ImprovementProfile {
  const parsed = parse(profileSchema, value, 'improvements.profile')
  requireScope(parsed.scope, scope, 'improvements.profile')
  return parsed as ImprovementProfile
}

export function validateImprovementCase(value: unknown, scope: string): ImprovementCase {
  const parsed = parse(caseSchema, value, 'improvements.case')
  requireScope(parsed.scope, scope, 'improvements.case')
  return parsed as ImprovementCase
}

export function validateImprovementActionCase(
  value: unknown,
  expectedCaseId: number,
): ImprovementCaseDetail {
  const parsed = parse(caseDetailSchema, value, 'improvements.action.case')
  if (parsed.id !== expectedCaseId) invalid('improvements.action.case.id', 'unexpected case id')
  return parsed as ImprovementCaseDetail
}

export function validateImprovementJob(
  value: unknown,
  expected:
    | { id: number; scope: string; kind?: ImprovementJobKind }
    | { kind: ImprovementJobKind; scope: string; id?: number },
): ImprovementJob {
  const parsed = parse(jobSchema, value, 'improvements.job')
  requireScope(parsed.scope, expected.scope, 'improvements.job')
  if (expected.kind !== undefined && parsed.kind !== expected.kind)
    invalid('improvements.job.kind', 'unexpected job kind')
  if (expected.id !== undefined && parsed.id !== expected.id)
    invalid('improvements.job.id', 'unexpected job id')
  return parsed as ImprovementJob
}

export function validateApproval(
  value: unknown,
  expected: { caseId: number; scope: string },
): ApproveResponse {
  const parsed = parse(approvalSchema, value, 'improvements.approval')
  if (!expected.scope.trim()) invalid('improvements.approval.scope', 'expected scope')
  if (parsed.case.id !== expected.caseId)
    invalid('improvements.approval.case.id', 'unexpected case id')
  return parsed as ApproveResponse
}
