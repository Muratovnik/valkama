import { defineComponent, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BOARD_ROOM_BESIDE_DOCUMENT,
  DOCUMENT_PANE_DEFAULT_WIDTH,
  DOCUMENT_PANE_STORAGE_KEY,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
  INSPECTOR_DRAWER_STORAGE_KEY,
  INSPECTOR_KEYBOARD_STEP,
} from '@/shared/lib/shellLayout.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'

import { hintOf } from '../support/hint.ts'

/**
 * A second pane inside one surface: what the surface was opened for stays mounted with any
 * draft in it, one Tab trap goes through both, and Escape in the pane closes the pane alone.
 */

const mounted: ReturnType<typeof mount>[] = []

beforeEach(() => {
  // A reader's key opens these, which is what gives the first control focus.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 })
})

afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  await flushPromises()
  localStorage.removeItem(DOCUMENT_PANE_STORAGE_KEY)
  localStorage.removeItem(INSPECTOR_DRAWER_STORAGE_KEY)
  document.body.style.overflow = ''
})

const NAMES = {
  folded: 'Folded. Enter or a click shows it again',
  label: 'Document: The plan',
  main: 'The card',
  resize: 'Document width',
}

const CARD = `
  <ResizableInspector
    :open="open"
    label="Card"
    :pane="pane ? names : null"
    :pane-room="room"
    :storage-key="cardKey"
    @close="open = false"
    @pane-close="pane = false"
    @pane-fit="(next) => fits.push(next)"
  >
    <textarea class="draft" aria-label="Reply"></textarea>
    <button class="card-action" type="button">Link</button>
    <template #pane>
      <button class="pane-first" type="button">Back</button>
      <button class="pane-last" type="button">Close</button>
    </template>
  </ResizableInspector>`

const HUB = `
  <DialogFrame
    :open="open"
    title="Waiting for my answer"
    close-label="Close"
    :pane="pane ? names : null"
    :pane-room="room"
    @close="open = false"
    @pane-close="pane = false"
    @submit="submitted += 1"
  >
    <textarea class="draft" aria-label="Reply"></textarea>
    <button class="card-action" type="button">Link</button>
    <template #pane>
      <button class="pane-first">Back</button>
      <button class="pane-last">Close</button>
    </template>
  </DialogFrame>`

