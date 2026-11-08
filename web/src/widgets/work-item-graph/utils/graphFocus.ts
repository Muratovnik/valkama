/**
 * Context that identifies one rendered graph field.  A focus id from another
 * context is never allowed to leak into a newly opened space, scope, revision,
 * or done-filter projection.
 */
export interface GraphFocusContext {
  epicId: string | null
  open: boolean
  scopeKind: 'all' | 'chain' | 'epic' | 'none'
  showDone: boolean
  space: string
  version: number
}

/**
 * What the keyboard stands on. A pointer lights nothing: a card under it takes
 * the hover ground of its own, and the rest of the field stays as it was. Hover
 * used to light the card's lineage and dim everything else, which moved the
 * whole field under a pointer that was only passing through.
 */
export interface GraphFocusState extends GraphFocusContext {
  /** Keyboard focus remains visible while the focused button owns focus. */
  focused: string | null
}

export type GraphFocusEvent =
  | { id: string; type: 'focus' }
  | { id: string; type: 'blur' }
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
  return { ...context, focused: null }
}

/**
 * Reduce one DOM focus event without allowing a stale blur to clear a newer
 * node.  Clicks intentionally do not appear here: GraphView opens the
 * inspector, and never turns a click into a pinned graph selection.
 */
export function reduceGraphFocus(state: GraphFocusState, event: GraphFocusEvent): GraphFocusState {
  switch (event.type) {
    case 'focus': {
      return { ...state, focused: event.id }
    }
    case 'blur': {
      return state.focused === event.id ? { ...state, focused: null } : state
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
