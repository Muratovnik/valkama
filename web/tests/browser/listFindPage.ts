/**
 * What the browser specs of the list's own find share: rows that stand where their
 * index says, the bar and its parts, the marks the page registered, and the room
 * under the sticky head a match is brought to.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { picture } from './graphPixels.ts'
import { reference } from './served/listFind.ts'

export const listOf = (page: Page) => page.locator('.work-item-list')
export const barOf = (page: Page) => page.getByRole('search', { name: 'Find in the list' })
export const fieldOf = (page: Page) => barOf(page).getByRole('textbox', { name: 'Find' })
export const countOf = (page: Page) => barOf(page).locator('.list-find-now')

/** Hears whether the page took Ctrl+F from the browser, after the list has. */
export const hearFind = (page: Page) =>
  page.evaluate(() => {
    globalThis.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF') Object.assign(globalThis, { findTaken: event.defaultPrevented })
    })
  })
export const findTaken = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { findTaken?: boolean }).findTaken)

export interface Box {
  bottom: number
  left: number
  right: number
  top: number
}
export interface Mark {
  box: Box
  reference: string | undefined
  text: string
}

/** The marks the page registered, the current one apart, with the row each is drawn in. */
export const marksOf = (page: Page) =>
  page.evaluate(() => {
    const [current, others] = ['list-find-current', 'list-find'].map((name) =>
      [...(CSS.highlights.get(name) ?? [])].map((range) => {
        const { bottom, left, right, top } = (range as Range).getBoundingClientRect()
        const element = range.startContainer.parentElement
        return {
          box: { bottom, left, right, top },
          reference: element?.closest('tr')?.querySelector<HTMLElement>('.list-open')?.dataset
            .reference,
          text: (range as Range).toString(),
        }
      }),
    )
    return { current: current ?? [], others: others ?? [] }
  })

/** The room the rows scroll in: under the sticky head, inside the list's edges. */
const roomOf = (page: Page) =>
  listOf(page).evaluate((list): Box => {
    const frame = list.getBoundingClientRect()
    const head = list.querySelector('th.list-head')?.getBoundingClientRect().bottom ?? frame.top
    const left = frame.left + list.clientLeft
    return {
      bottom: frame.top + list.clientTop + list.clientHeight,
      left,
      right: left + list.clientWidth,
      top: head,
    }
  })

const overlaps = (one: Box, other: Box) =>
  one.top < other.bottom &&
  one.bottom > other.top &&
  one.left < other.right &&
  one.right > other.left

/** How much of a box is the current match's yellow, or another colour token's, read off the screen. */
export async function yellowIn(page: Page, box: Box, token = '--color-find-current') {
  const area = {
    bottom: Math.floor(box.bottom),
    left: Math.ceil(box.left),
    right: Math.floor(box.right),
    top: Math.ceil(box.top),
  }
  const source = await picture(page, area)
  return page.evaluate(
    async ([png, colour]) => {
      const image = new Image()
      image.src = `data:image/png;base64,${png}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d') as CanvasRenderingContext2D
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, image.width, image.height)
      const probe = document.createElement('span')
      probe.style.color = `var(${colour})`
      document.body.append(probe)
      const [r, g, b] = (getComputedStyle(probe).color.match(/\d+/gu) ?? []).map(Number)
      probe.remove()
      let near = 0
      for (let at = 0; at < data.length; at += 4) {
        const off =
          Math.abs((data[at] ?? 0) - r) +
          Math.abs((data[at + 1] ?? 0) - g) +
          Math.abs((data[at + 2] ?? 0) - b)
        if (off < 24) near += 1
      }
      return near / (data.length / 4)
    },
    [source, token] as const,
  )
}

/** The current match: one, in its row, whole in the room clear of the bar, and painted. */
export async function expectCurrentIn(page: Page, index: number, centred: boolean) {
  const { current } = await marksOf(page)
  expect(current, `the current match in ${reference(index)}`).toHaveLength(1)
  const [mark] = current as [Mark]
  expect(mark.reference).toBe(reference(index))
  expect(mark.text.toLowerCase()).toBe('quartz')
  const room = await roomOf(page)
  const bar = await barOf(page).boundingBox()
  expect(mark.box.top, 'under the sticky head').toBeGreaterThanOrEqual(room.top)
  expect(mark.box.bottom, 'above the list’s bottom edge').toBeLessThanOrEqual(room.bottom)
  if (bar) {
    const covered = {
      bottom: bar.y + bar.height,
      left: bar.x,
      right: bar.x + bar.width,
      top: bar.y,
    }
    expect(overlaps(mark.box, covered), 'clear of the find bar').toBe(false)
  }
  if (centred) {
    // The match itself brought to the middle of the room, to within the scroll's rounding.
    const middle = (mark.box.top + mark.box.bottom) / 2
    expect(
      Math.abs(middle - (room.top + room.bottom) / 2),
      'at the room’s middle',
    ).toBeLessThanOrEqual(1)
  }
  expect(await yellowIn(page, mark.box), 'the current match painted').toBeGreaterThan(0.3)
}