function host(template: string) {
  const state = {
    open: ref(true),
    pane: ref(true),
    submitted: ref(0),
    fits: ref<unknown[]>([]),
    names: NAMES,
    room: BOARD_ROOM_BESIDE_DOCUMENT,
    cardKey: INSPECTOR_DRAWER_STORAGE_KEY,
  }
  const wrapper = mount(
    defineComponent({
      components: { DialogFrame, ResizableInspector },
      setup: () => state,
      template,
    }),
    { attachTo: document.body },
  )
  mounted.push(wrapper)
  return state
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

function press(target: HTMLElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

const separator = () => element('.overlay-pane [role="separator"]')
const value = () => Number(separator().getAttribute('aria-valuenow'))
const cardEdge = () => element('.overlay-surface > [role="separator"]')

describe.each([
  ['a card', CARD],
  ['the questions waiting for an answer', HUB],
])('a pane in the surface of %s', (_name, template) => {
  it('is one dialog with two named regions, and the trap goes through both', async () => {
    host(template)
    await flushPromises()
    const dialogs = document.querySelectorAll('[role="dialog"]')
    expect(dialogs).toHaveLength(1)
    const names = [...document.querySelectorAll('[role="region"]')].map(
      (region) =>
        document.querySelector(`[id="${region.getAttribute('aria-labelledby')}"]`)?.textContent,
    )
    expect(names).toEqual(['The card', 'Document: The plan'])

    // The stops either side of the surface send focus round to the far end, past both panes.
    const stops =
      dialogs[0]?.parentElement?.querySelectorAll<HTMLElement>(':scope > [tabindex="0"]')
    stops?.[0]?.focus()
    expect(document.activeElement).toBe(element('.pane-last'))
    stops?.[1]?.focus()
    expect(dialogs[0]?.contains(document.activeElement)).toBe(true)
    expect(element('.overlay-pane').contains(document.activeElement)).toBe(false)
  })

  it('closes alone on Escape, the surface keeps its draft, and the next Escape closes it', async () => {
    const state = host(template)
    await flushPromises()
    const draft = element<HTMLTextAreaElement>('.draft')
    draft.value = 'Half an answer'

    const event = press(element('.pane-first'), 'Escape')
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(state.pane.value).toBe(false)
    expect(state.open.value).toBe(true)
    expect(element('.draft')).toBe(draft)
    expect(draft.value).toBe('Half an answer')
    expect(document.querySelectorAll('[role="region"]')).toHaveLength(0)

    press(draft, 'Escape')
    await flushPromises()
    expect(state.open.value).toBe(false)
  })

  it('takes Escape on its own edge too, and leaves one in the other pane to the surface', async () => {
    const state = host(template)
    await flushPromises()
    press(separator(), 'Escape')
    await flushPromises()
    expect(state.pane.value).toBe(false)
    expect(state.open.value).toBe(true)

    state.pane.value = true
    await flushPromises()
    press(element('.draft'), 'Escape')
    await flushPromises()
    expect(state.open.value).toBe(false)
  })

  it('walks between the panes on F6, back to where focus was', async () => {
    host(template)
    await flushPromises()
    const action = element('.card-action')
    action.focus()

    // A pane focus has never been in: its first control's title, or what it is read with.
    const first = press(action, 'F6')
    expect(first.defaultPrevented).toBe(true)
    expect(element('.overlay-pane').contains(document.activeElement)).toBe(true)

    const held = element('.pane-last')
    held.focus()
    press(held, 'F6', true)
    expect(document.activeElement).toBe(action)
    press(action, 'F6')
    expect(document.activeElement).toBe(held)
  })

  it('folds on Enter, keeping the pane open and its width, and comes back on Enter', async () => {
    const state = host(template)
    await flushPromises()
    const before = value()
    const control = element('.pane-first')

    press(separator(), 'Enter')
    await flushPromises()
    expect(value()).toBe(0)
    expect(state.pane.value).toBe(true)
    expect(element('.overlay-pane-region')).toContain(control)
    expect(separator().isConnected).toBe(true)

    // Folded, F6 has nowhere to go.
    const action = element('.card-action')
    action.focus()
    press(action, 'F6')
    expect(document.activeElement).toBe(action)

    press(separator(), 'Enter')
    await flushPromises()
    expect(value()).toBe(before)
    expect(element('.overlay-pane-region')).toContain(control)
  })

  it('folded, says so and shows whose edge it is, and a press of the pointer brings it back', async () => {
    host(template)
    await flushPromises()
    const before = value()
    expect(separator().hasAttribute('aria-valuetext')).toBe(false)

    press(separator(), 'Enter')
    await flushPromises()
    const edge = separator()
    expect(edge.getAttribute('aria-valuetext')).toBe(NAMES.folded)
    expect(hintOf(edge)).toBe(NAMES.folded)
    // Seen as well as heard: the strip carries the pane's name, and is named by it, so a
    // voice command saying what it shows finds it; what it sizes is its description.
    expect(edge.querySelector('.overlay-resizer-name')?.textContent).toBe(NAMES.label)
    expect(edge.getAttribute('aria-label')).toBe(NAMES.label)
    // Its purpose first; the hint's words, when it has a hint, after them.
    const [purpose] = (edge.getAttribute('aria-describedby') ?? '').split(' ')
    expect(document.querySelector(`[id="${purpose}"]`)?.textContent).toBe(NAMES.resize)

    edge.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { button: 0 }))
    await flushPromises()
    expect(value()).toBe(before)
    expect(separator().hasAttribute('aria-valuetext')).toBe(false)
    expect(separator().textContent?.trim()).toBe('')
  })

  it('says what it sizes, and takes the keys as the width of the pane', async () => {
    host(template)
    await flushPromises()
    const edge = separator()
    expect(edge.getAttribute('aria-controls')).toBe(element('.overlay-pane-region').id)
    expect(edge.getAttribute('aria-orientation')).toBe('vertical')
    expect(edge.dataset.overlayResizer).toBe('')

    const width = value()
    expect(width).toBe(DOCUMENT_PANE_DEFAULT_WIDTH)
    press(edge, 'ArrowLeft')
    await flushPromises()
    expect(value()).toBe(width + INSPECTOR_KEYBOARD_STEP)
    press(edge, 'ArrowRight')
    press(edge, 'ArrowRight')
    await flushPromises()
    expect(value()).toBe(width - INSPECTOR_KEYBOARD_STEP)
    press(edge, 'Home')
    await flushPromises()
    expect(value()).toBe(DRAWER_MIN_WIDTH)
    expect(edge.getAttribute('aria-valuemin')).toBe(String(DRAWER_MIN_WIDTH))
    press(edge, 'End')
    await flushPromises()
    expect(value()).toBe(Number(edge.getAttribute('aria-valuemax')))
    expect(value()).toBeLessThanOrEqual(DRAWER_MAX_WIDTH)
    expect(localStorage.getItem(DOCUMENT_PANE_STORAGE_KEY)).toBe(String(value()))
  })
})

