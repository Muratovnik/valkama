/**
 * Where words are drawn, read off pictures of the page: what no box tells, such as where the «…»
 * of a cut text ends or how high an input draws its own words. A picture is decoded in a blank
 * page of the same context, which no policy of the app's holds, and its lightness comes back
 * here, a value from 0 to 255 for each of its pixels.
 */
import type { Page } from '@playwright/test'

export interface Picture {
  height: number
  /** The lightness of each pixel, row by row. */
  light: number[]
  width: number
}

/** The pictures' pixels, as their lightness. */
export async function lightOf(page: Page, pictures: readonly Buffer[]): Promise<Picture[]> {
  const reader = await page.context().newPage()
  const read = await reader.evaluate(
    async (images) => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      const each: { height: number; light: number[]; width: number }[] = []
      for (const image of images) {
        const response = await fetch(`data:image/png;base64,${image}`)
        const bitmap = await createImageBitmap(await response.blob())
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        context?.drawImage(bitmap, 0, 0)
        const data = context?.getImageData(0, 0, bitmap.width, bitmap.height).data ?? []
        const light: number[] = []
        for (let at = 0; at < data.length; at += 4)
          light.push(
            0.2126 * (data[at] ?? 0) + 0.7152 * (data[at + 1] ?? 0) + 0.0722 * (data[at + 2] ?? 0),
          )
        each.push({ height: bitmap.height, light, width: bitmap.width })
      }
      return each
    },
    pictures.map((picture) => picture.toString('base64')),
  )
  await reader.close()
  return read
}

/** Whether the pixel at `x`, `y` is ink: further from the ground, the top left pixel, than `by`. */
const inked = (picture: Picture, x: number, y: number, by: number) =>
  Math.abs((picture.light[y * picture.width + x] ?? 0) - (picture.light[0] ?? 0)) > by

/** The first and the last row with ink, in pixels from the picture's top; -1 for none. */
export function inkRows(picture: Picture, by = 8) {
  const rows: number[] = []
  for (let y = 0; y < picture.height; y += 1)
    for (let x = 0; x < picture.width; x += 1)
      if (inked(picture, x, y, by)) {
        rows.push(y)
        break
      }
  return { first: rows.at(0) ?? -1, last: rows.at(-1) ?? -1 }
}

/**
 * How many columns of ground stand between the last column with ink before column `split` and
 * the first from it on; NaN where either side has none.
 */
export function inkGap(picture: Picture, split: number, by = 40) {
  const column = (x: number) => {
    for (let y = 0; y < picture.height; y += 1) if (inked(picture, x, y, by)) return true
    return false
  }
  let before = split - 1
  while (before >= 0 && !column(before)) before -= 1
  let after = split
  while (after < picture.width && !column(after)) after += 1
  return before >= 0 && after < picture.width ? after - before - 1 : Number.NaN
}
