type SemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
type SemanticEmphasis = 'quiet' | 'strong'

export type ClosedStateDimension =
  | 'checklist-step'
  | 'claim-lease'
  | 'connection-lifecycle'
  | 'platform-ui-state'
  | 'project-binding'
  | 'session-feed-result'
  | 'work-item-chain-group'
  | 'work-item-facet'
  | 'work-item-node-marker'
  | 'work-item-priority'
  | 'work-item-readiness'

export type OpenStateDimension =
  'work-item-state' | 'session' | 'execution' | 'activity-action' | 'integration-health'

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
  neutral: '#a8a8a8',
  info: '#7cacf8',
  success: '#7bd6a1',
  warning: '#d9b06a',
  danger: '#f99a8f',
}

/**
 * Every dimension's states and how each reads. Exported for the guard that
 * holds a dimension to distinguishing its states: one whose states all read
 * alike carries nothing, and is a dimension to retire rather than to bind.
 */
export const STATE_PRESENTATION = {
  /**
   * Whether the session behind a claim is still there. Stale is the one that
   * asks for a decision: the board says somebody holds the work and nobody
   * does. Unconfirmed is the ordinary state of every older claim and of the
   * owner's own, so it stays quiet rather than reading as a fault.
   */
  'claim-lease': {
    live: { tone: 'success', emphasis: 'quiet' },
    stale: { tone: 'warning', emphasis: 'strong' },
    unconfirmed: { tone: 'neutral', emphasis: 'quiet' },
  },
  /**
   * A step of a checklist, which is work and not a control: a done step is
   * finished, so it takes the green of finished work. It used to borrow the
   * switches' selection state, which tied the checklist's colour to every
   * switch. A control has no entry here at all: its chosen state is said by
   * its shape and its ink — a thrown switch, a ticked box — never by a hue.
   */
  'checklist-step': {
    done: { tone: 'success', emphasis: 'quiet' },
    open: { tone: 'neutral', emphasis: 'quiet' },
  },
  /**
   * A work item's state, keyed by its *category* rather than its name.
   *
   * There used to be a `lane` map beside this one keying the same six tones by
   * the six names one workflow happens to use, which is why renaming Dev lost
   * its colour. A category is shared vocabulary, so an installation that
   * renames a state or adds a second active one keeps the reading.
   *
   * Each category that asks something of a reader has a hue of its own, and
   * the two that are simply where work waits stay neutral. Work under way was
   * green — the same green as finished work, so a column of Dev and a column
   * of Done said the same thing — and the queue was the blue of selection and
   * focus. Moving is blue now, finished is green, and the queue says nothing.
   */
  'work-item-state': {
    backlog: { tone: 'neutral', emphasis: 'quiet' },
    queued: { tone: 'neutral', emphasis: 'quiet' },
    active: { tone: 'info', emphasis: 'quiet' },
    review: { tone: 'warning', emphasis: 'quiet' },
    completed: { tone: 'success', emphasis: 'quiet' },
    blocked: { tone: 'danger', emphasis: 'strong' },
    cancelled: { tone: 'neutral', emphasis: 'quiet' },
  },
  /**
   * The facets of a work item that carry no meaning colour at all: its kind,
   * its labels, its parent, its steps and a holder whose claim is in order. A
   * kind is a type, not a state, and coloured it would read as one more alarm;
   * the glyph tells a bug from an epic. Said here so a facet's colour has one
   * owner even when the answer is none.
   */
  'work-item-facet': {
    plain: { tone: 'neutral', emphasis: 'quiet' },
  },
  'work-item-priority': {
    low: { tone: 'neutral', emphasis: 'quiet' },
    medium: { tone: 'neutral', emphasis: 'quiet' },
    high: { tone: 'warning', emphasis: 'quiet' },
    urgent: { tone: 'danger', emphasis: 'strong' },
  },
  /**
   * Where a member of a chain stands, as the card's branch map draws it, its
   * groups head it and the graph marks it. A chain is read as progress, so
   * finished work is the green of something achieved and work under way is
   * blue; review is the amber of a decision waiting, and everything still
   * ahead — queued or backlog — is the one grey of what remains, which is what
   * makes a lane's tail read as its unfinished volume. These are the board's
   * `work-item-state` tones for the same categories: a hue means one thing on
   * every surface, so Dev is the same blue on a column head and on a lane.
   */
  'work-item-chain-group': {
    done: { tone: 'success', emphasis: 'quiet' },
    active: { tone: 'info', emphasis: 'quiet' },
    review: { tone: 'warning', emphasis: 'quiet' },
    queued: { tone: 'neutral', emphasis: 'quiet' },
    backlog: { tone: 'neutral', emphasis: 'quiet' },
    blocked: { tone: 'danger', emphasis: 'strong' },
  },
  // A held node is work moving, so it takes the hue of work under way. It was
  // green, which on the zoomed-out graph painted held work the colour of
  // finished work.
  'work-item-node-marker': {
    ready: { tone: 'neutral', emphasis: 'quiet' },
    claimed: { tone: 'info', emphasis: 'quiet' },
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
  // Activity providers may add action names without turning an unfamiliar
  // event into an alarm. The three completion-shaped actions are the only
  // shared positive vocabulary; every other action deliberately falls back.
  'activity-action': {
    released: { tone: 'success', emphasis: 'quiet' },
    checklist_released: { tone: 'success', emphasis: 'quiet' },
    checklist_completed: { tone: 'success', emphasis: 'quiet' },
  },
  'integration-health': {
    'ready': { tone: 'success', emphasis: 'quiet' },
    'not-observed': { tone: 'neutral', emphasis: 'quiet' },
    'degraded': { tone: 'warning', emphasis: 'strong' },
    'unavailable': { tone: 'danger', emphasis: 'strong' },
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
  // Whether one project resource has a usable owner binding. An absent
  // binding is an ordinary not-yet-configured state; an unavailable bound
  // store is the only hard failure.
  'project-binding': {
    mapped: { tone: 'success', emphasis: 'quiet' },
    unbound: { tone: 'neutral', emphasis: 'quiet' },
    unavailable: { tone: 'danger', emphasis: 'strong' },
  },
  /**
   * Workable is the ordinary condition of open backlog, so it is quiet: green
   * on every second card of a backlog column was the loudest colour on the
   * board and the one that meant least. Blocked is the exception it exists
   * to show.
   */
  'work-item-readiness': {
    ready: { tone: 'neutral', emphasis: 'quiet' },
    blocked: { tone: 'danger', emphasis: 'strong' },
    // A question waits for a person, the same call the session list makes.
    asking: { tone: 'warning', emphasis: 'strong' },
  },
} satisfies Record<StateDimension, Record<string, StatePresentation>>

type ChecklistStepState = keyof (typeof STATE_PRESENTATION)['checklist-step']
type ClaimLeaseState = keyof (typeof STATE_PRESENTATION)['claim-lease']
type ConnectionLifecycleState = keyof (typeof STATE_PRESENTATION)['connection-lifecycle']
type PlatformUiState = keyof (typeof STATE_PRESENTATION)['platform-ui-state']
type ProjectBindingState = keyof (typeof STATE_PRESENTATION)['project-binding']
type SessionFeedResultState = keyof (typeof STATE_PRESENTATION)['session-feed-result']
type WorkItemChainGroupState = keyof (typeof STATE_PRESENTATION)['work-item-chain-group']
type WorkItemFacetState = keyof (typeof STATE_PRESENTATION)['work-item-facet']
type WorkItemNodeMarkerState = keyof (typeof STATE_PRESENTATION)['work-item-node-marker']
type WorkItemPriorityState = keyof (typeof STATE_PRESENTATION)['work-item-priority']
type WorkItemReadinessState = keyof (typeof STATE_PRESENTATION)['work-item-readiness']

/**
 * A state and its dimension stay coupled where the platform owns the complete
 * vocabulary. Other dimensions remain open because their providers may add a
 * future state that should read as neutral rather than break the whole view.
 */
export type SemanticStatePair =
  | { dimension: 'checklist-step'; state: ChecklistStepState }
  | { dimension: 'claim-lease'; state: ClaimLeaseState }
  | { dimension: 'connection-lifecycle'; state: ConnectionLifecycleState }
  | { dimension: 'platform-ui-state'; state: PlatformUiState }
  | { dimension: 'project-binding'; state: ProjectBindingState }
  | { dimension: 'session-feed-result'; state: SessionFeedResultState }
  | { dimension: 'work-item-chain-group'; state: WorkItemChainGroupState }
  | { dimension: 'work-item-facet'; state: WorkItemFacetState }
  | { dimension: 'work-item-node-marker'; state: WorkItemNodeMarkerState }
  | { dimension: 'work-item-priority'; state: WorkItemPriorityState }
  | { dimension: 'work-item-readiness'; state: WorkItemReadinessState }
  | { dimension: OpenStateDimension; state: string }

const CLOSED_STATE_DIMENSIONS = {
  'checklist-step': true,
  'claim-lease': true,
  'connection-lifecycle': true,
  'platform-ui-state': true,
  'project-binding': true,
  'session-feed-result': true,
  'work-item-chain-group': true,
  'work-item-facet': true,
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
  | 'alert'
  | 'analytics'
  | 'bell'
  | 'board'
  | 'check'
  | 'claude'
  | 'codex'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'copy'
  | 'cursor'
  | 'database'
  | 'document'
  | 'editor'
  | 'external-link'
  | 'filters'
  | 'info'
  | 'improvements'
  | 'language'
  | 'link'
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
  // A work item's facets, named for what they mean rather than what they draw.
  | 'kind-bug'
  | 'kind-epic'
  | 'kind-improvement'
  | 'priority-urgent'
  | 'priority-high'
  | 'priority-low'
  | 'state-cancelled'
  | 'waiting'
  | 'holder'
  | 'parent'
  | 'steps'

export function iconPolicy(_icon: IconName): 'lucide' {
  return 'lucide'
}
