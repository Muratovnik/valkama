/**
 * A dashboard payload for the harness, half-observed on purpose.
 *
 * Its own file for the reason the execution and memory fixtures got theirs: a
 * fixture belongs to the module whose payload it is, and `harness.ts` mounts
 * surfaces rather than collecting every module's data.
 *
 * Half-observed is the whole point of the shape. The coverage line and the
 * per-attempt provenance are what these surfaces exist to render, and a fixture
 * where everything answered would never show either.
 */

import type { DashboardPayload } from '@/shared/types/analytics.ts'

import { projectId, spaceRef } from './planningFixtures.ts'

const now = new Date().toISOString()

export const analyticsPayload: DashboardPayload = {
  interface_version: 'dashboard',
  planning_space: 'MAIN',
  as_of: now,
  // Half-observed on purpose: the coverage line is what this surface is for,
  // and a fixture where everything answered would never render it.
  executions: {
    attempts: 9,
    truncated: false,
    // Two of the nine, and deliberately unlike each other: one observed with a
    // trace to follow, one that nobody measured. A drill-down where every row
    // answered would never show what the coverage line is warning about.
    attempt_rows: [
      {
        execution_id: `exec-${'a'.repeat(32)}`,
        work_item: 'MAIN-1',
        status: 'complete',
        outcome: 'delivered',
        client_family: 'claude',
        model: 'opus',
        role: 'executor',
        environment: 'workdir',
        started_at: now,
        ended_at: now,
        wall_seconds: 2640,
        tokens: 412_000,
        tokens_quality: 'observed',
        source: { adapter_id: 'claude-journal-telemetry', quality: 'confirmed' },
        sessions: ['sess-claude-1'],
        changed_files: 3,
      },
      {
        execution_id: `exec-${'b'.repeat(32)}`,
        work_item: 'MAIN-2',
        status: 'running',
        outcome: '',
        client_family: 'codex',
        model: '',
        role: 'executor',
        environment: 'worktree',
        started_at: now,
        ended_at: '',
        wall_seconds: null,
        tokens: null,
        tokens_quality: 'unknown',
        source: { adapter_id: '', quality: 'unknown' },
        sessions: [],
        changed_files: null,
      },
    ],
    attempt_rows_truncated: false,
    delivered: 5,
    ended: 7,
    statuses: [
      { name: 'complete', attempts: 5 },
      { name: 'partial', attempts: 2 },
      { name: 'running', attempts: 2 },
    ],
    clients: [
      { name: 'claude', attempts: 6 },
      { name: 'codex', attempts: 3 },
    ],
    models: [{ name: 'opus', attempts: 6 }],
    execution_wall_time: { seconds: 18_240, observed: 7, coverage: 'partial' },
    execution_active_time: { seconds: null, coverage: 'unknown' },
    tokens: {
      input: { value: 412_000, quality: 'observed' },
      cached_read: { value: 8_140_233, quality: 'observed' },
      cache_write: { value: 96_400, quality: 'observed' },
      output: { value: 61_200, quality: 'observed' },
      reasoning: { value: null, quality: 'unknown' },
      total: { value: 573_600, quality: 'observed' },
    },
    tokens_coverage: 'partial',
    tools: [
      { name: 'Read', server: '', calls: 128, errors: 3 },
      { name: 'memory_save', server: 'agentmemory', calls: 14, errors: 0 },
    ],
    observed_attempts: 6,
  },
  filters: {
    epic: null,
    client: null,
    agent: null,
    environment: null,
    tool: null,
    status: null,
    date_from: null,
    date_to: null,
    as_of: null,
  },
  facets: { agents: [], clients: [], environments: [], tools: [] },
  history_coverage: {
    overall: 'confirmed',
    states: { confirmed: 3 },
    work_items: 3,
    intervals: 6,
    as_of: now,
  },
  evidence_coverage: {
    overall: 'confirmed',
    states: { linked: 2, other_space: 0, unlinked: 0 },
    events: 2,
    as_of: now,
  },
  kpis: {
    inventory: 3,
    completed: 2,
    cycle_seconds: 7200,
    cycle_observed: 2,
    blocked: 0,
    reopened: 0,
    throughput: 2,
    unknown_status: 0,
  },
  // The space's own states, which is what names and tones every chart row.
  states: [
    { key: 'backlog', category: 'backlog' },
    { key: 'todo', category: 'queued' },
    { key: 'dev', category: 'active' },
    { key: 'review', category: 'review' },
    { key: 'done', category: 'completed' },
    { key: 'blocked', category: 'blocked' },
  ],
  flow: { backlog: 1, todo: 0, dev: 1, review: 0, done: 2, blocked: 0, unknown: 0 },
  status_time: Object.fromEntries(
    ['backlog', 'todo', 'dev', 'review', 'done', 'blocked'].map((state) => [
      state,
      {
        seconds: 3600,
        visits: 1,
        observed_cards: 1,
        coverage: 'confirmed',
        coverage_counts: { confirmed: 1, inferred: 0, partial: 0, unknown: 0 },
      },
    ]),
  ) as DashboardPayload['status_time'],
  throughput: Array.from({ length: 10 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    count: (index % 4) + 1,
  })),
  agents: [{ agent: 'codex', events: 2 }],
  session_analytics: {
    events: 2,
    evidence_coverage: {
      overall: 'confirmed',
      states: { linked: 2, other_space: 0, unlinked: 0 },
      events: 2,
      as_of: now,
    },
    clients: [{ name: 'codex', events: 2 }],
    servers: [],
    tools: [{ name: 'Read', events: 2 }],
    statuses: [],
    tool_usage: [
      {
        name: 'unknown·Read',
        calls: 2,
        success: 2,
        error: 0,
        coverage: 'confirmed',
        server: 'unknown',
        tool: 'Read',
        ok: 2,
        unknown: 0,
        quality: 'durable/session_events',
        unique_sessions: 1,
        observed: true,
        observation: 'observed',
      },
    ],
    runtime: [{ name: 'desktop', sessions: 2, coverage: 'confirmed', events: 2 }],
    agents: [],
  },
  longest_open: [],
  work_items: [
    {
      id: 'MAIN-1',
      title: 'Observed analytics contract',
      column: 'dev',
      live_column: 'dev',
      parent_id: null,
      claim_ref: 'codex',
      priority: 'high',
      status_history: {
        segments: [
          {
            status: 'dev',
            start: now,
            end: now,
            duration_seconds: 0,
            quality: 'confirmed',
            visit: 1,
          },
        ],
        coverage: 'confirmed',
        status_time: { dev: 0 },
        visits: { dev: 1 },
        cycle_seconds: null,
        reopened: 0,
        current_status: 'dev',
        current_seconds: 0,
        lower_bound: false,
        as_of: now,
      },
      sessions: ['session-observed'],
    },
  ],
  usage: {
    source: 'session-events',
    quality: 'confirmed',
    status: 'recorded',
    observation: 'observed',
    totals: { input: 120, output: 30 },
    cost: null,
    cost_quality: 'unknown',
    sessions: [
      {
        session_id: 'session-observed',
        source: 'local_journal',
        quality: 'derived/internal',
        observation: 'observed',
        observed: true,
        tokens: { input: 120, output: 30 },
        cost: null,
        cost_quality: 'unknown',
        model: 'gpt-5',
        daily: [
          {
            date: '2026-08-09',
            tokens: { input: 120, output: 30 },
            observed: true,
            observation: 'observed',
            quality: 'derived/internal',
            unknown: false,
            reason: null,
          },
        ],
        daily_unknown: false,
        shared: false,
        exclusive: true,
        work_items: ['MAIN-1'],
        planning_spaces: ['MAIN'],
      },
    ],
    observed_sessions: 2,
    linked_sessions: 2,
    global_linked_sessions: 2,
    note: '',
    token_daily: [
      {
        date: '2026-08-09',
        tokens: { input: 120, output: 30 },
        observed: true,
        observation: 'recorded',
        quality: 'confirmed',
        unknown: false,
        shared: false,
        reason: null,
      },
    ],
    daily_observation: 'observed',
    daily_quality: 'derived/internal',
    daily_unknown: false,
  },
}

