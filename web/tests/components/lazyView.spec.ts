import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'
import { lazyView } from '@/shared/ui/lazyView.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })

/** A stand-in for the downloaded view: it shows the prop it was handed and calls back. */
const Downloaded = defineComponent({
  props: { label: { type: String, required: true } },
  emits: ['pick'],
  setup(props, { emit, slots }) {
    return () =>
      h('button', { class: 'downloaded', onClick: () => emit('pick', props.label) }, [
        props.label,
        slots.default?.(),
      ])
  },
})

/** A loader the test settles by hand, counting how often the network was asked. */
function controlledLoader() {
  const calls: { reject: (error: Error) => void; resolve: () => void }[] = []
  const loader = vi.fn(
    () =>
      new Promise<{ default: typeof Downloaded }>((resolve, reject) => {
        calls.push({ resolve: () => resolve({ default: Downloaded }), reject })
      }),
  )
  return { calls, loader }
}

function mountView(component: object, onPick = vi.fn()) {
  return mount(component, {
    global: { plugins: [i18n] },
    props: { label: 'Graph', onPick },
    slots: { default: () => ' slot' },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a lazy view downloads on demand without blanking or flickering', () => {
  it('shows nothing during a fast download, then the view with its props, slots and listeners', async () => {
    const { calls, loader } = controlledLoader()
    const view = lazyView(loader)
    const onPick = vi.fn()
    const wrapper = mountView(view.component, onPick)

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
    calls[0]?.resolve()
    await flushPromises()
    vi.advanceTimersByTime(LOADING_DELAY_MS)
    await flushPromises()

    expect(view.ready.value).toBe(true)
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    expect(wrapper.get('.downloaded').text()).toBe('Graph slot')
    await wrapper.get('.downloaded').trigger('click')
    expect(onPick).toHaveBeenCalledWith('Graph')
  })

  it('announces a download that outlasts the delay with the shared loading panel', async () => {
    const { calls, loader } = controlledLoader()
    const wrapper = mountView(lazyView(loader).component)

    vi.advanceTimersByTime(LOADING_DELAY_MS - 1)
    await flushPromises()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(wrapper.get('[aria-busy="true"]').text()).toContain('Loading')

    // Shown, it stays long enough to be read, however soon the download lands after it.
    calls[0]?.resolve()
    await flushPromises()
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS - 1)
    await flushPromises()
    expect(wrapper.get('[aria-busy="true"]').text()).toContain('Loading')
    expect(wrapper.find('.downloaded').exists()).toBe(false)
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    expect(wrapper.find('.downloaded').exists()).toBe(true)
  })

  it('a download that lands well after the panel appeared shows the view at once', async () => {
    const { calls, loader } = controlledLoader()
    const wrapper = mountView(lazyView(loader).component)
    vi.advanceTimersByTime(LOADING_DELAY_MS + LOADING_MIN_SHOWN_MS)
    await flushPromises()
    expect(wrapper.get('[aria-busy="true"]').text()).toContain('Loading')
    calls[0]?.resolve()
    await flushPromises()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)
    expect(wrapper.find('.downloaded').exists()).toBe(true)
  })

  // The delay counts from the download, not from the mount: a view drawn once its download
  // has run that long, as the graph is after the workspace held its stage, says so at once.
  it('a view drawn after its download has run for the delay says at once that it is loading', async () => {
    const { calls, loader } = controlledLoader()
    const late = lazyView(loader)
    late.prefetch()
    vi.advanceTimersByTime(LOADING_DELAY_MS)
    const wrapper = mountView(late.component)
    expect(wrapper.get('[aria-busy="true"]').text()).toContain('Loading')
    calls[0]?.resolve()
    await flushPromises()
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS)
    await flushPromises()
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(false)

    // Drawn part way through, it waits only what is left of the delay.
    const second = controlledLoader()
    const early = lazyView(second.loader)
    early.prefetch()
    vi.advanceTimersByTime(LOADING_DELAY_MS - 50)
    const partway = mountView(early.component)
    expect(partway.find('[aria-busy="true"]').exists()).toBe(false)
    vi.advanceTimersByTime(49)
    await flushPromises()
    expect(partway.find('[aria-busy="true"]').exists()).toBe(false)
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(partway.get('[aria-busy="true"]').text()).toContain('Loading')
  })

  it('reports a failed download with Retry, and Retry asks the network again', async () => {
    const { calls, loader } = controlledLoader()
    const wrapper = mountView(lazyView(loader).component)

    calls[0]?.reject(new Error('Failed to fetch dynamically imported module'))
    await flushPromises()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Could not load this view')
    expect(alert.text()).toContain('This part of the interface did not download.')
    // A late timer from the failed attempt must not turn the failure back into a wait.
    vi.advanceTimersByTime(LOADING_DELAY_MS * 2)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await alert.get('button').trigger('click')
    expect(loader).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    calls[1]?.resolve()
    await flushPromises()
    expect(wrapper.get('.downloaded').text()).toBe('Graph slot')
  })

  // A failure was drawn with the information glyph every other status borrows; the
  // card now carries the danger tone and the danger mark, and no glyph of its own.
  it('draws a failed download as a failure, not as information', async () => {
    const { calls, loader } = controlledLoader()
    const wrapper = mountView(lazyView(loader).component)

    calls[0]?.reject(new Error('Failed to fetch dynamically imported module'))
    await flushPromises()
    const alert = wrapper.get('[role="alert"]')
    expect(alert.attributes('data-tone')).toBe('danger')
    expect(alert.find('svg').exists()).toBe(false)
  })

  it('shares one download between a prefetch and the mount that follows it', async () => {
    const { calls, loader } = controlledLoader()
    const view = lazyView(loader)

    view.prefetch()
    view.prefetch()
    const wrapper = mountView(view.component)
    expect(loader).toHaveBeenCalledTimes(1)
    calls[0]?.resolve()
    await flushPromises()
    expect(wrapper.find('.downloaded').exists()).toBe(true)

    // Once resident, a new mount draws the view at once without asking again.
    const second = mountView(view.component)
    expect(second.find('.downloaded').exists()).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed prefetch, so the view that mounts later downloads afresh', async () => {
    const { calls, loader } = controlledLoader()
    const view = lazyView(loader)

    view.prefetch()
    calls[0]?.reject(new Error('offline'))
    await flushPromises()
    const wrapper = mountView(view.component)
    expect(loader).toHaveBeenCalledTimes(2)
    calls[1]?.resolve()
    await flushPromises()
    expect(wrapper.find('.downloaded').exists()).toBe(true)
  })
})
