import type { AnalyticsPortfolio } from '@/entities/analytics/api/analyticsApi.ts'

import { plainObject, strictObject, z } from '@/shared/api/contract.ts'
import type { DashboardPayload } from '@/shared/types/analytics.ts'

const DASHBOARD_INTERFACE_VERSION = 'dashboard' as const
const DASHBOARD_CONTRACT_ERROR_CODE = 'dashboard_contract_invalid' as const
const text = z.string().max(4096)
const optionalText = text.nullable()
const count = z.number().int().nonnegative()
const quantity = z.number().finite().nonnegative().nullable()
const coverage = z.enum(['confirmed', 'inferred', 'partial', 'unknown'])
const aggregateCoverage = z.enum(['confirmed', 'partial', 'unknown'])
const stateCategory = z.enum([
  'backlog',
  'queued',
  'active',
  'review',
  'completed',
  'blocked',
  'cancelled',
])
const dashboardFlow = plainObject.pipe(z.object({ unknown: count }).catchall(count))

const evidenceCoverage = strictObject({
  overall: coverage,
  states: strictObject({ linked: count, other_space: count, unlinked: count }),
  events: count,
  as_of: text,
})

const filters = strictObject({
  epic: z.union([text, count]).nullable(),
  client: optionalText,
  agent: optionalText,
  environment: optionalText,
  tool: optionalText,
  status: optionalText,
  date_from: optionalText,
  date_to: optionalText,
  as_of: optionalText,
})

const executionAttempt = strictObject({
  execution_id: text,
  work_item: text,
  status: text,
  outcome: text,
  client_family: text,
  model: text,
  role: text,
  environment: text,
  started_at: text,
  ended_at: text,
  wall_seconds: quantity,
  tokens: quantity,
  tokens_quality: text,
  source: strictObject({ adapter_id: text, quality: text }),
  sessions: z.array(text).max(512),
  changed_files: quantity,
})

const executions = strictObject({
  attempts: count,
  truncated: z.boolean(),
  attempt_rows: z.array(executionAttempt).max(100),
  attempt_rows_truncated: z.boolean(),
  delivered: count,
  ended: count,
  statuses: z.array(strictObject({ name: text, attempts: count })).max(32),
  clients: z.array(strictObject({ name: text, attempts: count })).max(32),
  models: z.array(strictObject({ name: text, attempts: count })).max(128),
  execution_wall_time: strictObject({ seconds: quantity, observed: count, coverage: text }),
  execution_active_time: strictObject({ seconds: quantity, coverage: text }),
  tokens: strictObject({
    input: strictObject({ value: quantity, quality: text }),
    cached_read: strictObject({ value: quantity, quality: text }),
    cache_write: strictObject({ value: quantity, quality: text }),
    output: strictObject({ value: quantity, quality: text }),
    reasoning: strictObject({ value: quantity, quality: text }),
    total: strictObject({ value: quantity, quality: text }),
  }),
  tokens_coverage: text,
  tools: z.array(strictObject({ name: text, server: text, calls: count, errors: count })).max(1024),
  observed_attempts: count,
})

const statusSegment = strictObject({
  status: optionalText,
  start: optionalText,
  end: optionalText,
  duration_seconds: quantity,
  quality: z.enum(['confirmed', 'inferred', 'unknown']),
  visit: count,
})

const analyticsWorkItem = strictObject({
  id: text,
  title: text,
  column: optionalText,
  live_column: text,
  parent_id: optionalText,
  claim_ref: text,
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  status_history: strictObject({
    segments: z.array(statusSegment).max(2048),
    coverage,
    status_time: z.record(z.string(), quantity),
    visits: z.record(z.string(), count),
    cycle_seconds: quantity,
    reopened: count,
    current_status: optionalText,
    current_seconds: quantity,
    lower_bound: z.boolean(),
    as_of: text,
  }),
  sessions: z.array(text).max(512),
})

const toolUsage = strictObject({
  name: text,
  calls: count,
  success: count,
  error: count,
  coverage: text,
  server: text,
  tool: text,
  ok: count,
  unknown: count,
  quality: text,
  unique_sessions: count,
  observed: z.boolean(),
  observation: text,
})

const dailyTokenShape = {
  date: text,
  tokens: z.record(z.string(), z.number().finite().nonnegative()).nullable(),
  observed: z.boolean(),
  observation: text,
  quality: text,
  unknown: z.boolean(),
  reason: optionalText,
}

const sessionDailyTokens = strictObject(dailyTokenShape)
const aggregateDailyTokens = strictObject({ ...dailyTokenShape, shared: z.boolean() })

const usageSession = strictObject({
  session_id: text,
  source: text,
  quality: text,
  observation: text,
  observed: z.boolean(),
  tokens: z.record(z.string(), z.number().finite().nonnegative()).nullable(),
  cost: quantity,
  cost_quality: text,
  model: optionalText,
  daily: z.array(sessionDailyTokens).max(3660),
  daily_unknown: z.boolean(),
  reason: text.optional(),
  shared: z.boolean(),
  exclusive: z.boolean(),
  work_items: z.array(text).max(512),
  planning_spaces: z.array(text).max(128),
})

