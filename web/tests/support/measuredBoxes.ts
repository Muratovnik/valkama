/**
 * A `ResizeObserver` that reports what a test says: the list is as wide as the
 * last width given, and only the list's observers hear it. Stubbed globally;
 * `vi.unstubAllGlobals` takes it away.
 */
import { flushPromises } from '@vue/test-utils'
import { vi } from 'vitest'

/** Boxes measured as a hand sets them: the list is as wide as `resizeList` last said. */
export function measuredBoxes() {
  const observers: { report: ResizeObserverCallback; targets: Element[] }[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly watch: { report: ResizeObserverCallback; targets: Element[] }
      constructor(report: ResizeObserverCallback) {
        this.watch = { report, targets: [] }
        observers.push(this.watch)
      }
      observe(target: Element) {
        this.watch.targets.push(target)
      }
      unobserve() {}
      disconnect() {}
    },
  )
  return async function resizeList(width: number) {
    const list = document.querySelector('.work-item-list')
    if (!list) throw new Error('no list to resize')
    const entry = { contentRect: { width }, target: list } as unknown as ResizeObserverEntry
    for (const { report, targets } of observers)
      if (targets.includes(list)) report([entry], {} as ResizeObserver)
    await flushPromises()
  }
}
