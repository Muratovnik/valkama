import assert from 'node:assert/strict'

import { createI18n } from 'vue-i18n'

import { test } from 'vitest'

import { failureMessage, failureMessageKey, typedFailure } from '@/shared/api/typedFailure.ts'
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

test('a missing record is not offered again and says so in both locales', () => {
  const missing = typedFailure(
    Object.assign(new Error('no work item MAIN-12'), { status: 404, code: 'not_found' }),
  )
  assert.deepEqual(missing, { code: 'not_found', status: 404, retryable: false })
  assert.equal(
    localized('en', 'not_found'),
    'There is no such record: it was deleted, or the address points elsewhere.',
  )
  assert.equal(
    localized('ru', 'not_found'),
    'Такой записи нет: её удалили или адрес указывает не туда.',
  )
})

function unavailable(status: number): Error {
  return Object.assign(new Error('Exact work item is unavailable'), {
    status,
    state: {
      interface_version: 'valkama-ui-state',
      status: 'unavailable',
      reason: 'Exact work item is unavailable',
    },
  })
}

test('an exact read answered 404 is a missing record, not a dependency that is down', () => {
  assert.deepEqual(typedFailure(unavailable(404)), {
    code: 'not_found',
    status: 404,
    retryable: false,
  })
  assert.deepEqual(typedFailure(unavailable(409)), {
    code: 'dependency_unavailable',
    status: 409,
    retryable: false,
  })
})

test('a key alone never leads to the unknown sentence with its technical code left empty', () => {
  const unknown = { code: 'internal', status: 500, retryable: true }
  assert.equal(failureMessageKey(unknown), 'platform.failures.requestFailed')
  assert.equal(failureMessage(unknown).params?.code, 'internal')
  const known = { code: 'not_found', status: 404, retryable: false }
  assert.equal(failureMessageKey(known), 'platform.failures.notFound')
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
