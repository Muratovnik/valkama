/**
 * The contrast of an element's text against the drawer's ground, as it is
 * drawn: its colour faded by the opacity of it and of every ancestor, measured
 * as WCAG 2 does. Axe leaves text under a partial opacity "incomplete" rather
 * than failing it, so a faded label needs this measure to be caught.
 *
 * Passed to `evaluate`, so everything it uses is inside it.
 */
export function renderedContrast(node: Element): number {
  let opacity = 1
  for (let at: Element | null = node; at; at = at.parentElement)
    opacity *= Number(getComputedStyle(at).opacity)
  const frame = node.closest('.drawer-frame') ?? document.body
  const ground = (getComputedStyle(frame).backgroundColor.match(/[0-9.]+/gu) ?? [])
    .slice(0, 3)
    .map(Number)
  const ink = (getComputedStyle(node).color.match(/[0-9.]+/gu) ?? [])
    .slice(0, 3)
    .map((value, index) => Number(value) * opacity + ground[index] * (1 - opacity))
  const [light, dark] = [ink, ground]
    .map((rgb) =>
      rgb
        .map((value) => {
          const unit = value / 255
          return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0),
    )
    .sort((left, right) => right - left)
  return (light + 0.05) / (dark + 0.05)
}
