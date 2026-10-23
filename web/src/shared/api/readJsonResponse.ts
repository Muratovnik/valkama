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
  } finally {
    clearTimeout(timer)
  }
}
