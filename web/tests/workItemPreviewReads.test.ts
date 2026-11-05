/**
 * The preview's read of a work item off the page: which store it asks, what it
 * remembers and for how long, and what closing the preview does to it. The
 * server is a fetch double that answers the brief the real server answered
 * (`fixtures/server/card-brief.json`), addressed to whatever was asked.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createWorkItemPreviewReads,
  PREVIEW_CACHE_LIMIT,
  PREVIEW_FRESH_MS,
  useWorkItemPreviewReads,
} from '@/entities/work-item/composables/useWorkItemPreviewReads.ts'
import type { PreviewCandidate } from '@/entities/work-item/composables/useWorkItemPreviewReads.ts'

import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
} from '@/shared/api/platformPlanningPayload.ts'

import { requestUrl, withSecurityBootstrap } from './support/request.ts'

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/server/${name}`, import.meta.url)), 'utf8'),
  )

const PRIMARY = '123e4567-e89b-42d3-a456-426614174000'
const ATTACHED = '223e4567-e89b-42d3-a456-426614174000'
const primary: PreviewCandidate = {
  project_id: 'example-project',
  space_ref: { data_scope_id: PRIMARY, space_key: 'MAIN' },
}
const attached: PreviewCandidate = {
  project_id: 'other-project',
  space_ref: { data_scope_id: ATTACHED, space_key: 'MAIN' },
}

/** What each store answers: a title for a record, or a refusal's status. */
type Store = { title: string } | { status: number }

