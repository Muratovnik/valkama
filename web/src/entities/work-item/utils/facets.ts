/**
 * The facets of a work item, and for each surface whether it prints one.
 *
 * Every surface used to decide for itself, in its own strings: the tile wrote
 * the priority word and the kind word and «можно брать» on one crowded line,
 * the list appended the kind after the title, the graph printed readiness in
 * bold, the card laid five facts out as an equal-weight grid. Defaults were
 * printed as if they were news — «Средний» on most tiles, «можно брать» on
 * nearly every tile of the two columns where it can be true at all — and a
 * type looked exactly like a tag.
 *
 * Here a surface asks one question, "do I print this facet for this item?",
 * and gets back what to draw: a glyph, a word, the tone the state owner gives
 * it, and the filter token a click adds. The rules are data, one row per facet
 * and one cell per surface, so a surface never re-derives them. Colour is
 * never named here: a mark carries the `uiSystem` pair, and the component
 * that draws it asks `uiSystem` for the tone. A kind says what an item is rather
 * than how it stands, so it has no tone: its mark carries the kind as its `ink`,
 * and its colour is the custom property the owner can set.
 */

import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { holderName } from '@/shared/lib/actor.ts'
import type { IconName, SemanticStatePair } from '@/shared/lib/uiSystem.ts'

/**
 * `chain` is a member row of a card's chain: a list of items that holds no facets
 * but readiness. `lane` is the head of an epic's row on the grouped board.
 * `preview` is the card that a reference in text shows while the pointer rests on
 * it: nothing beside the reference says anything about the item, so it answers
 * what the item is and where it stands, and every mark keeps its word, because
 * the card is read rather than pressed and a glyph alone would bring a second,
 * native hover text over it.
 */
export type FacetSurface =
  'tile' | 'list' | 'graph' | 'card' | 'finder' | 'chain' | 'lane' | 'preview'
export type FacetId =
  'kind' | 'priority' | 'state' | 'readiness' | 'labels' | 'holder' | 'parent' | 'steps'

/**
 * What a surface knows of an item. A board, a list and a graph hold the whole
 * brief; a search result holds its kind, its priority and its state, and
 * nothing else. A fact the subject does not carry prints nothing rather than a
 * default it would be mistaken for.
 */
export type FacetSubject = Pick<WorkItemBrief, 'kind' | 'priority'> & {
  state: Pick<WorkItemBrief['state'], 'name' | 'category'> & { is_terminal?: boolean }
} & Partial<
    Pick<
      WorkItemBrief,
      | 'checklist'
      | 'claim_ref'
      | 'claim_state'
      | 'labels'
      | 'last_claim_ref'
      | 'parent_id'
      | 'ready'
    >
  >

/** What a surface knows about an item that the item itself does not carry. */
export interface FacetContext {
  /** The board is grouped by epic, so the lane already names the parent. */
  grouped?: boolean
  /**
   * How many label chips the surface measured room for on its one line. The
   * rule's limit still caps it, and one chip always shows, shortened if it
   * must be, rather than a count standing alone.
   */
  labelRoom?: number
  /** The parent's reference, which the brief carries only as an id. */
  parentReference?: string | null
  /**
   * The reference of an open item that blocks this one, or null for none.
   * The brief carries no blockers; the caller reads them from the links.
   */
  waitingOn?: string | null
  /** The inline size of the container the item is drawn in, in px. */
  width?: number
}

/**
 * How a surface prints one facet.
 *
 * `glyph` is the glyph alone with its word as the accessible name and the
 * hover text; `word` is the word alone; `glyph-word` both. `chips` is a row of
 * label chips and `action` means the surface says it through its primary
 * action rather than a mark.
 */
type FacetForm = 'glyph' | 'word' | 'glyph-word' | 'chips' | 'action'

