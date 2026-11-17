/**
 * What the board specs' server answers: the space with the board's items in it, their
 * chain, and the item a move writes back.
 */
import { serve } from '../boardBackend.ts'
import { workItem } from '../planningFixtures.ts'
import { SPACE_READ } from '../servedAnswers.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

export const routes: DrivenRoutes[] = [
  {
    name: 'boardBackend.ts serve() over boardFixtures.ts boardSpace()',
    install: (page) => serve(page),
    reads: [
      SPACE_READ,
      `/api/planning/work-item/chain?id=${workItem.work_item_id}&scope=chain`,
      {
        method: 'POST',
        url: '/api/planning/work-item/transition',
        body: { id: 'MAIN-402', state: 'dev' },
      },
      {
        method: 'POST',
        url: '/api/planning/work-item/update',
        body: { id: 'MAIN-405', state: 'done' },
      },
    ],
  },
]