/** A server holding `stores` by data scope; answers each brief read as the real one would. */
function serve(stores: Record<string, Store>) {
  const asked: string[] = []
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    withSecurityBootstrap(async (input, init) => {
      const query = new URL(requestUrl(input), 'https://example.test').searchParams
      const scope = query.get('data_scope_id') ?? ''
      const reference = query.get('reference') ?? ''
      asked.push(`${reference}@${scope}`)
      expect(query.get('brief')).toBe('true')
      const store = stores[scope]
      if (store === undefined || 'status' in store)
        return new Response(
          JSON.stringify({ error: { code: 'unavailable', message: 'Exact work item' } }),
          { status: store?.status ?? 404 },
        )
      // Wait on the signal for the abort tests; any other read answers at once.
      if (store.title === 'never')
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        )
      const answer = structuredClone(fixture('card-brief.json')) as {
        scope: { project_ref: { project_id: string } }
        state: { payload: { work_item: Record<string, unknown> } }
        work_item_ref: { reference: string; space_ref: unknown }
      }
      answer.scope.project_ref.project_id = query.get('project_id') ?? ''
      answer.work_item_ref = {
        space_ref: { data_scope_id: scope, space_key: query.get('space_key') },
        reference,
      }
      Object.assign(answer.state.payload.work_item, {
        reference,
        number: Number(reference.split('-')[1]),
        title: store.title,
      })
      return new Response(JSON.stringify(answer))
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return asked
}

function clock(start = 1_000_000) {
  const time = { now: start }
  return { time, now: () => time.now }
}

const live = () => new AbortController().signal

afterEach(() => vi.unstubAllGlobals())

describe('the brief record', () => {
  it('is what the server answers with brief=true, and only the brief schema reads it', () => {
    const read = validatePlanningWorkItemBriefPayload(fixture('card-brief.json'))
    expect(read.state.status).toBe('ready')
    if (read.state.status === 'ready') expect(read.state.payload.work_item.comment_count).toBe(7)
    // Each strict schema refuses the other record, so neither read can pass for the other.
    expect(() => validatePlanningWorkItemPayload(fixture('card-brief.json'))).toThrow(/work_item/u)
    expect(() => validatePlanningWorkItemBriefPayload(fixture('card.json'))).toThrow(/work_item/u)
  })
})

describe('a preview read off the page', () => {
  it('asks the primary store first and stops at its answer', async () => {
    const asked = serve({ [PRIMARY]: { title: 'In the primary' }, [ATTACHED]: { title: 'No' } })
    const read = await createWorkItemPreviewReads().read('MAIN-12', [primary, attached], live())
    expect(read).toMatchObject({ status: 'ready', item: { title: 'In the primary' } })
    expect(read).toMatchObject({ candidate: primary })
    expect(asked).toEqual([`MAIN-12@${PRIMARY}`])
  })

  it('asks the next store when the first has no such item', async () => {
    const asked = serve({ [PRIMARY]: { status: 404 }, [ATTACHED]: { title: 'Attached' } })
    const read = await createWorkItemPreviewReads().read('MAIN-12', [primary, attached], live())
    expect(read).toMatchObject({
      status: 'ready',
      item: { title: 'Attached' },
      candidate: attached,
    })
    expect(asked).toEqual([`MAIN-12@${PRIMARY}`, `MAIN-12@${ATTACHED}`])
  })

  it('says why there is no record, and does not look past a store that went away', async () => {
    const reads = createWorkItemPreviewReads()
    serve({ [PRIMARY]: { status: 404 }, [ATTACHED]: { status: 404 } })
    expect(await reads.read('MAIN-12', [primary, attached], live())).toEqual({ status: 'missing' })
    const asked = serve({ [PRIMARY]: { status: 409 }, [ATTACHED]: { title: 'Not asked' } })
    expect(await reads.read('MAIN-12', [primary, attached], live())).toEqual({
      status: 'unavailable',
    })
    expect(asked).toEqual([`MAIN-12@${PRIMARY}`])
    serve({ [PRIMARY]: { status: 500 } })
    expect(await reads.read('MAIN-12', [primary], live())).toEqual({ status: 'failed' })
  })

  it('answers a record younger than ten seconds without asking', async () => {
    const { time, now } = clock()
    const reads = createWorkItemPreviewReads({ now })
    const asked = serve({ [PRIMARY]: { title: 'First' } })
    const first = await reads.read('MAIN-12', [primary], live())
    time.now += PREVIEW_FRESH_MS - 1
    expect(await reads.read('MAIN-12', [primary], live())).toBe(first)
    expect(asked).toHaveLength(1)
  })

  it('keeps an older record to draw at once while a read replaces it', async () => {
    const { time, now } = clock()
    const reads = createWorkItemPreviewReads({ now })
    serve({ [PRIMARY]: { title: 'First' } })
    await reads.read('MAIN-12', [primary], live())
    time.now += PREVIEW_FRESH_MS
    const asked = serve({ [PRIMARY]: { title: 'Renamed' } })
    expect(reads.cached('MAIN-12', [primary])).toMatchObject({ item: { title: 'First' } })
    const fresh = await reads.read('MAIN-12', [primary], live())
    expect(asked).toHaveLength(1)
    expect(fresh).toMatchObject({ item: { title: 'Renamed' }, readAt: time.now })
    expect(reads.cached('MAIN-12', [primary])).toBe(fresh)
  })

  it('remembers no refusal or failure, and forgets what a refusal replaced', async () => {
    const { time, now } = clock()
    const reads = createWorkItemPreviewReads({ now })
    let asked = serve({ [PRIMARY]: { status: 500 } })
    await reads.read('MAIN-12', [primary], live())
    await reads.read('MAIN-12', [primary], live())
    expect(asked).toHaveLength(2)
    serve({ [PRIMARY]: { title: 'Kept for now' } })
    await reads.read('MAIN-12', [primary], live())
    time.now += PREVIEW_FRESH_MS
    asked = serve({ [PRIMARY]: { status: 404 } })
    expect(await reads.read('MAIN-12', [primary], live())).toEqual({ status: 'missing' })
    expect(reads.cached('MAIN-12', [primary])).toBeNull()
    await reads.read('MAIN-12', [primary], live())
    expect(asked).toHaveLength(2)
  })

  it('stops the read when the preview closes, and remembers nothing of it', async () => {
    const reads = createWorkItemPreviewReads()
    const asked = serve({ [PRIMARY]: { title: 'never' } })
    const closing = new AbortController()
    const pending = reads.read('MAIN-12', [primary], closing.signal)
    await vi.waitFor(() => expect(asked).toHaveLength(1))
    closing.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads.cached('MAIN-12', [primary])).toBeNull()
    // Already closed: nothing is asked at all.
    await expect(reads.read('MAIN-13', [primary], closing.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(asked).toHaveLength(1)
  })

  it('keeps at most a hundred records, the least recently used leaving first', async () => {
    const reads = createWorkItemPreviewReads()
    serve({ [PRIMARY]: { title: 'Item' } })
    for (let number = 1; number <= PREVIEW_CACHE_LIMIT; number += 1)
      await reads.read(`MAIN-${number}`, [primary], live())
    // MAIN-1 was looked at again, so MAIN-2 is now the oldest.
    expect(reads.cached('MAIN-1', [primary])).not.toBeNull()
    await reads.read(`MAIN-${PREVIEW_CACHE_LIMIT + 1}`, [primary], live())
    expect(reads.cached('MAIN-2', [primary])).toBeNull()
    for (const number of [1, 3, PREVIEW_CACHE_LIMIT + 1])
      expect(reads.cached(`MAIN-${number}`, [primary])).not.toBeNull()
  })

  it('keeps a record by where it was looked for, so another binding asks again', async () => {
    const reads = createWorkItemPreviewReads()
    const asked = serve({ [PRIMARY]: { title: 'Primary' }, [ATTACHED]: { title: 'Attached' } })
    await reads.read('MAIN-12', [primary], live())
    const elsewhere = await reads.read('MAIN-12', [attached], live())
    expect(elsewhere).toMatchObject({ item: { title: 'Attached' } })
    expect(asked).toHaveLength(2)
  })

  it('is one reader for the whole window', () => {
    expect(useWorkItemPreviewReads()).toBe(useWorkItemPreviewReads())
  })
})