interface FacetRule {
  form: FacetForm
  /** The surface prints this facet even when nothing holds it (a column). */
  always?: boolean
  /** Not on the grouped board, whose lane says it. */
  flatOnly?: boolean
  /**
   * These values lead the reference as a glyph, apart from where the surface
   * prints the facet itself: the list marks the priority before the
   * reference, where the eye runs down the list, and its column says the word
   * in its tone, so a row draws the glyph once.
   */
  lead?: readonly string[]
  /** Chips before the rest fold into «+N». */
  limit?: number
  /** Below this container width the facet does not print. */
  minWidth?: number
  /** Only these values print; absent prints every value the facet has. */
  only?: readonly string[]
  /** Not on a finished or cancelled item. */
  openOnly?: boolean
  /**
   * The mark is read, not pressed: a click on it adds nothing to the filter.
   * A tile and a graph node are one open target each, and a glyph that
   * filtered spent a 28px pointer box of a line that has to hold the
   * reference and what stops the work. The list, the card and the bar's
   * filter menu filter by the same values.
   */
  plain?: boolean
  /** When this facet prints, it takes the place of `state`. */
  replacesState?: boolean
  /**
   * The form draws the mark's short words where it has them — a waiting mark
   * the reference it waits on — and keeps the whole words as its name and
   * hover text.
   */
  terse?: boolean
}

/**
 * Which surface prints which facet, and how. A surface that has no cell for a
 * facet never prints it. This is the table of the design specification's
 * §3.2, cell for cell.
 */
const FACET_RULES: Readonly<Record<FacetId, Partial<Record<FacetSurface, FacetRule>>>> = {
  // Kind carries no tone, only its own ink. A plain task is the norm, so it has
  // no glyph and only the card names it in words.
  kind: {
    tile: { form: 'glyph', only: ['bug', 'epic', 'improvement'], plain: true },
    list: { form: 'glyph', only: ['bug', 'epic', 'improvement'] },
    graph: { form: 'glyph', only: ['bug', 'epic', 'improvement'], plain: true },
    card: { form: 'glyph-word' },
    finder: { form: 'glyph', only: ['bug', 'epic', 'improvement'] },
    preview: { form: 'glyph-word', only: ['bug', 'epic', 'improvement'] },
  },
  // Medium is the default and is not news on a tile, a node or a finder row.
  // The list keeps it as a quiet word, because a blank cell in a sortable
  // column reads as unknown, and leads the reference with the others' glyphs;
  // the column says the word alone, since the glyph already leads the row.
  priority: {
    tile: { form: 'glyph', only: ['low', 'high', 'urgent'], plain: true },
    list: { form: 'word', always: true, lead: ['low', 'high', 'urgent'] },
    graph: { form: 'glyph', only: ['high', 'urgent'], plain: true },
    card: { form: 'glyph-word', always: true },
    finder: { form: 'glyph', only: ['high', 'urgent'] },
    // A preview leads with what is news about an item; low, like medium, is not.
    preview: { form: 'glyph-word', only: ['high', 'urgent'] },
  },
  // The board's column already says the state. An epic is no tile, so its row's
  // head says it, but only once it has moved: an epic not started is the norm of
  // a board that holds a hundred of them, and a word per row said nothing.
  state: {
    lane: { form: 'glyph-word', only: ['active', 'review', 'blocked', 'completed', 'cancelled'] },
    list: { form: 'glyph-word', always: true },
    graph: { form: 'glyph-word', always: true },
    card: { form: 'glyph-word', always: true },
    finder: { form: 'glyph-word', always: true },
    preview: { form: 'glyph-word', always: true },
  },
  // Workable is the norm of the two waiting columns, so the tile and the list print
  // only its exception, an open blocker. The graph mixes every state, so it
  // says workable too, quietly, in place of the state word. The card says it
  // with «Взять».
  readiness: {
    // «Ждёт MAIN-12» does not fit a desktop tile's first line after its glyphs
    // and its own reference, so it folded to the bare glyph and the reference
    // was hover-only. The glyph already says "waiting"; the reference is what
    // the line has to show.
    tile: { form: 'glyph-word', only: ['waiting'], terse: true },
    list: { form: 'glyph-word', only: ['waiting'] },
    graph: { form: 'glyph-word', replacesState: true },
    card: { form: 'action' },
    // A chain member reads as the norm of its group: workable prints nothing.
    chain: { form: 'glyph-word', only: ['waiting'] },
    // Why an item is not moving, which its state does not say.
    preview: { form: 'glyph-word', only: ['waiting'] },
  },
  labels: {
    tile: { form: 'chips', limit: 3 },
    list: { form: 'chips', limit: 2, minWidth: 900 },
    card: { form: 'chips' },
  },
  // A tile says that somebody holds the item, as a glyph whose hover names who and
  // whether the claim is stale; the name and «Захват устарел» as words were the
  // longest things on the sheet after its title. The card and the hover card say both.
  holder: {
    tile: { form: 'glyph', openOnly: true },
    list: { form: 'word', always: true },
    graph: { form: 'glyph-word' },
    card: { form: 'glyph-word', always: true },
    // Nobody prints nothing; a finished item names who held it before.
    preview: { form: 'glyph-word' },
  },
  // The card's row is named «Эпик» and draws the epic's own sign, as a tile of the epic
  // does, before the reference, which the card draws as a link to the epic.
  parent: {
    tile: { form: 'glyph-word', flatOnly: true },
    graph: { form: 'glyph-word' },
    card: { form: 'glyph' },
  },
  // A closed item's steps are all done, as the guard on closing asks: on a tile of
  // Done that was a line saying what the column already says.
  steps: {
    tile: { form: 'glyph-word', openOnly: true },
    list: { form: 'word', always: true },
    card: { form: 'word' },
    preview: { form: 'glyph-word', openOnly: true },
  },
}

