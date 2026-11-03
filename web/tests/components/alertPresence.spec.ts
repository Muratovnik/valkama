import { defineComponent, h, ref } from 'vue'

import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAlertPresence } from '@/app/composables/useAlertPresence.ts'

import { reportAlertPresence } from '@/shared/api/alertsApi.ts'
import type { AlertPresence } from '@/shared/api/alertsApi.ts'

vi.mock('@/shared/api/alertsApi.ts', () => ({
  reportAlertPresence: vi.fn(),
}))

const report = vi.mocked(reportAlertPresence)
const HEARTBEAT_MS = 15_000

let visibility: DocumentVisibilityState = 'visible'
let focused = true

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  focused = next === 'visible' && focused
  document.dispatchEvent(new Event('visibilitychange'))
}

function setFocus(next: boolean) {
  focused = next
  window.dispatchEvent(new Event(next ? 'focus' : 'blur'))
}

const emptyRender = () => h('div')

function mountPresence() {
  const workItem = ref<string | null>(null)
  const hub = ref(false)
  const wrapper = mount(
    defineComponent({
      setup() {
        useAlertPresence(
          () => workItem.value,
          () => hub.value,
        )
        return emptyRender
      },
    }),
  )
  return { hub, workItem, wrapper }
}

const sent = () => report.mock.calls.map(([presence]): AlertPresence => presence)
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  focused = true
  report.mockReset()
  report.mockResolvedValue()
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAlertPresence', () => {
  it('reports at once, then every 15 s, under one page id', async () => {
    mountPresence()
    await settle()
    expect(sent()).toEqual([
      { page_id: expect.any(String), focused: true, work_item_id: null, hub_open: false },
    ])

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    expect(sent()).toHaveLength(3)
    expect(new Set(sent().map((presence) => presence.page_id)).size).toBe(1)
  })

  it('reports the open card and the open hub the moment they change', async () => {
    const { hub, workItem } = mountPresence()
    await settle()

    workItem.value = 'item-1'
    await settle()
    expect(sent().at(-1)).toMatchObject({ work_item_id: 'item-1', hub_open: false })

    hub.value = true
    await settle()
    expect(sent().at(-1)).toMatchObject({ work_item_id: 'item-1', hub_open: true })
  })

  it('says it lost focus right away', async () => {
    mountPresence()
    await settle()
    setFocus(false)
    await settle()
    expect(sent().at(-1)).toMatchObject({ focused: false })
    setFocus(true)
    await settle()
    expect(sent().at(-1)).toMatchObject({ focused: true })
  })

  it('says once that it went hidden, and nothing more from a hidden tab', async () => {
    const { workItem } = mountPresence()
    await settle()
    report.mockClear()

    setVisibility('hidden')
    await settle()
    expect(sent()).toEqual([expect.objectContaining({ focused: false })])

    workItem.value = 'item-1'
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 4)
    expect(sent()).toHaveLength(1)
  })

  it('reports again when the tab comes back, with what changed while it was hidden', async () => {
    const { workItem } = mountPresence()
    await settle()
    setVisibility('hidden')
    workItem.value = 'item-1'
    await settle()
    report.mockClear()

    focused = true
    setVisibility('visible')
    await settle()
    expect(sent()).toEqual([expect.objectContaining({ focused: true, work_item_id: 'item-1' })])
  })

  it('says nothing from a tab that opened hidden', async () => {
    visibility = 'hidden'
    mountPresence()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2)
    expect(report).not.toHaveBeenCalled()
  })

  it('says it is gone when a window closes while still in focus', async () => {
    mountPresence()
    await settle()
    window.dispatchEvent(new Event('pagehide'))
    await settle()
    expect(sent().at(-1)).toMatchObject({ focused: false })
  })

  it('sends one report at a time and the next carries the newest state', async () => {
    let release: () => void = vi.fn()
    report.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    const { workItem } = mountPresence()
    await settle()

    workItem.value = 'item-1'
    await settle()
    workItem.value = 'item-2'
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    expect(sent()).toHaveLength(1)

    release()
    await settle()
    expect(sent()).toHaveLength(2)
    expect(sent().at(-1)).toMatchObject({ work_item_id: 'item-2' })
  })

  it('takes a report that failed as no listener, and goes on', async () => {
    report.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    mountPresence()
    await settle()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    expect(sent()).toHaveLength(2)
  })

  it('stops with the page', async () => {
    const { wrapper } = mountPresence()
    await settle()
    wrapper.unmount()
    report.mockClear()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2)
    window.dispatchEvent(new Event('focus'))
    expect(report).not.toHaveBeenCalled()
  })
})
