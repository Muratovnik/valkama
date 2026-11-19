/**
 * Why a task that stands ready is held back: the take-next queue would not give it, and
 * the server says why in its `withheld` codes.
 *
 * A tile in a ready column is the norm there only while the queue would give it. One the
 * queue would not give is muted, and its first line ends with a sign and a word for the
 * first reason, as a blocked tile names its blocker; the whole sentence is the mark's name
 * and hover text, so a line short of room keeps the sign and still says it. Tone alone
 * carries no meaning (DESIGN.md, Accessibility), and a hint alone is not seen.
 *
 * Elsewhere the column already says why: work in triage, put off or at work is not ready,
 * which is the queue's first reason for it, and a goal or stage is never given. Neither
 * of those two codes is ever the word.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { WithheldCode } from '@/shared/api/planningRecordRules.ts'

/** What the rule reads of an item; a surface that carries less says nothing. */
export type HeldBackSubject = Partial<Pick<WorkItemBrief, 'open' | 'workable' | 'withheld'>> & {
  state?: { category: string } | null
}

/** What the column says for itself, so a tile never repeats it. */
const SAID_BY_COLUMN: ReadonlySet<WithheldCode> = new Set(['goal_or_stage', 'not_ready'])

/** Whether the item stands ready and the queue would still not give it. */
export function heldBack(item: HeldBackSubject): boolean {
  return item.open === true && item.state?.category === 'ready' && item.workable === false
}

/** The reason a held-back tile names: the first the server gives that its column does not. */
export function withheldReason(item: HeldBackSubject): WithheldCode | null {
  return heldBack(item) ? (item.withheld?.find((code) => !SAID_BY_COLUMN.has(code)) ?? null) : null
}

/**
 * The mark of that reason as the facet registry draws it (`facets.ts`): the sign, the short
 * word drawn, the whole sentence its name and hover text.
 */
export function withheldMark<Form extends string>(code: WithheldCode, form: Form) {
  return {
    facet: 'readiness' as const,
    value: 'withheld',
    form,
    glyph: 'withheld' as const,
    text: { key: `workItem.withheld.${code}` },
    short: { key: `workItem.withheldShort.${code}` },
    tone: { dimension: 'work-item-readiness' as const, state: 'blocked' as const },
    filter: null,
    quiet: false,
  }
}
