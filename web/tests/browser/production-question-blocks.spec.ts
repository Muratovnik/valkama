/**
 * Answering several blocks of questions in «Needs my answer», at the widths its layout changes at
 * and at a phone's width in both languages.
 *
 * «Accept recommended in all» chooses nothing until it is pressed and sends nothing until «Accept
 * N» is: its press lists, a line a block, the task, the block and the option that would be chosen,
 * says how many blocks no recommendation answers, and «Accept N» stands under the list. Each
 * block is written on its own, so one the server refuses keeps the option filled with the reason
 * in its foot while the ones that went fold. An answer and a read of the list that cross each
 * other leave every question once, the answered one answered and what the read brought new.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { mixedField } from './questionBackend.ts'
import { ofPurpose, openKinds } from './questionKindsPage.ts'
import { test } from './test.ts'

/**
 * The list read again as a window coming back to the front reads it: not by the poll's clock,
 * which would also run out the time an answer still out is given.
 */
const readAgain = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')))

const WORDS = {
  en: {
    acceptAll: 'Accept recommended in all',
    acceptN: (n: number) => `Accept ${n}`,
    left: 'Not in the list: 1, with no recommendation that answers them.',
    sentPart: 'Sent: 2 of 3. Not sent: 1; the reason is in each question.',
    conflict: 'This request changed or closed. Check its status; your draft is kept.',
    answered: 'You answered',
    send: 'Send',
    count: (n: number) => `Waiting for an answer: ${n}`,
  },
  ru: {
    acceptAll: 'Принять рекомендованное во всех',
    acceptN: (n: number) => `Принять ${n}`,
    left: 'Не вошли: 1 — нет рекомендации, которая на них отвечает.',
    sentPart: 'Отправлено: 2 из 3. Не ушло: 1; причина — в каждом вопросе.',
    conflict: 'Запрос изменён или закрыт. Проверьте его статус; черновик сохранён.',
    answered: 'Вы ответили',
    send: 'Отправить',
    count: (n: number) => `Ждут ответа: ${n}`,
  },
} as const

const CASES = [
  { width: 1280, locale: 'en' },
  { width: 620, locale: 'en' },
  { width: 390, locale: 'en' },
  { width: 390, locale: 'ru' },
] as const

/** A block of one choice whose recommendation answers it, on a task of its own title. */
const recommending = (prompt: string, title: string) => ofPurpose(null, { prompt, title })
/** A block of one choice that recommends nothing. */
const silent = (prompt: string) => ofPurpose(null, { prompt, fields: [mixedField] })

const RECOMMENDED = 'Keep the comments'

async function openBlocks(page: Page, locale: 'en' | 'ru', width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  const entries = [
    recommending('The first block', 'Tray delivery adapter'),
    recommending('The second block', 'Settings window'),
    recommending('The third block', 'Release notes'),
    silent('The block with no advice'),
  ]
  const opened = await openKinds(page, entries, width)
  return { ...opened, ids: entries.map((entry) => entry.request.request_id) }
}

/** A promise the test settles. */
function held() {
  const settled: { now?: () => void } = {}
  const promise = new Promise<void>((resolve) => (settled.now = resolve))
  return { promise, settle: () => settled.now?.() }
}

const chosenIn = (record: Locator) => record.getByRole('radio', { name: RECOMMENDED, exact: true })