/**
 * The one order every surface reads a work item's marks in: what the item is —
 * its kind, then its number, which the host draws and `drawHead` places right
 * after the kind — then how much it asks (priority), where it stands (state,
 * readiness), its labels, who holds it, its parent and its steps. A host chooses
 * which facets a run holds and never their order: `surfaceMarks` sorts them by
 * this list. Surfaces used to order them each their own way — the tile and the
 * list put the priority before the kind and both before the number, the hover
 * card the number first, the graph the priority at its foot.
 */
export const FACET_ORDER: readonly FacetId[] = [
  'kind',
  'priority',
  'state',
  'readiness',
  'labels',
  'holder',
  'parent',
  'steps',
]

/** The words a mark can say: an i18n key and its parameters, or data as it is. */
type FacetText = { key: string; params?: Record<string, string | number> } | { literal: string }

export interface FacetMark {
  facet: FacetId
  /**
   * What a click on the mark adds to the filter, or null when it filters
   * nothing. Kind, priority and labels filter, as the owner decided, except
   * where a surface reads its glyphs rather than presses them (`plain`: a
   * tile and a graph node); the filter model takes every facet, and the
   * bar's menu reaches the rest.
   */
  filter: WorkFilterToken | null
  form: FacetForm
  glyph: IconName | null
  /** The value is the norm — medium, workable, nobody — so its word takes the quiet ink. */
  quiet: boolean
  /** The word, shown when the form shows it and always the accessible name. */
  text: FacetText
  /** The state owner's pair for this mark; a facet with no colour says so too. */
  tone: SemanticStatePair
  /** The facet's value: a kind, a priority, a category, `ready`/`waiting`, a label. */
  value: string
  /**
   * What the value means, which the hover says after the mark's name; absent
   * where a value has no meaning to state.
   */
  hint?: FacetText
  /** The kind whose own colour this mark's glyph and word are drawn in. */
  ink?: WorkItemBrief['kind']
  /**
   * Shorter words the form draws in place of `text`, which stays the name and
   * the hover text; absent, the form draws `text`.
   */
  short?: FacetText
}

/** A facet that carries no meaning colour, as the state owner says it. */
const PLAIN: SemanticStatePair = { dimension: 'work-item-facet', state: 'plain' }

