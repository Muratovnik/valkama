/**
 * What the field draws, read off its pixels: a picture of an area, and the points of it
 * that a change of state painted.
 */
import type { Page } from '@playwright/test'

export interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/** A picture of `area`, as the page draws it now. */
export async function picture(page: Page, area: Box) {
  const shot = await page.screenshot({
    clip: {
      x: area.left,
      y: area.top,
      width: area.right - area.left,
      height: area.bottom - area.top,
    },
  })
  return shot.toString('base64')
}

/**
 * The points of `area`, in page units, that changed since `rest` by more than a raster's
 * shimmer, a step of a few levels on an edge's softened pixels. With `ring`, only those that
 * took the focus ring's colour: read against the same control under the pointer, the ring as
 * drawn, and nothing the header draws blue either way, its edge, its state or its live work.
 */
export function movedSince(page: Page, area: Box, pictures: [string, string], ring: boolean) {
  return page.evaluate(
    async ({ pair, box, only }) => {
      const pixels = await Promise.all(
        pair.map(async (source) => {
          const image = new Image()
          image.src = `data:image/png;base64,${source}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d') as CanvasRenderingContext2D
          context.drawImage(image, 0, 0)
          return {
            data: context.getImageData(0, 0, image.width, image.height).data,
            width: image.width,
            height: image.height,
          }
        }),
      )
      const [after, before] = pixels
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-focus-ring)'
      document.body.append(probe)
      const [r, g, b] = (getComputedStyle(probe).color.match(/\d+/gu) ?? []).map(Number)
      probe.remove()
      const scale = after.width / (box.right - box.left)
      const points: [number, number][] = []
      for (let y = 0; y < after.height; y += 1)
        for (let x = 0; x < after.width; x += 1) {
          const at = (y * after.width + x) * 4
          const hue =
            Math.abs(after.data[at] - r) +
            Math.abs(after.data[at + 1] - g) +
            Math.abs(after.data[at + 2] - b)
          const moved =
            Math.abs(after.data[at] - before.data[at]) +
            Math.abs(after.data[at + 1] - before.data[at + 1]) +
            Math.abs(after.data[at + 2] - before.data[at + 2])
          if ((!only || hue < 90) && moved > 30)
            points.push([box.left + (x + 0.5) / scale, box.top + (y + 0.5) / scale])
        }
      return points
    },
    { pair: pictures, box: area, only: ring },
  )
}
