/**
 * Every record a browser spec serves passes the contract the page applies to it.
 *
 * The page refuses a whole answer when one record breaks a rule and shows "Could not
 * load this view"; the spec then times out on an element that is not there, and its
 * trace says nothing about the schema. Here the same records meet the same
 * validators in a unit run, so a broken one fails in seconds and by name.
 *
 * Two populations. The backend double's own route table is driven as the page would
 * ask it, under every set of options a spec gives it. The records a helper or a spec
 * adds on top of it live in `tests/browser/served/`, each module listing what it
 * serves, and both the spec and this test read them from there.
 */
import { describe, expect, it } from 'vitest'

import { installBackend } from './browser/backend.ts'
import type { BackendOptions } from './browser/backend.ts'
import { PLAN_PATH } from './browser/planDocumentFixture.ts'
import {
  attachedDataScopeId,
  blockedWorkItem,
  dataScopeId,
  workItem,
  workItemRef,
} from './browser/planningFixtures.ts'
import { routedPage } from './browser/routeDriver.ts'
import { served as kindColorsServed } from './browser/served/kindColors.ts'
import { uiSystemCard, served as uiSystemServed } from './browser/served/uiSystem.ts'
import { SPACE_READ } from './browser/servedAnswers.ts'
import { checkServed } from './browser/servedContracts.ts'
import type { Served } from './browser/servedContracts.ts'

const space = (scopeId = dataScopeId) =>
  new URLSearchParams({ scope_kind: 'space', data_scope_id: scopeId, space_key: 'MAIN' })

/** The reads the page makes of the backend double, one per route it answers strictly. */
function backendReads(options: BackendOptions): string[] {
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
    '/api/quota/settings',
    '/api/quota/account-names',
    '/api/doctor',
    '/api/open-places',
    `/api/documents/resolve?path=${PLAN_PATH}&path=src/a.ts&path=missing.md`,
    '/api/documents/search?q=plan',
    `/api/documents/read?path=${PLAN_PATH}`,
  ]
}

async function backendServes(label: string, options: BackendOptions): Promise<Served[]> {
  const { page, ask } = routedPage()
  await installBackend(page, options)
  const served: Served[] = []
  for (const url of backendReads(options)) {
    const answer = await ask(url)
    if (answer?.status === 200)
      served.push({ name: `backend.ts (${label})`, url, body: answer.body })
  }
  const test = await ask('/api/alerts/test', { method: 'POST', body: {} })
  if (test?.status === 200)
    served.push({
      name: `backend.ts (${label})`,
      method: 'POST',
      url: '/api/alerts/test',
      body: test.body,
    })
  return served
}

/** What each served answer's contract says of it, one line for each that it refuses. */
const failuresOf = (served: readonly Served[]) =>
  served.map((entry) => checkServed(entry)).filter((failure) => failure !== null)

/** Each module under `served/`, with the answers it lists and the backend options it gives. */
const modules = import.meta.glob<{
  backendOptions?: Record<string, BackendOptions>
  served?: Served[]
}>('./browser/served/*.ts', { eager: true })

describe('the records the browser specs serve', () => {
  it.each(Object.entries(modules))(
    '%s serves only records its contracts take',
    async (_, module) => {
      expect(module.served?.length ?? 0).toBeGreaterThan(0)
      const options = Object.entries(module.backendOptions ?? {})
      const driven = await Promise.all(options.map(([label, given]) => backendServes(label, given)))
      expect(failuresOf([...(module.served ?? []), ...driven.flat()])).toStrictEqual([])
    },
  )

  it('the backend double answers every strict read it serves with a valid record', async () => {
    const served = await backendServes('default', {})
    expect(failuresOf(served)).toStrictEqual([])
  })

  // The two faults that left tens of specs red: a row workable while withheld as not
  // ready, and a card without `lapsed_claim`. Each is brought back on a copy here.
  it('names the record and the rule a reintroduced fault breaks', () => {
    const space = kindColorsServed.find(({ url }) => url === SPACE_READ) as Served
    const model = structuredClone(space.body) as { work_items: Record<string, unknown>[] }
    model.work_items[1] = { ...model.work_items[1], workable: true, withheld: ['not_ready'] }
    expect(checkServed({ ...space, body: model })).toBe(
      `served/kindColors.ts KIND_SPACE: GET ${SPACE_READ} (record MAIN-902) planning.work_items[1]: expected workable exactly when nothing is withheld`,
    )
    const card = uiSystemCard()
    Reflect.deleteProperty(card.state.payload.work_item, 'lapsed_claim')
    const read = uiSystemServed.find(({ url }) => url.includes('work-item')) as Served
    expect(checkServed({ ...read, body: card })).toBe(
      `served/uiSystem.ts uiSystemCard(): GET ${read.url} planning_work_item.state.payload.work_item.lapsed_claim: missing field`,
    )
  })
})