/**
 * Two projects that were not configured the same way.
 *
 * That is the whole point of a cross-project mode: one answered through a
 * journal adapter and one answered through nothing, so the combined coverage
 * has to be recomputed rather than merged, and the row that cannot say what it
 * cost has to say so rather than showing a zero.
 */
export const portfolioPayload = {
  interface_version: 'dashboard-portfolio',
  projects: [
    {
      project_id: projectId,
      space_key: spaceRef.space_key,
      space_name: spaceRef.space_key,
      inventory: 4,
      completed: 1,
      blocked: 1,
      states: [
        { key: 'todo', items: 2 },
        { key: 'dev', items: 1 },
        { key: 'done', items: 1 },
      ],
      cycle_seconds: 36_000,
      cycle_observed: 1,
      attempts: 2,
      delivered: 1,
      ended: 1,
      observed_attempts: 1,
      tokens: 573_600,
      tokens_coverage: 'partial',
      wall_seconds: 2640,
      wall_observed: 1,
      wall_coverage: 'partial',
      adapters: ['claude-journal-telemetry'],
    },
    {
      project_id: 'unmeasured',
      space_key: 'UNM',
      space_name: 'Unmeasured',
      inventory: 2,
      completed: 0,
      blocked: 0,
      states: [{ key: 'todo', items: 2 }],
      cycle_seconds: null,
      cycle_observed: 0,
      attempts: 1,
      delivered: 0,
      ended: 0,
      observed_attempts: 0,
      tokens: null,
      tokens_coverage: 'unknown',
      wall_seconds: null,
      wall_observed: 0,
      wall_coverage: 'unknown',
      adapters: [],
    },
  ],
  truncated: false,
  totals: {
    projects: 2,
    inventory: 6,
    completed: 1,
    blocked: 1,
    attempts: 3,
    delivered: 1,
    ended: 1,
    cycle_seconds: 36_000,
    cycle_observed: 1,
    tokens: 573_600,
    tokens_coverage: 'partial',
    wall_seconds: 2640,
    wall_coverage: 'partial',
    adapters: ['claude-journal-telemetry'],
  },
}