for (const { width, locale } of CASES) {
  const words = WORDS[locale]

  test(`at ${width}px in ${locale} «Accept recommended in all» lists what would go and sends only on «Accept N»; what did not go stays filled with its reason`, async ({
    page,
  }) => {
    const { dialog, record, requests, ids } = await openBlocks(page, locale, width)
    const offer = dialog.getByRole('button', { name: words.acceptAll, exact: true })
    await expect(offer).toHaveAttribute('aria-expanded', 'false')

    await offer.click()
    await expect(offer).toHaveAttribute('aria-expanded', 'true')
    const list = dialog.locator(`[id="${await offer.getAttribute('aria-controls')}"]`)
    const lines = list.getByRole('listitem')
    await expect(lines).toHaveCount(3)
    // Newest first, as the blocks stand.
    await expect(lines).toHaveText([
      `MAIN-264 · Release notesRoute: ${RECOMMENDED}`,
      `MAIN-264 · Settings windowRoute: ${RECOMMENDED}`,
      `MAIN-264 · Tray delivery adapterRoute: ${RECOMMENDED}`,
    ])
    await expect(list).toContainText(words.left)
    const accept = list.getByRole('button', { name: words.acceptN(3), exact: true })
    // «Accept N» stands at the bottom of the list, under its last line.
    const [last, button] = await Promise.all([lines.last().boundingBox(), accept.boundingBox()])
    expect(button?.y ?? 0).toBeGreaterThanOrEqual((last?.y ?? 0) + (last?.height ?? 0))
    // Listing chose nothing and sent nothing.
    for (const prompt of ['The first block', 'The second block', 'The third block'])
      await expect(chosenIn(record(prompt))).not.toBeChecked()
    expect(requests.writes).toHaveLength(0)

    // The server refuses the second block; the other two go.
    const refused: unknown[] = []
    await page.route('**/api/modules/planning/request/answer', async (route) => {
      const body = route.request().postDataJSON() as { id: string }
      if (body.id !== ids[1]) return route.fallback()
      refused.push(body)
      return route.fulfill({ status: 409, json: {} })
    })
    await accept.click()
    await expect(dialog.getByRole('status').filter({ hasText: words.sentPart })).toBeVisible()
    expect(requests.writes.map((write) => [write.body.id, write.body.answers])).toEqual(
      expect.arrayContaining([
        [ids[0], { route: 'keep' }],
        [ids[2], { route: 'keep' }],
      ]),
    )
    expect(requests.writes).toHaveLength(2)
    expect(refused).toEqual([expect.objectContaining({ answers: { route: 'keep' } })])
    await expect(list).toHaveCount(0)

    // The ones that went fold to how they ended; the refused one keeps its choice and says why.
    for (const prompt of ['The first block', 'The third block']) {
      await expect(record(prompt).locator('.request-state')).toContainText(words.answered)
      await expect(record(prompt).getByRole('radio')).toHaveCount(0)
    }
    const failed = record('The second block')
    await expect(chosenIn(failed)).toBeChecked()
    await expect(failed.locator('.request-foot').getByRole('alert')).toHaveText(words.conflict)
    await expect(failed.getByRole('button', { name: words.send, exact: true })).toBeVisible()
    // What no recommendation answers was left as it was.
    await expect(
      record('The block with no advice').getByRole('radio', { checked: true }),
    ).toHaveCount(0)
  })

  test(`at ${width}px in ${locale} an answer and a read of the list that cross leave every question once`, async ({
    page,
  }) => {
    const { dialog, record, requests } = await openBlocks(page, locale, width)
    const cards = dialog.locator('.request-card')
    await expect(cards).toHaveCount(4)

    // A read lands while an answer is out: the server has not taken the answer yet, so the read
    // still lists the question, and it brings a question asked meanwhile.
    const write = held()
    requests.holdWrites(write.promise)
    const first = record('The first block')
    await chosenIn(first).check()
    await first.getByRole('button', { name: words.send, exact: true }).click()
    await expect.poll(() => requests.writes.length).toBe(1)
    requests.entries.push(recommending('A block asked meanwhile', 'Tray delivery adapter'))
    await readAgain(page)
    await expect(record('A block asked meanwhile')).toHaveCount(1)
    // The answer still out is still what the person chose.
    await expect(chosenIn(first)).toBeChecked()
    write.settle()
    await expect(first.locator('.request-state')).toContainText(words.answered)

    // An answer lands while a read is out: the read that began before it says nothing over it.
    const read = held()
    await page.route('**/api/modules/planning/requests?**', async (route) => {
      await read.promise
      await route.fallback().catch(() => {})
    })
    await readAgain(page)
    const second = record('The second block')
    await chosenIn(second).check()
    await second.getByRole('button', { name: words.send, exact: true }).click()
    await expect(second.locator('.request-state')).toContainText(words.answered)
    read.settle()

    // Every question once: the two answered where they were, the rest waiting, the new one in.
    await expect(dialog.locator('.request-status')).toHaveText(words.count(3))
    for (const prompt of [
      'The first block',
      'The second block',
      'The third block',
      'The block with no advice',
      'A block asked meanwhile',
    ])
      await expect(record(prompt)).toHaveCount(1)
    await expect(cards).toHaveCount(5)
    await expect(first.locator('.request-state')).toContainText(words.answered)
    await expect(second.locator('.request-state')).toContainText(words.answered)
  })
}
