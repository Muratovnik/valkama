export type SemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
type SemanticEmphasis = 'quiet' | 'strong'

export type ClosedStateDimension =
  | 'connection-lifecycle'
  | 'platform-ui-state'
  | 'project-binding'
  | 'relation-state'
  | 'session-feed-result'
  | 'work-item-node-marker'
  | 'work-item-priority'
  | 'work-item-readiness'

export type OpenStateDimension =
  | 'work-item-state'
  | 'session'
  | 'execution'
  | 'job'
  | 'case'
  | 'activity-action'
  | 'improvement-readiness'
  | 'integration-health'
  | 'integration-intake'
  | 'registry-lifecycle'
  | 'skill-validation'
  | 'skill-readiness'

export type StateDimension = ClosedStateDimension | OpenStateDimension

export interface StatePresentation {
  emphasis: SemanticEmphasis
  tone: SemanticTone
}

/**
 * The token each tone renders as, for renderers that have no cascade.
 *
 * A canvas chart cannot resolve `var()`, so the value has to be a literal
 * somewhere. It lives here as a mirror of `tokens.css` rather than as a second
 * palette: `scripts/sync-tokens.mjs` reads this map and rewrites the colors
 * below from it, so the palette to edit is always the stylesheet. These drifted
 * into two different blues before anything compared them.
 *
 * @public read as source text by that script, which no import graph can see.
 */
export const SEMANTIC_TONE_TOKENS: Record<SemanticTone, string> = {
  neutral: '--color-text-tertiary',
  info: '--color-info',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
}

const SEMANTIC_TONE_COLORS: Record<SemanticTone, string> = {
  neutral: '#8f8f8f',
  info: '#7cacf8',
  success: '#7bd6a1',
  warning: '#d9b06a',
  danger: '#ef8479',
}

export function toneColor(tone: SemanticTone): string {
  return SEMANTIC_TONE_COLORS[tone]
}

