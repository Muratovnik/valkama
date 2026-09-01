import type { WorkItem } from '@/shared/api/planningModel.ts'

type Priority = WorkItem['priority']
type StateCategory = WorkItem['state']['category']
/**
 * The analytics read model: work over time, tool usage and the filters.
 *
 * A state is named by its own key throughout, and the key is the space's own
 * text rather than one of six fixed lane names — which is why every `status`
 * and `column` below is a plain string.
 */

type CoverageConfidence = 'confirmed' | 'inferred' | 'partial' | 'unknown'
/** Where a session's evidence sits relative to the space being read. */
type EvidenceBucket = 'linked' | 'other_space' | 'unlinked'

interface AnalyticsWorkItem {
  claim_ref: string
  /** The state reconstructed for `as_of`, which is what every chart counts. */
  column: string | null
  /** A work item reference — `MAIN-264` — not a row id. */
  id: string
  /** The state stored right now, kept only as an explicit diagnostic. */
  live_column: string
  parent_id: string | null
  priority: Priority
  sessions: string[]
  status_history: {
    as_of: string
    coverage: CoverageConfidence
    current_seconds: number | null
    current_status: string | null
    cycle_seconds: number | null
    lower_bound: boolean
    reopened: number
    segments: Array<{
      duration_seconds: number | null
      end: string | null
      quality: 'confirmed' | 'inferred' | 'unknown'
      start: string | null
      status: string | null
      visit: number
    }>
    status_time: Record<string, number | null>
    visits: Record<string, number>
  }
  title: string
}

interface DashboardUsageSession {
  cost: number | null
  cost_quality: string
  daily: SessionDailyTokenRow[]
  daily_unknown: boolean
  exclusive: boolean
  model: string | null
  observation: string
  observed: boolean
  planning_spaces: string[]
  quality: string
  session_id: string
  shared: boolean
  source: string
  tokens: Record<string, number> | null
  work_items: string[]
  reason?: string
}

/** A selectable evidence value returned by the analytics projection. */
interface AnalyticsFacet {
  count: number
  value: string
  label?: string
}

/** Every facet is calculated from the same scoped evidence as the charts. */
interface DashboardFacets {
  agents: AnalyticsFacet[]
  clients: AnalyticsFacet[]
  environments: AnalyticsFacet[]
  tools: AnalyticsFacet[]
}

export interface DashboardFilters {
  agent: string | null
  as_of: string | null
  client: string | null
  date_from: string | null
  date_to: string | null
  environment: string | null
  epic: string | number | null
  status: string | null
  tool: string | null
}

/** A stacked tool/MCP usage row; absent evidence yields no row. */
interface ToolUsageRow {
  calls: number
  coverage: string
  error: number
  name: string
  observation: string
  observed: boolean
  ok: number
  quality: string
  server: string
  success: number
  tool: string
  unique_sessions: number
  unknown: number
}

/** Runtime/environment distribution from observed session evidence. */
interface RuntimeDistributionRow {
  coverage: string
  events: number
  name: string
  sessions: number | null
}

interface DailyTokenBase {
  date: string
  observation: string
  observed: boolean
  quality: string
  reason: string | null
  tokens: Record<string, number> | null
  unknown: boolean
}

/** One session's daily token delta, before cross-session attribution is added. */
type SessionDailyTokenRow = DailyTokenBase

/** A daily token delta; null means it was not observed, never zero. */
interface DailyTokenRow extends DailyTokenBase {
  shared: boolean
}

interface DashboardFlow {
  [state: string]: number
  unknown: number
}

export interface DashboardPayload {
  agents: Array<{ agent: string; events: number }>
  as_of: string
  /** Session evidence stays attributable to the space it belongs to. */
  evidence_coverage: {
    as_of: string
    events: number
    overall: CoverageConfidence
    states: Record<EvidenceBucket, number>
  }
  /**
   * What was attempted at this space's work. Its own block rather than four
   * more KPIs, because its coverage is its own: an attempt whose journal was
   * never configured lowers confidence in a token total without lowering the
   * count of attempts.
   */
  executions: {
    /**
     * The rows behind every figure in this block, newest first.
     *
     * Bounded below the aggregation on purpose: the totals describe the space
     * and the list is read rather than exported, so `attempt_rows_truncated`
     * is a different flag from `truncated`.
     */
    attempt_rows: Array<{
      changed_files: number | null
      client_family: string
      ended_at: string
      environment: string
      execution_id: string
      model: string
      outcome: string
      role: string
      sessions: string[]
      /** Who answered for this attempt, not for the block. */
      source: { adapter_id: string; quality: string }
      started_at: string
      status: string
      tokens: number | null
      tokens_quality: string
      wall_seconds: number | null
      work_item: string
    }>
    attempt_rows_truncated: boolean
    attempts: number
    clients: Array<{ attempts: number; name: string }>
    delivered: number
    ended: number
    execution_active_time: { coverage: string; seconds: number | null }
    execution_wall_time: { coverage: string; observed: number; seconds: number | null }
    models: Array<{ attempts: number; name: string }>
    observed_attempts: number
    statuses: Array<{ attempts: number; name: string }>
    tokens: Record<string, { quality: string; value: number | null }>
    tokens_coverage: string
    tools: Array<{ calls: number; errors: number; name: string; server: string }>
    truncated: boolean
  }
  facets: DashboardFacets
  filters: DashboardFilters
  flow: DashboardFlow
  /** Work-item lifecycle observations; never conflated with session evidence. */
  history_coverage: {
    as_of: string
    intervals: number
    overall: CoverageConfidence
    states: Record<string, number>
    work_items: number
  }
  interface_version: 'dashboard'
  kpis: {
    blocked: number
    completed: number
    cycle_observed: number
    cycle_seconds: number | null
    inventory: number
    reopened: number
    throughput: number | null
    unknown_status: number
  }
  longest_open: Array<{
    column: string | null
    current_segment_seconds: number | null
    /** A work item reference, which is what opening the row navigates by. */
    id: string
    lower_bound: boolean
    quality: string
    seconds: number | null
    state_category: StateCategory
    title: string
  }>
  planning_space: string
  session_analytics: {
    agents: Array<{ events: number; name: string }>
    clients: Array<{ events: number; name: string }>
    events: number
    evidence_coverage: {
      as_of: string
      events: number
      overall: CoverageConfidence
      states: Record<EvidenceBucket, number>
    }
    runtime: RuntimeDistributionRow[]
    servers: Array<{ events: number; name: string }>
    statuses: Array<{ events: number; name: string }>
    tool_usage: ToolUsageRow[]
    tools: Array<{ events: number; name: string }>
  }
  /**
   * The space's own states, in workflow order, with the category each belongs
   * to. Nothing else in this payload says what the keys under `flow` are
   * called or how to read them.
   */
  states: Array<{ category: StateCategory; key: string }>
  status_time: Record<
    string,
    {
      coverage: string
      coverage_counts: Record<CoverageConfidence, number>
      observed_cards: number
      seconds: number | null
      visits: number | null
    }
  >
  throughput: Array<{ count: number; date: string }>
  usage: {
    cost: number | null
    cost_quality: string
    daily_observation: string
    daily_quality: string
    daily_unknown: boolean
    global_linked_sessions: number
    linked_sessions: number
    note: string
    observation: string
    observed_sessions: number
    quality: string
    sessions: DashboardUsageSession[]
    source: string
    status: string
    token_daily: DailyTokenRow[]
    totals: Record<string, number> | null
  }
  /** Every work item in scope with its reconstructed lifecycle. */
  work_items: AnalyticsWorkItem[]
}
