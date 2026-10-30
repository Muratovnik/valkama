import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InstallationHealth from '@/pages/settings/components/InstallationHealth.vue'

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

function mountHealth(locale = 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
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
  it.each(['en', 'ru'])(
    'names optional journal warnings and preserves required failure severity in %s',
    async (locale) => {
      const data = structuredClone(report)
      data.status = 'fail'
      data.summary = { fail: 1, ok: 0, unknown: 0, warn: 2 }
      data.levels[0].status = 'fail'
      data.levels[0].checks = [
        ...['claude-journal-telemetry', 'codex-rollout-telemetry'].map((adapter) => ({
          id: `adapter-${adapter}`,
          title: adapter,
          status: 'warn' as const,
          detail: `Raw ${adapter} source_not_configured`,
          fix: 'VALKAMA_CODEX_ROLLOUT_ROOT',
          presentation: { code: 'adapter-unconfigured', parameters: { adapter } },
        })),
        {
          id: 'schema',
          title: 'Schema incompatible',
          status: 'fail',
          detail: 'Stored schema too new',
          fix: 'Use newer build',
          presentation: { code: 'store-schema-newer', parameters: { stored: 99, supported: 5 } },
        },
      ]
      vi.mocked(fetchDoctorReport).mockResolvedValueOnce(data)
      const wrapper = mountHealth(locale)
      await flushPromises()
      const findings = wrapper.findAll('.health-finding')
      const warnings = findings.slice(1)
      expect(warnings).toHaveLength(2)
      expect(warnings[0].get('.health-finding-state').text()).toContain(
        locale === 'en' ? 'Claude local journal' : 'Локальный журнал Claude',
      )
      expect(warnings[1].get('.health-finding-state').text()).toContain(
        locale === 'en' ? 'Codex rollout telemetry' : 'Телеметрия Codex rollout',
      )
      for (const warning of warnings) {
        expect(warning.get('.health-detail').text()).toContain(
          locale === 'en' ? 'optional' : 'необязательный',
        )
        expect(warning.get('.health-action').text()).toContain(
          locale === 'en' ? 'only if you want' : 'только если нужны',
        )
        expect(warning.get('.health-finding-state').attributes('data-state')).toBe('degraded')
        expect(warning.get('details').attributes('open')).toBeUndefined()
        expect(warning.get('details').text()).toContain('VALKAMA_CODEX_ROLLOUT_ROOT')
        expect(warning.get('.health-finding-state').text()).not.toContain('-telemetry')
      }
      expect(findings[0].get('.health-finding-state').attributes('data-state')).toBe('unavailable')
      expect(findings[0].get('.health-detail').text()).not.toContain(
        locale === 'en' ? 'optional' : 'необязательный',
      )
    },
  )
  it.each(['en', 'ru'])('names an adapter record the contract refused in %s', async (locale) => {
    const data = structuredClone(report)
    data.status = 'warn'
    data.summary = { fail: 0, ok: 0, unknown: 0, warn: 1 }
    data.levels[0].status = 'warn'
    data.levels[0].checks = [
      {
        id: 'adapter-record-old-adapter',
        title: 'Adapter record old-adapter',
        status: 'warn',
        detail: 'old-adapter.json: unknown field(s): permissions',
        fix: 'valkama adapter install',
        presentation: { code: 'adapter-record-refused', parameters: { adapter: 'old-adapter' } },
      },
    ]
    vi.mocked(fetchDoctorReport).mockResolvedValueOnce(data)
    const wrapper = mountHealth(locale)
    await flushPromises()
    const finding = wrapper.get('.health-finding')
    expect(finding.get('.health-finding-state').text()).toContain('old-adapter')
    expect(finding.get('.health-detail').text()).toContain(
      locale === 'en' ? 'adapter contract' : 'контракту адаптера',
    )
    expect(finding.get('.health-action').text()).toContain(
      locale === 'en' ? 'reinstall' : 'переустановите',
    )
  })
})
