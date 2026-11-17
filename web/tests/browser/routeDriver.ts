/**
 * A page that only routes, so a route table written for Playwright answers in a
 * plain Node process.
 *
 * `installBackend` and the helpers like it register handlers with `page.route` and
 * nothing else a request reaches. Driving those handlers here, rather than copying
 * what they answer, is what lets a unit test read the very object a spec serves.
 * The matching follows Playwright's: the handler registered last is asked first,
 * `fallback` hands the request to the one before it, and a glob's `*` stops at `/`
 * while `**` does not and `?` is itself.
 */
import type { Page } from '@playwright/test'

type Matcher = string | RegExp | ((url: URL) => boolean)
type Handler = (route: DrivenRoute, request: ReturnType<DrivenRoute['request']>) => unknown

interface Fulfilled {
  body: unknown
  status: number
}

interface Request {
  body?: unknown
  method?: string
}

const ORIGIN = 'http://127.0.0.1:4173'

function globPattern(glob: string): RegExp {
  let pattern = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index)
    if (char === '*' && glob[index + 1] === '*') {
      pattern += '.*'
      index += 1
    } else if (char === '*') pattern += '[^/]*'
    else pattern += char.replaceAll(/[$()+.?[\\\]^{|}]/gu, String.raw`\$&`)
  }
  return new RegExp(`^${pattern}$`, 'u')
}

function matches(matcher: Matcher, url: URL): boolean {
  if (typeof matcher === 'function') return matcher(url)
  if (matcher instanceof RegExp) return matcher.test(url.href)
  return globPattern(matcher).test(url.href)
}

class DrivenRoute {
  answer: Fulfilled | null = null
  passed = false
  constructor(
    private readonly url: URL,
    private readonly sent: Request,
  ) {}

  request() {
    const { url, sent } = this
    return {
      url: () => url.href,
      method: () => sent.method ?? 'GET',
      headers: () => ({ 'x-valkama-session': 'playwright-session-token'.padEnd(64, 'x') }),
      postData: () => (sent.body === undefined ? null : JSON.stringify(sent.body)),
      postDataJSON: () => sent.body ?? null,
    }
  }

  fulfill(options: { body?: string; contentType?: string; json?: unknown; status?: number }) {
    const text = options.body
    const isJson = (options.contentType ?? 'application/json').includes('json')
    let json: unknown = options.json
    if (json === undefined) json = text !== undefined && isJson ? JSON.parse(text || 'null') : text
    this.answer = { status: options.status ?? 200, body: structuredClone(json) }
    return Promise.resolve()
  }

  fallback() {
    this.passed = true
    return Promise.resolve()
  }

  continue() {
    return this.fallback()
  }

  abort() {
    this.answer = { status: 0, body: null }
    return Promise.resolve()
  }
}

/** A page whose routes can be asked, and the call that asks them. */
export function routedPage() {
  const handlers: { handler: Handler; matcher: Matcher }[] = []
  const page = {
    route: (matcher: Matcher, handler: Handler) => {
      handlers.unshift({ matcher, handler })
      return Promise.resolve()
    },
    unroute: () => Promise.resolve(),
    addInitScript: () => Promise.resolve(),
  }
  /** What the routes answer `url` (a path on the served origin), or null when none does. */
  async function ask(url: string, sent: Request = {}): Promise<Fulfilled | null> {
    const target = new URL(url, ORIGIN)
    for (const { matcher, handler } of handlers) {
      if (!matches(matcher, target)) continue
      const route = new DrivenRoute(target, sent)
      await handler(route, route.request())
      if (route.answer) return route.answer
      if (!route.passed) return null
    }
    return null
  }
  return { page: page as unknown as Page, ask }
}
