/**
 * Every record a browser spec serves passes the contract the page applies to it.
 *
 * The page refuses a whole answer when one record breaks a rule and shows "Could not
 * load this view"; the spec then times out on an element that is not there, and its
 * trace says nothing about the schema. Here the same records meet the same
 * validators in a unit run, so a broken one fails in seconds and by name.
 *
 * The records a helper or a spec serves live in `tests/browser/served/`, and both the
 * spec and this test read them from there. Each module lists the answers it serves,
 * and the route tables that compose answers (the backend double among them) are
 * driven as the page asks them, under the arguments the specs give them.
 */
import { describe, expect, it, vi } from 'vitest'

import { routedPage } from './browser/routeDriver.ts'
import { served as kindColorsServed } from './browser/served/kindColors.ts'
import { uiSystemCard, served as uiSystemServed } from './browser/served/uiSystem.ts'
import { SPACE_READ } from './browser/servedAnswers.ts'
import { checkServed } from './browser/servedContracts.ts'
import type { Served } from './browser/servedContracts.ts'
import { backendReads, backendRoutes } from './browser/servedRoutes.ts'
import type { DrivenRoutes } from './browser/servedRoutes.ts'

// The records live outside Playwright: a module that loads it at run time fails this file.
vi.mock('@playwright/test', () => {
  throw new Error('a served record module loads @playwright/test at run time')
})

/**
 * What a driven route table answers the page's reads with, each answer a record. A read
 * it leaves unanswered, or answers with a refusal, is not a pass: it is named as missed.
 */
async function drive({ install, name, reads }: DrivenRoutes) {
  const { page, ask } = routedPage()
  await install(page)
  const served: Served[] = []
  const missed: string[] = []
  for (const read of reads) {
    const { url, method = 'GET', body } = typeof read === 'string' ? { url: read } : read
    const answer = await ask(url, { method, body })
    if (answer && answer.status >= 200 && answer.status < 300)
      served.push({ name, method, url, body: answer.body, sent: body })
    else missed.push(`${name}: ${method} ${url} answered ${answer?.status ?? 'nothing'}`)
  }
  return { missed, served }
}

/** What each served answer's contract says of it, one line for each that it refuses. */
const failuresOf = (served: readonly Served[]) =>
  served.map((entry) => checkServed(entry)).filter((failure) => failure !== null)

/** Each module under `served/`, with the answers it lists and the route tables it drives. */
const modules = import.meta.glob<{ routes?: DrivenRoutes[]; served?: Served[] }>(
  './browser/served/*.ts',
  { eager: true },
)

describe('the records the browser specs serve', () => {
  it.each(Object.entries(modules))(
    '%s serves only records its contracts take',
    async (_, module) => {
      const driven = await Promise.all((module.routes ?? []).map((routes) => drive(routes)))
      const served = [...(module.served ?? []), ...driven.flatMap((table) => table.served)]
      expect(served.length).toBeGreaterThan(0)
      expect(driven.flatMap((table) => table.missed)).toStrictEqual([])
      expect(failuresOf(served)).toStrictEqual([])
    },
  )

  it('the backend double answers every strict read it serves with a valid record', async () => {
    const { missed, served } = await drive(backendRoutes('default'))
    // Every read is answered: a route the double stopped answering is not a pass.
    expect(missed).toStrictEqual([])
    expect(served).toHaveLength(backendReads().length)
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
