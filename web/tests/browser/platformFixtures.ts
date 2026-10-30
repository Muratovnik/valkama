/**
 * What the analyzer profile answers, for the same one project the board
 * fixtures describe.
 */
export const signalSummary = {
  total: 0,
  source_counts: { session_event: 0, agentmemory_lesson: 0, user_feedback: 0 },
  session_count: 0,
  last_recorded_at: null,
}
export const improvementProfile = {
  interface_version: 'improvements-api',
  scope: 'personal',
  revision: 0,
  enabled: false,
  purpose: '',
  expected_behavior: '',
  allowed_targets: [],
  excluded_targets: ['product-code'],
  analyzer_client: 'codex',
  analyzer_model: '',
  reasoning_effort: '',
  planning_space: '',
  schedule: { mode: 'manual', interval_hours: 24 },
  limits: { lookback_days: 30, max_sessions: 20, max_chars: 60_000 },
  capabilities: { can_analyze: false, can_approve: false },
  signal_summary: signalSummary,
}
