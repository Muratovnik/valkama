/**
 * The backend double under the options the card specs install it with, where the
 * option is a shared fixture or a flag: each table asks it everything it answers.
 */
import {
  agentsInEveryState,
  finishedCard,
  heldCard,
  openPlanFor,
  PLANNED_SESSIONS,
  shortHolderCard,
  threeAgents,
  UNLINKED_SESSION,
} from '../openSessionFixtures.ts'
import { backendRoutes } from '../servedRoutes.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

/** What the dialog asks the open plan of: every session it answers for, and one setting's choice. */
const planReads = [...PLANNED_SESSIONS(), UNLINKED_SESSION].flatMap((session) => [
  `/api/open-plan?session=${session}`,
  `/api/open-plan?session=${session}&always=vscode`,
])

const held = (name: string, card: (read: Record<string, unknown>) => object): DrivenRoutes => {
  const routes = backendRoutes(name, { agents: threeAgents, card, openPlan: openPlanFor })
  return { ...routes, reads: [...routes.reads, ...planReads] }
}

export const routes: DrivenRoutes[] = [
  backendRoutes('{ longRead: true }', { longRead: true }),
  backendRoutes('{ includeAttachedDuplicate: true }', { includeAttachedDuplicate: true }),
  backendRoutes('{ includeEmptySpace: true }', { includeEmptySpace: true }),
  backendRoutes('{ closedWith }', { closedWith: 'Готово и выпущено.' }),
  backendRoutes('{ stepText }', { stepText: 'Wait for MAIN-265, then run `npm test`' }),
  backendRoutes('{ source: file }', { source: 'src/a.ts:42' }),
  backendRoutes('{ source: words }', { source: 'Notion: the migration plan' }),
  backendRoutes('{ agents: agentsInEveryState }', { agents: agentsInEveryState }),
  held('heldCard', heldCard),
  held('finishedCard', finishedCard),
  held('shortHolderCard', shortHolderCard),
]
