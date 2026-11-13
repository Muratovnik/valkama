/**
 * A stand-in for the names Valkama keeps for accounts, `/api/quota/account-names`, over whatever
 * `fetch` the test stubbed before it: a read answers what it holds, a write names, clears or, with
 * `replace` false, names only an account with none, as the server does. A test may refuse the
 * next writes with a status and the server's words, or hold them until it lets them go.
 */
import { vi } from 'vitest'

const PATH = '/api/quota/account-names'

interface Refusal {
  status: number
  message?: string
}

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export function stubAccountNames(initial: Record<string, string> = {}) {
  const stored: Record<string, string> = { ...initial }
  const writes: { names: Record<string, string>; replace: boolean }[] = []
  const refusals: Refusal[] = []
  const held: (() => void)[] = []
  let holding = false
  let reads = 0
  const before = globalThis.fetch

  function apply(body: { names: Record<string, string>; replace?: boolean }) {
    const replace = body.replace ?? true
    writes.push({ names: body.names, replace })
    for (const [id, name] of Object.entries(body.names)) {
      if (!replace) {
        if (name && !Object.hasOwn(stored, id)) stored[id] = name
      } else if (name) stored[id] = name
      else delete stored[id]
    }
  }

  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input as string, 'http://127.0.0.1')
      // What a write asks first, for the browser's credential.
      if (url.pathname === '/api/security/bootstrap')
        return answer({ session_token: 'x'.repeat(64) })
      if (url.pathname !== PATH) return before(input, init)
      if ((init?.method ?? 'GET') === 'GET') {
        reads += 1
        const refusal = refusals.shift()
        return refusal ? answer({}, refusal.status) : answer({ names: { ...stored } })
      }
      if (holding) await new Promise<void>((resolve) => held.push(resolve))
      const refusal = refusals.shift()
      if (refusal)
        return answer(
          { error: { code: 'invalid_request', message: refusal.message ?? '' } },
          refusal.status,
        )
      apply(
        JSON.parse(init?.body as string) as { names: Record<string, string>; replace?: boolean },
      )
      return answer({ names: { ...stored } })
    }),
  )

  return {
    stored,
    writes,
    reads: () => reads,
    /** The next request to the names, a read or a write, is refused. */
    refuse: (refusal: Refusal) => refusals.push(refusal),
    /** Writes wait from now until `release`. */
    hold: () => {
      holding = true
    },
    release: () => {
      holding = false
      for (const resolve of held.splice(0)) resolve()
    },
  }
}
