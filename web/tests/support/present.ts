/**
 * The value, or a failure that names what was missing.
 *
 * `expect(x).not.toBeNull()` proves it to the reader and nothing to the
 * compiler, so every such check used to be followed by a `!` on the next line.
 * This is one statement that does both, and its message says which lookup failed
 * instead of leaving a "cannot read properties of null" to be traced back.
 */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`)
  return value
}
