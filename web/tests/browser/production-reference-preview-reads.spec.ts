/**
 * What the hover card reads: nothing in the open space, one brief request outside
 * it, and a line of its own when the answer is slow or a refusal. Its words are
 * measured here on the real surface, since a harness's surface proves only itself.
 */
import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import { drawnColours } from './contrast.ts'
import { attachedDataScopeId, attachedSpaceRef, dataScopeId } from './planningFixtures.ts'
import {
  briefAnswer,
  card,
  cardsAfterTheDelay,
  coolDown,
  held,
  openHub,
  openReported,
  reference,
  refusal,
  rest,
  SPACE,
} from './previewPage.ts'
import { test } from './test.ts'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

/**
 * Every request to the server from now on, by its path and query. Saving the
 * window's own layout goes on whatever the pointer does, and asks nothing of the item.
 */
function apiRequests(page: Page) {
  const seen: string[] = []
  page.on('request', (request) => {
    const { pathname, search } = new URL(request.url())
    if (pathname.startsWith('/api/') && pathname !== '/api/platform/ui-prefs')
      seen.push(`${pathname}${search}`)
  })
  return seen
}

const [ITEM] = SPACE

/**
 * Past the card's 500 ms delay, and short of that delay and the 120 ms the card waits
 * for a read before it says it is reading. Run on a paused clock, it opens the card
 * and leaves that wait where it is, however slow the machine is.
 */
const PAST_THE_DELAY_MS = 550
if (!ITEM) throw new Error('Expected the space to hold items')

test('in the open space the card comes from what the page holds, with no request', async ({
  page,
}) => {
  const { entry } = await openReported(page)
  const seen = apiRequests(page)

  await rest(page, reference(entry, 'MAIN-12'))
  await expect(card(page)).toContainText('Keep the reader in place when a card closes')
  // What only the space's links can say.
  await rest(page, reference(entry, 'MAIN-13'))
  await expect(card(page)).toContainText('MAIN-265')
  await page.mouse.move(5, 5)
  await expect(card(page)).toHaveCount(0)
  expect(await cardsAfterTheDelay(page)).toBe(0)
  expect(seen).toEqual([])
})

