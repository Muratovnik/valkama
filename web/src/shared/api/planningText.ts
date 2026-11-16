/**
 * The text fields Planning records share: blank-or-bounded text, what the server composes,
 * what a caller wrote about itself, a holder, and an id a client reported.
 */

import { boundedText, z } from '@/shared/api/contract.ts'

/**
 * A field that may be blank, which several of these are: an unheld item has no
 * claim, an item raised by hand has no source, an event needs no detail.
 * `boundedText` requires one character, so blank needs its own reader rather
 * than a pattern pretending an empty string is a value.
 */
export function blankable(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => !/\u{0}/u.test(value), { message: 'expected bounded string' })
}

/**
 * Text the server composes itself (a warning, a refusal joining its guards),
 * which no write bounds: present and free of NUL, at whatever length it runs.
 */
export const serverText = () =>
  z
    .string()
    .min(1)
    .refine((value) => !/\u{0}/u.test(value), { message: 'expected text' })

/** Free text an agent wrote about itself, bounded and never resolved. */
export const actor = () => blankable(128)
/** A holder that is somebody: `claim_ref` as it reads while the item is held. */
export const holderField = () => boundedText(/^[^\u{0}]{1,128}$/u, 128)
/** A client-reported id, never resolved here; the server bounds it at 200. */
export const callField = () => blankable(200).nullable()
