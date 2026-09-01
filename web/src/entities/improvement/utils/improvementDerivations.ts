export const IMPROVEMENTS_INTERFACE_VERSION = 'improvements-api' as const

export const IMPROVEMENT_STATES = [
  'collecting',
  'open',
  'watching',
  'snoozed',
  'approved',
  'implementing',
  'validating',
  'resolved',
  'effective',
  'false_positive',
  'regressed',
] as const
export type ImprovementState = (typeof IMPROVEMENT_STATES)[number]
export type ImprovementSeverity = 'low' | 'medium' | 'high' | 'critical'
export const IMPROVEMENT_CATEGORIES = [
  'instructions',
  'skill',
  'tool-contract',
  'hook-lifecycle',
  'validator-eval',
  'documentation-process',
] as const
type ImprovementCategory = (typeof IMPROVEMENT_CATEGORIES)[number]
export const IMPROVEMENT_ACTIONS = [
  'merge',
  'split',
  'false_positive',
  'snooze',
  'watch',
  'approve',
  'reopen',
] as const
export type ImprovementAction = (typeof IMPROVEMENT_ACTIONS)[number]
export const IMPROVEMENT_JOB_STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type ImprovementJobState = (typeof IMPROVEMENT_JOB_STATES)[number]
export const IMPROVEMENT_JOB_KINDS = ['analysis', 'eval'] as const
export type ImprovementJobKind = (typeof IMPROVEMENT_JOB_KINDS)[number]
export const IMPROVEMENT_EVIDENCE_SOURCE_KINDS = [
  'session_event',
  'execution_result',
  'agentmemory_lesson',
  'user_feedback',
] as const
export type ImprovementEvidenceSourceKind = (typeof IMPROVEMENT_EVIDENCE_SOURCE_KINDS)[number]
export const ANALYZER_EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type AnalyzerEffort = (typeof ANALYZER_EFFORTS)[number]
const MILLISECONDS_PER_DAY = 86_400_000

/** This is a catalog of accepted, sanitized signal origins, never a live source subscription. */
export const IMPROVEMENT_EVIDENCE_SOURCES: ReadonlyArray<{
  kind: ImprovementEvidenceSourceKind
  labelKey: string
}> = [
  { kind: 'session_event', labelKey: 'improvements.source.session_event' },
  { kind: 'execution_result', labelKey: 'improvements.source.execution_result' },
  { kind: 'agentmemory_lesson', labelKey: 'improvements.source.agentmemory_lesson' },
  { kind: 'user_feedback', labelKey: 'improvements.source.user_feedback' },
]

interface ImprovementSchedule {
  interval_hours: number
  mode: 'manual' | 'scheduled'
}
interface ImprovementLimits {
  lookback_days: number
  max_chars: number
  max_sessions: number
}
interface ImprovementCapabilities {
  can_analyze: boolean
  can_approve: boolean
}
export interface ImprovementProfile {
  allowed_targets: ImprovementCategory[]
  analyzer_client: 'codex' | 'claude'
  analyzer_model: string
  capabilities: ImprovementCapabilities
  enabled: boolean
  excluded_targets: ['product-code']
  expected_behavior: string
  interface_version: typeof IMPROVEMENTS_INTERFACE_VERSION
  limits: ImprovementLimits
  planning_space: string
  purpose: string
  reasoning_effort: AnalyzerEffort
  revision: number
  schedule: ImprovementSchedule
  scope: string
}

