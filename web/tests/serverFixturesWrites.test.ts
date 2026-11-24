/**
 * The server's answers to a card's writes as the interface sends them, as the real server gave
 * them (`tests/test_web_contract_fixtures.py` writes the fixtures), read through the calls the
 * windows make: a goal's cancel refused with its list on the batch step it names, a close
 * refused by its guard on that step, a commit attached to a card at revision 0, and a card's
 * close on the board that brings back the work put off until it.
 *
 * Only `fetch` is a double, so each answer reaches the call as the server sent it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CancelListError, planningRefusal, transitionWorkItem } from '@/shared/api/planningApi.ts'
import { cancelWorkItem, confirmWorkItemClose } from '@/shared/api/planningClosingApi.ts'
import { attachCommit } from '@/shared/api/unattachedCommitsApi.ts'

import { withSecurityBootstrap } from './support/request.ts'
import { readServerFixture as read } from './support/serverFixtures.ts'

/** Every write answered with one fixture, at its status. */
const answer = (name: string, status: number) =>
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      withSecurityBootstrap(
        async () =>
          new Response(JSON.stringify(read(name)), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    ),
  )

/** What a write threw, or a failure when it threw nothing. */
async function thrown(write: Promise<unknown>): Promise<unknown> {
  try {
    await write
  } catch (error) {
    return error
  }
  throw new Error('the write was not refused')
}

const summary = { done: 'Cancelled.', next: 'Nothing: it was cancelled.' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the server's answers to a card's writes", () => {
  it("hand a goal's cancel the list it closes, refused on its batch step", async () => {
    answer('refusal-cancel-list.json', 409)
    const error = await thrown(cancelWorkItem({ id: 'MAIN-31', state: 'cancelled', summary }))
    expect(error).toBeInstanceOf(CancelListError)
    const { list } = error as CancelListError
    expect(list.cancels.map((row) => row.reference)).toEqual(['MAIN-32'])
    expect(list.dependents.map((row) => [row.reference, row.waits_on, row.how])).toEqual([
      ['MAIN-33', 'MAIN-32', 'blocks'],
    ])
    expect(list.list_token).toMatch(/^[0-9a-f]{16}$/u)
  })

  it("keep the server's words of a guard that refused a batch step", async () => {
    answer('refusal-apply-step.json', 409)
    const error = await thrown(confirmWorkItemClose({ id: 'MAIN-34', state: 'done', ticks: [] }))
    const refusal = planningRefusal(error)
    expect(refusal?.code).toBe('workflow_guard')
    expect(refusal?.guards).toEqual(['summary'])
    expect(refusal?.message).toMatch(/^transition: \[summary\] MAIN-34 has no closing summary/u)
  })

  it('report a commit attached to a card at revision 0 as attached', async () => {
    answer('commit-attached.json', 200)
    expect(read('commit-attached.json')).toMatchObject({ revision: 0 })
    await expect(
      attachCommit({ reference: 'MAIN-35', repository: 'example-project', hash: 'd'.repeat(40) }),
    ).resolves.toBe(true)
  })

  it('read a close on the board that brings back what was put off until it', async () => {
    answer('transition-brought-back.json', 200)
    const closed = await transitionWorkItem({ id: 'MAIN-36', state: 'done' })
    expect(closed.state?.key).toBe('done')
    expect([closed.brought_back, closed.returned]).toEqual([['MAIN-37'], undefined])
  })
})
