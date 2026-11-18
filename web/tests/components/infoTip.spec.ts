/**
 * Escape on an InfoTip: it closes the tip while the tip is open, and otherwise goes on to the
 * dialog or panel the tip stands in, which closes on it as it would anywhere else.
 *
 * Where an open tip stands: over the page at its control, centred over it 8px above where there
 * is room, below it otherwise, and never closer than 12px to an edge of the viewport, measured
 * again when the window changes size.
 */
import { defineComponent, nextTick, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InfoTip from '@/shared/ui/InfoTip.vue'

function host() {
  const heard = ref(0)
  const wrapper = mount(
    defineComponent({
      components: { InfoTip },
      setup: () => ({ heard }),
      template:
        '<div class="around" @keydown.esc="heard += 1"><InfoTip label="About this">Why it is so</InfoTip></div>',
    }),
    { attachTo: document.body },
  )
  return { heard, trigger: wrapper.get('.info-tip-trigger'), wrapper }
}

const panel = () => document.querySelector('.info-tip-panel')

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Escape on an InfoTip', () => {
  it('reaches what holds the tip while the tip is closed', async () => {
    const { heard, trigger } = host()
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(heard.value).toBe(1)
  })

  it('closes an open tip, gives focus back to its control and goes no further', async () => {
    const { heard, trigger } = host()
    await trigger.trigger('click')
    expect(panel()).not.toBeNull()
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    expect(heard.value).toBe(0)
    // Closed now, the next Escape is the surrounding surface's.
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(heard.value).toBe(1)
  })
})

/** The viewport's size, as the window gives it. */
function viewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

/** Where the open tip stands, in viewport pixels. */
function placed() {
  const tip = document.querySelector<HTMLElement>('[role="tooltip"]')
  if (!tip) throw new Error('no open tip')
  return { left: Number.parseFloat(tip.style.left), top: Number.parseFloat(tip.style.top) }
}

describe('an open InfoTip in the viewport', () => {
  /** The tip's box, and the clear space the rule keeps to the viewport and to its control. */
  const TIP = { width: 200, height: 80 }
  const GUTTER = 12
  const GAP = 8
  const sizes = ['innerWidth', 'innerHeight'] as const
  const saved = sizes.map((name) => Object.getOwnPropertyDescriptor(window, name))

  /** Opens a tip whose control stands at `control` in a viewport of 400 by 300. */
  async function openAt(control: DOMRect) {
    viewport(400, 300)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('role') === 'tooltip') return new DOMRect(0, 0, TIP.width, TIP.height)
      return this.matches('button') ? control : new DOMRect()
    })
    const wrapper = mount(InfoTip, {
      props: { label: 'About this' },
      slots: { default: 'Why it is so' },
      attachTo: document.body,
    })
    await wrapper.get('button').trigger('click')
    await nextTick()
    return wrapper
  }

  afterEach(() => {
    vi.restoreAllMocks()
    for (const [index, name] of sizes.entries()) {
      const descriptor = saved[index]
      if (descriptor) Object.defineProperty(window, name, descriptor)
      else Reflect.deleteProperty(window, name)
    }
  })

  it('stands centred over its control, the gap above it, where there is room', async () => {
    await openAt(new DOMRect(190, 150, 20, 20))
    expect(placed()).toEqual({ left: 200 - TIP.width / 2, top: 150 - GAP - TIP.height })
  })

  it('keeps clear of the right and the left edge of the viewport', async () => {
    await openAt(new DOMRect(370, 150, 20, 20))
    expect(placed().left).toBe(400 - GUTTER - TIP.width)
    document.body.innerHTML = ''
    await openAt(new DOMRect(5, 150, 20, 20))
    expect(placed().left).toBe(GUTTER)
  })

  it('stands below its control where above it would cross the top', async () => {
    await openAt(new DOMRect(190, 20, 20, 20))
    expect(placed().top).toBe(20 + 20 + GAP)
  })

  it('is measured again when the window narrows, and stays inside it', async () => {
    await openAt(new DOMRect(190, 150, 20, 20))
    expect(placed().left).toBe(100)
    viewport(300, 300)
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(placed().left).toBe(300 - GUTTER - TIP.width)
  })
})
