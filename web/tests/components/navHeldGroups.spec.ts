/**
 * The groups under the list of work going on now wait for its first frame, and only for as
 * long as it can still come: a lost connection, which may bring none, draws them, and so does
 * a folded list, which takes no room. The browser spec `production-startup-chrome.spec.ts`
 * measures the rail itself; this holds the conditions.
 */
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'

import { planningTargetRoute } from '@/shared/api/planningTarget.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { useLiveWorkStore } from '@/shared/stores/liveWorkStore.ts'

import { busyFrame } from '../support/liveFrame.ts'

const SCOPE = '123e4567-e89b-42d3-a456-426614174000'

function target(place: { key: string; reference: string | null }) {
  if (place.reference === null) return null
  return planningTargetRoute({
    space_ref: { data_scope_id: SCOPE, space_key: place.key },
    reference: place.reference,
    writable: true,
  })
}

function mountRail(connection: 'connecting' | 'live' | 'reconnecting') {
  return mount(AppNav, {
    attachTo: document.body,
    props: {
      active: 'planning',
      connection,
      liveTarget: target,
      modules: OFFLINE_MODULE_FALLBACK,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })],
    },
  })
}

/** The headings of the groups held back, by the words they show. */
const held = (wrapper: ReturnType<typeof mountRail>) =>
  wrapper.findAll('.nav-held .nav-group-heading').map((heading) => heading.text())

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the groups under the list of work going on now', () => {
  it('wait for the first frame, and are drawn once it comes', async () => {
    const wrapper = mountRail('connecting')
    expect(held(wrapper)).toEqual(['Understand', 'Capabilities'])
    useLiveWorkStore().accept(busyFrame())
    await flushPromises()
    expect(held(wrapper)).toEqual([])
    wrapper.unmount()
  })

  it('are drawn when the connection is lost before any frame', async () => {
    const wrapper = mountRail('connecting')
    expect(held(wrapper)).not.toEqual([])
    await wrapper.setProps({ connection: 'reconnecting' })
    expect(held(wrapper)).toEqual([])
    wrapper.unmount()
  })

  it('wait for nothing under a folded list', () => {
    localStorage.setItem('valkama-nav-open', JSON.stringify({ work: false }))
    const wrapper = mountRail('connecting')
    expect(held(wrapper)).toEqual([])
    wrapper.unmount()
  })

  it('leave the groups above the list and «Work» itself drawn', () => {
    const wrapper = mountRail('connecting')
    expect(wrapper.find('.nav-live-group').classes()).not.toContain('nav-held')
    wrapper.unmount()
  })
})
