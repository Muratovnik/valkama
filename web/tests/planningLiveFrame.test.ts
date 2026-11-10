/**
 * The live-work frame and the pin, as the connection contract writes them ("The
 * live-work frame", "Pins"). The frame is the contract's own example, read from the
 * document as it is written, so a drift between it and the schema fails here; the
 * server's real answer is checked by `serverFixtures.test.ts`.
 */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateLiveFrame } from '@/shared/api/liveFrameModel.ts'
import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'
import { pinWorkItem } from '@/shared/api/planningApi.ts'

import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

const CONTRACT = fileURLToPath(new URL('../../docs/connection-contract.md', import.meta.url))

/** The contract's example as `docs/connection-contract.md` writes it, read from the document. */
function contractFrame(): LiveFrame {
  const text = fs.readFileSync(CONTRACT, 'utf8')
  const section = text.slice(text.indexOf('### The live-work frame'))
  const block = /```json\r?\n([\s\S]*?)\r?\n```/u.exec(section)
  if (!block) throw new Error('the contract has no example of the live-work frame')
  return JSON.parse(block[1]) as LiveFrame
}

const contractExample = contractFrame()
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
