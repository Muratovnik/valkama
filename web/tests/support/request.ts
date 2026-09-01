/**
 * Reading a captured `fetch` call the way its own types allow.
 *
 * `String(input)` was doing this before, and it is wrong for one of the three
 * shapes `fetch` accepts: `String(new Request(url))` is `[object Request]`, so a
 * test asserting on the URL would compare against that and only pass because
 * every call in the suite happens to pass a string. The same for a body, which
 * may be a stream or a blob and stringifies to nothing useful.
 */

/** The URL a call was made to, whichever of the three input shapes it used. */
export function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** A request body as the JSON text these tests send, or a failure that says so. */
export function requestBody(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body
  throw new Error(`expected a string request body, got ${typeof body}`)
}
export type FetchInput = string | URL | Request

/** Add the real browser security bootstrap in front of a focused API mock. */
export function withSecurityBootstrap(delegate: typeof fetch): typeof fetch {
  return async (input, init) =>
    requestUrl(input) === '/api/security/bootstrap'
      ? new Response(JSON.stringify({ session_token: 'S'.repeat(64) }))
      : delegate(input, init)
}
