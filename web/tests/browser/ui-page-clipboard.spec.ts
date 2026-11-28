import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { copiedTexts, pageCopies, refuseClipboard } from './pageClipboard.ts'
import { test } from './test.ts'

/**
 * The page's clipboard (`pageClipboard.ts`) in a spec off the clipboard list: a page meets it
 * before its first script; what a page copies, by each way a browser offers, stays in the page
 * and is read back from there; it refuses when told to; and a grant of the system clipboard
 * fails. That the system clipboard was left as it was is not something a page can see: a run of
 * this spec shows it by the system's own count of its writes, read before and after.
 */

// The first test finds the page's clipboard in place; should it not, the rest, which copy, do not
// run against the system's.
test.describe.configure({ mode: 'serial' })

const PAGE = '/page-clipboard'

/** A page whose first script notes what it met: the page's clipboard, or the browser's own. */
const BODY = `<!doctype html>
<html>
  <head>
    <script>
      const native = (one) => Function.prototype.toString.call(one).includes('[native code]')
      window.firstScript = {
        kept: Symbol.for('valkama.pageClipboard') in window,
        native: [
          ...['writeText', 'write', 'readText', 'read'].map((name) => Clipboard.prototype[name]),
          document.execCommand,
        ].filter(native).length,
        control: native(document.createElement),
      }
    </script>
  </head>
  <body>
    <p id="words">Words to copy</p>
    <textarea id="field" aria-label="Field"></textarea>
  </body>
</html>`

async function open(page: Page, at = PAGE) {
  await page.route(`**${PAGE}`, (route) => route.fulfill({ contentType: 'text/html', body: BODY }))
  await page.goto(at)
}

const firstScript = (page: Page) =>
  page.evaluate(() => (window as unknown as { firstScript: object }).firstScript)

/** What the first script meets where the page's clipboard came before it. */
const KEPT = { kept: true, native: 0, control: true }

/** The start of what a refused grant of `asked` says. */
const why = (asked: string) =>
  new RegExp(
    `^ui-page-clipboard\\.spec\\.ts asks for ${asked}, which only a spec on the clipboard list`,
    'u',
  )

test('a page meets the page clipboard before its first script runs', async ({ page }) => {
  await open(page)
  expect(await firstScript(page)).toEqual(KEPT)
  // A second page of the context, opened once the first has loaded, meets it as well.
  const other = await page.context().newPage()
  await open(other, page.url())
  expect(await firstScript(other)).toEqual(KEPT)
})

test('what a page writes through its clipboard is kept in the page and read back', async ({
  page,
}) => {
  await open(page)
  const read = await page.evaluate(async () => {
    await navigator.clipboard.writeText('first')
    const item = new ClipboardItem({
      'text/plain': new Blob(['second'], { type: 'text/plain' }),
      'image/png': new Blob([new Uint8Array(3)], { type: 'image/png' }),
    })
    await navigator.clipboard.write([item])
    const items = await navigator.clipboard.read()
    return { text: await navigator.clipboard.readText(), types: items.flatMap((one) => one.types) }
  })
  expect(read).toEqual({ text: 'second', types: ['text/plain'] })
  expect(await pageCopies(page)).toEqual([
    { via: 'writeText', data: { 'text/plain': 'first' } },
    { via: 'write', data: { 'text/plain': 'second', 'image/png': '3 bytes' } },
  ])
})

test('the keys copy the selection, or what the page set, and cut and paste within the page', async ({
  page,
}) => {
  await open(page)
  await page.locator('#words').selectText()
  await page.keyboard.press('Control+c')
  await expect.poll(() => copiedTexts(page)).toEqual(['Words to copy'])

  // A page that sets what is copied has its own words kept, as the browser would have copied them.
  await page.evaluate(() => {
    document.addEventListener(
      'copy',
      (event) => {
        event.clipboardData?.setData('text/plain', 'set by the page')
        event.preventDefault()
      },
      { once: true },
    )
  })
  await page.keyboard.press('Control+Insert')
  await expect.poll(() => copiedTexts(page)).toEqual(['Words to copy', 'set by the page'])

  // A page that cancels the key copies nothing, and the next press copies again. The press of
  // Control comes first, as its own keydown, so the page waits for the C.
  await page.evaluate(() => {
    document.addEventListener('keydown', function decline(event) {
      if (event.code !== 'KeyC') return
      event.preventDefault()
      document.removeEventListener('keydown', decline)
    })
  })
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+c')
  await expect
    .poll(() => copiedTexts(page))
    .toEqual(['Words to copy', 'set by the page', 'Words to copy'])

  const field = page.getByRole('textbox', { name: 'Field' })
  await field.fill('cut me please')
  await field.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 7))
  await page.keyboard.press('Control+x')
  await expect(field).toHaveValue('please')
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Insert')
  await expect(field).toHaveValue('pleasecut me ')
  const copies = await pageCopies(page)
  expect(copies.at(-1)).toEqual({ via: 'cut', data: { 'text/plain': 'cut me ' } })
})

test('execCommand copies into the page, pastes nothing, and still does the rest', async ({
  page,
}) => {
  await open(page)
  await page.locator('#words').selectText()
  const done = await page.evaluate(() => [
    document.execCommand('copy'),
    document.execCommand('paste'),
  ])
  expect(done).toEqual([true, false])
  expect(await pageCopies(page)).toEqual([{ via: 'copy', data: { 'text/plain': 'Words to copy' } }])
  const field = page.getByRole('textbox', { name: 'Field' })
  await field.focus()
  expect(await page.evaluate(() => document.execCommand('insertText', false, 'typed'))).toBe(true)
  await expect(field).toHaveValue('typed')
})

test('a clipboard told to refuse refuses each write and read, here and in the next document', async ({
  page,
}) => {
  await open(page)
  await refuseClipboard(page)
  const tries = () =>
    page.evaluate(() =>
      Promise.all(
        [
          navigator.clipboard.writeText('refused'),
          navigator.clipboard.write([]),
          navigator.clipboard.readText(),
          navigator.clipboard.read(),
        ].map((one) =>
          one.then(
            () => 'done',
            (error: DOMException) => error.name,
          ),
        ),
      ),
    )
  const refused = ['NotAllowedError', 'NotAllowedError', 'NotAllowedError', 'NotAllowedError']
  expect(await tries()).toEqual(refused)
  await page.reload()
  expect(await tries()).toEqual(refused)
  expect(await pageCopies(page)).toEqual([])
})

test('a grant of the system clipboard fails and says where such a test goes', async ({
  page,
  browser,
}) => {
  await expect(page.context().grantPermissions(['clipboard-read'])).rejects.toThrow(
    why('clipboard-read'),
  )
  await expect(browser.newContext({ permissions: ['clipboard-write'] })).rejects.toThrow(
    why('clipboard-write'),
  )
  // Any other permission is granted as before.
  await page.context().grantPermissions(['geolocation'])
  // A page the test opens in a context of its own meets the page's clipboard too.
  await open(page)
  const own = await browser.newPage()
  await open(own, page.url())
  expect(await firstScript(own)).toEqual(KEPT)
  await own.close()
})
