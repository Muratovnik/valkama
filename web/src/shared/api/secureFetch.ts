const SESSION_HEADER = 'X-Valkama-Session'
const SESSION_TOKEN = /^[A-Za-z0-9_-]{64}$/u

let sessionToken: string | null = null
let bootstrapInFlight: Promise<string> | null = null

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function requireSameOriginApiTarget(input: RequestInfo | URL): void {
  const rawTarget = input instanceof Request ? input.url : String(input)
  if (typeof input === 'string' && rawTarget.trimStart().startsWith('//'))
    throw new TypeError('secure writes require a same-origin /api/ target')

  const browserLocation = typeof window === 'undefined' ? null : window.location
  let target: URL
  try {
    target = new URL(rawTarget, browserLocation?.href ?? 'https://non-browser.invalid/')
  } catch {
    throw new TypeError('secure writes require a same-origin /api/ target')
  }
  if (browserLocation === null) {
    if (
      typeof input !== 'string' ||
      !rawTarget.startsWith('/') ||
      target.origin !== 'https://non-browser.invalid' ||
      target.pathname.startsWith('/api/') === false
    )
      throw new TypeError('secure writes require a same-origin /api/ target')
    return
  }
  if (
    target.origin !== browserLocation.origin ||
    target.username !== '' ||
    target.password !== '' ||
    !target.pathname.startsWith('/api/')
  )
    throw new TypeError('secure writes require a same-origin /api/ target')
}

async function bootstrap(): Promise<string> {
  if (sessionToken !== null) return sessionToken
  if (bootstrapInFlight !== null) return bootstrapInFlight
  bootstrapInFlight = (async () => {
    const response = await fetch('/api/security/bootstrap', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`security bootstrap failed: HTTP ${response.status}`)
    const payload: unknown = await response.json()
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !Object.hasOwn(payload, 'session_token') ||
      typeof (payload as { session_token?: unknown }).session_token !== 'string' ||
      !SESSION_TOKEN.test((payload as { session_token: string }).session_token)
    )
      throw new Error('security bootstrap returned an invalid contract')
    sessionToken = (payload as { session_token: string }).session_token
    return sessionToken
  })()
  try {
    return await bootstrapInFlight
  } finally {
    bootstrapInFlight = null
  }
}

async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string,
): Promise<Response> {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  )
  headers.set(SESSION_HEADER, token)
  return fetch(input, { ...init, headers })
}

/**
 * Add the process-scoped browser credential to writes.  The credential exists
 * only in this module closure.  A restart-stale credential is cleared,
 * bootstrapped, and retried once; the retry result is final.
 */
export async function secureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = requestMethod(input, init)
  if (method !== 'POST' && method !== 'PUT') return fetch(input, init)

  requireSameOriginApiTarget(input)
  const attemptedToken = await bootstrap()
  const response = await authenticatedFetch(input, init, attemptedToken)
  if (response.status !== 401) return response
  if (sessionToken === attemptedToken) sessionToken = null
  return authenticatedFetch(input, init, await bootstrap())
}
