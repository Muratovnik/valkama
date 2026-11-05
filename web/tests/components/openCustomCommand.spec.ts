/**
 * The owner's own command in a browser: it cannot start a program, so it copies the command
 * with the session's folders filled in. `fetch` and the clipboard are stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openTarget } from '@/features/session-open/openPlan.ts'

import { mergeSettings } from '@/shared/lib/settings.ts'

const SESSION = '6f1c2a8e-0000-4000-8000-000000000001'
const FOLDER = 'C:\\work\\example-project'
const claude = { kind: 'session', session: SESSION, family: 'claude' } as const

let body: unknown = null
const fetched: string[] = []

function answer(context: unknown) {
  body = context
}

beforeEach(() => {
  fetched.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url)
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the owner’s own command in a browser', () => {
  it('copies the owner’s own command with the session’s folders filled in', async () => {
    const settings = mergeSettings({
      sessions: {
        claude: { fallback: 'vscode', always: 'custom', command: 'wt -d "{cwd}" {session}' },
      },
    })
    answer({
      kind: 'session',
      value: SESSION,
      resolved: true,
      detail: '',
      session: SESSION,
      session_cwd: 'C:\\work\\example-project\\web',
      space_root: {
        status: 'mapped',
        reason: '',
        canonical_root: FOLDER,
        resource_ref: { kind: 'planning-space', resource_id: 'x' },
      },
    })
    const outcome = await openTarget(claude, { settings })
    expect(fetched[0]).toBe(`/api/session?id=${SESSION}`)
    expect(outcome).toMatchObject({ status: 'copied', text: `wt -d ${FOLDER} ${SESSION}` })
  })

  it('names in {session_cwd} the folder a click opens, not where the shell got to', async () => {
    const settings = mergeSettings({
      sessions: {
        claude: { fallback: 'vscode', always: 'custom', command: 'tool {session_cwd}' },
      },
    })
    answer({
      kind: 'session',
      value: SESSION,
      resolved: true,
      detail: '',
      session: SESSION,
      cwd: 'C:\\work\\example-project\\web',
      session_cwd: 'C:\\work\\example-project\\web',
      session_folder: FOLDER,
    })
    const outcome = await openTarget(claude, { settings })
    expect(outcome).toMatchObject({ status: 'copied', text: `tool ${FOLDER}` })
  })
})
