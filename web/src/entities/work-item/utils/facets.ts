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
 * that draws it asks `uiSystem` for the tone.
 */

import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { holderName } from '@/shared/lib/actor.ts'
import type { IconName, SemanticStatePair } from '@/shared/lib/uiSystem.ts'

export type FacetSurface = 'tile' | 'list' | 'graph' | 'card' | 'finder'
export type FacetId =
  'kind' | 'priority' | 'state' | 'readiness' | 'labels' | 'holder' | 'parent' | 'steps'

/** What a surface knows about an item that the item itself does not carry. */
export interface FacetContext {
  /** The board is grouped by epic, so the lane already names the parent. */
  grouped?: boolean
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
  /** Chips before the rest fold into «+N». */
  limit?: number
  /** Below this container width the facet does not print. */
  minWidth?: number
  /** Only these values print; absent prints every value the facet has. */
  only?: readonly string[]
  /** Not on a finished or cancelled item. */
  openOnly?: boolean
  /** When this facet prints, it takes the place of `state`. */
  replacesState?: boolean
}

/**
 * Which surface prints which facet, and how. A surface that has no cell for a
 * facet never prints it. This is the table of the design specification's
 * §3.2, cell for cell.
 */
const FACET_RULES: Readonly<Record<FacetId, Partial<Record<FacetSurface, FacetRule>>>> = {
  // Kind carries no colour. A plain task is the norm, so it has no glyph and
  // only the card names it in words.
  kind: {
    tile: { form: 'glyph', only: ['bug', 'epic', 'improvement'] },
    list: { form: 'glyph', only: ['bug', 'epic', 'improvement'] },
    graph: { form: 'glyph', only: ['bug', 'epic', 'improvement'] },
    card: { form: 'glyph-word' },
    finder: { form: 'glyph', only: ['bug', 'epic', 'improvement'] },
  },
  // Medium is the default and is not news on a tile, a node or a finder row.
  // The list keeps it as a quiet word, because a blank cell in a sortable
  // column reads as unknown.
  priority: {
    tile: { form: 'glyph', only: ['low', 'high', 'urgent'] },
    list: { form: 'glyph-word', always: true },
    graph: { form: 'glyph', only: ['high', 'urgent'] },
    card: { form: 'glyph-word', always: true },
    finder: { form: 'glyph', only: ['high', 'urgent'] },
  },
  // The board's column already says the state.
  state: {
    list: { form: 'glyph-word', always: true },
    graph: { form: 'glyph-word', always: true },
    card: { form: 'glyph-word', always: true },
    finder: { form: 'glyph-word', always: true },
  },
  // Workable is the norm of the two waiting columns, so the tile and the list print
  // only its exception, an open blocker. The graph mixes every state, so it
  // says workable too, quietly, in place of the state word. The card says it
  // with «Взять».
  readiness: {
    tile: { form: 'glyph-word', only: ['waiting'] },
    list: { form: 'glyph-word', only: ['waiting'] },
    graph: { form: 'glyph-word', replacesState: true },
    card: { form: 'action' },
  },
  labels: {
    tile: { form: 'chips', limit: 3 },
    list: { form: 'chips', limit: 2, minWidth: 900 },
    card: { form: 'chips' },
  },
  holder: {
    tile: { form: 'glyph-word', openOnly: true },
    list: { form: 'word', always: true },
    graph: { form: 'glyph-word' },
    card: { form: 'glyph-word', always: true },
  },
  parent: {
    tile: { form: 'glyph-word', flatOnly: true },
    graph: { form: 'glyph-word' },
    card: { form: 'glyph-word' },
  },
  steps: {
    tile: { form: 'glyph-word' },
    list: { form: 'word', always: true },
    card: { form: 'word' },
  },
}

/** The facets in the order a surface reads them out, lead marks first. */
export const FACET_ORDER: readonly FacetId[] = [
  'priority',
  'kind',
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
   * nothing. Kind, priority and labels filter, as the owner decided; the
   * filter model takes every facet, and the bar's menu reaches the rest.
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
}

/** A facet that carries no meaning colour, as the state owner says it. */
const PLAIN: SemanticStatePair = { dimension: 'work-item-facet', state: 'plain' }

const KIND_GLYPHS: Record<WorkItemBrief['kind'], IconName | null> = {
  task: null,
  bug: 'kind-bug',
  epic: 'kind-epic',
  improvement: 'kind-improvement',
}

const PRIORITY_GLYPHS: Record<WorkItemBrief['priority'], IconName | null> = {
  urgent: 'priority-urgent',
  high: 'priority-high',
  medium: null,
  low: 'priority-low',
}