export interface ImprovementEvidence {
  at: string
  client: string
  event_type: string
  excerpt: string
  id: number
  pointer: string
  session_id: string
  severity: ImprovementSeverity
  source_hash: string
  source_kind: ImprovementEvidenceSourceKind
}
export interface ImprovementCaseSummary {
  case_key: string
  category: ImprovementCategory
  first_seen: string
  id: number
  last_seen: string
  planning_work_item: string | null
  revision: number
  session_count: number
  severity: ImprovementSeverity
  signal_count: number
  state: ImprovementState
  title: string
  trend: string
  updated_at: string
}
interface ImprovementProposal {
  [key: string]: unknown
  rationale?: string
  summary?: string
  target?: string
  title?: string
}
interface ImprovementEvaluationPack {
  [key: string]: unknown
  assertions?: unknown[]
  scenarios?: unknown[]
}
interface ImprovementEvalRun {
  case_id: number
  created_at: string
  git_ref: string
  id: number
  job_id: number | null
  pack_hash: string
  pack_version: number | null
  patch_hash: string | null
  phase: 'baseline' | 'candidate'
  repo: string
  result: Record<string, unknown>
  result_json: string
  run_identity: string
}
interface ImprovementHistory {
  at: string
  from_state: ImprovementState | null
  reason: string
  to_state: ImprovementState
}
interface ImprovementMonitoring {
  baseline_rate: number
  case_id: number
  comparable_sessions: number
  high_critical_count: number
  recurrence_count: number
  started_at: string
  updated_at: string
}
export interface ImprovementCaseDetail extends ImprovementCaseSummary {
  eval_runs: ImprovementEvalRun[]
  evaluation_pack: ImprovementEvaluationPack | null
  evidence: ImprovementEvidence[]
  history: ImprovementHistory[]
  monitoring: ImprovementMonitoring | null
  proposal: ImprovementProposal | null
}
export interface ImprovementCase extends ImprovementCaseDetail {
  interface_version: typeof IMPROVEMENTS_INTERFACE_VERSION
  scope: string
  signal_summary: ImprovementSignalSummary
}
export interface ImprovementJob {
  client: string
  created_at: string
  error_code: string
  finished_at: string | null
  id: number
  kind: ImprovementJobKind
  result_summary: string
  scope: string
  started_at: string | null
  state: ImprovementJobState
}
export interface ImprovementSignalSummary {
  last_recorded_at: string | null
  session_count: number
  source_counts: Record<ImprovementEvidenceSourceKind, number>
  total: number
}
export interface ImprovementsReadModel {
  cases: ImprovementCaseSummary[]
  interface_version: typeof IMPROVEMENTS_INTERFACE_VERSION
  jobs: ImprovementJob[]
  profile: ImprovementProfile
  scope: string
  signal_summary: ImprovementSignalSummary
}
export interface AnalyzeRequest {
  scope: string
  trigger: 'manual' | 'scheduled'
}
export interface ImprovementActionRequest {
  action: ImprovementAction
  expected_revision: number
  reason: string
  scope: string
  signal_ids: number[]
  snooze_until: string | null
  target_case_id: number | null
}
export type ImprovementActionOptions = Pick<ImprovementActionRequest, 'expected_revision'> &
  Partial<Omit<ImprovementActionRequest, 'scope' | 'action' | 'expected_revision'>>
export interface ApproveResponse {
  case: ImprovementCaseDetail
  created: boolean
  epic_work_item: string
  interface_version: typeof IMPROVEMENTS_INTERFACE_VERSION
  launched: false
  work_item: string
}
export interface EvalRunRequest {
  case_id: number
  git_ref: string
  phase: 'baseline' | 'candidate'
  repo: string
  scope: string
}

export function sortCases(
  cases: ImprovementCaseSummary[],
  order: 'updated' | 'severity' = 'updated',
): ImprovementCaseSummary[] {
  const weights: Record<ImprovementSeverity, number> = { low: 1, medium: 2, high: 4, critical: 8 }
  return [...cases].sort((a, b) =>
    order === 'severity'
      ? weights[b.severity] - weights[a.severity] || b.updated_at.localeCompare(a.updated_at)
      : b.updated_at.localeCompare(a.updated_at),
  )
}
export function filterCases(
  cases: ImprovementCaseSummary[],
  state?: ImprovementState,
): ImprovementCaseSummary[] {
  return state ? cases.filter((item) => item.state === state) : cases
}
export function allowedActions(state: ImprovementState): ImprovementAction[] {
  if (state === 'approved' || state === 'implementing' || state === 'validating')
    return ['watch', 'reopen']
  if (state === 'resolved' || state === 'effective') return ['reopen', 'watch']
  if (state === 'false_positive') return ['reopen']
  if (state === 'snoozed') return ['watch', 'reopen']
  if (state === 'collecting') return ['watch']
  return ['merge', 'split', 'false_positive', 'snooze', 'watch', 'approve']
}
export function validateAction(action: ImprovementActionRequest): string[] {
  const errors: string[] = []
  if (!action.scope.trim()) errors.push('scope is required')
  if (!Number.isSafeInteger(action.expected_revision) || action.expected_revision < 0)
    errors.push('expected_revision is required')
  if (
    action.action === 'merge' &&
    (!Number.isSafeInteger(action.target_case_id) || (action.target_case_id ?? 0) < 1)
  )
    errors.push('target_case_id is required')
  if (
    action.action === 'split' &&
    (action.signal_ids.length === 0 ||
      action.signal_ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(action.signal_ids).size !== action.signal_ids.length)
  )
    errors.push('signal_ids is required')
  if ((action.action === 'false_positive' || action.action === 'snooze') && !action.reason?.trim())
    errors.push('reason is required')
  if (
    action.action === 'snooze' &&
    (!action.snooze_until || Number.isNaN(Date.parse(action.snooze_until)))
  )
    errors.push('snooze_until must be ISO timestamp')
  return errors
}
export function buildActionPayload(
  scope: string,
  action: ImprovementAction,
  options: ImprovementActionOptions,
): ImprovementActionRequest {
  return {
    scope,
    action,
    reason: options.reason ?? '',
    target_case_id: options.target_case_id ?? null,
    signal_ids: options.signal_ids ?? [],
    snooze_until: options.snooze_until ?? null,
    expected_revision: options.expected_revision,
  }
}
export function buildAnalyzePayload(
  scope: string,
  trigger: AnalyzeRequest['trigger'] = 'manual',
): AnalyzeRequest {
  if (!scope.trim()) throw new Error('scope is required')
  return { scope, trigger }
}
export function buildProfilePayload(
  profile: Partial<ImprovementProfile> & { expected_revision: number; scope: string },
) {
  return {
    scope: profile.scope,
    expected_revision: profile.expected_revision,
    enabled: profile.enabled ?? false,
    purpose: profile.purpose ?? '',
    expected_behavior: profile.expected_behavior ?? '',
    allowed_targets: profile.allowed_targets ?? [...IMPROVEMENT_CATEGORIES],
    excluded_targets: profile.excluded_targets ?? ['product-code'],
    analyzer_client: profile.analyzer_client ?? 'codex',
    analyzer_model: profile.analyzer_model ?? '',
    reasoning_effort: profile.reasoning_effort ?? '',
    planning_space: profile.planning_space ?? '',
    schedule: profile.schedule ?? { mode: 'manual' as const, interval_hours: 24 },
    limits: profile.limits ?? { lookback_days: 30, max_sessions: 20, max_chars: 60_000 },
  }
}
export function evidenceExcerpt(evidence: ImprovementEvidence): string {
  return evidence.excerpt.slice(0, 1200)
}
export function canCancelImprovementJob(job: Pick<ImprovementJob, 'state'>): boolean {
  return job.state === 'queued' || job.state === 'running'
}

