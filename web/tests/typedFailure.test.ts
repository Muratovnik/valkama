import assert from 'node:assert/strict'

import { createI18n } from 'vue-i18n'

import { test } from 'vitest'

import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import { messages } from '@/shared/i18n/index.ts'

function localized(locale: 'en' | 'ru', code: string): string {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  const failure = failureMessage({ code, status: null, retryable: true })
  return i18n.global.t(failure.key, failure.params ?? {})
}

test('known failures have stable English and Russian copy', () => {
  assert.equal(localized('en', 'stream_disconnected'), 'Live session updates were interrupted.')
  assert.equal(localized('ru', 'stream_disconnected'), 'Поток обновлений сессий прерван.')
})

test('unknown failures expose only a bounded stable technical code in both locales', () => {
  assert.equal(
    localized('en', 'adapter_timeout'),
    'The request failed (technical code: adapter_timeout).',
  )
  assert.equal(
    localized('ru', 'adapter_timeout'),
    'Запрос завершился ошибкой (технический код: adapter_timeout).',
  )
  assert.equal(
    failureMessage({ code: '<script>private path</script>', status: null, retryable: true }).params
      ?.code,
    'unknown_failure',
  )
})

test('permission and contract failures are typed without preserving backend prose', () => {
  const denied = typedFailure(Object.assign(new Error('private backend prose'), { status: 403 }))
  assert.deepEqual(denied, { code: 'permission_denied', status: 403, retryable: false })

  const contract = typedFailure(
    Object.assign(new Error('C:/private/path: expected object'), {
      code: 'session_contract_invalid',
    }),
  )
  assert.deepEqual(contract, { code: 'contract_invalid', status: null, retryable: true })
})
