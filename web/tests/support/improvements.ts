import type {
  ImprovementCase,
  ImprovementCaseDetail,
  ImprovementCaseSummary,
  ImprovementJob,
  ImprovementProfile,
  ImprovementSignalSummary,
  ImprovementsReadModel,
} from '@/entities/improvement/utils/improvementDerivations.ts'
import {
  IMPROVEMENT_CATEGORIES,
  IMPROVEMENTS_INTERFACE_VERSION,
} from '@/entities/improvement/utils/improvementDerivations.ts'

export function improvementSignalSummary(
  overrides: Partial<ImprovementSignalSummary> = {},
): ImprovementSignalSummary {
  const sourceCounts = {
    agentmemory_lesson: 0,
    execution_result: 0,
    session_event: 0,
    user_feedback: 0,
    ...overrides.source_counts,
  }
  return {
    last_recorded_at: null,
    session_count: 0,
    total: Object.values(sourceCounts).reduce((total, count) => total + count, 0),
    ...overrides,
    source_counts: sourceCounts,
  }
}

export function improvementProfile(
  scope = 'personal',
  overrides: Partial<ImprovementProfile> = {},
): ImprovementProfile {
  return {
    allowed_targets: [...IMPROVEMENT_CATEGORIES],
    analyzer_client: 'codex',
    analyzer_model: '',
    capabilities: { can_analyze: false, can_approve: false },
    enabled: false,
    excluded_targets: ['product-code'],
    expected_behavior: '',
    interface_version: IMPROVEMENTS_INTERFACE_VERSION,
    limits: { lookback_days: 30, max_sessions: 20, max_chars: 60_000 },
    planning_space: '',
    purpose: '',
    reasoning_effort: '',
    revision: 0,
    schedule: { mode: 'manual', interval_hours: 24 },
    ...overrides,
    scope,
  }
}

export function improvementCaseSummary(
  id = 1,
  overrides: Partial<ImprovementCaseSummary> = {},
): ImprovementCaseSummary {
  return {
    case_key: `case-${id}`,
    category: 'instructions',
    first_seen: '2026-01-01T10:00:00Z',
    id,
    last_seen: '2026-01-02T10:00:00Z',
    planning_work_item: null,
    revision: 1,
    session_count: 2,
    severity: 'medium',
    signal_count: 3,
    state: 'open',
    title: `Case ${id}`,
    trend: 'steady',
    updated_at: `2026-01-${String(id).padStart(2, '0')}T10:00:00Z`,
    ...overrides,
  }
}

export function improvementCaseDetail(
  id = 1,
  overrides: Partial<ImprovementCaseDetail> = {},
): ImprovementCaseDetail {
  return {
    ...improvementCaseSummary(id),
    eval_runs: [],
    evaluation_pack: null,
    evidence: [],
    history: [],
    monitoring: null,
    proposal: null,
    ...overrides,
  }
}

export function improvementEvalRun(
  id = 1,
  overrides: Partial<ImprovementCaseDetail['eval_runs'][number]> = {},
): ImprovementCaseDetail['eval_runs'][number] {
  return {
    case_id: 1,
    created_at: '2026-01-03T10:00:00Z',
    git_ref: 'a'.repeat(40),
    id,
    job_id: null,
    pack_hash: 'b'.repeat(64),
    pack_version: 1,
    patch_hash: null,
    phase: 'baseline',
    repo: 'C:\\repo',
    result: {},
    result_json: '{}',
    run_identity: 'c'.repeat(64),
    ...overrides,
  }
}

export function improvementCase(
  scope = 'personal',
  id = 1,
  overrides: Partial<ImprovementCase> = {},
): ImprovementCase {
  return {
    ...improvementCaseDetail(id),
    interface_version: IMPROVEMENTS_INTERFACE_VERSION,
    scope,
    signal_summary: improvementSignalSummary(),
    ...overrides,
  }
}

export function improvementJob(
  id = 1,
  scope = 'personal',
  overrides: Partial<ImprovementJob> = {},
): ImprovementJob {
  return {
    client: 'codex',
    created_at: '2026-01-01T10:00:00Z',
    error_code: '',
    finished_at: null,
    id,
    kind: 'analysis',
    result_summary: '',
    scope,
    started_at: null,
    state: 'queued',
    ...overrides,
  }
}

export function improvementsSnapshot(
  scope = 'personal',
  overrides: Partial<ImprovementsReadModel> = {},
): ImprovementsReadModel {
  return {
    cases: [],
    interface_version: IMPROVEMENTS_INTERFACE_VERSION,
    jobs: [],
    profile: improvementProfile(scope),
    scope,
    signal_summary: improvementSignalSummary(),
    ...overrides,
  }
}
