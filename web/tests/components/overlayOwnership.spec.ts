import { defineComponent, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import OverlayHost from '@/shared/ui/OverlayHost.vue'

const mounted: ReturnType<typeof mount>[] = []
let opener: HTMLButtonElement | null = null

function start() {
  document.body.style.overflow = 'auto'
  opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const drawer = ref(true)
  const command = ref(false)
  const wrapper = mount(
    defineComponent({
      components: { OverlayHost },
      setup: () => ({ drawer, command }),
      template: `
      <OverlayHost :open="drawer" aria-label="Drawer" layer="drawer" variant="drawer" @close="drawer = false">
        <button class="drawer-first">First drawer action</button>
        <button class="command-trigger" @click="command = true">Open command</button>
        <button class="drawer-last">Last drawer action</button>
      </OverlayHost>
      <OverlayHost :open="command" aria-label="Command" layer="command" @close="command = false">
        <button class="command-first">First command action</button>
        <button class="command-last">Last command action</button>
      </OverlayHost>`,
    }),
    { attachTo: document.body },
  )
  mounted.push(wrapper)
  return { wrapper, drawer, command }
}

function button(selector: string) {
  const element = document.querySelector<HTMLButtonElement>(selector)
  if (!element) throw new Error(`Missing button: ${selector}`)
  return element
}

function key(element: HTMLElement, value: string, shiftKey = false) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }),
  )
}

afterEach(async () => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  await flushPromises()
  opener?.remove()
  opener = null
  document.body.style.overflow = ''
})

describe('shared nested overlay ownership', () => {
  it('suspends the drawer, dismisses only the command, and restores drawer focus and trap before final close', async () => {
    const { drawer, command } = start()
    await flushPromises()
    expect(document.activeElement).toBe(button('.drawer-first'))
    const trigger = button('.command-trigger')
    trigger.focus()
    trigger.click()
    await flushPromises()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    const covered = document.querySelector('.overlay-surface-drawer')
    expect(covered?.hasAttribute('inert')).toBe(true)
    expect(covered?.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(button('.command-first'))
    expect(document.body.style.overflow).toBe('hidden')

    button('.command-last').focus()
    key(button('.command-last'), 'Tab')
    expect(document.activeElement).toBe(button('.command-first'))
    key(button('.command-first'), 'Tab', true)
    expect(document.activeElement).toBe(button('.command-last'))

    key(button('.command-last'), 'Escape')
    await flushPromises()
    expect(command.value).toBe(false)
    expect(drawer.value).toBe(true)
    expect(covered?.hasAttribute('inert')).toBe(false)
    expect(covered?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(trigger)
    expect(document.body.style.overflow).toBe('hidden')
    button('.drawer-last').focus()
    key(button('.drawer-last'), 'Tab')
    expect(document.activeElement).toBe(button('.drawer-first'))
    key(button('.drawer-first'), 'Escape')
    await flushPromises()
    expect(drawer.value).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('ignores covered scrims and Escape already consumed by a choice popup', async () => {
    const { drawer, command } = start()
    await flushPromises()
    button('.command-trigger').click()
    await flushPromises()
    document
      .querySelector('.overlay-layer-drawer .overlay-scrim')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(drawer.value).toBe(true)
    const consumed = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    consumed.preventDefault()
    button('.command-first').dispatchEvent(consumed)
    expect(command.value).toBe(true)
    document
      .querySelector('.overlay-layer-command .overlay-scrim')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(command.value).toBe(false)
    expect(drawer.value).toBe(true)
  })

  it('closes only the top overlay on Escape after focus has fallen to the page body', async () => {
    const { drawer, command } = start()
    await flushPromises()
    const trigger = button('.command-trigger')
    trigger.focus()
    trigger.click()
    await flushPromises()
    // A refused write disables the focused control, and the browser drops focus to BODY.
    button('.command-first').blur()
    expect(document.activeElement).toBe(document.body)
    key(document.body, 'Escape')
    await flushPromises()
    expect(command.value).toBe(false)
    expect(drawer.value).toBe(true)
    expect(document.activeElement).toBe(trigger)
    button('.drawer-first').blur()
    key(document.body, 'Escape')
    await flushPromises()
    expect(drawer.value).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('leaves Escape pressed in a covered overlay, or consumed on the way, to its owner', async () => {
    const { drawer, command } = start()
    await flushPromises()
    button('.command-trigger').click()
    await flushPromises()
    key(button('.drawer-last'), 'Escape')
    await flushPromises()
    expect(command.value).toBe(true)
    expect(drawer.value).toBe(true)
    const consumed = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    consumed.preventDefault()
    document.body.dispatchEvent(consumed)
    await flushPromises()
    expect(command.value).toBe(true)
    // A choice list portalled out of the dialog takes its own Escape and closes
    // itself; the dialog under it stays.
    const portal = document.createElement('button')
    document.body.append(portal)
    key(portal, 'Escape')
    await flushPromises()
    portal.remove()
    expect(command.value).toBe(true)
  })

  it('keeps scroll locked and the original opener when the covered drawer unmounts first', async () => {
    const { drawer, command } = start()
    await flushPromises()
    button('.command-trigger').focus()
    button('.command-trigger').click()
    await flushPromises()
    drawer.value = false
    await flushPromises()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Command')
    command.value = false
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('hands a same-tick replacement the original page focus without briefly unlocking scroll', async () => {
    const { drawer, command } = start()
    await flushPromises()
    drawer.value = false
    command.value = true
    await flushPromises()
    expect(document.activeElement).toBe(button('.command-first'))
    expect(document.body.style.overflow).toBe('hidden')
    command.value = false
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('keeps a live command above a drawer that reopens later', async () => {
    const { drawer, command } = start()
    await flushPromises()
    button('.command-trigger').click()
    await flushPromises()
    drawer.value = false
    await flushPromises()
    drawer.value = true
    await flushPromises()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Command')
    expect(document.querySelector('.overlay-surface-drawer')?.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(button('.command-first'))
    command.value = false
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Drawer')
    expect(document.activeElement).toBe(button('.drawer-first'))
  })

  it('does not let a passive preview claim focus, scroll, or dismissal', async () => {
    const { drawer } = start()
    await flushPromises()
    const preview = mount(OverlayHost, {
      attachTo: document.body,
      props: { open: true, interactive: false, ariaLabel: 'Preview' },
      slots: { default: '<button class="preview-action">Preview</button>' },
    })
    mounted.push(preview)
    await flushPromises()
    expect(document.activeElement).toBe(button('.drawer-first'))
    key(button('.preview-action'), 'Escape')
    expect(preview.emitted('close')).toBeUndefined()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    mounted.pop()
    preview.unmount()
    await flushPromises()
    expect(drawer.value).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
  })
})
