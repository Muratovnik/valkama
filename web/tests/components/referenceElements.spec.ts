/**
 * What a reference in text is drawn as, and what a press on it does.
 *
 * A reference to a place with an address — a card, a document's page — is a link to that
 * address, so a press with a modifier or the middle button is the browser's, as on any
 * link (`RouterLink` leaves the same presses alone). One that acts — copies, opens a file
 * in the editor, shows a record — is a button, with the keys the WAI-ARIA button pattern
 * gives one. Either is inline, so it wraps with the words around it.
 */
import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDocuments } from '@/shared/api/documentApi.ts'
import type { ResolvedPath } from '@/shared/api/documentApi.ts'
import { messages } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceLink } from '@/shared/lib/referenceLinks.ts'
import RichText from '@/shared/ui/RichText.vue'

import {
  clipboard,
  CODE,
  drawn,
  FILE,
  server,
  strong,
  unmountAll,
} from '../support/documentLinks.ts'

vi.mock('@/shared/api/documentApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/documentApi.ts')>()),
  resolveDocuments: vi.fn(),
}))

/** A layer that links `MAIN-12` to its card and `a1b2c3d` to an action, as a page provides them. */
const Layer = defineComponent({
  props: { open: { type: Function as PropType<(value: string) => void>, required: true } },
  setup(props, { slots }) {
    provideReferenceLinks((reference): ReferenceLink | null => {
      if (reference.value === 'MAIN-12')
        return { title: 'Open MAIN-12', href: '/open/MAIN-12', open: () => props.open('MAIN-12') }
      if (reference.value === 'a1b2c3d')
        return { title: 'Show a1b2c3d', open: () => props.open('a1b2c3d') }
      return null
    })
    return () => slots.default?.()
  },
})

function linked() {
  const open = vi.fn()
  const wrapper = mount(Layer, {
    props: { open },
    slots: { default: () => h(RichText, { source: 'See MAIN-12 at a1b2c3d.' }) },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
    attachTo: document.body,
  })
  const [card, action] = wrapper.findAll('.rich-reference')
  if (!card || !action) throw new Error('Not linked')
  return { open, card: card.element, action: action.element, wrapper }
}

/** What the browser would have done with the event: prevented, by the page, or not. */
const prevented: boolean[] = []
const record = (event: Event) => {
  prevented.push(event.defaultPrevented)
  // Nothing here navigates for real.
  event.preventDefault()
}

function pressOn(element: Element, type: 'auxclick' | 'click', init: MouseEventInit = {}) {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }))
  return prevented.at(-1)
}

/** The server's answer about paths, given when the test says. */
function later() {
  const held: { settle?: (paths: ResolvedPath[]) => void } = {}
  const promise = new Promise<ResolvedPath[]>((settle) => {
    held.settle = settle
  })
  return { promise, answer: (paths: ResolvedPath[]) => held.settle?.(paths) }
}

const key = (element: Element, type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
  element.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  prevented.length = 0
  window.addEventListener('click', record)
  window.addEventListener('auxclick', record)
})

