import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ImprovementCaseDetail from '@/widgets/improvement-case/components/ImprovementCaseDetail.vue'

import { messages } from '@/shared/i18n/index.ts'

import { improvementCase, improvementEvalRun, improvementJob } from '../support/improvements.ts'

const evalRun = improvementEvalRun(9, { git_ref: 'abc123', job_id: 17 })

function mountDetail(
  item = improvementCase('personal', 1, { eval_runs: [evalRun] }),
  jobs = [improvementJob(17, 'personal', { kind: 'eval', state: 'succeeded' })],
) {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  return mount(ImprovementCaseDetail, {
    props: { item, jobs },
    global: { plugins: [i18n] },
  })
}

describe('ImprovementCaseDetail canonical presentation', () => {
  it('leaves absent monitoring and unlinked evaluation state absent', () => {
    const wrapper = mountDetail(
      improvementCase('personal', 1, {
        eval_runs: [{ ...evalRun, job_id: null }],
        monitoring: null,
      }),
      [],
    )

    expect(wrapper.text()).toContain('Not started')
    expect(wrapper.text()).toContain('abc123')
    expect(wrapper.find('.evaluation-run-state').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Unknown')
    expect(wrapper.text()).not.toContain('0 days')
  })

  it('derives monitoring age and evaluation state from canonical timestamps and jobs', () => {
    const wrapper = mountDetail(
      improvementCase('personal', 1, {
        eval_runs: [evalRun],
        monitoring: {
          baseline_rate: 0.25,
          case_id: 1,
          comparable_sessions: 7,
          high_critical_count: 1,
          recurrence_count: 2,
          started_at: '2026-01-01T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
        },
      }),
    )

    expect(wrapper.text()).toContain('7 comparable sessions · 3 days')
    expect(wrapper.get('.evaluation-run-state').text()).toBe('Passed')
  })
})
