import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  choiceValueCodec,
  decodeChoiceValue,
  encodeChoiceValue,
} from '@/shared/ui/choiceControls.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'

const options: ChoiceOption[] = [
  { value: '', label: 'All' },
  { value: '__empty__', label: 'Literal sentinel-like value' },
  { value: 'клиент / tool:read', label: 'Unicode and symbols' },
]

test('choice values use non-empty injective tokens, including the logical empty value', () => {
  const codec = choiceValueCodec(options)
  const tokens = options.map((option) => encodeChoiceValue(codec, option.value))
  assert.ok(tokens.every(Boolean))
  assert.equal(new Set(tokens).size, options.length)
  for (const option of options) {
    assert.equal(decodeChoiceValue(codec, encodeChoiceValue(codec, option.value)), option.value)
  }
})

test('choice decoding accepts only tokens from the current option set', () => {
  const codec = choiceValueCodec(options)
  assert.equal(decodeChoiceValue(codec, 'choice:999'), null)
  assert.equal(decodeChoiceValue(codec, ''), null)
  assert.equal(encodeChoiceValue(codec, 'stale'), null)
})

test('choice tokens remain value-owned when options are reordered', () => {
  const first = choiceValueCodec(options)
  const second = choiceValueCodec([...options].reverse())
  for (const option of options) {
    assert.equal(encodeChoiceValue(first, option.value), encodeChoiceValue(second, option.value))
  }
})