afterEach(() => {
  window.removeEventListener('click', record)
  window.removeEventListener('auxclick', record)
  delete window.valkamaDesktop
  unmountAll()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('a reference to a place', () => {
  it('is a link to its address, and a plain press opens it in place', () => {
    const { open, card } = linked()
    expect(card.tagName).toBe('A')
    expect(card.getAttribute('href')).toBe('/open/MAIN-12')
    expect(card.hasAttribute('role')).toBe(false)
    expect(pressOn(card, 'click')).toBe(true)
    expect(open).toHaveBeenCalledExactlyOnceWith('MAIN-12')
  })

  it('leaves a modified or a middle press to the browser, as any link', () => {
    const { open, card } = linked()
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])
      expect(pressOn(card, 'click', init)).toBe(false)
    expect(pressOn(card, 'auxclick', { button: 1 })).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('in the desktop app opens in place on any of them, since it has no tab to open', () => {
    window.valkamaDesktop = {}
    const { open, card } = linked()
    expect(pressOn(card, 'click', { ctrlKey: true })).toBe(true)
    expect(pressOn(card, 'click', { shiftKey: true })).toBe(true)
    expect(pressOn(card, 'auxclick', { button: 1 })).toBe(true)
    expect(open).toHaveBeenCalledTimes(3)
    // The context menu's button is the menu's, here as anywhere.
    expect(pressOn(card, 'auxclick', { button: 2 })).toBe(false)
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('answers Enter through the click a link makes of it, not twice', () => {
    const { open, card } = linked()
    expect(key(card, 'keydown', { key: 'Enter' })).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('a reference that acts', () => {
  it('is a button in the text, reached by Tab', () => {
    const { action } = linked()
    expect(action.tagName).toBe('A')
    expect(action.getAttribute('role')).toBe('button')
    expect(action.getAttribute('tabindex')).toBe('0')
    expect(action.hasAttribute('href')).toBe(false)
  })

  it('acts on a press and on Enter as it goes down, once while it is held', () => {
    const { open, action } = linked()
    pressOn(action, 'click')
    expect(key(action, 'keydown', { key: 'Enter' })).toBe(true)
    expect(key(action, 'keydown', { key: 'Enter', repeat: true })).toBe(true)
    expect(open.mock.calls).toEqual([['a1b2c3d'], ['a1b2c3d']])
  })

  it('acts on Space as it comes up, and keeps the page from scrolling as it goes down', () => {
    const { open, action } = linked()
    expect(key(action, 'keydown', { key: ' ' })).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(key(action, 'keyup', { key: ' ' })).toBe(true)
    expect(open).toHaveBeenCalledExactlyOnceWith('a1b2c3d')
  })

  it('takes no middle press', () => {
    const { open, action } = linked()
    expect(pressOn(action, 'auxclick', { button: 1 })).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('a path', () => {
  beforeEach(() => {
    vi.mocked(resolveDocuments).mockReset()
    clipboard()
  })

  it('that opens in the viewer links to the document’s own page; any other is a button', async () => {
    server({ 'docs/a.md': FILE, 'src/a.ts': CODE })
    const { wrapper } = drawn(
      [strong('docs/a.md#kb:a7f3'), strong('src/a.ts'), strong('docs/gone.md')],
      { openDocument: () => true, openFile: () => true },
    )
    await flushPromises()
    const [document, file, gone] = wrapper.findAll('.rich-reference')
    expect(document?.element.tagName).toBe('A')
    expect(document?.attributes('href')).toBe('/doc?project=demo&path=docs%2Fa.md#kb:a7f3')
    for (const control of [file, gone]) {
      expect(control?.attributes('role')).toBe('button')
      expect(control?.attributes('href')).toBeUndefined()
    }
  })

  it('keeps focus when the server answers that it opens, as the same element', async () => {
    const { promise, answer } = later()
    vi.mocked(resolveDocuments).mockImplementationOnce(() => promise)
    const { wrapper } = drawn([strong('docs/a.md')], { openDocument: () => true })
    await flushPromises()
    const waiting = wrapper.get('.rich-reference')
    expect(waiting.attributes('role')).toBe('button')
    ;(waiting.element as HTMLElement).focus()
    answer([{ path: 'docs/a.md', ...FILE }])
    await flushPromises()
    const opening = wrapper.get('.rich-reference')
    expect(opening.attributes('href')).toBe('/doc?project=demo&path=docs%2Fa.md')
    expect(opening.element).toBe(waiting.element)
    expect(document.activeElement).toBe(opening.element)
  })

  it('may break after each `/`, which adds nothing to its text', async () => {
    server()
    const { wrapper } = drawn([strong('docs/plans/x.md')])
    await flushPromises()
    const path = wrapper.get('.rich-reference')
    expect(path.html()).toContain('docs/<wbr>plans/<wbr>x.md')
    expect(path.text()).toBe('docs/plans/x.md')
  })
})