test('outside the open space one brief request draws it, with its project', async ({ page }) => {
  const { dialog, reads } = await openHub(page)
  const seen = apiRequests(page)
  await rest(page, reference(dialog, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toContainText('Keep the reader in place when a card closes')
  await expect(shown).toContainText('Example Project')
  expect(reads.asked).toEqual([{ reference: 'MAIN-12', scope: dataScopeId }])
  expect(seen.filter((path) => path.includes('/work-item'))).toHaveLength(1)
  expect(seen.find((path) => path.includes('/work-item'))).toContain('brief=true')

  // Looked at again at once, it is read from memory.
  await page.mouse.move(5, 5)
  await expect(shown).toHaveCount(0)
  await rest(page, reference(dialog, 'MAIN-12'))
  await expect(shown).toContainText('Keep the reader in place when a card closes')
  expect(reads.asked).toHaveLength(1)
})

test('passing by reads nothing: the read starts when the card would open', async ({ page }) => {
  const { dialog, reads } = await openHub(page)
  await rest(page, reference(dialog, 'MAIN-12'))
  await page.mouse.move(5, 5)
  expect(await cardsAfterTheDelay(page)).toBe(0)
  expect(reads.asked).toEqual([])
})

test('a quick answer never says it is reading; a slow one does, then replaces it', async ({
  page,
}) => {
  // On the wall clock a loaded machine made the quick answer slow, and the card was
  // right to say it was reading. The page's own time moves here only when the test
  // moves it, so a quick answer is one that comes before the wait ends.
  await page.clock.install()
  const { dialog, reads } = await openHub(page)
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  await page.evaluate(() => {
    const words: string[] = []
    Object.assign(window, { previewWords: words })
    new MutationObserver(() => {
      const text = document.querySelector('.work-item-preview')?.textContent
      if (text) words.push(text)
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  await rest(page, reference(dialog, 'MAIN-12'))
  await page.clock.runFor(PAST_THE_DELAY_MS)
  await expect(card(page)).toContainText('Keep the reader')
  const said = await page.evaluate(
    () => (window as unknown as { previewWords: string[] }).previewWords,
  )
  expect(said.join(' ')).not.toContain('Reading')

  const unanswered: Route[] = []
  reads.answer((route) => {
    unanswered.push(route)
  })
  await page.mouse.move(5, 5)
  await expect(card(page)).toHaveCount(0)
  await rest(page, reference(dialog, 'MAIN-13'))
  await expect.poll(() => unanswered.length).toBe(1)
  await page.clock.runFor(PAST_THE_DELAY_MS)
  await expect(card(page)).toContainText('Reading…')
  await expect(card(page)).toContainText('MAIN-13')
  const box = await card(page).boundingBox()
  await unanswered[0]?.fulfill(briefAnswer(held(13, 'Answered slowly')))
  await expect(card(page)).toContainText('Answered slowly')
  await expect(card(page)).not.toContainText('Reading')
  // It grows downwards, from where it hung, at the width it had.
  const grown = await card(page).boundingBox()
  expect(grown?.x).toBe(box?.x)
  expect(grown?.y).toBe(box?.y)
  expect(grown?.width).toBe(box?.width)
})

test('leaving while the read is out cancels it and shows nothing', async ({ page }) => {
  const { dialog, reads } = await openHub(page)
  const failed: string[] = []
  page.on('requestfailed', (request) => {
    if (request.url().includes('brief=true')) failed.push(request.failure()?.errorText ?? '')
  })
  // The pointer leaves as the read goes out, while the card is held back for the answer.
  reads.answer(async () => {
    await page.mouse.move(5, 5)
  })
  await rest(page, reference(dialog, 'MAIN-12'))
  await expect.poll(() => failed).toEqual(['net::ERR_ABORTED'])
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('closing the card cancels the read it was still waiting for', async ({ page }) => {
  const { dialog, reads } = await openHub(page)
  const failed: string[] = []
  page.on('requestfailed', (request) => {
    if (request.url().includes('brief=true')) failed.push(request.failure()?.errorText ?? '')
  })
  reads.answer(() => new Promise(() => {}))
  await rest(page, reference(dialog, 'MAIN-12'))
  await expect(card(page)).toContainText('Reading…')
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect.poll(() => failed).toEqual(['net::ERR_ABORTED'])
})

for (const [name, answer, words] of [
  ['404', refusal(404), 'Task MAIN-12 was not found.'],
  ['409', refusal(409), "The work item's store is unavailable right now."],
  ['a broken answer', { json: { interface_version: 'wrong' } }, 'Could not read the work item.'],
] as const)
  test(`${name} says so in a line, and the next look asks again`, async ({ page }) => {
    const { dialog, reads } = await openHub(page)
    reads.answer((route) => route.fulfill(answer))
    await rest(page, reference(dialog, 'MAIN-12'))
    await expect(card(page)).toContainText(words)
    await expect(card(page)).toContainText('MAIN-12')
    // The reference stays the link it was.
    await expect(reference(dialog, 'MAIN-12')).toBeVisible()

    await page.mouse.move(5, 5)
    await expect(card(page)).toHaveCount(0)
    reads.answer((route) => route.fulfill(briefAnswer(ITEM)))
    await coolDown()
    await rest(page, reference(dialog, 'MAIN-12'))
    await expect(card(page)).toContainText('Keep the reader in place')
    expect(reads.asked).toHaveLength(2)
  })

test('a connection that breaks reads as a failure', async ({ page }) => {
  const { dialog, reads } = await openHub(page)
  reads.answer((route) => route.abort('connectionfailed'))
  await rest(page, reference(dialog, 'MAIN-12'))
  await expect(card(page)).toContainText('Could not read the work item.')
})

test('two stores with one key: the primary is asked first, a 404 asks the other', async ({
  page,
}) => {
  const { dialog, reads } = await openHub(page, [], { includeAttachedDuplicate: true })
  reads.answer((route, wanted) =>
    reads.asked.length === 1
      ? route.fulfill(refusal(404))
      : route.fulfill(briefAnswer(held(12, `Attached: ${wanted}`), attachedSpaceRef)),
  )
  await rest(page, reference(dialog, 'MAIN-12'))
  await expect(card(page)).toContainText('Attached: MAIN-12')
  expect(reads.asked.map((read) => read.scope)).toEqual([dataScopeId, attachedDataScopeId])
})

test('every line of the card reads at 4.5:1 on the surface it really floats on', async ({
  page,
}) => {
  const { entry } = await openReported(page)
  for (const name of ['MAIN-12', 'MAIN-13', 'MAIN-14', 'MAIN-15', 'MAIN-16']) {
    await page.mouse.move(5, 5)
    await expect(card(page)).toHaveCount(0)
    await coolDown()
    await rest(page, reference(entry, name))
    await expect(card(page)).toContainText(name)
    // Measured settled: the first frames are still fading in.
    await expect(card(page)).toHaveCSS('opacity', '1')
    await card(page).evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    )
    const lines = await card(page)
      .locator(
        '.preview-reference, .preview-when, .preview-note, .facet-word, .state-label, .preview-title',
      )
      .all()
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines) {
      const { contrast } = await line.evaluate(drawnColours, 'own' as const)
      expect(contrast, `${name}: «${await line.textContent()}»`).toBeGreaterThanOrEqual(4.5)
    }
  }
})
