/**
 * The live-work frame and the pin, as the connection contract writes them ("The
 * live-work frame", "Pins"). The frame is the contract's own example, so a drift
 * between it and the schema fails here; the server's real answer is checked by
 * `serverFixtures.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateLiveFrame } from '@/shared/api/liveFrameModel.ts'
import { pinWorkItem } from '@/shared/api/planningApi.ts'

import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

const row = {
  reference: 'MAIN-12',
  title: 'Answer a review in one form',
  kind: 'task',
  parent: 'MAIN-4',
  state: 'working',
  agents: 2,
  quiet_since: null,
  pinned: false,
  state_name: 'Dev',
  is_terminal: false,
  updated_at: '2026-11-04T10:15:00Z',
}

const contractExample = {
  spaces: [
    {
      key: 'MAIN',
      name: 'Main',
      project_id: 'example-project',
      unplaced: 2,
      rows: [
        {
          ...row,
          reference: 'MAIN-4',
          title: 'Structured answers',
          kind: 'epic',
          parent: null,
          state: null,
          agents: 0,
          updated_at: '2026-10-28T08:00:00Z',
        },
        row,
        {
          ...row,
          reference: 'MAIN-13',
          title: 'Tell other work',
          state: 'quiet',
          agents: 0,
          quiet_since: '2026-11-03T18:02:11Z',
          updated_at: '2026-11-03T17:40:00Z',
        },
        {
          ...row,
          reference: 'MAIN-7',
          title: 'Old migration',
          parent: null,
          state: null,
          agents: 0,
          pinned: true,
          state_name: 'Done',
          is_terminal: true,
          updated_at: '2026-10-02T12:00:00Z',
        },
        {
          ...row,
          reference: 'MAIN-20',
          title: 'Notes for the owner',
          parent: null,
          state: null,
          agents: 0,
          pinned: true,
          state_name: 'Backlog',
          updated_at: '2026-10-30T09:30:00Z',
        },
      ],
    },
  ],
  elsewhere: 0,
}

const withRow = (changed: Record<string, unknown>) => ({
  spaces: [{ ...contractExample.spaces[0], rows: [{ ...row, ...changed }] }],
  elsewhere: 0,
})

describe('the live-work frame', () => {
  it('reads the contract example as it stands', () => {
    expect(validateLiveFrame(contractExample)).toEqual(contractExample)
  })

  it('reads a space no project binds and an empty frame', () => {
    const unbound = {
      spaces: [{ ...contractExample.spaces[0], project_id: null, rows: [] }],
      elsewhere: 3,
    }
    expect(validateLiveFrame(unbound)).toEqual(unbound)
    expect(validateLiveFrame({ spaces: [], elsewhere: 0 })).toEqual({ spaces: [], elsewhere: 0 })
  })

  it.each([
    ['a quiet row without its time', withRow({ state: 'quiet' })],
    ['a time on a working row', withRow({ quiet_since: '2026-11-03T18:02:11Z' })],
    [
      'a time on a row with no live work',
      withRow({ state: null, quiet_since: '2026-11-03T18:02:11Z' }),
    ],
    ['a state the server has no word for', withRow({ state: 'running' })],
    ['a closed flag the contract replaced', withRow({ closed: null })],
    [
      'a row without its workflow state',
      {
        spaces: [{ ...contractExample.spaces[0], rows: [{ ...row, state_name: undefined }] }],
        elsewhere: 0,
      },
    ],
    ['a parent that is no reference', withRow({ parent: '4' })],
    [
      'a row without when its item changed',
      {
        spaces: [{ ...contractExample.spaces[0], rows: [{ ...row, updated_at: undefined }] }],
        elsewhere: 0,
      },
    ],
    ['a change time that is not a time', withRow({ updated_at: 'yesterday' })],
    ['a negative count', withRow({ agents: -1 })],
    ['a frame without elsewhere', { spaces: [] }],
  ])('refuses %s', (_case, frame) => {
    expect(() => validateLiveFrame(frame)).toThrow()
  })
})

describe('a pin', () => {
  it('sends only the item and the pin, and reads the frame it answers with', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        withSecurityBootstrap(async () => new Response(JSON.stringify(contractExample))),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(pinWorkItem({ id: 'MAIN-20', pinned: true })).resolves.toEqual(contractExample)
    const call = fetchMock.mock.calls.find(([url]) => requestUrl(url) !== '/api/security/bootstrap')
    expect(requestUrl(call?.[0] ?? '')).toBe('/api/planning/work-item/pin')
    expect(JSON.parse(requestBody(call?.[1]?.body))).toEqual({ id: 'MAIN-20', pinned: true })
  })

  it('refuses an answer that is not a frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(withSecurityBootstrap(async () => new Response('{"spaces": []}'))),
    )
    await expect(pinWorkItem({ id: 'MAIN-20', pinned: false })).rejects.toThrow()
  })
})
