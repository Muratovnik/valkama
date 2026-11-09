/**
 * Saved views: a module's address state kept under a name, one list per place it
 * was saved in, so a view saved in one planning space is never offered in another.
 *
 * A view is the state and nothing else. The address already holds how the work is
 * looked at — the view, the board's grouping, the filter, a chain — so keeping that
 * object is keeping the view, and applying it is writing it back. No copy of the
 * work is kept: what the view shows is read again whenever it is applied.
 *
 * It is the owner's preference on this machine, kept with the other settings
 * (`settings.ts`), and `readSavedViews` is the one reader of what was stored: a
 * value it cannot read is no views rather than a broken setting.
 */

export type ViewState = Record<string, string | number | boolean>

export interface SavedView {
  /** Unique within its place, as typed with the ends trimmed. */
  name: string
  state: ViewState
}

/** Every place's views, keyed by the place the caller names. */
export type SavedViews = Readonly<Record<string, readonly SavedView[]>>

/** The longest name a view keeps. */
export const VIEW_NAME_CHARS = 60

const NO_VIEWS: readonly SavedView[] = Object.freeze([])

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

/** A name as it is kept: trimmed and no longer than the bound. */
export const viewName = (name: string) => name.trim().slice(0, VIEW_NAME_CHARS)

function readState(raw: unknown): ViewState | null {
  const source = record(raw)
  if (!source) return null
  const entries = Object.entries(source)
  return entries.every(([, value]) => ['boolean', 'number', 'string'].includes(typeof value))
    ? (Object.fromEntries(entries) as ViewState)
    : null
}

function readView(raw: unknown): SavedView | null {
  const source = record(raw)
  const name = typeof source?.name === 'string' ? viewName(source.name) : ''
  const state = readState(source?.state)
  return name && state ? { name, state } : null
}

/**
 * What was stored, read: a place's list that is not a list, or a view without a
 * name or a state, is left out, and a second view of a name already read is too.
 */
export function readSavedViews(raw: unknown): SavedViews {
  const views: Record<string, SavedView[]> = {}
  for (const [place, list] of Object.entries(record(raw) ?? {})) {
    if (!Array.isArray(list)) continue
    const kept: SavedView[] = []
    for (const entry of list) {
      const view = readView(entry)
      if (view && !kept.some((other) => other.name === view.name)) kept.push(view)
    }
    if (kept.length) views[place] = kept
  }
  return views
}

/** The views saved in one place, in the order they were first saved. */
export function viewsOf(views: SavedViews, place: string): readonly SavedView[] {
  return views[place] ?? NO_VIEWS
}

/**
 * The views with this state saved under this name in this place. A name the place
 * already has keeps its place in the list and takes the new state.
 */
export function saveView(
  views: SavedViews,
  place: string,
  name: string,
  state: ViewState,
): SavedViews {
  const kept = viewName(name)
  if (!kept) return views
  const view: SavedView = { name: kept, state: { ...state } }
  const list = viewsOf(views, place)
  const next = list.some((other) => other.name === kept)
    ? list.map((other) => (other.name === kept ? view : other))
    : [...list, view]
  return { ...views, [place]: next }
}

/** The views without this place's view of this name; a place left with none is dropped. */
export function deleteView(views: SavedViews, place: string, name: string): SavedViews {
  const list = viewsOf(views, place).filter((view) => view.name !== name)
  const next: Record<string, readonly SavedView[]> = { ...views }
  if (list.length) next[place] = list
  else delete next[place]
  return next
}

/** The state to write back when the view is applied; null for a view the place does not have. */
export function viewState(views: SavedViews, place: string, name: string): ViewState | null {
  const view = viewsOf(views, place).find((other) => other.name === name)
  return view ? { ...view.state } : null
}

/** One state's key, whatever order its keys were written in. */
const stateKey = (state: ViewState | undefined) =>
  JSON.stringify(Object.entries(state ?? {}).sort(([left], [right]) => left.localeCompare(right)))

/** The view whose state the address holds now, if one does. */
export function activeView(
  views: SavedViews,
  place: string,
  state: ViewState | undefined,
): string | null {
  const key = stateKey(state)
  return viewsOf(views, place).find((view) => stateKey(view.state) === key)?.name ?? null
}
