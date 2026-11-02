import { afterEach, describe, expect, it, vi } from 'vitest'

import { readWorkItemLink } from '@/features/work-item-link/workItemLink.ts'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute, workItemLinkText } from '@/shared/api/platformRoute.ts'

import { finderResponse, finderTarget } from './support/globalFinder.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const SPACE = finderTarget().space_ref
const PROJECT = finderTarget().project_id

function serve(value: unknown, status = 200) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(value), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** A search that found nothing, having read exactly these sources. */
function nothingFound(query: string, coverage: { reason: string | null; status: string }[]) {
  return {
    interface_version: 'valkama-planning-search',
    query,
    limit: 50,
    has_more: false,
    items: [],
    coverage: coverage.map((source) => ({ project_id: PROJECT, space_ref: SPACE, ...source })),
  }
}

const read = (text: string) => readWorkItemLink(text, new AbortController().signal)

describe('what a work item address leads to', () => {
  it('names a malformed address without asking the server', async () => {
    const fetchMock = serve({})
    for (const text of ['', 'not-a-number', 'TASK', 'TASK-0', 'TASK-7/', '//evil.example']) {
      expect(await read(text)).toEqual({ kind: 'malformed' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens the card the search found, whatever the case of the address', async () => {
    const payload = finderResponse('TASK-7')
    const fetchMock = serve(payload)
    expect(await read(' task-7 ')).toEqual({
      kind: 'found',
      route: {
        module_id: 'planning',
        scope: { kind: 'project', project_ref: { project_id: PROJECT } },
        entity: expect.objectContaining({ kind: 'work-item' }),
      },
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/modules/planning/search?q=TASK-7&limit=50')
  })

  it('tells a number nobody filed from a space that is not here', async () => {
    serve(nothingFound('TASK-999', [{ status: 'searched', reason: null }]))
    expect(await read('TASK-999')).toMatchObject({
      kind: 'no-item',
      reference: 'TASK-999',
      space: 'TASK',
      spaceRoute: { scope: { project_ref: { project_id: PROJECT } } },
    })
    serve(nothingFound('NOPE-1', [{ status: 'searched', reason: null }]))
    expect(await read('NOPE-1')).toEqual({ kind: 'no-space', reference: 'NOPE-1', space: 'NOPE' })
  })

  it('reads a binding to a space its store lacks as no such space', async () => {
    serve(nothingFound('TASK-1', [{ status: 'unavailable', reason: 'space_missing' }]))
    expect(await read('TASK-1')).toMatchObject({ kind: 'no-space', space: 'TASK' })
  })

  it('never says an item is missing while a store that may hold it did not answer', async () => {
    serve(
      nothingFound('TASK-1', [
        { status: 'searched', reason: null },
        { status: 'unavailable', reason: 'store_unreadable' },
      ]),
    )
    expect(await read('TASK-1')).toEqual({ kind: 'unreadable', reference: 'TASK-1', space: 'TASK' })
  })

  it('leaves a failed search to the caller rather than calling the item missing', async () => {
    serve({ error: { code: 'unavailable', message: 'project_registry_unavailable' } }, 409)
    await expect(read('TASK-1')).rejects.toMatchObject({ status: 409 })
  })
})

describe('the address grammar', () => {
  it('reads only the /open path, and decodes what follows it', () => {
    expect(workItemLinkText('/open/MAIN-12')).toBe('MAIN-12')
    expect(workItemLinkText('/open/%D0%B0-1')).toBe('а-1')
    expect(workItemLinkText('/open//evil.example')).toBe('/evil.example')
    expect(workItemLinkText('/open/')).toBe('')
    expect(workItemLinkText('/open')).toBe('')
    expect(workItemLinkText('/open/%E0%A4%A')).toBe('%E0%A4%A')
    expect(workItemLinkText('/opening/MAIN-12')).toBeNull()
    expect(workItemLinkText('/modules/planning/global')).toBeNull()
  })

  it('reads the route the server redirects to as the card it names', () => {
    // The same literal stands in `tests/test_work_item_link.py`, worked out by hand:
    // the two languages share this route and no code, so this is what ties them.
    const route = parsePlatformRoute(
      '/modules/planning/project/example-project?entity=' +
        'eyJraW5kIjoid29yay1pdGVtIiwicmVzb3VyY2VfaWQiOiJleUp5WldabGNtVnVZMlVpT2lKTlFVbE9MVEV5SWl3aWMz' +
        'QmhZMlZmY21WbUlqcDdJbVJoZEdGZmMyTnZjR1ZmYVdRaU9pSXdNVEl6TkRVMk55MDRPV0ZpTFRSa1pXWXRPREV5TXkw' +
        'ME5UWTNPRGxoWW1Oa1pXWWlMQ0p6Y0dGalpWOXJaWGtpT2lKTlFVbE9JbjE5In0',
    )
    expect(route.scope).toEqual({ kind: 'project', project_ref: { project_id: 'example-project' } })
    expect(planningWorkItemRef(route.entity)).toEqual({
      reference: 'MAIN-12',
      space_ref: { data_scope_id: '01234567-89ab-4def-8123-456789abcdef', space_key: 'MAIN' },
    })
  })
})
