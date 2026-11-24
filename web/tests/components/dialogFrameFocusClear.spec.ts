import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import DialogFrame from '@/shared/ui/DialogFrame.vue'

import { present } from '../support/present.ts'

// What moves the words over a dialog's foot against a focus that stays where it is, and what
// `DialogFrame` does then, by the rule in DESIGN.md («Dialogs and drawers»): the focused control
// and its ring stand clear of the words. happy-dom lays nothing out,
// so each box states where it stands and the observer reports a resize when the test says so.
// A ring is 2px wide and 2px out (`base.css`), and the scroll goes a pixel further, since it
// stops at a whole one.

/** Each element observed, and what its observer reports a resize to. */
const observed = new Map<Element, ResizeObserverCallback>()

/** What the browser's observer does as `target` is resized to `blockSize` tall. */
function resized(target: Element, blockSize = 0) {
  const entry = { target, borderBoxSize: [{ blockSize, inlineSize: 0 }] }
  observed.get(target)?.([entry as unknown as ResizeObserverEntry], {} as ResizeObserver)
}

/** Where `node` stands in the window, top to bottom. */
function place(node: Element, top: number, bottom: number) {
  const box = { top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top }
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(box as DOMRect)
}

beforeEach(() => {
  observed.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly report: ResizeObserverCallback
      constructor(report: ResizeObserverCallback) {
        this.report = report
      }
      observe(target: Element) {
        observed.set(target, this.report)
      }
      unobserve(target: Element) {
        observed.delete(target)
      }
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

/**
 * A dialog whose body shows 300px from 100px down, holding a tab ringed as `base.css` rings
 * one, focused from the keyboard.
 */
async function focusedDialog() {
  const wrapper = mount(DialogFrame, {
    attachTo: document.body,
    props: { open: true, title: 'New work', closeLabel: 'Close' },
    slots: {
      default:
        '<button type="button" style="outline: 2px solid; outline-offset: 2px">Write</button>',
    },
  })
  await nextTick()
  const body = present(
    document.querySelector<HTMLElement>('[data-part="dialog-body"]'),
    'the dialog body',
  )
  place(body, 100, 400)
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 })
  const scrolled = vi.spyOn(body, 'scrollBy').mockImplementation(() => {})
  const tab = present(body.querySelector('button'), 'the tab')
  return { wrapper, body, tab, scrolled }
}

const wordsOf = () =>
  present(document.querySelector('[data-part="said"]'), 'the words over the foot')

it('a refusal that comes over a focus that stays scrolls the focused control out from under it', async () => {
  const { wrapper, tab, scrolled } = await focusedDialog()
  place(tab, 350, 374)
  tab.focus()
  expect(document.activeElement).toBe(tab)
  expect(scrolled).not.toHaveBeenCalled()

  await wrapper.setProps({ error: 'The work was not created.' })
  await nextTick()
  const words = wordsOf()
  place(words, 340, 400)
  resized(words, 60)
  // From its ring's lower side, 378, and a pixel, up past the refusal's top at 340.
  expect(scrolled).toHaveBeenCalledWith({ top: 39 })
})

it('words that grow, and a body that gets shorter, under a focus that stays scroll it clear', async () => {
  const { wrapper, body, tab, scrolled } = await focusedDialog()
  place(tab, 300, 324)
  tab.focus()
  await wrapper.setProps({ error: 'The work was not created.' })
  await nextTick()
  const words = wordsOf()
  place(words, 340, 400)
  resized(words, 60)
  // The ring's lower side at 328 stands clear of the refusal's top at 340.
  expect(scrolled).not.toHaveBeenCalled()

  place(words, 320, 400)
  resized(words, 80)
  expect(scrolled).toHaveBeenLastCalledWith({ top: 9 })

  place(tab, 291, 315)
  place(body, 100, 360)
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 260 })
  place(words, 280, 360)
  resized(body, 260)
  expect(scrolled).toHaveBeenLastCalledWith({ top: 40 })
})
