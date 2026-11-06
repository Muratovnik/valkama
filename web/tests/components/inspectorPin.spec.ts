/**
 * The pin in a card's head: shown once the live-work frame can say whether the item is
 * pinned, filled when it is, and a press that writes the pin and says in the shell's
 * corner what came of it.
 */
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorPin from '@/widgets/work-item-inspector/components/InspectorPin.vue'

import { provideOpenNotice } from '@/features/session-open/openNotice.ts'

import { messages } from '@/shared/i18n/index.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'

import { busyFrame } from '../support/liveFrame.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from '../support/request.ts'

function pin(reference: string) {
  const say = vi.fn()
  const wrapper = mount(
    {
      components: { InspectorPin },
      setup() {
        provideOpenNotice(say)
        return { reference }
      },
      template: '<InspectorPin :reference="reference" />',
    },
    {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages })],
        stubs: { VIcon: true },
      },
    },
  )
  return { say, wrapper }
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

describe('the pin on a card', () => {
  it('is not offered until a frame says whether the item is pinned', async () => {
    const { wrapper } = pin('MAIN-12')
    expect(wrapper.find('button').exists()).toBe(false)
    useLiveWorkStore().accept(busyFrame())
    await flushPromises()
    expect(wrapper.get('button').attributes('aria-label')).toBe('Pin to Work')
    expect(wrapper.get('button').classes()).not.toContain('pinned')
  })

  it('reads a pinned item as pinned, and a press takes the pin off', async () => {
    useLiveWorkStore().accept(busyFrame())
    const unpinned = busyFrame()
    const at = unpinned.spaces[0].rows.findIndex((row) => row.reference === 'MAIN-20')
    unpinned.spaces[0].rows[at] = { ...unpinned.spaces[0].rows[at], pinned: false }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(unpinned)))
    vi.stubGlobal('fetch', withSecurityBootstrap(fetch))
    const { say, wrapper } = pin('MAIN-20')
    const button = wrapper.get('button')
    expect(button.classes()).toContain('pinned')
    expect(button.attributes('aria-label')).toBe('Pinned to Work: press to remove the pin')

    await button.trigger('click')
    await flushPromises()
    const [input, init] = fetch.mock.calls[0]
    expect(requestUrl(input)).toBe('/api/planning/work-item/pin')
    expect(JSON.parse(requestBody(init?.body))).toEqual({ id: 'MAIN-20', pinned: false })
    expect(say).toHaveBeenCalledWith('Pin removed from MAIN-20', 'done')
    expect(wrapper.get('button').classes()).not.toContain('pinned')
  })

  it('says a pin that did not change, and leaves the item as it was', async () => {
    useLiveWorkStore().accept(busyFrame())
    vi.stubGlobal(
      'fetch',
      withSecurityBootstrap(vi.fn(async () => new Response('{}', { status: 500 }))),
    )
    const { say, wrapper } = pin('MAIN-12')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(say).toHaveBeenCalledWith('The pin could not be changed', 'refused')
    expect(wrapper.get('button').classes()).not.toContain('pinned')
  })
})
