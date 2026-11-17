/**
 * The questions double under the questions its helpers build: the list of every space,
 * the pending ones, those on the card, and the question itself.
 */
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

import { installInputRequestBackend } from '../inputRequestBackend.ts'
import { workItemRef } from '../planningFixtures.ts'
import {
  asked,
  crowdedField,
  installQuestions,
  mixedField,
  question,
  QUESTION_ID,
  routeField,
  wordsField,
} from '../questionBackend.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

const reads = (id: string) => [
  '/api/modules/planning/requests?scope_kind=global',
  '/api/modules/planning/requests?scope_kind=global&status=pending',
  `/api/modules/planning/requests?scope_kind=global&reference=${workItemRef.reference}`,
  `/api/modules/planning/request?id=${id}`,
]

const asking = (name: string, entries: InputRequestEntry[]): DrivenRoutes => ({
  name: `${name} (questionBackend.ts)`,
  install: (page) => installQuestions(page, entries),
  reads: reads(entries[0]?.request.request_id ?? QUESTION_ID),
})

export const routes: DrivenRoutes[] = [
  asking('asked()', [asked()]),
  asking('question()', [question()]),
  ...Object.entries({ routeField, wordsField, crowdedField, mixedField }).map(([name, field]) =>
    asking(`asked({ fields: [${name}] })`, [asked({ fields: [field] })]),
  ),
  {
    name: 'installInputRequestBackend()',
    install: installInputRequestBackend,
    reads: ['/api/modules/planning/requests?scope_kind=global'],
  },
]