/** Resolve a persisted evaluation run through its canonical eval job, if one exists. */
export function improvementEvaluationState(
  run: Pick<ImprovementCaseDetail['eval_runs'][number], 'job_id'>,
  jobs: readonly ImprovementJob[],
): ImprovementJobState | null {
  if (run.job_id === null) return null
  return jobs.find((job) => job.id === run.job_id && job.kind === 'eval')?.state ?? null
}

/** Whole elapsed days recorded by the monitoring interval; invalid or absent data stays absent. */
export function improvementMonitoringAgeDays(
  monitoring: Pick<
    NonNullable<ImprovementCaseDetail['monitoring']>,
    'started_at' | 'updated_at'
  > | null,
): number | null {
  if (monitoring === null) return null
  const elapsed = Date.parse(monitoring.updated_at) - Date.parse(monitoring.started_at)
  return Number.isFinite(elapsed) && elapsed >= 0
    ? Math.floor(elapsed / MILLISECONDS_PER_DAY)
    : null
}

export function visibleImprovementJobs(
  jobs: readonly ImprovementJob[],
  terminalLimit = 5,
): ImprovementJob[] {
  const newest = (left: ImprovementJob, right: ImprovementJob) =>
    right.created_at.localeCompare(left.created_at) || right.id - left.id
  const active = jobs.filter((job) => canCancelImprovementJob(job)).sort(newest)
  const terminal = jobs
    .filter((job) => !canCancelImprovementJob(job))
    .sort(newest)
    .slice(0, Math.max(0, terminalLimit))
  return [...active, ...terminal]
}

export type ImprovementActivationStatus = 'disabled' | 'needs_evidence' | 'ready' | 'analyzed_empty'

/**
 * Empty cases are not proof that analysis succeeded. The state explains the
 * next human-controlled step from the profile and sanitized aggregate only.
 */
export function improvementActivationState(
  profile: Pick<ImprovementProfile, 'enabled' | 'capabilities'>,
  signals: ImprovementSignalSummary,
  caseCount: number,
): { next: Array<'enable' | 'record' | 'analyze'>; status: ImprovementActivationStatus } {
  if (!profile.enabled || !profile.capabilities.can_analyze) {
    return { status: 'disabled', next: ['enable', 'record', 'analyze'] }
  }
  if (signals.total <= 0) return { status: 'needs_evidence', next: ['record', 'analyze'] }
  if (caseCount <= 0) return { status: 'analyzed_empty', next: ['analyze'] }
  return { status: 'ready', next: ['analyze'] }
}
