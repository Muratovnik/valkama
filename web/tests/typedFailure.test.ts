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

// The words are the catalog's to edit. What holds is that a failure reads in the reader's
// language, and that only a failure the catalog does not name shows its technical code.
const LANGUAGE = { en: /^(?!.*\p{Script=Cyrillic}).*\p{L}/su, ru: /\p{Script=Cyrillic}/u }

function ownCopy(code: string) {
  for (const locale of ['en', 'ru'] as const) {
    const text = localized(locale, code)
    assert.match(text, LANGUAGE[locale], `${locale}: «${text}»`)
    assert.ok(!text.includes(code), `${locale}: «${text}» shows its code`)
  }
}

test('known failures have their own copy in English and Russian', () => {
  ownCopy('stream_disconnected')
})

test('unknown failures expose only a bounded stable technical code in both locales', () => {
  for (const locale of ['en', 'ru'] as const) {
    const text = localized(locale, 'adapter_timeout')
    assert.match(text, LANGUAGE[locale], `${locale}: «${text}»`)
    assert.ok(text.includes('adapter_timeout'), `${locale}: «${text}» hides the code`)
    // Every unknown code reads as one sentence; only the code in it differs.
    assert.equal(
      text.replace('adapter_timeout', '…'),
      localized(locale, 'sync_lost').replace('sync_lost', '…'),
      locale,
    )
  }
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
  ownCopy('not_found')
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

test('a bare unavailable code without a ui state is typed, so the raw word never reaches the panel', () => {
  const missing = typedFailure(
    Object.assign(new Error('no space'), { status: 404, code: 'unavailable' }),
  )
  assert.deepEqual(missing, { code: 'not_found', status: 404, retryable: false })
  const down = typedFailure(
    Object.assign(new Error('binding'), { status: 409, code: 'unavailable' }),
  )
  assert.deepEqual(down, { code: 'dependency_unavailable', status: 409, retryable: false })
  assert.equal(failureMessage(down).key, 'platform.failures.dependencyUnavailable')
})

test('a store another build wrote is worded in both languages and offers no retry', () => {
  const expected = { code: 'store_schema_mismatch', status: 409, retryable: false }
  // The card's exact read answers in the ui state, the space's read in an error envelope.
  assert.deepEqual(
    typedFailure(
      Object.assign(new Error('store_schema_mismatch'), {
        status: 409,
        state: {
          interface_version: 'valkama-ui-state',
          status: 'unavailable',
          reason: 'store_schema_mismatch',
        },
      }),
      'work_item_request_failed',
    ),
    expected,
  )
  assert.deepEqual(
    typedFailure(Object.assign(new Error('x'), { status: 409, code: 'store_schema_mismatch' })),
    expected,
  )
  assert.match(localized('en', 'store_schema_mismatch'), /another version of Valkama/u)
  assert.match(localized('ru', 'store_schema_mismatch'), /другая версия Valkama/u)
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
