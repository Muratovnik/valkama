/**
 * An element's text and fill as they are drawn, and the WCAG 2 contrast
 * between the two.
 *
 * The ink and the fill are faded by the opacity of the element and of every
 * ancestor, so a faded label is measured as the eye sees it: axe leaves text
 * under a partial opacity "incomplete" rather than failing it, so that case
 * needs this measure to be caught.
 *
 * `ground` names what the text is read against. `drawer` is the drawer's ground,
 * for text that lies on it; `own` is the element's own fill laid over the first
 * opaque ground beneath it, which is what a filled control's label is read
 * against — and a fill that went transparent reads as the ground it shows.
 *
 * Besides the ratio it answers each colour as sRGB, the fill's relative
 * luminance and both colours in CIE L*a*b*, so a caller can say whether two
 * looks are one step apart or the same look, without doing colour science of
 * its own.
 *
 * Passed to `evaluate`, so everything it uses is inside it.
 */
export function drawnColours(node: Element, ground: 'drawer' | 'own' = 'drawer'): DrawnColours {
  // This body is serialized and evaluated in the page, so a module-scope
  // helper would not be in scope here.
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const rgba = (value: string) => {
    const parts = (value.match(/[0-9.]+/gu) ?? []).map(Number)
    return { alpha: parts.length > 3 ? (parts[3] ?? 1) : 1, rgb: parts.slice(0, 3) }
  }
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const over = (top: number[], alpha: number, bottom: number[]) =>
    top.map((value, index) => value * alpha + (bottom[index] ?? 0) * (1 - alpha))
  // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
  const linear = (rgb: number[]) =>
    rgb.map((value) => {
      const unit = value / 255
      return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
    })
  const toXyz = (rgb: number[]) =>
    [
      [0.4124, 0.3576, 0.1805],
      [0.2126, 0.7152, 0.0722],
      [0.0193, 0.1192, 0.9505],
    ].map((row) =>
      linear(rgb).reduce((sum, channel, index) => sum + channel * (row[index] ?? 0), 0),
    )
  const toLab = (rgb: number[]) => {
    const [x = 0, y = 0, z = 0] = toXyz(rgb).map(
      (value, axis) => value / ([0.9505, 1, 1.089][axis] ?? 1),
    )
    const [fx = 0, fy = 0, fz = 0] = [x, y, z].map((t) =>
      t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116,
    )
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
  }

  let opacity = 1
  for (let at: Element | null = node; at; at = at.parentElement)
    opacity *= Number(getComputedStyle(at).opacity)
  let under = rgba(
    getComputedStyle(node.closest('.drawer-frame') ?? document.body).backgroundColor,
  ).rgb
  let fill = under
  if (ground === 'own') {
    const layers: { alpha: number; rgb: number[] }[] = []
    for (let at = node.parentElement; at; at = at.parentElement) {
      const layer = rgba(getComputedStyle(at).backgroundColor)
      if (layer.alpha === 0) continue
      layers.unshift(layer)
      if (layer.alpha === 1) break
    }
    under = [255, 255, 255]
    for (const layer of layers) under = over(layer.rgb, layer.alpha, under)
    const own = rgba(getComputedStyle(node).backgroundColor)
    fill = over(own.rgb, own.alpha, under)
  }
  const text = rgba(getComputedStyle(node).color)
  const ink = over(over(text.rgb, text.alpha, fill), opacity, under)
  const drawnFill = over(fill, opacity, under)
  const [inkLuminance = 0, fillLuminance = 0] = [ink, drawnFill].map((rgb) => toXyz(rgb)[1] ?? 0)
  const [light = 0, dark = 0] = [inkLuminance, fillLuminance].toSorted(
    (left, right) => right - left,
  )
  return {
    contrast: (light + 0.05) / (dark + 0.05),
    fill: drawnFill.map((value) => Math.round(value)),
    fillLab: toLab(drawnFill),
    fillLuminance,
    ink: ink.map((value) => Math.round(value)),
    inkLab: toLab(ink),
  }
}

export interface DrawnColours {
  contrast: number
  fill: number[]
  fillLab: number[]
  fillLuminance: number
  ink: number[]
  inkLab: number[]
}
