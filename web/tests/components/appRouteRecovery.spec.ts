import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppRouteRecovery from '@/app/components/AppRouteRecovery.vue'

import { messages } from '@/shared/i18n/index.ts'

function mountRecovery(props: InstanceType<typeof AppRouteRecovery>['$props']) {
  return mount(AppRouteRecovery, {
    props,
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
    },
  })
}

describe('route recovery actions', () => {
  it('offers home for a route failure without rendering a no-op retry', () => {
    const wrapper = mountRecovery({ failure: 'Invalid route', pending: false, unavailable: null })
    expect(wrapper.text()).toContain('Go to Planning')
    expect(wrapper.text()).not.toContain('Retry')
  })

  it('localizes typed module failures without presenting raw diagnostic detail', () => {
    const wrapper = mountRecovery({
      failure: {
        code: 'request_failed',
        detail: 'DISTINCT backend prose C:\\private\\module.log',
        retryable: true,
        status: 500,
      },
      pending: false,
      unavailable: null,
    })

    expect(wrapper.text()).toContain('The local service did not complete the request.')
    expect(wrapper.text()).not.toContain('DISTINCT backend prose')
    expect(wrapper.text()).not.toContain('module.log')
  })

  it('offers registered modules for unavailable routes without rendering a no-op retry', () => {
    const wrapper = mountRecovery({
      failure: '',
      pending: false,
      unavailable: {
        input_module_id: 'missing',
        input_scope: { kind: 'global' },
        reason: 'unknown-module',
        recovery: { available_modules: ['planning', 'sessions'], kind: 'choose-module' },
        status: 'unavailable',
      },
    })
    expect(wrapper.findAll('.recovery-choice')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('Retry')
  })
})
