/**
 * The two execution payloads the inspector reads, as the server answers them.
 *
 * Apart from `planningFixtures.ts` because they answer to a different module:
 * the item is Planning's record and the attempts are the execution module's,
 * and the fixture file follows the same split the read models do.
 */

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'

import { now, projectId, workItemRef } from './planningFixtures.ts'

/**
 * What the clients accept, as the server answers it.
 *
 * One driver ready and one not, because the launch form treats them
 * differently: an installed client is chosen, an absent one stays in the list
 * and says why. The effort vocabularies differ here exactly as they differ in
 * the drivers — that difference is the reason this payload exists at all.
 */
export const executionCapabilities = {
  interface_version: 'valkama-execution-api',
  drivers: [
    {
      client: 'claude',
      adapter_lineage_id: 'claude-code-execution',
      models: ['fable', 'opus', 'sonnet', 'haiku'],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
      exact_resume: true,
      assigns_session_identity: true,
      mechanical_executor: true,
      result_transport: 'stdout',
      telemetry_configuration: 'environment',
      health: 'ready',
      unavailable_reason: '',
    },
    {
      client: 'codex',
      adapter_lineage_id: 'codex-execution',
      models: ['gpt-5.6-sol'],
      efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      exact_resume: true,
      assigns_session_identity: false,
      mechanical_executor: false,
      result_transport: 'file',
      telemetry_configuration: 'client-config',
      health: 'unavailable',
      unavailable_reason: 'codex is not on PATH; set VALKAMA_CODEX_BIN to its absolute path',
    },
  ],
  roles: ['executor', 'orchestrator'],
  environments: ['workdir', 'worktree', 'wsl'],
  expected_effects: ['change_required', 'no_change_acceptable', 'read_only_finding'],
  review_modes: ['', 'decision_review', 'acceptance_review', 'adversarial_review'],
  review_verdicts: {
    decision_review: ['proceed', 'change', 'stop'],
    acceptance_review: ['ship', 'fix-first', 'rethink'],
    adversarial_review: ['risk-found', 'no-material-risk-found'],
  },
  max_prompt_chars: 8000,
  repository: 'C:/work/valkama',
  repository_status: 'mapped',
}

/** One finished attempt, with the evidence half a reported delivery is checked against. */
export const executionHistory = {
  interface_version: 'valkama-execution-api',
  work_item: workItemRef.reference,
  executions: [
    {
      execution_id: 'exec-0f1e2d3c4b5a69788796a5b4c3d2e1f0',
      work_item_id: workItemRef.reference,
      project_id: projectId,
      adapter_lineage_id: 'claude-code-execution',
      client_family: 'claude',
      role: 'executor',
      environment: 'workdir',
      model: 'opus',
      effort: 'high',
      expected_effect: 'change_required',
      review_mode: '',
      status: 'complete',
      presence: 'terminal',
      outcome: 'complete',
      launch_id: 'launch-abc123def456',
      cwd: 'C:/work/valkama',
      resumed_from: '',
      exit_code: 0,
      result: {
        outcome: 'complete',
        delivery: 'The route is dispatched and the client knows the field.',
        oracle: 'the suite passes',
        unresolved: '',
        structured: true,
        expected_effect: 'change_required',
      },
      base_artifact: {
        repository: 'C:/work/valkama',
        head: '1111111111111111111111111111111111111111',
        branch: 'main',
        dirty: false,
        worktree: 'C:/work/valkama',
        quality: 'observed',
      },
      final_artifact: {
        head: '2222222222222222222222222222222222222222',
        branch: 'main',
        dirty: false,
        changed_files: 3,
        insertions: 42,
        deletions: 7,
        commits: ['2222222222222222222222222222222222222222'],
        quality: 'observed',
      },
      started_at: now,
      ended_at: now,
      revision: 2,
      sessions: [
        {
          session_id: '11111111-2222-4333-8444-555555555555',
          relation: 'launched',
          status: 'ended',
          attention: '',
          client: 'claude',
        },
      ],
    },
  ],
}

/** The id the attempt above opened, so the jump from the item lands somewhere. */
export const launchedSessionId = '11111111-2222-4333-8444-555555555555'
const sessionResourceRef = planningSpaceEntity(workItemRef.space_ref)

/**
 * Two sessions, because the monitor has two jobs: one carries work and can be
 * followed to it, and one carries none and is where attaching happens.
 */
export const monitorSessions = [
  {
    id: launchedSessionId,
    execution_id: 'exec-0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    client: 'claude',
    client_family: 'claude' as const,
    adapter_id: 'claude-sessions',
    cwd: 'C:/work/valkama',
    label: `${workItemRef.reference} the launched one`,
    work_item: workItemRef.reference,
    space_root: {
      canonical_root: 'C:/work/valkama',
      reason: '',
      resource_ref: sessionResourceRef,
      status: 'mapped' as const,
    },
    status: 'ended' as const,
    attention: '',
    attention_seen: true,
    started_at: now,
    last_seen: now,
    ended_at: now,
    quiet_seconds: 60,
    current_step: '',
    presence: 'terminal' as const,
    scope: projectId,
  },
  {
    id: '99999999-8888-4777-8666-555555555555',
    client: 'codex',
    client_family: 'codex' as const,
    adapter_id: 'codex-sessions',
    cwd: 'C:/work/elsewhere',
    label: 'an interactive session nobody launched',
    work_item: null,
    status: 'active' as const,
    attention: '',
    attention_seen: true,
    started_at: now,
    last_seen: now,
    ended_at: null,
    quiet_seconds: 10,
    current_step: '',
    presence: 'connected' as const,
  },
]

/**
 * What the attempt above cost, as the local journal reported it.
 *
 * Deliberately not all observed: `reasoning` has no value and the second
 * session answered nothing, because the states worth rendering are the ones
 * where a number is absent rather than zero.
 */
export const executionUsage = {
  interface_version: 'valkama-execution-api',
  usage: {
    scope: {
      project_id: projectId,
      work_item: workItemRef.reference,
      work_item_id: '00000000-0000-4000-8000-000000000264',
      execution_id: 'exec-0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    },
    window: { started_at: now, ended_at: now },
    duration: {
      wall_ms: { value: 642_000, quality: 'observed' },
      active_ms: { value: null, quality: 'unsupported' },
    },
    tokens: {
      input: { value: 180_000, quality: 'observed' },
      cached_read: { value: 1_416_131_861, quality: 'observed' },
      cache_write: { value: 120_000, quality: 'observed' },
      output: { value: 14_000, quality: 'observed' },
      reasoning: { value: null, quality: 'unknown' },
      total: { value: 216_000, quality: 'observed' },
    },
    cost: { amount: { value: null, quality: 'unknown' }, currency: null },
    models: [{ id: 'opus', sessions: 1, quality: 'observed' }],
    tools: [
      { name: 'Read', server: '', calls: 42, errors: 1, unknown: 0, quality: 'observed' },
      { name: 'Edit', server: '', calls: 7, errors: 0, unknown: 0, quality: 'observed' },
    ],
    sessions: [
      { session_id: launchedSessionId, client: 'claude', observed: true, reason: '' },
      {
        session_id: 'a-resumed-one',
        client: 'claude',
        observed: false,
        reason: 'no exact local journal file configured for this session',
      },
    ],
    provenance: {
      adapter_id: 'claude-journal-telemetry',
      connection_id: 'local',
      observed_at: now,
      source_quality: 'partial',
    },
    coverage: { time: 'confirmed', tokens: 'partial', cost: 'unknown', tools: 'confirmed' },
  },
}
