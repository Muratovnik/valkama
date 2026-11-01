/**
 * A one-line field's short placeholder: shown only where the whole one would be
 * cut, and never in place of the field's name. The widths a browser lays out
 * are stood in for by the getters the field reads; the layout itself — the
 * Work bar's filter at 390 — is the browser suite's.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import VTextInput from '@/shared/ui/VTextInput.vue'

/** A text box `room` pixels wide, whose whole placeholder is 144px of text. */
function lay(room: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('placeholder-ghost') ? 144 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'INPUT' ? room : 0
  })
}

/** A resize observer that reports the box it is given at once, as a first layout does. */
class ReportingObserver {
  constructor(private readonly report: ResizeObserverCallback) {}
  observe(target: Element) {
    this.report([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ReportingObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function field(props: Record<string, unknown> = {}) {
  const wrapper = mount(VTextInput, {
    attachTo: document.body,
    props: {
      label: 'Filter work',
      modelValue: '',
      placeholder: 'Reference or title',
      shortPlaceholder: 'Search',
      hideLabel: true,
      ...props,
    },
  })
  await flushPromises()
  return wrapper.get('input')
}

describe('a field with a short placeholder', () => {
  it('shows the whole placeholder where it fits', async () => {
    lay(200)
    const input = await field()
    expect(input.attributes('placeholder')).toBe('Reference or title')
  })

  it('shows the short one where the whole one would be cut, and keeps its whole name', async () => {
    lay(81)
    const input = await field()
    expect(input.attributes('placeholder')).toBe('Search')
    expect(input.attributes('aria-label')).toBe('Filter work')
  })

  it('shows the whole placeholder where nothing can be measured', async () => {
    const input = await field()
    expect(input.attributes('placeholder')).toBe('Reference or title')
  })

  it('draws nothing to measure for a field without a short placeholder', async () => {
    lay(81)
    const input = await field({ shortPlaceholder: '' })
    expect(input.attributes('placeholder')).toBe('Reference or title')
    expect(document.querySelector('.placeholder-ghost')).toBeNull()
  })
})