const KIND_GLYPHS: Record<WorkItemBrief['kind'], IconName | null> = {
  task: null,
  bug: 'kind-bug',
  epic: 'kind-epic',
  improvement: 'kind-improvement',
}

/** The glyph of a kind wherever one is named apart from a mark; a plain task has none. */
export function kindGlyph(kind: WorkItemBrief['kind']): IconName | null {
  return KIND_GLYPHS[kind]
}

const PRIORITY_GLYPHS: Record<WorkItemBrief['priority'], IconName | null> = {
  urgent: 'priority-urgent',
  high: 'priority-high',
  medium: null,
  low: 'priority-low',
}

/**
 * What readiness reads of an item: its state and whether it is workable. A
 * chain member carries exactly these, so it needs no kind or priority to be
 * given a readiness mark.
 */
export type ReadinessSubject = Pick<FacetSubject, 'state' | 'ready'>

/** Readiness as a facet value: startable, waiting on an open blocker, or neither. */
export function readinessOf(item: ReadinessSubject, context: FacetContext = {}): string | null {
  if (item.state.is_terminal) return null
  if (context.waitingOn) return 'waiting'
  return item.ready ? 'ready' : null
}

/**
 * The readiness mark one surface prints for an item, or none: the surface's
 * rule decides whether the value prints at all, so a ready item on a surface
 * that prints only the exception returns nothing.
 */
export function readinessMarks(
  item: ReadinessSubject,
  surface: FacetSurface,
  context: FacetContext = {},
): FacetMark[] {
  const rule = FACET_RULES.readiness[surface]
  if (!rule || rule.form === 'action') return []
  const value = readinessOf(item, context)
  const printed = value !== null && (!rule.only || rule.only.includes(value))
  return printed ? [readinessMark(value, rule, context)] : []
}

function steps(item: FacetSubject) {
  const checklist = item.checklist ?? []
  return {
    done: checklist.filter((step) => step.done).length,
    total: checklist.length,
  }
}

/** The value one facet has on one item, or null when the item has none. */
function valueOf(facet: FacetId, item: FacetSubject, context: FacetContext): string | null {
  if (facet === 'kind') return item.kind
  if (facet === 'priority') return item.priority
  if (facet === 'state') return item.state.category
  if (facet === 'readiness') return readinessOf(item, context)
  if (facet === 'labels') return item.labels?.length ? item.labels.join(',') : null
  if (facet === 'holder') return holderRef(item) || null
  if (facet === 'parent')
    return item.parent_id && context.parentReference ? context.parentReference : null
  return item.checklist?.length ? 'steps' : null
}

/**
 * Whether a surface prints a facet for an item. A surface that prints a
 * column (`always`) prints it whatever the value, including none, and says
 * "nobody" or "—" in its own words; every other cell prints only a value the
 * item has and its rule lets through.
 */
export function printsFacet(
  facet: FacetId,
  surface: FacetSurface,
  item: FacetSubject,
  context: FacetContext = {},
): boolean {
  const rule = FACET_RULES[facet][surface]
  if (!rule) return false
  if (rule.minWidth !== undefined && (context.width ?? Infinity) < rule.minWidth) return false
  if (rule.openOnly && item.state.is_terminal) return false
  if (rule.flatOnly && context.grouped) return false
  const value = valueOf(facet, item, context)
  if (value === null) return rule.always === true
  if (rule.only && !rule.only.includes(value)) return false
  // Where readiness takes the state's place — the graph — the state yields
  // whenever readiness prints.
  if (facet === 'state' && FACET_RULES.readiness[surface]?.replacesState)
    return !printsFacet('readiness', surface, item, context)
  return true
}

function kindMark(item: FacetSubject, { form, plain }: FacetRule): FacetMark {
  return {
    facet: 'kind',
    value: item.kind,
    form,
    glyph: KIND_GLYPHS[item.kind],
    text: { key: `workItem.kind.${item.kind}` },
    tone: PLAIN,
    ink: item.kind,
    filter: plain ? null : { facet: 'kind', value: item.kind },
    quiet: false,
  }
}

