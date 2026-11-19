/**
 * The past window a quota window shows in its place, read when a person asks for it and for nothing
 * else (`GET /api/analytics/quota/window`): closed while the current window stands, then the window
 * before the current one, and from there each window before the one shown, while the store keeps
 * one.
 *
 * The first read asks for the latest window that reset by the current window's start, the window
 * the line under it names (`previous`); each step back asks by the start of the window shown. While
 * a window is read, the one shown stays, so the card does not blank between two windows; a read
 * that fails keeps it too and says so, and its retry asks again for the same window. An answer that
 * holds no window — its readings aged out of the store since the line was read — is said as such.
 * A later read always replaces an earlier one, and closing drops whatever is read.
 */
import { onScopeDispose, ref, shallowRef } from 'vue'

import { fetchQuotaWindow } from '@/shared/api/analyticsApi.ts'
import type { QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

/** Where the read stands: closed, waiting, a window shown, none kept, or a read that failed. */
export type PastStatus = 'closed' | 'reading' | 'shown' | 'gone' | 'failed'

/** The start a window's predecessor is asked by: its start, or its latest reading with none. */
const startOf = (window: QuotaShareWindow) => window.started_at ?? window.latest.at

export function usePastWindow(options: {
  account: () => QuotaAccount
  /** The offset of the quota answer, in minutes east of UTC, every time of the read is said at. */
  offset: () => number
  window: () => QuotaShareWindow
}) {
  const shown = shallowRef<QuotaShareWindow | null>(null)
  const status = ref<PastStatus>('closed')
  let asked = ''
  let reading: AbortController | null = null

  async function read(before: string) {
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    asked = before
    status.value = 'reading'
    const window = options.window()
    try {
      const found = await fetchQuotaWindow(
        {
          account: options.account().account,
          kind: window.kind,
          model: window.model,
          before,
          utcOffset: options.offset(),
        },
        controller.signal,
      )
      if (reading !== controller) return
      if (found.window) shown.value = found.window
      status.value = found.window ? 'shown' : 'gone'
    } catch {
      if (reading !== controller) return
      status.value = 'failed'
    }
  }

  /** Show the window before the current one. */
  const open = () => read(startOf(options.window()))
  /** Show the window before the one shown. */
  const back = async () => {
    if (shown.value) await read(startOf(shown.value))
  }
  /** Ask again for the window a failed read asked for. */
  const retry = () => read(asked)
  /** Return to the current window. */
  function close() {
    reading?.abort()
    reading = null
    shown.value = null
    status.value = 'closed'
  }
  onScopeDispose(() => reading?.abort())

  return { back, close, open, retry, shown, status }
}
