import { createHash } from 'node:crypto'

import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { test } from './test.ts'

/**
 * A picture pasted into a comment: sent to the item, named in the text, and drawn in the
 * published comment at a bounded size that opens at its own size. The clipboard is a
 * paste event the page dispatches with a file in it; the system clipboard is not touched.
 */

/** The server's side of a picture: what was sent, and the bytes it then hands back. */
async function keepPictures(page: Page) {
  const sent: Buffer[] = []
  const kept = new Map<string, Buffer>()
  await page.route('**/api/images?*', async (route) => {
    const request = route.request()
    const bytes = request.postDataBuffer() ?? Buffer.alloc(0)
    sent.push(bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    kept.set(sha256, bytes)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        work_item_id: new URL(request.url()).searchParams.get('item'),
        sha256,
        media_type: 'image/png',
        size: bytes.length,
        path: `/api/images/${sha256}`,
      }),
    })
  })
  await page.route('**/api/images/*', async (route) => {
    const sha256 = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    const bytes = kept.get(sha256)
    await (bytes
      ? route.fulfill({ status: 200, contentType: 'image/png', body: bytes })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  })
  return { sent }
}

/** A paste of one file into `field`, as a browser hands one over from the clipboard. */
function pasteFile(field: Locator, file: { kind: 'png' | 'text' | 'huge'; name: string }) {
  return field.evaluate(async (element, { kind, name }) => {
    let blob: Blob
    if (kind === 'png') {
      const canvas = new OffscreenCanvas(1600, 1200)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no 2d context')
      context.fillStyle = '#2a6f97'
      context.fillRect(0, 0, 1600, 1200)
      context.fillStyle = '#f4d35e'
      context.fillRect(200, 150, 400, 300)
      blob = await canvas.convertToBlob({ type: 'image/png' })
    } else if (kind === 'huge') {
      // A PNG's signature followed by eleven megabytes: a picture by its first bytes, too large.
      const bytes = new Uint8Array(11 * 1024 * 1024)
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      blob = new Blob([bytes])
    } else {
      blob = new Blob(['not a picture at all'])
    }
    // The declared type says picture for every one: only the bytes may decide.
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], name, { type: 'image/png' }))
    element.focus()
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
  }, file)
}

test('a pasted picture is sent, named in the comment and drawn in it at a bounded size', async ({
  page,
}) => {
  let pictures: Awaited<ReturnType<typeof keepPictures>> | undefined
  const { backend, drawer, comment } = await openCard(page, async () => {
    pictures = await keepPictures(page)
  })
  await comment.click()
  await page.keyboard.insertText('Before the picture')
  await pasteFile(comment, { kind: 'png', name: 'screen.png' })

  await expect(comment).toHaveValue(
    /^Before the picture\n!\[screen\.png\]\(<\/api\/images\/[0-9a-f]{64}>\)\n$/u,
  )
  expect(pictures?.sent).toHaveLength(1)
  const sha256 = createHash('sha256')
    .update(pictures?.sent[0] ?? '')
    .digest('hex')
  await drawer
    .locator('.discussion-form')
    .getByRole('button', { name: 'Add note', exact: true })
    .click()
  await expect(comment).toHaveValue('')
  expect(backend.writes.at(-1)?.body).toBe(
    `Before the picture\n![screen.png](</api/images/${sha256}>)\n`,
  )

  const open = drawer.getByRole('button', { name: 'Open the picture full size: screen.png' })
  const thumb = open.locator('img')
  await expect(thumb).toHaveAttribute('src', `/api/images/${sha256}`)
  await expect
    .poll(() => thumb.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth))
    .toBe(1600)
  const geometry = await thumb.evaluate((image: HTMLImageElement) => {
    const own = image.getBoundingClientRect()
    const text = image.closest('.rich-text') ?? image.parentElement?.parentElement
    const room = (text ?? image).getBoundingClientRect()
    const line = Number.parseFloat(getComputedStyle(image).lineHeight)
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return { width: own.width, height: own.height, room: room.width, line, rem }
  })
  // No wider than the text or 32rem, no taller than six lines, and not stretched.
  expect(geometry.width).toBeGreaterThan(100)
  expect(geometry.width).toBeLessThanOrEqual(Math.min(geometry.room, 32 * geometry.rem) + 0.5)
  expect(geometry.height).toBeLessThanOrEqual(6 * geometry.line + 0.5)
  // Whole inside the comment's held lines: nothing of the comment is held back.
  await expect(drawer.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0)
  expect(Math.abs(geometry.width / geometry.height - 1600 / 1200)).toBeLessThan(0.02)

  // Pressed, it opens at its own size, and Escape closes the picture, not the card.
  await open.click()
  const viewer = page.getByRole('dialog', { name: 'screen.png' })
  await expect(viewer).toBeVisible()
  const full = viewer.getByRole('img', { name: 'screen.png' })
  await expect
    .poll(() => full.evaluate((image: HTMLImageElement) => image.getBoundingClientRect().width))
    .toBe(1600)
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await expect(open).toBeFocused()
})

test('a file that is no picture, or a picture over 10 MB, is refused before it is sent', async ({
  page,
}) => {
  let pictures: Awaited<ReturnType<typeof keepPictures>> | undefined
  const { drawer, comment } = await openCard(page, async () => {
    pictures = await keepPictures(page)
  })
  const form = drawer.locator('.discussion-form')

  await pasteFile(comment, { kind: 'text', name: 'notes.png' })
  await expect(form).toContainText('Only a PNG, JPEG, WebP or GIF picture can be attached.')
  // Said where the field's reader hears it, not only drawn under it.
  await expect(comment).toHaveAccessibleDescription(/Only a PNG, JPEG, WebP or GIF picture/u)

  await pasteFile(comment, { kind: 'huge', name: 'huge.png' })
  await expect(form).toContainText('The picture is larger than 10 MB and was not attached.')

  await expect(comment).toHaveValue('')
  expect(pictures?.sent).toHaveLength(0)

  // Typing again clears what was said about the picture.
  await comment.click()
  await page.keyboard.insertText('x')
  await expect(form).not.toContainText('larger than 10 MB')
})