function parentMark(surface: FacetSurface, form: FacetForm, context: FacetContext): FacetMark {
  const reference = context.parentReference ?? ''
  const mark = {
    facet: 'parent',
    value: reference,
    form,
    tone: PLAIN,
    filter: null,
    quiet: false,
  } as const
  return surface === 'card'
    ? { ...mark, glyph: KIND_GLYPHS.epic, text: { key: 'workItem.kind.epic' }, ink: 'epic' }
    : { ...mark, glyph: 'parent', text: { literal: reference } }
}

function priorityMark(item: FacetSubject, { form, plain }: FacetRule): FacetMark {
  return {
    facet: 'priority',
    value: item.priority,
    form,
    glyph: PRIORITY_GLYPHS[item.priority],
    text: { key: `priority.${item.priority}` },
    hint: { key: `priorityMeaning.meaning.${item.priority}` },
    tone: { dimension: 'work-item-priority', state: item.priority },
    filter: plain ? null : { facet: 'priority', value: item.priority },
    quiet: item.priority === 'medium',
  }
}

function stateMark(item: FacetSubject, form: FacetForm): FacetMark {
  return {
    facet: 'state',
    value: item.state.category,
    form,
    glyph: item.state.category === 'cancelled' ? 'state-cancelled' : null,
    text: { literal: item.state.name },
    tone: { dimension: 'work-item-state', state: item.state.category },
    // The card's state is its transition menu, so a click there moves the
    // item; state filters come from the bar's menu instead.
    filter: null,
    quiet: false,
  }
}

function readinessMark(value: string, rule: FacetRule, context: FacetContext): FacetMark {
  const waiting = value === 'waiting'
  const { form } = rule
  const short = waiting && rule.terse ? { short: { literal: context.waitingOn ?? '' } } : {}
  return {
    facet: 'readiness',
    value,
    form,
    glyph: waiting ? 'waiting' : null,
    text: waiting
      ? { key: 'workItem.facet.waiting', params: { reference: context.waitingOn ?? '' } }
      : { key: 'workItem.facet.ready' },
    tone: { dimension: 'work-item-readiness', state: waiting ? 'blocked' : 'ready' },
    filter: null,
    quiet: !waiting,
    ...short,
  }
}

/**
 * Nobody, in a column, is a dash; in a sentence of facts it is said. Whoever
 * held finished work held it before: said as a holder, the name read as
 * somebody still on it.
 */
function holderText(item: FacetSubject, surface: FacetSurface): FacetText {
  const holder = holderRef(item)
  // A glyph alone says its words on hover, where a bare name would not say what it is.
  if (holder && surface === 'tile') {
    const stale = item.claim_state === 'stale' && !item.state.is_terminal
    return {
      key: stale ? 'workItem.facet.heldStale' : 'workItem.facet.heldBy',
      params: { holder: holderName(holder) },
    }
  }
  if (holder && item.state.is_terminal)
    return { key: 'workItem.previousHolder', params: { holder: holderName(holder) } }
  if (holder) return { literal: holderName(holder) }
  return surface === 'list' ? { literal: '—' } : { key: 'workItem.noClaim' }
}

/**
 * Who the holder facet names: the claim on open work, and on finished work
 * whoever held it when it closed. A close ends the claim, so the server says
 * that holder apart; an item closed while closing still left the claim on it
 * carries no such field, and its claim is that holder.
 */
export function holderRef(item: FacetSubject): string {
  const current = item.claim_ref ?? ''
  return item.state.is_terminal ? item.last_claim_ref || current : current
}

