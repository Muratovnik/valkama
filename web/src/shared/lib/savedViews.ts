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

/**
 * The views of one place that `reads` reads as they were saved, and the names of those it
 * does not, which are left out. A place left with none is dropped, as `deleteView` drops it.
 */
export function keepReadViews(
  views: SavedViews,
  place: string,
  reads: (state: ViewState) => boolean,
): { dropped: string[]; views: SavedViews } {
  const list = viewsOf(views, place)
  const dropped = list.filter((view) => !reads(view.state)).map((view) => view.name)
  if (!dropped.length) return { dropped, views }
  let next = views
  for (const name of dropped) next = deleteView(next, place, name)
  return { dropped, views: next }
}

/**
 * The names of the views taken out as unread, by place, until the place has named them once.
 * They are kept with the views rather than by whoever shows them, because the views are gone
 * from the settings as soon as they are read: a reload, or a screen closed before its menu
 * opened, would otherwise take the only record that they were there.
 */
export type DroppedViews = Readonly<Record<string, readonly string[]>>

/** What was stored, read: a place whose value is not a list of names is left out. */
export function readDroppedViews(raw: unknown): DroppedViews {
  const dropped: Record<string, string[]> = {}
  for (const [place, list] of Object.entries(record(raw) ?? {})) {
    if (!Array.isArray(list)) continue
    const names = [
      ...new Set(list.flatMap((name) => (typeof name === 'string' ? [viewName(name)] : []))),
    ].filter(Boolean)
    if (names.length) dropped[place] = names
  }
  return dropped
}

/** The dropped names with these added to the place's, each named once. */
export function withDropped(
  dropped: DroppedViews,
  place: string,
  names: readonly string[],
): DroppedViews {
  return { ...dropped, [place]: [...new Set([...(dropped[place] ?? []), ...names])] }
}

/** The dropped names without the place's, once it has named them. */
export function withoutDropped(dropped: DroppedViews, place: string): DroppedViews {
  return Object.fromEntries(Object.entries(dropped).filter(([where]) => where !== place))
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
