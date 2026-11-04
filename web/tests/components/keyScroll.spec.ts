/**
 * A frame of a document is a stop on the keyboard's way only while its content does not
 * fit, on the frame's own word and nothing else's. A card draws the same frames and leaves
 * them alone.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/shared/i18n/index.ts'
import type { RichBlock } from '@/shared/lib/richText.ts'
import RichBlocks from '@/shared/ui/RichBlocks.vue'

const CODE: RichBlock = { kind: 'code', text: 'a line of code' } as RichBlock
const TABLE: RichBlock = {
  kind: 'table',
  align: [null],
  header: [[{ kind: 'text', text: 'Head' }]],
  rows: [[[{ kind: 'text', text: 'Cell' }]]],
} as RichBlock
const PARAGRAPH: RichBlock = {
  kind: 'paragraph',
  children: [{ kind: 'text', text: 'Words' }],
} as RichBlock

/** What the browser's observer does: says what it watches, when it was resized. */
const watching = new Set<Element>()
let callback: ResizeObserverCallback = () => {}

function resized() {
  callback(
    [...watching].map((target) => ({ target }) as ResizeObserverEntry),
    {} as ResizeObserver,
  )
}

function measure(frame: Element, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(frame, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(frame, 'clientWidth', { configurable: true, value: clientWidth })
}

beforeEach(() => {
  watching.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(next: ResizeObserverCallback) {
        callback = next
      }
      observe(target: Element) {
        watching.add(target)
      }
      unobserve(target: Element) {
        watching.delete(target)
      }
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const drawn = (blocks: RichBlock[], document = true) => {
  i18n.global.locale.value = 'en'
  return mount(RichBlocks, {
    props: { blocks, document },
    attachTo: globalThis.document.body,
    global: { plugins: [i18n] },
  })
}

const scrolledTo = (frame: Element, left: number) => {
  Object.defineProperty(frame, 'scrollLeft', { configurable: true, value: left })
  frame.dispatchEvent(new Event('scroll'))
}

describe('a frame in a document', () => {
  it('watches frames and nothing else', async () => {
    const wrapper = drawn([PARAGRAPH, CODE, PARAGRAPH, TABLE])
    await flushPromises()
    expect(watching.size).toBeLessThanOrEqual(2)
    expect([...watching].every((element) => element.matches('pre, .rich-table-frame'))).toBe(true)
    wrapper.unmount()
    expect(watching.size).toBe(0)
  })

  it.each([
    ['code', CODE, 'pre'],
    ['a table', TABLE, '.rich-table-frame'],
  ])('%s is a stop while it overflows, whenever its width changes', async (_name, block, part) => {
    const wrapper = drawn([block])
    await flushPromises()
    const frame = wrapper.get(part).element

    measure(frame, 900, 400)
    resized()
    expect(frame.getAttribute('tabindex')).toBe('0')

    // Widened until it fits: no stop on nothing.
    measure(frame, 900, 900)
    resized()
    expect(frame.hasAttribute('tabindex')).toBe(false)
    wrapper.unmount()
  })

  it('measures every frame before it marks any, so one pass lays the text out once', async () => {
    const wrapper = drawn([CODE, PARAGRAPH, TABLE, CODE])
    await flushPromises()
    const order: string[] = []
    for (const frame of watching) {
      Object.defineProperty(frame, 'scrollWidth', {
        configurable: true,
        get: () => (order.push('measure'), 900),
      })
      Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 400 })
      const set = frame.setAttribute.bind(frame)
      frame.setAttribute = (name: string, value: string) => (order.push('mark'), set(name, value))
    }
    resized()
    const firstMark = order.indexOf('mark')
    expect(order.filter((step) => step === 'measure')).toHaveLength(3)
    expect(firstMark).toBeGreaterThan(order.lastIndexOf('measure'))
    wrapper.unmount()
  })

  it.each([
    ['a table, by its head', TABLE, '.rich-table-frame', 'Table: Head'],
    ['code, by what it is', CODE, 'pre', 'Code block'],
  ])('while it is a stop it is a region named for %s', async (_name, block, part, name) => {
    const wrapper = drawn([block])
    await flushPromises()
    const frame = wrapper.get(part).element
    measure(frame, 900, 400)
    resized()
    expect(frame.getAttribute('role')).toBe('region')
    expect(frame.getAttribute('aria-label')).toBe(name)

    measure(frame, 900, 900)
    resized()
    expect(frame.hasAttribute('role')).toBe(false)
    expect(frame.hasAttribute('aria-label')).toBe(false)
    wrapper.unmount()
  })

  it('says at which edge more of it is hidden, as the reader scrolls it', async () => {
    const wrapper = drawn([TABLE])
    await flushPromises()
    const frame = wrapper.get<HTMLElement>('.rich-table-frame').element
    measure(frame, 900, 400)
    scrolledTo(frame, 0)
    resized()
    expect(frame.dataset.more).toBe('end')
    scrolledTo(frame, 200)
    expect(frame.dataset.more).toBe('start end')
    scrolledTo(frame, 500)
    expect(frame.dataset.more).toBe('start')
    measure(frame, 900, 900)
    resized()
    expect(frame.dataset.more).toBeUndefined()
    wrapper.unmount()
  })

  it('answers for a new text in the same frame, which no width announces', async () => {
    const wrapper = drawn([CODE])
    await flushPromises()
    const frame = wrapper.get('pre').element
    measure(frame, 400, 400)
    resized()
    expect(frame.hasAttribute('tabindex')).toBe(false)
    measure(frame, 900, 400)
    await wrapper.setProps({
      blocks: [{ ...CODE, text: 'a far longer line of code' } as RichBlock],
    })
    expect(frame.getAttribute('tabindex')).toBe('0')
    wrapper.unmount()
  })
})

describe('a frame in a card', () => {
  it('is left as it was, and nothing watches it', async () => {
    const wrapper = drawn([CODE, TABLE], false)
    await flushPromises()
    expect(watching.size).toBe(0)
    expect(wrapper.get('pre').attributes('tabindex')).toBeUndefined()
    wrapper.unmount()
  })
})
