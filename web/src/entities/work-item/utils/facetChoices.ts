/**
 * The values a menu offers for an item's kind, priority and state, each drawn the way the
 * card draws the chosen one. Kept apart from the facet registry it reads from, which is the
 * one place a mark is built.
 */
import { kindMark, priorityMark, stateMark } from '@/entities/work-item/utils/facets.ts'
import type { FacetMark, FacetRule, FacetSubject } from '@/entities/work-item/utils/facets.ts'

import { PRIORITIES, WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/**
 * A value a person chooses from a menu: what an item is, how much it asks, or where it
 * stands — a state of the workflow, or a category the filter narrows by, named in words.
 */
export type FacetChoice =
  | { facet: 'kind'; value: WorkItemBrief['kind'] }
  | { facet: 'priority'; value: WorkItemBrief['priority'] }
  /** `value` is what the menu chooses: a workflow state's key, or a category. */
  | { facet: 'state'; state: FacetSubject['state']; value: string }

/** The kinds as a menu offers them, in the order of the model's vocabulary. */
export const KIND_CHOICES: readonly FacetChoice[] = WORK_ITEM_KINDS.map((value) => ({
  facet: 'kind',
  value,
}))

/** The priorities as a menu offers them: the most pressing first. */
export const PRIORITY_CHOICES: readonly FacetChoice[] = [...PRIORITIES]
  .reverse()
  .map((value) => ({ facet: 'priority', value }))

/** What a menu draws a value with: the glyph and the word the card draws it with, read, not pressed. */
const CHOICE_RULE: FacetRule = { form: 'glyph-word', plain: true }

/**
 * One value as a menu offers it, from the rows the card draws the chosen value with: a
 * priority's glyph in its tone, its word and what it means; a kind's glyph and word in the
 * kind's colour; a state's dot and its name. A menu used to name a value in plain words
 * under a button that drew its glyph, so a list and its button said one value two ways.
 */
export function choiceMark(choice: FacetChoice): FacetMark {
  if (choice.facet === 'kind') return kindMark(choice.value, CHOICE_RULE)
  if (choice.facet === 'priority') return priorityMark(choice.value, CHOICE_RULE)
  return stateMark(choice.state, CHOICE_RULE.form)
}
