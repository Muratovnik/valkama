/**
 * The shell's own live-work stream and its handover to a space's stream. At the start the
 * shell opens `view=live` before it knows what it shows, so the list of work going on now
 * does not wait for a large space's read, and closes it only once the space's stream has
 * delivered its own frame; after that, a tab holds one stream again.
 */
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useLiveWorkFeed } from '@/app/composables/useLiveWorkFeed.ts'

import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'

import { busyFrame } from './support/liveFrame.ts'

const sources: Source[] = []
class Source extends EventTarget {
  closed = false
  close = vi.fn(() => {
    this.closed = true
  })
  constructor(readonly url: string) {
    super()
    sources.push(this)
  }
}
const open = () => sources.filter((source) => !source.closed)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('EventSource', Source)
  sources.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The shell as the feed reads it, starting where nothing is known yet. */
function shell(initial: { document?: boolean } = {}) {
  const page = {
    document: ref(initial.document ?? false),
    known: ref(false),
    spaceStream: ref(false),
  }
  const scope = effectScope()
  scope.run(() =>
    useLiveWorkFeed({
      known: () => page.known.value,
      shell: () => !page.document.value,
      spaceStream: () => page.spaceStream.value,
    }),
  )
  return { ...page, stop: () => scope.stop() }
}

it('opens the live view as the shell starts and closes it once the space stream delivered', async () => {
  const page = shell()
  await nextTick()
  // Before the route, the module list or the projects are known.
  expect(open().map((source) => source.url)).toEqual(['/api/events?view=live'])
  const [early] = sources
  early.dispatchEvent(new MessageEvent('live', { data: JSON.stringify(busyFrame()) }))
  expect(useLiveWorkStore().frame).toEqual(busyFrame())
  // The shell learns it shows a space, whose stream opens after the space's read.
  page.known.value = true
  page.spaceStream.value = true
  await nextTick()
  // Open until the space's stream has its own frame: the list is never without a source.
  expect(early.closed).toBe(false)
  useLiveWorkStore().acceptFromSpace(busyFrame())
  await nextTick()
  expect(early.close).toHaveBeenCalledOnce()
  expect(open()).toEqual([])
  // The frame it brought stays: the space's stream replaces it, nothing blanks it.
  expect(useLiveWorkStore().frame).toEqual(busyFrame())
  page.stop()
})

it('does not open the live view again when the space stream drops and comes back', async () => {
  const page = shell()
  page.known.value = true
  page.spaceStream.value = true
  await nextTick()
  useLiveWorkStore().acceptFromSpace(busyFrame())
  await nextTick()
  expect(open()).toEqual([])
  // A dropped space stream keeps its place as the tab's stream while it reconnects, and
  // the frame its return brings says nothing new to the shell.
  useLiveWorkStore().acceptFromSpace(busyFrame())
  await nextTick()
  expect(sources).toHaveLength(1)
  // A page with no space stream still has the live view, as it always had.
  page.spaceStream.value = false
  await nextTick()
  expect(open().map((source) => source.url)).toEqual(['/api/events?view=live'])
  expect(sources).toHaveLength(2)
  page.stop()
})

it('keeps the start’s stream as the page’s own when the page has no space stream', async () => {
  const page = shell()
  await nextTick()
  const [early] = sources
  page.known.value = true
  await nextTick()
  // The same stream, neither closed nor opened again.
  expect(sources).toEqual([early])
  expect(early.closed).toBe(false)
  // Moving to a space later closes it as that page's stream always closed: when the space's
  // stream opens. The start is over, so there is no wait for its frame.
  page.spaceStream.value = true
  await nextTick()
  expect(early.closed).toBe(true)
  page.stop()
})

it('opens nothing on a document page, which has no rail', async () => {
  const page = shell({ document: true })
  page.known.value = true
  await nextTick()
  expect(sources).toEqual([])
  page.stop()
})
