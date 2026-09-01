/**
 * Schema building blocks for the Platform wire contracts.
 *
 * The strictness is the contract, not a convenience: a payload with an unknown
 * field is rejected rather than trimmed, because the server rejects the same
 * shape on its side. Zod expresses the shapes; this module keeps the refusal
 * vocabulary the tests and the backend already speak — `path: detail`, with
 * `unknown field` and `missing field` naming the exact key.
 */

import { z } from 'zod'

export type Refusal = (path: string, detail: string) => never

/** A plain-JSON object. Class instances never arrive over the wire, and a
 *  prototype that is not Object's is a sign the value did not come from JSON. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const plainObject = z.custom<Record<string, unknown>>(isPlainObject, {
  message: 'expected plain object',
})

/**
 * An object with exactly the declared keys, and nothing but plain JSON around
 * them. `.strict()` alone rejects extra keys but accepts a class instance whose
 * shape happens to match, which is not what arrives over this wire.
 */
export function strictObject<T extends z.ZodRawShape>(shape: T) {
  // An absent key is undefined, and the schema below names that a missing
  // field. Only a value that is actually present has to be plain JSON.
  const present = z.custom<Record<string, unknown> | undefined>(
    (value) => value === undefined || isPlainObject(value),
    { message: 'expected plain object' },
  )
  return present.pipe(z.object(shape).strict())
}

export function boundedText(pattern: RegExp, max = 240) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => pattern.test(value), { message: 'expected bounded string' })
}

const UNSAFE_TEXT = /<[^>]*>|\b(?:javascript|data|file)\s*:/iu

/** Free text that reaches a view: bounded, and never markup or a scheme. */
export function safeText(max = 512) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !UNSAFE_TEXT.test(value), { message: 'expected safe bounded text' })
}

export function positiveInt(allowZero = false) {
  return z
    .number()
    .int()
    .refine((value) => Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1), {
      message: 'expected positive integer',
    })
}

/**
 * A card's epic, or none. One refusal names both shapes, because a value that
 * fails is usually neither — while an absent key stays a missing field.
 */
export function nullablePositiveInt() {
  const shape = z.custom<number | null | undefined>(
    (value) =>
      value === undefined ||
      value === null ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1),
    { message: 'expected null or positive integer' },
  )
  return shape.pipe(positiveInt().nullable())
}

export function boundedList<T extends z.ZodTypeAny>(item: T, max = 500) {
  return z.array(item).max(max, { message: 'expected bounded array' })
}

export function uniqueList<T extends z.ZodTypeAny>(item: T, max = 500) {
  return boundedList(item, max).refine((values) => new Set(values).size === values.length, {
    message: 'duplicate value',
  })
}

/**
 * Lift a path-aware validator that already exists — board refs, operating
 * scopes, UI state — into a schema. Its own refusal detail is re-raised at the
 * position the surrounding schema is validating, so the composed message reads
 * exactly as it did when the whole chain was hand-written.
 */
export function fromValidator<T>(validate: (value: unknown, path: string) => T) {
  return z.unknown().transform((value, ctx) => {
    try {
      return validate(value, 'value')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const detail = message.slice(message.indexOf(': ') + 2)
      ctx.addIssue({ code: 'custom', message: detail })
      return z.NEVER as never as T
    }
  })
}

function detailFor(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys') return 'unknown field'
  if (issue.code === 'invalid_type' && issue.input === undefined) return 'missing field'
  if (issue.code === 'invalid_union') return 'unknown value'
  return issue.message
}

function pathFor(base: string, issue: z.core.$ZodIssue): string {
  const segments = issue.path.map((part) =>
    typeof part === 'number' ? `[${part}]` : `.${String(part)}`,
  )
  const own = issue.code === 'unrecognized_keys' && issue.keys.length ? `.${issue.keys[0]}` : ''
  return `${base}${segments.join('')}${own}`.replaceAll('.[', '[')
}

/**
 * Validate against a schema, reporting the first refusal in the caller's own
 * error type. The first issue is enough: the contract is all-or-nothing, and a
 * list of consequences from one bad field reads worse than the field itself.
 */
export function parseContract<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  path: string,
  invalid: Refusal,
): z.infer<T> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  return invalid(pathFor(path, issue), detailFor(issue))
}

export { z } from 'zod'