const STATE_PRESENTATION = {
  /**
   * A work item's state, keyed by its *category* rather than its name.
   *
   * There used to be a `lane` map beside this one keying the same six tones by
   * the six names one workflow happens to use, which is why renaming Dev lost
   * its colour. A category is shared vocabulary, so an installation that
   * renames a state or adds a second active one keeps the reading.
   */
  'work-item-state': {
    backlog: { tone: 'neutral', emphasis: 'quiet' },
    queued: { tone: 'info', emphasis: 'quiet' },
    active: { tone: 'success', emphasis: 'quiet' },
    review: { tone: 'warning', emphasis: 'quiet' },
    completed: { tone: 'success', emphasis: 'quiet' },
    blocked: { tone: 'danger', emphasis: 'strong' },
    cancelled: { tone: 'neutral', emphasis: 'quiet' },
  },
  'work-item-priority': {
    low: { tone: 'neutral', emphasis: 'quiet' },
    medium: { tone: 'neutral', emphasis: 'quiet' },
    high: { tone: 'warning', emphasis: 'quiet' },
    urgent: { tone: 'danger', emphasis: 'strong' },
  },
  'work-item-node-marker': {
    ready: { tone: 'neutral', emphasis: 'quiet' },
    claimed: { tone: 'success', emphasis: 'quiet' },
    backlog: { tone: 'neutral', emphasis: 'quiet' },
    queued: { tone: 'neutral', emphasis: 'quiet' },
    active: { tone: 'neutral', emphasis: 'quiet' },
    review: { tone: 'neutral', emphasis: 'quiet' },
    completed: { tone: 'neutral', emphasis: 'quiet' },
    cancelled: { tone: 'neutral', emphasis: 'quiet' },
    blocked: { tone: 'danger', emphasis: 'strong' },
  },
  'session': {
    // Waiting for a person is the ordinary resting state of an agent, not a
    // fault: it was danger, so a monitor of idle sessions read as a monitor of
    // failures. Red is kept for a session that actually broke.
    attention: { tone: 'warning', emphasis: 'strong' },
    failed: { tone: 'danger', emphasis: 'strong' },
    active: { tone: 'success', emphasis: 'quiet' },
    working: { tone: 'success', emphasis: 'quiet' },
    waiting: { tone: 'neutral', emphasis: 'quiet' },
    recent: { tone: 'neutral', emphasis: 'quiet' },
    ended: { tone: 'neutral', emphasis: 'quiet' },
  },
  'session-feed-result': {
    normal: { tone: 'neutral', emphasis: 'quiet' },
    failed: { tone: 'danger', emphasis: 'strong' },
  },
  // What one attempt at a work item came to. Read alongside the session tones
  // above and they agree: a live attempt is green, a person being waited on is
  // neutral rather than red, and only a client that actually broke is danger.
  //
  // `refused` is warning rather than danger on purpose. A client that declined
  // the task reported honestly, which is a decision for the owner to look at,
  // not a fault. `attached` is neutral because Valkama makes no claim about a
  // session it did not run.
  'execution': {
    starting: { tone: 'info', emphasis: 'quiet' },
    running: { tone: 'success', emphasis: 'quiet' },
    complete: { tone: 'success', emphasis: 'quiet' },
    partial: { tone: 'warning', emphasis: 'quiet' },
    refused: { tone: 'warning', emphasis: 'strong' },
    failed: { tone: 'danger', emphasis: 'strong' },
    cancelled: { tone: 'neutral', emphasis: 'quiet' },
    attached: { tone: 'neutral', emphasis: 'quiet' },
  },
  'job': {
    queued: { tone: 'warning', emphasis: 'quiet' },
    running: { tone: 'info', emphasis: 'quiet' },
    succeeded: { tone: 'success', emphasis: 'quiet' },
    failed: { tone: 'danger', emphasis: 'strong' },
    cancelled: { tone: 'neutral', emphasis: 'quiet' },
  },
  'case': {
    open: { tone: 'info', emphasis: 'quiet' },
    collecting: { tone: 'info', emphasis: 'quiet' },
    watching: { tone: 'warning', emphasis: 'quiet' },
    implementing: { tone: 'info', emphasis: 'quiet' },
    validating: { tone: 'warning', emphasis: 'quiet' },
    approved: { tone: 'success', emphasis: 'quiet' },
    effective: { tone: 'success', emphasis: 'quiet' },
    resolved: { tone: 'success', emphasis: 'quiet' },
    regressed: { tone: 'danger', emphasis: 'strong' },
    false_positive: { tone: 'neutral', emphasis: 'quiet' },
  },
  // Activity providers may add action names without turning an unfamiliar
  // event into an alarm. The three completion-shaped actions are the only
  // shared positive vocabulary; every other action deliberately falls back.
  'activity-action': {
    released: { tone: 'success', emphasis: 'quiet' },
    checklist_released: { tone: 'success', emphasis: 'quiet' },
    checklist_completed: { tone: 'success', emphasis: 'quiet' },
  },
  'improvement-readiness': {
    disabled: { tone: 'neutral', emphasis: 'quiet' },
    needs_evidence: { tone: 'warning', emphasis: 'quiet' },
    analyzed_empty: { tone: 'info', emphasis: 'quiet' },
    ready: { tone: 'success', emphasis: 'quiet' },
  },
  'integration-health': {
    'ready': { tone: 'success', emphasis: 'quiet' },
    'not-observed': { tone: 'neutral', emphasis: 'quiet' },
    'degraded': { tone: 'warning', emphasis: 'strong' },
    'unavailable': { tone: 'danger', emphasis: 'strong' },
  },
  'integration-intake': {
    enabled: { tone: 'info', emphasis: 'quiet' },
    disabled: { tone: 'neutral', emphasis: 'quiet' },
  },
  'connection-lifecycle': {
    connecting: { tone: 'neutral', emphasis: 'quiet' },
    live: { tone: 'success', emphasis: 'quiet' },
    reconnecting: { tone: 'warning', emphasis: 'strong' },
  },
  'platform-ui-state': {
    'loading': { tone: 'info', emphasis: 'quiet' },
    'ready': { tone: 'success', emphasis: 'quiet' },
    'empty': { tone: 'neutral', emphasis: 'quiet' },
    'error': { tone: 'danger', emphasis: 'strong' },
    'unavailable': { tone: 'danger', emphasis: 'strong' },
    'permission-denied': { tone: 'danger', emphasis: 'strong' },
    'degraded': { tone: 'warning', emphasis: 'strong' },
  },
  // Whether one project resource has a single usable owner binding. An absent
  // binding is an ordinary not-yet-configured state; drift and ambiguity need
  // attention, and an unavailable owner is the only hard failure.
  'project-binding': {
    mapped: { tone: 'success', emphasis: 'quiet' },
    unbound: { tone: 'neutral', emphasis: 'quiet' },
    stale: { tone: 'warning', emphasis: 'strong' },
    detached: { tone: 'warning', emphasis: 'strong' },
    ambiguous: { tone: 'warning', emphasis: 'strong' },
    unavailable: { tone: 'danger', emphasis: 'strong' },
  },
  'relation-state': {
    resolved: { tone: 'success', emphasis: 'quiet' },
    missing: { tone: 'warning', emphasis: 'quiet' },
    ambiguous: { tone: 'warning', emphasis: 'strong' },
    unavailable: { tone: 'danger', emphasis: 'strong' },
    malformed: { tone: 'danger', emphasis: 'strong' },
  },
  // What the registry reports about an adapter, a service or a grant. The
  // settings screen used to colour these words from its own stylesheet, which
  // is the second status mapping this dimension exists to remove.
  'registry-lifecycle': {
    active: { tone: 'success', emphasis: 'quiet' },
    enabled: { tone: 'success', emphasis: 'quiet' },
    ready: { tone: 'success', emphasis: 'quiet' },
    registered: { tone: 'info', emphasis: 'quiet' },
    restricted: { tone: 'warning', emphasis: 'quiet' },
    degraded: { tone: 'warning', emphasis: 'strong' },
    blocked: { tone: 'danger', emphasis: 'strong' },
    revoked: { tone: 'danger', emphasis: 'strong' },
    unavailable: { tone: 'danger', emphasis: 'strong' },
  },
  'skill-validation': {
    valid: { tone: 'success', emphasis: 'quiet' },
    partial: { tone: 'warning', emphasis: 'quiet' },
    invalid: { tone: 'danger', emphasis: 'strong' },
  },
  'skill-readiness': {
    enabled: { tone: 'success', emphasis: 'quiet' },
    partial: { tone: 'info', emphasis: 'quiet' },
    disabled: { tone: 'neutral', emphasis: 'quiet' },
    unavailable: { tone: 'warning', emphasis: 'strong' },
    invalid: { tone: 'danger', emphasis: 'strong' },
  },
  'work-item-readiness': {
    ready: { tone: 'success', emphasis: 'quiet' },
    blocked: { tone: 'danger', emphasis: 'strong' },
  },
} satisfies Record<StateDimension, Record<string, StatePresentation>>

