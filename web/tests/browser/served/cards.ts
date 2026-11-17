/**
 * The cards the card specs answer the work-item read with in place of the backend
 * double's: steps in each standing, a held claim, a goal read down, and the
 * questions on a card.
 */
import { requestEntry, requestList } from '../../support/inputRequests.ts'
import { spaceRef, spaceScope, workItem, workItemRef } from '../planningFixtures.ts'
import { cardRead, itemAnswer } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

const step = (id: string, text: string, change: object = {}) => ({
  id,
  text,
  done: false,
  claimed_by: '',
  done_by: '',
  by_previous_holder: false,
  ...change,
})

/** A step nobody holds, one somebody closed and one somebody holds. */
export const STANDING_STEPS = [
  step('123e4567-e89b-42d3-a456-426614174101', 'A step nobody holds'),
  step('123e4567-e89b-42d3-a456-426614174102', 'A step somebody closed', {
    done: true,
    done_by: 'own-a (auto/val564-a)',
  }),
  step('123e4567-e89b-42d3-a456-426614174103', 'A step somebody holds', { claimed_by: 'own-b' }),
]
/** Two open steps, the first to talk over. */
export const TALKED_STEPS = [
  step('123e4567-e89b-42d3-a456-426614174201', 'A step to talk over'),
  step('123e4567-e89b-42d3-a456-426614174202', 'The step after it'),
]
/** The one step an empty checklist is given. */
export const ONE_STEP = [step('00000000-0000-4000-8000-000000000301', 'A step')]

/** Forty short paragraphs: a description long enough to scroll the card. */
export const PARAGRAPHS = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}.`).join(
  String.fromCodePoint(10, 10),
)

/** The card's answer: the fixture's work item with `change` laid over it. */
export const cardAnswer = (change: object = {}) =>
  itemAnswer(spaceScope, workItemRef, { ...workItem, ...change })

/** The long card whose claim `holder` holds, as its claims leave it. */
export const heldBy = (holder: string) => ({
  ...workItem,
  claim: null,
  claim_ref: holder,
  description: PARAGRAPHS,
  links: [],
})

/** A goal read down: it stands in a state of its own, and its description is long. */
export const READ_DOWN_GOAL = {
  ...workItem,
  kind: 'goal',
  open: true,
  container_state: null,
  acceptance: null,
  started_at: null,
  waits_for: [],
  claim: null,
  claim_ref: '',
  description: PARAGRAPHS,
}

/** A question asked on the card, which it can answer. */
export function aQuestion() {
  const entry = requestEntry()
  entry.target = {
    space_ref: spaceRef,
    reference: workItemRef.reference,
    writable: true,
  }
  entry.request.work_item_id = workItem.work_item_id
  entry.request.reference = workItemRef.reference
  return entry
}
/** The questions on the card, as the list of every space reads them. */
export const questionsAnswer = (questions: ReturnType<typeof requestEntry>[]) => ({
  ...requestList(questions),
  coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
})

const card = (name: string, body: object): Served => ({
  name: `served/cards.ts ${name}`,
  url: cardRead(workItemRef.reference),
  body,
})
const questions = (name: string, body: object): Served => ({
  name: `served/cards.ts ${name}`,
  url: '/api/modules/planning/requests?scope_kind=global',
  body,
})

export const served: Served[] = [
  card('STANDING_STEPS', cardAnswer({ checklist: STANDING_STEPS })),
  card('TALKED_STEPS', cardAnswer({ checklist: TALKED_STEPS })),
  card('no steps', cardAnswer({ checklist: [] })),
  card('ONE_STEP', cardAnswer({ checklist: ONE_STEP })),
  card('heldBy(codex)', itemAnswer(spaceScope, workItemRef, heldBy('codex'))),
  card('heldBy(nobody)', itemAnswer(spaceScope, workItemRef, heldBy(''))),
  card('READ_DOWN_GOAL', itemAnswer(spaceScope, workItemRef, READ_DOWN_GOAL)),
  ...['user', ''].map((holder): Served => ({
    name: `served/cards.ts heldBy(${holder || 'nobody'}) as the claim answers it`,
    method: 'POST',
    url: '/api/planning/work-item/claim',
    body: heldBy(holder),
  })),
  questions('no questions', questionsAnswer([])),
  questions('aQuestion()', questionsAnswer([aQuestion()])),
]
