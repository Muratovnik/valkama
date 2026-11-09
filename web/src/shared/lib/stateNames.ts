/**
 * The one way a workflow state's name reaches the screen.
 *
 * A state's name is the space's data, not an interface word: an agent moves an item to «Dev»
 * by the name its workflow gives, and the server answers in that name in every language. A
 * space that kept the workflow the server gave it still reads in the reader's language: a
 * state whose key is one of that workflow's and whose name is still that key's own is shown
 * by its translation. A renamed state, a state of another key, and every state when the owner
 * chose the workflow's own words are shown as written. Only the screen changes; what an agent
 * or the API reads stays the key and the name.
 */

/** What the owner chose: the standard states in the reader's language, or as the workflow writes them. */
export const STATE_NAMINGS = ['translated', 'workflow'] as const
export type StateNaming = (typeof STATE_NAMINGS)[number]

/**
 * A state as a surface holds it. A search result, a link's other end and a row of the
 * navigation carry no key: there a standard name stands for its key, in its standard category
 * where the surface carries one.
 */
export interface NamedState {
  name: string
  category?: string
  key?: string
}

/**
 * The workflow the server gives a new space (`DEFAULT_STATES` in `server/planning/model.py`):
 * each key with its name, compared exactly, and its category.
 */
const STANDARD_STATES: ReadonlyMap<string, { category: string; name: string }> = new Map([
  ['backlog', { name: 'Backlog', category: 'backlog' }],
  ['todo', { name: 'Todo', category: 'queued' }],
  ['dev', { name: 'Dev', category: 'active' }],
  ['review', { name: 'Review', category: 'review' }],
  ['done', { name: 'Done', category: 'completed' }],
  ['blocked', { name: 'Blocked', category: 'blocked' }],
  ['cancelled', { name: 'Cancelled', category: 'cancelled' }],
])

/** The standard key a state without one stands for: its name, and its category if it has one. */
function keyOf(state: NamedState): string | undefined {
  if (state.key !== undefined) return state.key
  for (const [key, standard] of STANDARD_STATES)
    if (standard.name === state.name && (state.category ?? standard.category) === standard.category)
      return key
  return undefined
}

/** The message a standard, unrenamed state is translated by; null for a state shown as written. */
function standardStateMessage(state: NamedState): string | null {
  const key = keyOf(state)
  const standard = key === undefined ? undefined : STANDARD_STATES.get(key)
  return standard?.name === state.name ? `workItem.stateName.${key}` : null
}

/** The name a reader sees for a state, under the owner's choice, in the words `translate` gives. */
export function stateName(
  state: NamedState,
  naming: StateNaming,
  translate: (message: string) => string,
): string {
  const message = naming === 'translated' ? standardStateMessage(state) : null
  return message === null ? state.name : translate(message)
}