type ConnectionLifecycleState = keyof (typeof STATE_PRESENTATION)['connection-lifecycle']
type PlatformUiState = keyof (typeof STATE_PRESENTATION)['platform-ui-state']
type ProjectBindingState = keyof (typeof STATE_PRESENTATION)['project-binding']
type RelationState = keyof (typeof STATE_PRESENTATION)['relation-state']
type SessionFeedResultState = keyof (typeof STATE_PRESENTATION)['session-feed-result']
type WorkItemNodeMarkerState = keyof (typeof STATE_PRESENTATION)['work-item-node-marker']
type WorkItemPriorityState = keyof (typeof STATE_PRESENTATION)['work-item-priority']
type WorkItemReadinessState = keyof (typeof STATE_PRESENTATION)['work-item-readiness']

/**
 * A state and its dimension stay coupled where the platform owns the complete
 * vocabulary. Other dimensions remain open because their providers may add a
 * future state that should read as neutral rather than break the whole view.
 */
export type SemanticStatePair =
  | { dimension: 'connection-lifecycle'; state: ConnectionLifecycleState }
  | { dimension: 'platform-ui-state'; state: PlatformUiState }
  | { dimension: 'project-binding'; state: ProjectBindingState }
  | { dimension: 'relation-state'; state: RelationState }
  | { dimension: 'session-feed-result'; state: SessionFeedResultState }
  | { dimension: 'work-item-node-marker'; state: WorkItemNodeMarkerState }
  | { dimension: 'work-item-priority'; state: WorkItemPriorityState }
  | { dimension: 'work-item-readiness'; state: WorkItemReadinessState }
  | { dimension: OpenStateDimension; state: string }

