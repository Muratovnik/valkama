import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InstallationHealth from '@/widgets/settings-registry/components/InstallationHealth.vue'

import { fetchDoctorReport } from '@/shared/api/doctorApi.ts'
import type { DoctorReport } from '@/shared/api/doctorApi.ts'
import { messages } from '@/shared/i18n/index.ts'

vi.mock('@/shared/api/doctorApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/doctorApi.ts')>()),
  fetchDoctorReport: vi.fn(),
}))

const report: DoctorReport = {
  checked_at: '2026-08-24T08:30:00Z',
  interface_version: 'valkama-doctor',
  levels: [
    {
      checks: [
        {
          detail: 'Schema 5 is supported by this build',
          fix: '',
          id: 'store-schema',
          presentation: {
            code: 'store-schema-supported',
            parameters: { path: 'C:\\private\\valkama.sqlite3', stored: 5 },
          },
          status: 'ok',
          title: 'Store schema raw title',
        },
      ],
      id: 'installation',
      status: 'ok',
      title: 'Installation raw title',
    },
  ],
  status: 'ok',
  summary: { fail: 0, ok: 1, unknown: 0, warn: 0 },
}

function mountHealth() {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  return mount(InstallationHealth, { global: { plugins: [i18n] } })
}

describe('InstallationHealth resource state', () => {
  beforeEach(() => {
    vi.mocked(fetchDoctorReport).mockReset()
  })

  it('keeps a canonical doctor path out of the generic panel payload and rendered copy', async () => {
    vi.mocked(fetchDoctorReport).mockResolvedValueOnce(report)
    const wrapper = mountHealth()
    await flushPromises()

    expect(wrapper.find('.health-summary').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('C:\\private\\valkama.sqlite3')
  })

  it('retains the accepted report when a background recheck fails', async () => {
    vi.mocked(fetchDoctorReport)
      .mockResolvedValueOnce(report)
      .mockRejectedValueOnce(new Error('private transport failure'))
    const wrapper = mountHealth()
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.health-summary').exists()).toBe(true)
    expect(wrapper.get('.platform-state-banner').text()).toContain(
      'The new check failed. The previous report remains below.',
    )
    expect(wrapper.text()).not.toContain('private transport failure')
  })

  it('uses the common state panel for a cold-load failure', async () => {
    vi.mocked(fetchDoctorReport).mockRejectedValueOnce(new Error('C:\\private\\failure.log'))
    const wrapper = mountHealth()
    await flushPromises()

    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('The health report could not be loaded')
    expect(wrapper.text()).not.toContain('C:\\private\\failure.log')
  })
})