function holderMark(item: FacetSubject, form: FacetForm, surface: FacetSurface): FacetMark {
  const stale = item.claim_state === 'stale' && !item.state.is_terminal
  const holder = holderRef(item)
  return {
    facet: 'holder',
    value: holder,
    form,
    glyph: holder ? 'holder' : null,
    text: holderText(item, surface),
    // Only a stale claim has something to say; a live or unconfirmed one is quiet.
    tone: stale ? { dimension: 'claim-lease', state: 'stale' } : PLAIN,
    filter: null,
    quiet: !holder,
  }
}

/**
 * A chip per label the surface has room for, then one quiet «+N» for the rest
 * (form `word`, no filter), which the surface's own open target explains.
 */
function labelMarks(item: FacetSubject, rule: FacetRule, context: FacetContext): FacetMark[] {
  const labels = item.labels ?? []
  const room = context.labelRoom === undefined ? Infinity : Math.max(1, context.labelRoom)
  const shown = labels.slice(0, Math.min(rule.limit ?? Infinity, room))
  const rest = labels.length - shown.length
  const more: FacetMark[] = rest
    ? [
        {
          facet: 'labels',
          value: `+${rest}`,
          form: 'word',
          glyph: null,
          text: { key: 'workItem.facet.moreLabels', params: { count: rest } },
          tone: PLAIN,
          filter: null,
          quiet: true,
        },
      ]
    : []
  return shown
    .map<FacetMark>((label) => ({
      facet: 'labels',
      value: label,
      form: rule.form,
      glyph: null,
      text: { literal: label },
      tone: PLAIN,
      filter: { facet: 'labels', value: label },
      quiet: false,
    }))
    .concat(more)
}

/**
 * The marks one facet prints on one surface for one item: none, one, or a
 * chip per label. `action` facets print nothing here, because the surface says
 * them through its primary action.
 */
export function facetMarks(
  facet: FacetId,
  surface: FacetSurface,
  item: FacetSubject,
  context: FacetContext = {},
): FacetMark[] {
  const rule = FACET_RULES[facet][surface]
  if (!rule || rule.form === 'action' || !printsFacet(facet, surface, item, context)) return []
  const { form } = rule
  if (facet === 'kind') return [kindMark(item, rule)]
  if (facet === 'priority') return [priorityMark(item, rule)]
  if (facet === 'state') return [stateMark(item, form)]
  if (facet === 'labels') return labelMarks(item, rule, context)
  if (facet === 'holder') return [holderMark(item, form, surface)]
  if (facet === 'readiness') return readinessMarks(item, surface, context)
  if (facet === 'parent') return [parentMark(surface, form, context)]
  const count = steps(item)
  return [
    {
      facet,
      value: `${count.done}/${count.total}`,
      form,
      glyph: count.total ? 'steps' : null,
      text: count.total ? { key: 'workItem.facet.steps', params: count } : { literal: '—' },
      tone: PLAIN,
      filter: null,
      quiet: count.total === 0,
    },
  ]
}

/**
 * The glyph a facet leads the reference with on a surface: its own mark where
 * the surface prints the facet as a glyph, else the glyph its `lead` rule names.
 * A value with no glyph leads with nothing.
 */
export function leadMarks(
  facet: FacetId,
  surface: FacetSurface,
  item: FacetSubject,
  context: FacetContext = {},
): FacetMark[] {
  const rule = FACET_RULES[facet][surface]
  if (!rule) return []
  const marks = facetMarks(facet, surface, item, context)
  if (!rule.lead) return rule.form === 'glyph' ? marks : []
  return marks
    .filter((mark) => rule.lead?.includes(mark.value))
    .map((mark) => ({ ...mark, form: 'glyph' }))
}

/**
 * Every mark a surface prints for an item from the facets it asks for, in the one
 * reading order (`FACET_ORDER`) whatever order they were asked in.
 */
export function surfaceMarks(
  surface: FacetSurface,
  item: FacetSubject,
  context: FacetContext = {},
  facets: readonly FacetId[] = FACET_ORDER,
): FacetMark[] {
  return FACET_ORDER.filter((facet) => facets.includes(facet)).flatMap((facet) =>
    facetMarks(facet, surface, item, context),
  )
}
