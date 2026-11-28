import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { copiedTexts, pageCopies, refuseClipboard } from './pageClipboard.ts'
import { test } from './test.ts'

/**
 * The page's clipboard (`pageClipboard.ts`) in a spec off the clipboard list: a page meets it
 * before its first script; what a page copies, by each way a browser offers, stays in the page
 * and is read back from there; it refuses when told to; and a grant of the system clipboard
 * fails.
 *
 * That the system clipboard was left as it was is not something a page can see, and no runner
 * checks it: the system's own count of its writes (on Windows, `GetClipboardSequenceNumber`) also
 * moves when the person at the machine copies anything during a run, so a check of it would refuse
 * runs that did nothing wrong. Whoever runs the suite reads that count by hand before and after a
 * run that touches this fixture, and the two must be equal.
 *
 * Each test copies only once its page is shown to have the page's clipboard and the listener that
 * keeps the keys from the browser (`beforeEach`), so a test run alone, or after a change that
 * broke the fixture, fails before it presses a key rather than reach the system clipboard.
 */

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

/**
 * The phase of each `keydown` listener on the page's window, as DevTools lists them. The page
 * above adds none, so each one there is the page clipboard's.
 */
async function keyListeners(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page)
  try {
    const { result } = (await session.send('Runtime.evaluate', { expression: 'window' })) as {
      result: { objectId?: string }
    }
    if (!result.objectId) throw new Error('the page has no window to read listeners from')
    const { listeners } = (await session.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
    })) as { listeners: { type: string; useCapture: boolean }[] }
    return listeners
      .filter(({ type }) => type === 'keydown')
      .map(({ useCapture }) => (useCapture ? 'capture' : 'bubble'))
  } finally {
    await session.detach()
  }
}

// Before any test copies: the page has the page's clipboard, and the one listener that takes the
// keys first, on the way down, so the browser's own copy never starts.
test.beforeEach(async ({ page }) => {
  await open(page)
  expect(await firstScript(page)).toEqual(KEPT)
  expect(await keyListeners(page)).toEqual(['capture'])
})

/** The start of what a refused grant of `asked` says. */
const why = (asked: string) =>
  new RegExp(
    `^ui-page-clipboard\\.spec\\.ts asks for ${asked}, which only a spec on the clipboard list`,
    'u',
  )

test('a page meets the page clipboard before its first script runs', async ({ page }) => {
  expect(await firstScript(page)).toEqual(KEPT)
  // A second page of the context, opened once the first has loaded, meets it as well.
  const other = await page.context().newPage()
  await open(other, page.url())
  expect(await firstScript(other)).toEqual(KEPT)
})

test('what a page writes through its clipboard is kept in the page and read back', async ({
  page,
}) => {
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

test('a press known by its virtual key alone copies, cuts and pastes within the page', async ({
  page,
}) => {
  // The page's own listener cancels every key with the browser's own `preventDefault`, so a press
  // the page clipboard missed never starts the browser's command: it copies nowhere, and the check
  // below fails rather than the system clipboard being written.
  await page.evaluate(() => {
    document.addEventListener('keydown', (event) => {
      Event.prototype.preventDefault.call(event)
    })
  })
  // An event as DevTools and other drivers may send it: the virtual key, and neither `code` nor
  // `key`.
  const session = await page.context().newCDPSession(page)
  const [control, shift] = [2, 8]
  const press = async (windowsVirtualKeyCode: number, modifiers: number) => {
    const event = { windowsVirtualKeyCode, modifiers }
    await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event })
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
  }

  await page.locator('#words').selectText()
  await press(67, control)
  await press(45, control)
  await expect.poll(() => copiedTexts(page)).toEqual(['Words to copy', 'Words to copy'])

  const field = page.getByRole('textbox', { name: 'Field' })
  await field.fill('cut me please')
  await field.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 7))
  await press(88, control)
  await expect(field).toHaveValue('please')
  await field.fill('one two')
  await field.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 4))
  await press(46, shift)
  await expect(field).toHaveValue('two')

  await field.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(3, 3))
  await press(86, control)
  await expect(field).toHaveValue('twoone ')
  await press(45, shift)
  await expect(field).toHaveValue('twoone one ')
  const copies = await pageCopies(page)
  expect(copies.map(({ via }) => via)).toEqual(['copy', 'copy', 'cut', 'cut'])
  await session.detach()
})

test('execCommand copies into the page, pastes nothing, and still does the rest', async ({
  page,
}) => {
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
  const own = await browser.newPage()
  await open(own, page.url())
  expect(await firstScript(own)).toEqual(KEPT)
  await own.close()
})