const dashboardSchema = strictObject({
  interface_version: z.literal(DASHBOARD_INTERFACE_VERSION),
  planning_space: text,
  as_of: text,
  filters,
  history_coverage: strictObject({
    overall: coverage,
    states: z.record(z.string(), count),
    work_items: count,
    intervals: count,
    as_of: text,
  }),
  evidence_coverage: evidenceCoverage,
  kpis: strictObject({
    inventory: count,
    completed: count,
    cycle_seconds: quantity,
    cycle_observed: count,
    blocked: count,
    reopened: count,
    throughput: quantity,
    unknown_status: count,
  }),
  states: z.array(strictObject({ key: text, category: stateCategory })).max(128),
  flow: dashboardFlow,
  status_time: z.record(
    z.string(),
    strictObject({
      seconds: quantity,
      visits: quantity,
      observed_cards: count,
      coverage: text,
      coverage_counts: strictObject({
        confirmed: count,
        inferred: count,
        partial: count,
        unknown: count,
      }),
    }),
  ),
  throughput: z.array(strictObject({ date: text, count })).max(3660),
  agents: z.array(strictObject({ agent: text, events: count })).max(2048),
  facets: strictObject({
    agents: z.array(strictObject({ value: text, count, label: text.optional() })).max(2048),
    clients: z.array(strictObject({ value: text, count, label: text.optional() })).max(2048),
    environments: z.array(strictObject({ value: text, count, label: text.optional() })).max(2048),
    tools: z.array(strictObject({ value: text, count, label: text.optional() })).max(2048),
  }),
  session_analytics: strictObject({
    events: count,
    evidence_coverage: evidenceCoverage,
    clients: z.array(strictObject({ name: text, events: count })).max(2048),
    servers: z.array(strictObject({ name: text, events: count })).max(2048),
    tools: z.array(strictObject({ name: text, events: count })).max(4096),
    statuses: z.array(strictObject({ name: text, events: count })).max(128),
    runtime: z
      .array(strictObject({ name: text, sessions: quantity, coverage: text, events: count }))
      .max(128),
    agents: z.array(strictObject({ name: text, events: count })).max(2048),
    tool_usage: z.array(toolUsage).max(4096),
  }),
  longest_open: z
    .array(
      strictObject({
        id: text,
        title: text,
        column: optionalText,
        state_category: stateCategory,
        seconds: quantity,
        current_segment_seconds: quantity,
        quality: text,
        lower_bound: z.boolean(),
      }),
    )
    .max(10),
  work_items: z.array(analyticsWorkItem).max(10_000),
  usage: strictObject({
    source: text,
    quality: text,
    status: text,
    observation: text,
    sessions: z.array(usageSession).max(10_000),
    totals: z.record(z.string(), z.number().finite().nonnegative()).nullable(),
    cost: quantity,
    cost_quality: text,
    observed_sessions: count,
    linked_sessions: count,
    global_linked_sessions: count,
    token_daily: z.array(aggregateDailyTokens).max(3660),
    daily_observation: text,
    daily_quality: text,
    daily_unknown: z.boolean(),
    note: text,
  }),
  executions,
})

const portfolioProject = strictObject({
  project_id: text,
  space_key: text,
  space_name: text,
  inventory: count,
  completed: count,
  blocked: count,
  states: z.array(strictObject({ key: text, items: count })).max(128),
  cycle_seconds: quantity,
  cycle_observed: count,
  attempts: count,
  delivered: count,
  ended: count,
  observed_attempts: count,
  tokens: quantity,
  tokens_coverage: aggregateCoverage,
  wall_seconds: quantity,
  wall_observed: count,
  wall_coverage: aggregateCoverage,
  adapters: z.array(text).max(128),
})

const portfolioSchema = strictObject({
  interface_version: z.literal('dashboard-portfolio'),
  projects: z.array(portfolioProject).max(25),
  truncated: z.boolean(),
  totals: strictObject({
    projects: count,
    inventory: count,
    completed: count,
    blocked: count,
    attempts: count,
    delivered: count,
    ended: count,
    cycle_seconds: quantity,
    cycle_observed: count,
    tokens: quantity,
    tokens_coverage: aggregateCoverage,
    wall_seconds: quantity,
    wall_coverage: aggregateCoverage,
    adapters: z.array(text).max(128),
  }),
})

/** A stable error code for callers; the issue path stays in the message. */
class DashboardContractError extends Error {
  readonly code = DASHBOARD_CONTRACT_ERROR_CODE

  constructor(path: string) {
    super(`${DASHBOARD_CONTRACT_ERROR_CODE}: ${path}`)
    this.name = 'DashboardContractError'
  }
}

/** Dynamic lane names still have one exact shape: every declared lane and `unknown`. */
function validateFlowShape(payload: DashboardPayload): DashboardPayload {
  const stateKeys = payload.states.map((state) => state.key)
  const declared = new Set(stateKeys)
  if (declared.size !== stateKeys.length) throw new DashboardContractError('states: duplicate key')
  const expected = new Set([...declared, 'unknown'])
  for (const key of expected) {
    if (!Object.hasOwn(payload.flow, key)) throw new DashboardContractError(`flow.${key}`)
  }
  for (const key of Object.keys(payload.flow)) {
    if (!expected.has(key)) throw new DashboardContractError(`flow.${key}`)
  }
  return payload
}

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  throw new DashboardContractError(issue.path.length ? issue.path.join('.') : issue.message)
}

export function validateDashboardPayload(payload: unknown): DashboardPayload {
  return validateFlowShape(parse(dashboardSchema, payload))
}

export function validateAnalyticsPortfolio(payload: unknown): AnalyticsPortfolio {
  return parse(portfolioSchema, payload)
}
