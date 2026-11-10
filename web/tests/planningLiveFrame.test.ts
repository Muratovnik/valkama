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

/*
 * The contract's example, as `docs/connection-contract.md` writes it, but for where its
 * two sessions in VS Code are open: the example says `"opened_in": "vscode"`, which is no
 * place a session is recorded in, and a server writes that place as `ide` in `vscode`.
 */
const contractExample = {
  spaces: [
    {
      key: 'MAIN',
      name: 'Main',
      project_id: 'example-project',
      rows: [
        {
          reference: 'MAIN-4',
          title: 'Structured answers',
          kind: 'epic',
          parent: null,
          state: null,
          agents: 0,
          long: false,
          asks: false,
          since: null,
          quiet_since: null,
          executor: null,
          pinned: false,
          state_name: 'Dev',
          is_terminal: false,
          updated_at: '2026-10-28T08:00:00Z',
        },
        {
          reference: 'MAIN-12',
          title: 'Answer a review in one form',
          kind: 'task',
          parent: 'MAIN-4',
          state: 'working',
          agents: 2,
          long: false,
          asks: false,
          since: '2026-11-04T10:08:12Z',
          quiet_since: null,
          executor: {
            session: '6f1c2a8e-0000-4000-8000-000000000002',
            agent: null,
            opened_in: 'ide',
            opened_host: 'vscode',
            family: 'claude',
            state: 'live',
          },
          pinned: false,
          state_name: 'Dev',
          is_terminal: false,
          updated_at: '2026-11-04T10:15:00Z',
        },
        {
          reference: 'MAIN-15',
          title: 'Read the answers back',
          kind: 'task',
          parent: 'MAIN-4',
          state: 'waiting',
          agents: 0,
          long: false,
          asks: true,
          since: '2026-11-04T10:11:30Z',
          quiet_since: null,
          executor: {
            session: '6f1c2a8e-0000-4000-8000-000000000003',
            agent: null,
            opened_in: 'terminal',
            opened_host: '',
            family: 'claude',
            state: 'live',
          },
          pinned: false,
          state_name: 'Dev',
          is_terminal: false,
          updated_at: '2026-11-04T10:05:00Z',
        },
        {
          reference: 'MAIN-13',
          title: 'Tell other work',
          kind: 'task',
          parent: 'MAIN-4',
          state: 'quiet',
          agents: 0,
          long: false,
          asks: false,
          since: null,
          quiet_since: '2026-11-03T18:02:11Z',
          executor: {
            session: '6f1c2a8e-0000-4000-8000-000000000004',
            agent: null,
            opened_in: '',
            opened_host: '',
            family: 'claude',
            state: 'live',
          },
          pinned: false,
          state_name: 'Dev',
          is_terminal: false,
          updated_at: '2026-11-03T17:40:00Z',
        },
        {
          reference: 'MAIN-7',
          title: 'Old migration',
          kind: 'task',
          parent: null,
          state: null,
          agents: 0,
          long: false,
          asks: false,
          since: null,
          quiet_since: null,
          executor: null,
          pinned: true,
          state_name: 'Done',
          is_terminal: true,
          updated_at: '2026-10-02T12:00:00Z',
        },
      ],
      sessions: [
        {
          session: '6f1c2a8e-0000-4000-8000-000000000001',
          title: 'Compare two exports',
          folder: 'example-project',
          state: 'working',
          long: false,
          asks: false,
          agents: 1,
          since: '2026-11-04T10:02:40Z',
          executor: {
            session: '6f1c2a8e-0000-4000-8000-000000000001',
            agent: null,
            opened_in: 'ide',
            opened_host: 'vscode',
            family: 'claude',
            state: 'live',
          },
        },
      ],
    },
  ],
  elsewhere: [],
}

const space = contractExample.spaces[0]
const row = space.rows[1]
const session = space.sessions[0]

const withRow = (changed: Record<string, unknown>) => ({
  spaces: [{ ...space, rows: [{ ...row, ...changed }] }],
  elsewhere: [],
})

const withSession = (changed: Record<string, unknown>) => ({
  spaces: [{ ...space, sessions: [{ ...session, ...changed }] }],
  elsewhere: [],
})

describe('the live-work frame', () => {
  it('reads the contract example as it stands', () => {
    expect(validateLiveFrame(contractExample)).toEqual(contractExample)
  })

  it('reads a space no project binds, a session under no space, and an empty frame', () => {
    const unbound = {
      spaces: [{ ...space, project_id: null, rows: [] }],
      elsewhere: [{ ...session, title: null, folder: '', state: 'waiting', long: true }],
    }
    expect(validateLiveFrame(unbound)).toEqual(unbound)
    expect(validateLiveFrame({ spaces: [], elsewhere: [] })).toEqual({ spaces: [], elsewhere: [] })
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
    ['a row without its wait', withRow({ long: undefined })],
    ['a row without whether it asks', withRow({ asks: undefined })],
    ['a since that is not a time', withRow({ since: 'a minute ago' })],
    ['an executor of another shape', withRow({ executor: { session: 'x' } })],
    [
      'a row without its workflow state',
      {
        spaces: [{ ...space, rows: [{ ...row, state_name: undefined }] }],
        elsewhere: [],
      },
    ],
    ['a parent that is no reference', withRow({ parent: '4' })],
    [
      'a row without when its item changed',
      {
        spaces: [{ ...space, rows: [{ ...row, updated_at: undefined }] }],
        elsewhere: [],
      },
    ],
    ['a change time that is not a time', withRow({ updated_at: 'yesterday' })],
    ['a negative count', withRow({ agents: -1 })],
    ['a session with a key the contract has not', withSession({ cwd: 'C:/work' })],
    ['a session held or quiet, which a row would be', withSession({ state: 'held' })],
    ['a session without since', withSession({ since: null })],
    ['a session without its executor', withSession({ executor: null })],
    [
      'a space with the count the sessions replaced',
      { spaces: [{ ...space, unplaced: 2 }], elsewhere: [] },
    ],
    [
      'a space without its sessions',
      { spaces: [{ ...space, sessions: undefined }], elsewhere: [] },
    ],
    ['elsewhere as the count it was', { spaces: [], elsewhere: 0 }],
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
