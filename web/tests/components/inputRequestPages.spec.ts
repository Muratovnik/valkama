import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'

import { fetchInputRequests } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { requestUrl, withSecurityBootstrap } from '../support/request.ts'

const wrappers: ReturnType<typeof mount>[] = []

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

/** The `index`-th open question, the two spaces taking turns, each asked a minute later. */
function asked(index: number): InputRequestEntry {
  const entry = requestEntry()
  const spaceKey = index % 2 ? 'TASK' : 'OTHER'
  const reference = `${spaceKey}-${String(index + 1)}`
  const minute = new Date(Date.UTC(2026, 10, 1) + index * 60_000).toISOString()
  return {
    target: {
      ...entry.target,
      space_ref: { ...entry.target.space_ref, space_key: spaceKey },
      reference,
    },
    request: {
      ...entry.request,
      request_id: `22222222-2222-4222-8222-${index.toString(16).padStart(12, '0')}`,
      reference,
      title: `Question ${String(index + 1)}`,
      created_at: minute.replace('.000Z', 'Z'),
    },
  }
}

/** The server's list of every space: newest first, cut into pages from `offset` by `limit`. */
function serveInPages(entries: InputRequestEntry[]) {
  const newest = [...entries].reverse()
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    withSecurityBootstrap(async (input) => {
      const query = new URL(requestUrl(input), 'https://test.example').searchParams
      const limit = Number(query.get('limit'))
      const offset = Number(query.get('offset') ?? 0)
      const body = {
        ...requestList(newest.slice(offset, offset + limit)),
        limit,
        total: newest.length,
        has_more: offset + limit < newest.length,
      }
      return new Response(JSON.stringify(body))
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const QUESTIONS = Array.from({ length: 250 }, (_, index) => asked(index))

function pagesRead(fetchMock: ReturnType<typeof serveInPages>) {
  return fetchMock.mock.calls
    .map(([input]) => new URL(requestUrl(input), 'https://test.example'))
    .filter((url) => url.pathname === '/api/modules/planning/requests')
    .map((url) => [url.searchParams.get('limit'), url.searchParams.get('offset')])
}

// Drawing 250 cards is not what is checked, and took past a test's time on a loaded
// machine: the read is checked whole, and the hub's count with its dialog closed.
describe('the list of questions past one page', () => {
  it('reads both pages of 250 open questions into one complete list, newest first', async () => {
    const fetchMock = serveInPages(QUESTIONS)
    const list = await fetchInputRequests()
    expect(pagesRead(fetchMock)).toEqual([
      ['200', null],
      ['200', '200'],
    ])
    expect(list.items.map((entry) => entry.request.request_id)).toEqual(
      [...QUESTIONS].reverse().map((entry) => entry.request.request_id),
    )
    // `has_more` is what the list shows as incomplete: false once every page is read.
    expect([list.total, list.has_more]).toEqual([250, false])
  })

  it('counts all 250 on the rail and does not call the count incomplete', async () => {
    const fetchMock = serveInPages(QUESTIONS)
    const wrapper = mount(InputRequestsHub, {
      props: { open: false },
      attachTo: document.body,
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages })],
        stubs: { teleport: true },
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(pagesRead(fetchMock).length).toBeGreaterThanOrEqual(2)
    expect(wrapper.emitted('count')?.at(-1)).toEqual([{ value: 250, incomplete: false }])
  })
})
