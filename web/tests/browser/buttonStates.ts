/**
 * What a button's three looks owe each other, judged from their drawn colours.
 *
 * Each case is named `ground:variant:kind:on|off`. A look is `rest` (no pointer)
 * and `hover` (pointed at); a disabled case is read in both, and must not react.
 */
import type { DrawnColours } from './contrast.ts'

export interface ButtonLooks {
  hover: DrawnColours
  name: string
  rest: DrawnColours
}

/** The label's floor against its own fill: WCAG 1.4.3 AA for body-size text. */
const LABEL_CONTRAST = 4.5

/**
 * Two looks a reader tells apart: CIE76 ΔE of 10 or more in the fill or in the
 * label. Below about 2 nobody sees a difference; 10 is a step anyone sees.
 */
const DISTINCT = 10

const distance = (left: number[], right: number[]) =>
  Math.hypot(...left.map((value, index) => value - (right[index] ?? 0)))

const same = (left: DrawnColours, right: DrawnColours) =>
  distance(left.fillLab, right.fillLab) < DISTINCT && distance(left.inkLab, right.inkLab) < DISTINCT

/** The disabled looks on the same ground that a hovered button cannot be told from. */
function lookalikes(name: string, hover: DrawnColours, disabled: readonly ButtonLooks[]) {
  const ground = name.split(':')[0]
  return disabled
    .filter((off) => off.name.startsWith(`${ground}:`) && same(hover, off.rest))
    .map((off) => `${name} hovered looks like ${off.name}`)
}

/** Every way a set of looks breaks the button grammar, as readable lines. */
export function buttonStateFailures(looks: readonly ButtonLooks[]): string[] {
  const failures: string[] = []
  const disabled = looks.filter((look) => look.name.endsWith(':off'))
  const enabled = looks.filter((look) => look.name.endsWith(':on'))
  for (const { name, rest } of looks) {
    if (rest.contrast < LABEL_CONTRAST)
      failures.push(`${name} at rest: ${rest.contrast.toFixed(2)}:1`)
  }
  for (const { name, rest, hover } of disabled) {
    // Pointing at an unavailable control changes nothing about it.
    if (JSON.stringify([hover.fill, hover.ink]) !== JSON.stringify([rest.fill, rest.ink]))
      failures.push(`${name} reacts to hover`)
  }
  for (const { name, rest, hover } of enabled) {
    if (hover.contrast < LABEL_CONTRAST)
      failures.push(`${name} hovered: ${hover.contrast.toFixed(2)}:1`)
    // One step stronger: on this dark ladder every weight's fill moves up it,
    // the light primary included, so the hovered fill is the lighter one.
    if (hover.fillLuminance <= rest.fillLuminance)
      failures.push(
        `${name} hover fill ${hover.fill.join(',')} is not above ${rest.fill.join(',')}`,
      )
    failures.push(...lookalikes(name, hover, disabled))
  }
  return failures
}
