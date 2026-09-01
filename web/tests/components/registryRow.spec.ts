/** The row keeps unlike operational facts in named lanes. */

import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RegistryRow from '@/widgets/settings-registry/components/RegistryRow.vue'

import { messages } from '@/shared/i18n/index.ts'

const i18n = createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'en', messages })
const options = { global: { plugins: [i18n] } }

const row = (configuration: string) =>
  mount(RegistryRow, {
    props: { icon: 'check', title: 'Adapter', subtitle: 'adapter.lineage' },
    slots: { configuration },
    ...options,
  })

describe('RegistryRow', () => {
  it('distinguishes availability from enablement inside one aligned control lane', () => {
    const wrapper = mount(RegistryRow, {
      props: {
        icon: 'check',
        title: 'Adapter',
        subtitle: 'adapter.lineage',
      },
      slots: {
        availability: '<span class="available">Available</span>',
        enablement: '<button class="toggle">Enabled</button>',
      },
      ...options,
    })
    const lane = wrapper.get('.registry-control-lane')
    expect(lane.get('.registry-availability .available').text()).toBe('Available')
    expect(lane.get('.registry-enablement .toggle').text()).toBe('Enabled')
    expect(lane.findAll('.registry-lane-label').map((label) => label.text())).toEqual([
      'Доступность',
      'Включение',
    ])
  })

  it('keeps a multi-root configuration inside the same lane', () => {
    const wrapper = row('<span class="badge">active</span><button class="revoke">Revoke</button>')
    const lane = wrapper.get('.registry-control-lane')
    expect(lane.get('.badge').text()).toBe('active')
    expect(lane.get('.revoke').text()).toBe('Revoke')
  })

  it('keeps technical facts collapsed behind a localized disclosure', async () => {
    const wrapper = mount(RegistryRow, {
      props: {
        icon: 'check',
        title: 'Adapter',
        subtitle: 'adapter.lineage',
        details: [{ label: 'Transport', value: 'local-process' }],
      },
      ...options,
    })

    expect(wrapper.get('.registry-details-summary').text()).toBe('Подробнее')
    expect(wrapper.get('.registry-details').attributes('open')).toBeUndefined()
    await wrapper.get('.registry-details-summary').trigger('click')
    expect(wrapper.get('.registry-details').attributes('open')).toBe('')
  })
})
