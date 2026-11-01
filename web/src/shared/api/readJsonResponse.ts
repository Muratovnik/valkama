import { secureFetch } from '@/shared/api/secureFetch.ts'

type JsonResponse = { payload: unknown; response: Response }
const READ_TIMEOUT_MS = 15_000

async function consume(input: string, init?: RequestInit): Promise<JsonResponse> {
  const response = await secureFetch(input, init)
  const payload: unknown = await response.json().catch(() => {
    init?.signal?.throwIfAborted()
    return null
  })
  return { response, payload }
}

/**
 * A read the network refused never reached the service, so what failed is the
 * connection, and it says so: the browser's own `TypeError` carried no code,
 * and a card opened while the server was away read as a record that could not
 * be loaded.
 */
function connectionLost(error: unknown, signal: AbortSignal): unknown {
  if (!(error instanceof TypeError) || signal.aborted) return error
  return Object.assign(new Error('Connection to the local service lost', { cause: error }), {
    code: 'connection_lost',
  })
}

/** Bound the whole read, including a response body that stops arriving. */
export async function readJsonResponse(input: string, init?: RequestInit): Promise<JsonResponse> {
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return consume(input, init)
  const controller = new AbortController()
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('Request timed out'), { code: 'request_timeout' }))
      controller.abort()
    }, READ_TIMEOUT_MS)
  })
  try {
    return await Promise.race([consume(input, { ...init, signal }), deadline])
  } catch (error) {
    throw connectionLost(error, signal)
  } finally {
    clearTimeout(timer)
  }
}
