import { defineComponent, h, nextTick, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { caretLine } from '@/shared/lib/caretLine.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'

import { present } from '../support/present.ts'

// What moves the words over a dialog's foot against a focus that stays where it is, and what
// `DialogFrame` does then, by the rule in DESIGN.md («Dialogs and drawers»): the focused control
// and its ring stand clear of the words and whole inside the body. happy-dom lays nothing out,
// so each box states where it stands and the observer reports a resize when the test says so.
// A ring is 2px wide and 2px out (`base.css`), and the scroll goes a pixel further, since it
// stops at a whole one. Where a text area's caret line stands is the browser's layout too, so
// the test says where it is.

vi.mock('@/shared/lib/caretLine.ts', () => ({ caretLine: vi.fn() }))

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

it('a focus that comes over the body’s top edge scrolls down until its ring stands whole', async () => {
  const { tab, scrolled } = await focusedDialog()
  place(tab, 98, 122)
  tab.focus()
  // From the top edge at 100, down past its ring's top side at 94, and a pixel.
  expect(scrolled).toHaveBeenCalledWith({ top: -7 })
})

it('a text area taller than the room the words leave keeps its caret’s line in sight, not its lower end', async () => {
  const { wrapper, body, scrolled } = await focusedDialog()
  // A text field shows focus by its own edge, and draws no ring (`VTextInput`).
  const field = document.createElement('textarea')
  field.style.outline = 'none'
  body.prepend(field)
  // 300px of text from 110px down, its caret on its first line.
  place(field, 110, 410)
  vi.mocked(caretLine).mockReturnValue({ top: 120, bottom: 146 })
  field.focus()
  await wrapper.setProps({ note: 'Agents that name the space will no longer find it.' })
  await nextTick()
  const words = wordsOf()
  place(words, 340, 400)
  resized(words, 60)
  // The caret's line stands in the 240px the note leaves: nothing moves, where its lower end at
  // 410 took the body 71px down and that line over its top edge.
  expect(scrolled).not.toHaveBeenCalled()

  // On its last line under the note, the caret's line comes up over it, with a pixel.
  vi.mocked(caretLine).mockReturnValue({ top: 330, bottom: 356 })
  resized(body, 300)
  expect(scrolled).toHaveBeenLastCalledWith({ top: 17 })
})

it('the body the browser focuses, with nothing in it that takes focus, is not scrolled', async () => {
  const { wrapper, body, scrolled } = await focusedDialog()
  // Chrome makes a box that scrolls focusable while nothing in it takes focus, and rings it.
  body.tabIndex = -1
  body.style.outline = '2px solid'
  body.style.outlineOffset = '-2px'
  body.focus()
  expect(document.activeElement).toBe(body)
  await wrapper.setProps({ error: 'The work was not created.' })
  await nextTick()
  const words = wordsOf()
  place(words, 340, 400)
  resized(words, 60)
  resized(body, 260)
  expect(scrolled).not.toHaveBeenCalled()
})

/**
 * A dialog whose Save waits while `busy`, disabled meanwhile, as a window's own button is: the
 * focus on it falls to the page as it is disabled, or stays where the reader puts it.
 */
function waitingDialog() {
  const busy = ref(false)
  const Host = defineComponent({
    render() {
      return h(
        DialogFrame,
        { open: true, busy: busy.value, title: 'Space LNG', closeLabel: 'Cancel' },
        {
          default: () => h('input', { 'aria-label': 'Name' }),
          footer: () => h('button', { type: 'submit', disabled: busy.value }, 'Save'),
        },
      )
    },
  })
  mount(Host, { attachTo: document.body })
  return { busy }
}

/** The waiting dialog's field or button of that name. */
const control = (name: string) =>
  present(
    [...document.querySelectorAll<HTMLElement>('input, button')].find(
      (node) => (node.getAttribute('aria-label') ?? node.textContent) === name,
    ),
    name,
  )

it('a control a save disables under the focus takes it back once the save is refused', async () => {
  const { busy } = waitingDialog()
  await nextTick()
  const save = control('Save')
  save.focus()
  busy.value = true
  await nextTick()
  // The browser takes the focus off it as it next draws; until then it holds a focus nothing
  // can use, and either way the focus stands on nothing.
  expect(save.matches(':disabled')).toBe(true)
  document.body.focus()

  busy.value = false
  await nextTick()
  await nextTick()
  expect(document.activeElement).toBe(save)
})

it('a focus the reader puts somewhere while the save waits stays there', async () => {
  const { busy } = waitingDialog()
  await nextTick()
  control('Save').focus()
  busy.value = true
  await nextTick()
  const name = control('Name')
  name.focus()
  busy.value = false
  await nextTick()
  await nextTick()
  expect(document.activeElement).toBe(name)
})
