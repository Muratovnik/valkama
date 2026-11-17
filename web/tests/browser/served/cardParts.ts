/**
 * What the card specs lay over the backend double's card: links in two groups, a long
 * Activity, a long discussion and a long checklist.
 */
import { asRoot } from '../../support/threads.ts'
import { now } from '../planningFixtures.ts'
import { backendRoutes } from '../servedRoutes.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

const SHORT = 'Ask the vendor'
const LONG =
  'Move the store integrity check into a build stage of its own, describe how it is rolled back and what a failed check leaves for the next run to find'

/** Two groups, each with a short and a long title, and four state words of different lengths. */
export const LINKS = [
  ['discovered-from', 'MAIN-777', SHORT, 'Dev', 'active'],
  ['discovered-from', 'MAIN-778', LONG, 'Done', 'completed'],
  ['relates-to', 'MAIN-779', LONG, 'Backlog', 'triage'],
  ['relates-to', 'MAIN-780', SHORT, 'Review', 'review'],
].map(([kind, reference, title, name, category], index) => ({
  kind,
  direction: 'outgoing',
  work_item_id: `00000000-0000-4000-8000-00000000077${index}`,
  reference,
  title,
  state_name: name,
  state_category: category,
  is_terminal: category === 'completed',
  state_unavailable: null,
}))

/** Sixty claims in the card's Activity, a minute apart. */
export const sixtyEvents = () =>
  Array.from({ length: 60 }, (_, index) => ({
    action: 'claimed',
    author: `agent-${index}`,
    at: `2026-08-13T08:${String(index).padStart(2, '0')}:00Z`,
    detail: '',
    identity: { agent_id: null, session_id: null, source: null, state: 'unconfirmed' },
  }))

/** Thirty remarks, each a root of its own. */
export const thirtyRemarks = () =>
  Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    kind: 'comment',
    ...asRoot,
    author: 'codex',
    at: now,
    body: `Remark ${index + 1}.`,
    report: null,
    checklist_item_id: null,
    checklist_item_text: null,
  }))

/** Nine steps, the first two done. */
export const nineSteps = () =>
  Array.from({ length: 9 }, (_, index) => ({
    id: `123e4567-e89b-42d3-a456-4266141742${String(index).padStart(2, '0')}`,
    text: `The step number ${index + 1}`,
    done: index < 2,
    claimed_by: '',
    done_by: '',
    by_previous_holder: false,
  }))

export const routes: DrivenRoutes[] = [
  backendRoutes('LINKS', { card: (card) => ({ ...card, links: LINKS }) }),
  backendRoutes('sixtyEvents()', { events: sixtyEvents(), longRead: true }),
  backendRoutes('thirtyRemarks()', { comments: thirtyRemarks() }),
  backendRoutes('nineSteps()', {
    longRead: true,
    card: (read) => ({ ...read, checklist: nineSteps() }),
  }),
]
