/**
 * Route tables a unit test can ask, as a spec installs them.
 *
 * A module under `served/` lists the answers it serves as records where it can, and as a
 * table to drive where the answer is composed by a helper: `install` runs the helper the
 * spec runs, on the page `routeDriver.ts` fakes, and each of `reads` is asked of it as the
 * page would ask. `tests/browserRecords.test.ts` passes every answer through its contract.
 */
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import type { BackendOptions } from './backend.ts'
import { PLAN_PATH } from './planDocumentFixture.ts'
import {
  attachedDataScopeId,
  blockedWorkItem,
  dataScopeId,
  workItem,
  workItemRef,
} from './planningFixtures.ts'

/** One request the page makes: a path on the served origin, a GET unless it says otherwise. */
export type Read = string | { method: 'POST' | 'PUT'; url: string; body?: unknown }

export interface DrivenRoutes {
  name: string
  reads: readonly Read[]
  install: (page: Page) => Promise<unknown>
}

const space = (scopeId = dataScopeId) =>
  new URLSearchParams({ scope_kind: 'space', data_scope_id: scopeId, space_key: 'MAIN' })

/** The reads the page makes of the backend double, one to each route it answers strictly. */
export function backendReads(options: BackendOptions = {}): Read[] {
  const scopes = [dataScopeId, ...(options.includeAttachedDuplicate ? [attachedDataScopeId] : [])]
  const items = [workItemRef.reference, blockedWorkItem.reference]
  return [
    '/api/modules',
    '/api/platform/context?scope_kind=global',
    '/api/platform/planning?scope_kind=global',
    ...scopes.flatMap((scope) => [
      `/api/planning?data_scope_id=${scope}&space_key=MAIN`,
      `/api/platform/planning?${space(scope)}`,
      ...items.flatMap((reference) => {
        const query = new URLSearchParams({ ...Object.fromEntries(space(scope)), reference })
        return [
          `/api/modules/planning/work-item?${query}`,
          `/api/modules/planning/work-item?${query}&brief=true`,
        ]
      }),
    ]),
    `/api/planning/work-item/chain?id=${workItem.work_item_id}&scope=space`,
    `/api/planning/work-item/usage?id=${workItem.work_item_id}`,
    '/api/planning/session/usage?id=session',
    '/api/modules/planning/requests?scope_kind=global',
    '/api/execution/capabilities',
    `/api/execution/history?work_item=${workItemRef.reference}`,
    '/api/execution/history?work_item=MAIN-1',
    '/api/memory/search?project=example-project&q=plan',
    '/api/memory/providers',
    '/api/memory/linked?project=example-project',
    '/api/alerts/settings',
    '/api/alerts/status',
    { method: 'POST', url: '/api/alerts/test', body: {} },
    '/api/quota/settings',
    '/api/quota/account-names',
    '/api/doctor',
    '/api/open-places',
    `/api/documents/resolve?path=${PLAN_PATH}&path=src/a.ts&path=missing.md`,
    '/api/documents/search?q=plan',
    `/api/documents/read?path=${PLAN_PATH}`,
  ]
}

/** The backend double under `options`, asked everything it answers. */
export const backendRoutes = (name: string, options: BackendOptions = {}): DrivenRoutes => ({
  name: `${name} (backend.ts)`,
  install: (page) => installBackend(page, options),
  reads: backendReads(options),
})
