/**
 * The palette as a test reads it: a token's value as `tokens.css` resolves it, and the colour
 * science that judges one colour against another. The thresholds a test holds are WCAG's and
 * OKLab's; the colour-vision matrices are Machado, Oliveira and Fernandes (2009) at full
 * severity. None of it is the product's own arithmetic, so a test that uses it checks the
 * palette against an outside measure rather than against itself.
 */
import assert from 'node:assert/strict'

// @ts-expect-error - the generator is a plain script, and it is what reads the stylesheet.
import { readTokens } from '../scripts/sync-tokens.mjs'

const tokens = readTokens() as Map<string, { declared: string; value: string }>

export const token = (name: string) => {
  const found = tokens.get(name)
  assert.ok(found, `${name} is missing from tokens.css`)
  return found.value
}

const longHex = (hex: string) => (hex.length === 4 ? hex.replaceAll(/[0-9a-f]/giu, '$&$&') : hex)

export const linear = (hex: string) =>
  [1, 3, 5].map((start) => {
    const unit = Number.parseInt(longHex(hex).slice(start, start + 2), 16) / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

function luminance(hex: string) {
  const [red, green, blue] = linear(hex)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrast(first: string, second: string) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ]
  return (high + 0.05) / (low + 0.05)
}

export const VISION = {
  ordinary: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const

export type Vision = keyof typeof VISION

/** A colour as one kind of vision takes it, in OKLab. */
export function seen(hex: string, vision: Vision) {
  const [red, green, blue] = linear(hex)
  const [r, g, b] = VISION[vision].map((row) =>
    Math.min(1, Math.max(0, row[0] * red + row[1] * green + row[2] * blue)),
  ) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as const
}

/** How far apart two colours stand for one kind of vision, as OKLab distance. */
export const apart = (first: string, second: string, vision: Vision) => {
  const [a, b] = [seen(first, vision), seen(second, vision)]
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