const CLOSED_STATE_DIMENSIONS = {
  'connection-lifecycle': true,
  'platform-ui-state': true,
  'project-binding': true,
  'relation-state': true,
  'session-feed-result': true,
  'work-item-node-marker': true,
  'work-item-priority': true,
  'work-item-readiness': true,
} satisfies Record<ClosedStateDimension, true>

const FALLBACK_PRESENTATION: StatePresentation = { tone: 'neutral', emphasis: 'quiet' }

function presentationFor(dimension: StateDimension, state: string): StatePresentation {
  const presentation = (STATE_PRESENTATION[dimension] as Record<string, StatePresentation>)[state]
  if (presentation) return presentation
  if (dimension in CLOSED_STATE_DIMENSIONS) {
    throw new Error(`Unknown ${dimension} state: ${state}`)
  }
  return FALLBACK_PRESENTATION
}

export function statePresentation<D extends ClosedStateDimension>(
  dimension: D,
  state: Extract<SemanticStatePair, { dimension: D }>['state'],
): StatePresentation
export function statePresentation(dimension: OpenStateDimension, state: string): StatePresentation
export function statePresentation(dimension: StateDimension, state: string): StatePresentation {
  return presentationFor(dimension, state)
}

/** Present a pair supplied to SemanticState without losing its discriminated type. */
export function semanticStatePresentation(input: SemanticStatePair): StatePresentation {
  return presentationFor(input.dimension, input.state)
}

export function stateColor<D extends ClosedStateDimension>(
  dimension: D,
  state: Extract<SemanticStatePair, { dimension: D }>['state'],
): string
export function stateColor(dimension: OpenStateDimension, state: string): string
export function stateColor(dimension: StateDimension, state: string): string {
  return SEMANTIC_TONE_COLORS[presentationFor(dimension, state).tone]
}

export type SelectionMode = 'combobox'

export function selectionMode(input: {
  optionCount: number
  hasDescriptions?: boolean
  hasIcons?: boolean
  remote?: boolean
  searchable?: boolean
}): SelectionMode {
  void input
  return 'combobox'
}

export type SurfaceKind = 'dialog' | 'drawer' | 'inspector'

export function surfacePolicy(kind: SurfaceKind) {
  if (kind === 'dialog') return { modal: true, resizable: false, placement: 'center' as const }
  if (kind === 'drawer') return { modal: true, resizable: true, placement: 'right' as const }
  return { modal: false, resizable: true, placement: 'workspace' as const }
}

export type IconName =
  | 'activity'
  | 'analytics'
  | 'bell'
  | 'board'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'copy'
  | 'cursor'
  | 'database'
  | 'external-link'
  | 'filters'
  | 'info'
  | 'improvements'
  | 'language'
  | 'menu'
  | 'message-square'
  | 'play'
  | 'refresh'
  | 'search'
  | 'sessions'
  | 'skills'
  | 'settings'
  | 'terminal'
  | 'table'
  | 'client'

export function iconPolicy(_icon: IconName): 'lucide' {
  return 'lucide'
}
