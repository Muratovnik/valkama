/**
 * «…» in a card's bar, and the pin it holds: offered once the live-work frame can say whether
 * the item is pinned, checked when it is, and a choice that writes the pin and says in the
 * shell's corner what came of it. The menu itself, its keys and its focus, is `VMenu`'s
 * (`ui-menu.spec.ts`); here it is read through the entries it is handed.
 */
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorMenu from '@/widgets/work-item-inspector/components/InspectorMenu.vue'

import { provideOpenNotice } from '@/features/session-open/openNotice.ts'

import { messages } from '@/shared/i18n/index.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'

import { busyFrame } from '../support/liveFrame.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from '../support/request.ts'

/** The menu as the card hands it over: its name and its entries, each to be chosen. */
const MenuStub = defineComponent({
  name: 'VMenu',
  props: {
    entries: { type: Array as () => MenuEntry[], required: true },
    label: { type: String, required: true },
  },
  template: '<div class="menu-stub" :aria-label="label" />',
})

function menu(reference: string) {
  const say = vi.fn()
  const wrapper = mount(
    {
      components: { InspectorMenu },
      setup() {
        provideOpenNotice(say)
        return { reference }
      },
      template: '<InspectorMenu :reference="reference" />',
    },
    {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages })],
        stubs: { VMenu: MenuStub },
      },
    },
  )
  const pin = () => {
    const [entry] = wrapper.getComponent(MenuStub).props('entries') as MenuEntry[]
    if (entry.kind !== 'toggle') throw new Error('the pin is a setting the menu checks')
    return entry
  }
  return { pin, say, wrapper }
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

describe('the pin in a card’s «…»', () => {
  it('is no menu until a frame says whether the item is pinned', async () => {
    const { pin, wrapper } = menu('MAIN-12')
    expect(wrapper.findComponent(MenuStub).exists()).toBe(false)
    useLiveWorkStore().accept(busyFrame())
    await flushPromises()
    expect(wrapper.getComponent(MenuStub).props('label')).toBe('More')
    expect(pin()).toMatchObject({ label: 'Pin to Work', icon: 'pin', checked: false })
  })

  it('reads a pinned item as checked, and choosing it takes the pin off', async () => {
    useLiveWorkStore().accept(busyFrame())
    const unpinned = busyFrame()
    const at = unpinned.spaces[0].rows.findIndex((row) => row.reference === 'MAIN-20')
    unpinned.spaces[0].rows[at] = { ...unpinned.spaces[0].rows[at], pinned: false }
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(unpinned)))
    vi.stubGlobal('fetch', withSecurityBootstrap(fetch))
    const { pin, say } = menu('MAIN-20')
    expect(pin().checked).toBe(true)

    pin().select(false)
    await flushPromises()
    const [input, init] = fetch.mock.calls[0]
    expect(requestUrl(input)).toBe('/api/planning/work-item/pin')
    expect(JSON.parse(requestBody(init?.body))).toEqual({ id: 'MAIN-20', pinned: false })
    expect(say).toHaveBeenCalledWith('Pin removed from MAIN-20', 'done')
    expect(pin().checked).toBe(false)
  })

  it('says a pin that did not change, and leaves the item as it was', async () => {
    useLiveWorkStore().accept(busyFrame())
    vi.stubGlobal(
      'fetch',
      withSecurityBootstrap(vi.fn(async () => new Response('{}', { status: 500 }))),
    )
    const { pin, say } = menu('MAIN-12')
    pin().select(true)
    await flushPromises()
    expect(say).toHaveBeenCalledWith('The pin could not be changed', 'refused')
    expect(pin().checked).toBe(false)
  })
})
