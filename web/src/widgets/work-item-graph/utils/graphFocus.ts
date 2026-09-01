/**
 * Context that identifies one rendered graph field.  A focus id from another
 * context is never allowed to leak into a newly opened space, scope, revision,
 * or done-filter projection.
 */
export interface GraphFocusContext {
  epicId: string | null
  open: boolean
  scopeKind: 'all' | 'epic' | 'none'
  showDone: boolean
  space: string
  version: number
}

export interface GraphFocusState extends GraphFocusContext {
  /** Which input modality currently owns the visual focus treatment. */
  active: 'hover' | 'focus' | null
  /** Keyboard focus remains visible while the focused button owns focus. */
  focused: string | null
  /** Pointer hover is transient and independent from keyboard focus. */
  hovered: string | null
}

export type GraphFocusEvent =
  | { id: string; type: 'pointer-enter' }
  | { id: string; type: 'pointer-leave' }
  | { id: string; type: 'focus' }
  | { id: string; type: 'blur' }
  | { type: 'field-leave' }
  | { context: GraphFocusContext; type: 'reset' }

export function graphFocusContextKey(context: GraphFocusContext): string {
  return [
    context.open ? 'open' : 'closed',
    context.space,
    context.version,
    context.scopeKind,
    context.epicId ?? '',
    context.showDone ? 'all' : 'open',
  ].join('|')
}

export function createGraphFocus(context: GraphFocusContext): GraphFocusState {
  return { ...context, hovered: null, focused: null, active: null }
}

/**
 * Reduce one DOM focus/hover event without allowing stale leave/blur events to
 * clear a newer node.  Clicks intentionally do not appear here: GraphView
 * opens the inspector, and never turns a click into a pinned graph selection.
 */
export function reduceGraphFocus(state: GraphFocusState, event: GraphFocusEvent): GraphFocusState {
  switch (event.type) {
    case 'pointer-enter': {
      return { ...state, hovered: event.id, active: 'hover' }
    }
    case 'pointer-leave': {
      return state.hovered === event.id
        ? { ...state, hovered: null, active: state.focused == null ? null : 'focus' }
        : state
    }
    case 'focus': {
      return { ...state, focused: event.id, active: 'focus' }
    }
    case 'blur': {
      return state.focused === event.id
        ? { ...state, focused: null, active: state.hovered == null ? null : 'hover' }
        : state
    }
    case 'field-leave': {
      return { ...state, hovered: null, active: state.focused == null ? null : 'focus' }
    }
    case 'reset': {
      return createGraphFocus(event.context)
    }
    default: {
      // The union is closed and every member returns above. `satisfies never`
      // is the compiler's proof of that, and stops compiling the day an event
      // is added without a case; the focus passes through untouched meanwhile.
      event satisfies never
      return state
    }
  }
}

/** Pointer hover owns the visual treatment while the pointer is in the field;
 * keyboard focus resumes when the pointer leaves. */
export function activeGraphFocus(state: GraphFocusState): string | null {
  if (state.active === 'focus') return state.focused
  if (state.active === 'hover') return state.hovered
  return null
}
