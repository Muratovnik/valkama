import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SkillsView from '@/pages/skills/components/SkillsView.vue'

import { messages } from '@/shared/i18n/index'

import { skillMatrixPayload, skillsPayload } from '../browser/skillsFixtures.ts'

function skillsFetch() {
  return vi.fn(async (url: string) =>
    url.startsWith('/api/modules/skills/matrix')
      ? new Response(JSON.stringify(skillMatrixPayload))
      : new Response(JSON.stringify(skillsPayload)),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Skills route state', () => {
  it('renders only route-owned state after an update and a remount', async () => {
    vi.stubGlobal('fetch', skillsFetch())
    const i18n = createI18n({ legacy: false, locale: 'en', messages })
    const initial = { query: 'review', status: 'enabled', view: 'matrix' }
    const wrapper = mount(SkillsView, {
      props: initial,
      global: { plugins: [i18n] },
    })
    await flushPromises()

    expect(wrapper.find('.skill-matrix').exists()).toBe(true)
    await wrapper.setProps({ query: 'missing', status: 'issues', view: 'catalog', skill: '' })
    expect(wrapper.get('input[type="search"]').element).toHaveProperty('value', 'missing')
    expect(wrapper.get('.choice-trigger').text()).toContain('Needs attention')
    expect(wrapper.findAll('.skill-row')).toHaveLength(0)

    await wrapper.get('input[type="search"]').setValue('review')
    expect(wrapper.emitted('state')?.at(-1)).toEqual([{ query: 'review', status: 'issues' }])

    wrapper.unmount()
    const reloaded = mount(SkillsView, {
      props: initial,
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(reloaded.find('.skill-matrix').exists()).toBe(true)
    expect(reloaded.findAll('.segmented-option')[1].attributes('aria-pressed')).toBe('true')
    reloaded.unmount()
  })
})