/** Readiness as a facet value: startable, waiting on an open blocker, or neither. */
export function readinessOf(item: WorkItemBrief, context: FacetContext = {}): string | null {
  if (item.state.is_terminal) return null
  if (context.waitingOn) return 'waiting'
  return item.ready ? 'ready' : null
}

function steps(item: WorkItemBrief) {
  return {
    done: item.checklist.filter((step) => step.done).length,
    total: item.checklist.length,
  }
}

/** The value one facet has on one item, or null when the item has none. */
function valueOf(facet: FacetId, item: WorkItemBrief, context: FacetContext): string | null {
  if (facet === 'kind') return item.kind
  if (facet === 'priority') return item.priority
  if (facet === 'state') return item.state.category
  if (facet === 'readiness') return readinessOf(item, context)
  if (facet === 'labels') return item.labels.length ? item.labels.join(',') : null
  if (facet === 'holder') return item.claim_ref || null
  if (facet === 'parent')
    return item.parent_id && context.parentReference ? context.parentReference : null
  return item.checklist.length ? 'steps' : null
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
  item: WorkItemBrief,
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

function kindMark(item: WorkItemBrief, form: FacetForm): FacetMark {
  return {
    facet: 'kind',
    value: item.kind,
    form,
    glyph: KIND_GLYPHS[item.kind],
    text: { key: `workItem.kind.${item.kind}` },
    tone: PLAIN,
    filter: { facet: 'kind', value: item.kind },
    quiet: false,
  }
}

function priorityMark(item: WorkItemBrief, form: FacetForm): FacetMark {
  return {
    facet: 'priority',
    value: item.priority,
    form,
    glyph: PRIORITY_GLYPHS[item.priority],
    text: { key: `priority.${item.priority}` },
    tone: { dimension: 'work-item-priority', state: item.priority },
    filter: { facet: 'priority', value: item.priority },
    quiet: item.priority === 'medium',
  }
}

function stateMark(item: WorkItemBrief, form: FacetForm): FacetMark {
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

function readinessMark(value: string, form: FacetForm, context: FacetContext): FacetMark {
  const waiting = value === 'waiting'
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
  }
}

/** Nobody, in a column, is a dash; in a sentence of facts it is said. */
function holderText(item: WorkItemBrief, surface: FacetSurface): FacetText {
  if (item.claim_ref) return { literal: holderName(item.claim_ref) }
  return surface === 'list' ? { literal: '—' } : { key: 'workItem.noClaim' }
}

function holderMark(item: WorkItemBrief, form: FacetForm, surface: FacetSurface): FacetMark {
  const stale = item.claim_state === 'stale' && !item.state.is_terminal
  return {
    facet: 'holder',
    value: item.claim_ref,
    form,
    glyph: item.claim_ref ? 'holder' : null,
    text: holderText(item, surface),
    // Only a stale claim has something to say; a live or unconfirmed one is quiet.
    tone: stale ? { dimension: 'claim-lease', state: 'stale' } : PLAIN,
    filter: null,
    quiet: !item.claim_ref,
  }
}

/**
 * A chip per label the surface has room for, then one quiet «+N» for the rest
 * (form `word`, no filter), which the surface's own open target explains.
 */
function labelMarks(item: WorkItemBrief, rule: FacetRule): FacetMark[] {
  const shown = rule.limit === undefined ? item.labels : item.labels.slice(0, rule.limit)
  const rest = item.labels.length - shown.length
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
  item: WorkItemBrief,
  context: FacetContext = {},
): FacetMark[] {
  const rule = FACET_RULES[facet][surface]
  if (!rule || rule.form === 'action' || !printsFacet(facet, surface, item, context)) return []
  const { form } = rule
  if (facet === 'kind') return [kindMark(item, form)]
  if (facet === 'priority') return [priorityMark(item, form)]
  if (facet === 'state') return [stateMark(item, form)]
  if (facet === 'labels') return labelMarks(item, rule)
  if (facet === 'holder') return [holderMark(item, form, surface)]
  if (facet === 'readiness') {
    const value = readinessOf(item, context)
    return value ? [readinessMark(value, form, context)] : []
  }
  if (facet === 'parent')
    return [
      {
        facet,
        value: context.parentReference ?? '',
        form,
        glyph: 'parent',
        text: { literal: context.parentReference ?? '' },
        tone: PLAIN,
        filter: null,
        quiet: false,
      },
    ]
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

/** Every mark a surface prints for an item, facet by facet in reading order. */
export function surfaceMarks(
  surface: FacetSurface,
  item: WorkItemBrief,
  context: FacetContext = {},
  facets: readonly FacetId[] = FACET_ORDER,
): FacetMark[] {
  return facets.flatMap((facet) => facetMarks(facet, surface, item, context))
}
