/**
 * Which breakdowns are a list only. The oracle is the owner's rule: the tasks and the sessions are
 * named by free text and drawn as a list, every other dimension by an identifier and drawn as a
 * ring or bars; a pair is free text where either side is.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { FREE_TEXT_DIMENSIONS, namedByText } from '@/pages/analytics/utils/splitView.ts'

import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

const IDENTIFIERS: UsageDimension[] = [
  'account',
  'project',
  'role',
  'model',
  'effort',
  'environment',
  'launch_class',
]

describe('the drawing of a split', () => {
  test('every dimension of the page is one or the other', () => {
    assert.deepEqual(new Set([...IDENTIFIERS, 'work_item', 'executor']), new Set(USAGE_DIMENSIONS))
  })

  test('the dimensions named by free text are the tasks and the sessions', () => {
    assert.deepEqual(FREE_TEXT_DIMENSIONS, new Set(['work_item', 'executor']))
  })

  test('tasks and sessions are a list only, alone or on either side of a pair', () => {
    for (const text of ['work_item', 'executor'] as const) {
      assert.equal(namedByText(text), true, text)
      for (const other of IDENTIFIERS) {
        assert.equal(namedByText(text, other), true, `${text} · ${other}`)
        assert.equal(namedByText(other, text), true, `${other} · ${text}`)
      }
    }
  })

  test('identifiers, and the kinds of tokens, keep their ring', () => {
    assert.equal(namedByText(null), false)
    for (const one of IDENTIFIERS) {
      assert.equal(namedByText(one), false, one)
      assert.equal(namedByText(one, null), false, one)
      for (const other of IDENTIFIERS) assert.equal(namedByText(one, other), false)
    }
  })
})
