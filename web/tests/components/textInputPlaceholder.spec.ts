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

/** A resize observer that has not been told anything yet. */
class SilentObserver {
  static readonly targets: Element[] = []
  observe(target: Element) {
    SilentObserver.targets.push(target)
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

/** A field mounted where the fonts are long ready and no observer has said anything yet. */
async function quietField() {
  vi.stubGlobal('ResizeObserver', SilentObserver)
  vi.stubGlobal('FontFaceSet', undefined)
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  })
  const reads = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(0)
  const wrapper = mount(VTextInput, {
    attachTo: document.body,
    props: {
      label: 'Filter work',
      modelValue: '',
      placeholder: 'Reference or title',
      shortPlaceholder: 'Search',
    },
  })
  await flushPromises()
  return { reads, wrapper }
}

describe('when a field reads its boxes', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts')
    SilentObserver.targets.length = 0
  })

  it('reads nothing on a schedule of its own, only when an observer reports', async () => {
    // A reading right after mounting lands on whatever else that render drew:
    // a thousand new rows of a list, all laid out for one placeholder.
    const { reads } = await quietField()
    expect(reads).not.toHaveBeenCalled()
  })

  it('watches the whole placeholder too, so words or fonts that change its width are read', async () => {
    const { wrapper } = await quietField()
    expect(SilentObserver.targets).toContain(wrapper.get('input').element)
    expect(SilentObserver.targets).toContain(wrapper.get('.placeholder-ghost').element)
  })
})

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