describe('a pane beside a dialog', () => {
  it('stands outside its form, so a button in it answers nothing', async () => {
    const state = host(HUB)
    await flushPromises()
    expect(element('.pane-first').closest('form')).toBeNull()
    expect(element('.card-action').closest('form')).not.toBeNull()
    element('.pane-first').click()
    await flushPromises()
    expect(state.submitted.value).toBe(0)
  })
})

describe('a pane beside a card', () => {
  it('sizes itself alone: the card keeps its width, in its own key, and the other way', async () => {
    host(CARD)
    await flushPromises()
    const card = cardEdge().getAttribute('aria-valuenow')
    press(separator(), 'ArrowLeft')
    await flushPromises()
    expect(cardEdge().getAttribute('aria-valuenow')).toBe(card)
    expect(localStorage.getItem(INSPECTOR_DRAWER_STORAGE_KEY)).toBeNull()

    const pane = value()
    press(cardEdge(), 'ArrowLeft')
    await flushPromises()
    expect(value()).toBe(pane)
    expect(localStorage.getItem(DOCUMENT_PANE_STORAGE_KEY)).toBe(String(pane))
  })

  it('is passed over by the focus an open places, with its edge', async () => {
    host(CARD)
    await flushPromises()
    expect(document.activeElement).toBe(element('.draft'))
  })

  it('answers whether a pane would fit, and only after a drag has ended', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1460 })
    const state = host(CARD)
    state.pane.value = false
    await flushPromises()
    const last = () => state.fits.value.at(-1)
    expect(last()).toEqual({ active: true, fits: true })

    // One step wider than the threshold allows at this window, by the card's edge.
    cardEdge().dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 800 }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 790 }))
    await flushPromises()
    expect(last()).toEqual({ active: true, fits: true })
    window.dispatchEvent(new PointerEvent('pointerup', {}))
    await flushPromises()
    expect(last()).toEqual({ active: true, fits: false })

    press(cardEdge(), 'ArrowRight')
    await flushPromises()
    expect(last()).toEqual({ active: true, fits: true })

    // The window's own width is the other half: at 604 the card needs 1444.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1443 })
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(last()).toEqual({ active: true, fits: false })

    state.open.value = false
    await flushPromises()
    expect(last()).toBeNull()
  })
})
