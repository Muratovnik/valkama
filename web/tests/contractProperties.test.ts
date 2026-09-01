/**
 * Properties of the wire-contract building blocks.
 *
 * The example tests state what these schemas do for the payloads the product
 * sends. These state what they must do for every payload, which is the half an
 * example cannot reach: a validator is a boundary, and the inputs that matter
 * most at a boundary are the ones nobody thought to write down.
 *
 * The arbitraries are written by hand on purpose. The zod-to-fast-check bridge
 * stopped at fast-check 3, and generating from the schema under test would only
 * prove the generator and the schema agree with each other.
 */

import { fc, test } from '@fast-check/vitest'
import { expect } from 'vitest'

// Fixed, for the reason `tests/property_settings.py` gives on the Python side:
// there is no CI here, so the gate is a person running a command, and a run
// that is red on Tuesday and green on Wednesday against the same tree teaches
// re-running rather than reading. A seed that moves also hides which change
// broke something. New cases arrive when the code or an arbitrary changes.
fc.configureGlobal({ seed: 0x48_55_42_21 })

import {
  boundedList,
  boundedText,
  nullablePositiveInt,
  plainObject,
  positiveInt,
  safeText,
  strictObject,
  uniqueList,
} from '@/shared/api/contract.ts'

/** Anything that can arrive from JSON.parse, including the awkward shapes. */
const jsonValue = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noDefaultInfinity: true, noNaN: true }),
    fc.string(),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string(), tie('value'), { maxKeys: 4 }),
  ),
})).value

test.prop([fc.dictionary(fc.string(), jsonValue, { maxKeys: 6 })])(
  'a plain object is accepted however deep or empty it is',
  (object) => {
    expect(plainObject.safeParse(object).success).toBe(true)
  },
)

test.prop([fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))])(
  'nothing that is not an object passes plainObject',
  (value) => {
    expect(plainObject.safeParse(value).success).toBe(false)
  },
)

test.prop([fc.array(jsonValue, { maxLength: 4 })])(
  'an array is never a plain object, whatever it holds',
  (values) => {
    expect(plainObject.safeParse(values).success).toBe(false)
  },
)

test.prop([fc.string({ minLength: 1, maxLength: 40 }), fc.string({ minLength: 1, maxLength: 8 })])(
  'strictObject accepts exactly its declared key and refuses any addition',
  (declared, extra) => {
    fc.pre(declared !== extra)
    const schema = strictObject({ [declared]: boundedText(/^[a-z]+$/u, 40) })
    expect(schema.safeParse({ [declared]: 'value' }).success).toBe(true)
    expect(schema.safeParse({ [declared]: 'value', [extra]: 'more' }).success).toBe(false)
  },
)

test.prop([fc.string({ minLength: 1, maxLength: 20 })])(
  'a class instance never passes strictObject, whatever shape it has',
  (key) => {
    // The reason strictObject is not just `.strict()`: an instance whose fields
    // match is still not something that came off this wire.
    class Impostor {
      constructor(readonly field: string) {}
    }
    const schema = strictObject({ [key]: boundedText(/^[a-z]+$/u, 40) })
    const instance = new Impostor('value') as unknown as Record<string, unknown>
    instance[key] = 'value'
    expect(schema.safeParse(instance).success).toBe(false)
  },
)

test.prop([fc.string(), fc.integer({ min: 1, max: 64 })])(
  'boundedText accepts a string exactly when it is in range and matches',
  (value, max) => {
    const pattern = /^[a-z]+$/u
    const schema = boundedText(pattern, max)
    const expected = value.length >= 1 && value.length <= max && pattern.test(value)
    expect(schema.safeParse(value).success).toBe(expected)
  },
)

test.prop([fc.string({ minLength: 1, maxLength: 200 })])(
  'safeText never accepts markup, wherever it sits in the text',
  (filler) => {
    expect(safeText(512).safeParse(`${filler}<b>${filler}`.slice(0, 512)).success).toBe(false)
  },
)

const safeFiller = fc.stringMatching(/^[A-Za-z0-9 ]{1,200}$/)

test.prop([safeFiller])('safeText rejects a scheme that starts a word, and only then', (filler) => {
  // What the property established: the pattern is anchored on a word
  // boundary, so `data:` is refused where a scheme could actually begin and
  // `xdata:` is not. That is the intent — otherwise every word ending in
  // "data" before a colon would be refused — and it is worth stating,
  // because reading the regex alone does not make it obvious.
  const schema = safeText(512)
  expect(schema.safeParse(`${filler} data:x`).success).toBe(false)
  expect(schema.safeParse(`${filler}xdata:x`).success).toBe(true)
})

test.prop([fc.integer()])(
  'positiveInt draws the line at one, and zero only on request',
  (value) => {
    expect(positiveInt().safeParse(value).success).toBe(value >= 1)
    expect(positiveInt(true).safeParse(value).success).toBe(value >= 0)
  },
)

test.prop([fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined))])(
  'nullablePositiveInt admits null and one upwards, and nothing else',
  (value) => {
    // Not undefined: an absent key is a missing field, which the object schema
    // around this one names. Nullable is not optional, and the property is what
    // made the difference explicit.
    expect(nullablePositiveInt().safeParse(value).success).toBe(
      value !== null && value !== undefined ? value >= 1 : value === null,
    )
  },
)

test.prop([fc.array(fc.integer({ min: 1, max: 20 }), { maxLength: 30 })])(
  'uniqueList accepts exactly the lists boundedList accepts and no duplicate',
  (values) => {
    const bounded = boundedList(positiveInt(), 30).safeParse(values).success
    const unique = uniqueList(positiveInt(), 30).safeParse(values).success
    expect(unique).toBe(bounded && new Set(values).size === values.length)
  },
)
