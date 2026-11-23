/**
 * A group of findings a triage review proposes as one goal, in «Needs my answer», at the widths
 * its layout changes at and at a phone's width in both languages: its findings stand ticked, an
 * unticked one leaves Do naming how many go and leaves the answer, with none ticked Do and
 * «Later…» are unavailable with the reason under them, «Later…» puts the group off to a day or a
 * card's close with its findings, and «Don't do» over open work the question did not ask about
 * shows the list the server's refusal names, what waits on that work on one line, and confirms
 * that list's token, not the one the question was asked with. The list pushes the answers down,
 * past a phone's fold, and the record brings them back into view before the asking starts to
 * watch them move; a scroll the reader makes after that still ends the asking. A list taller than
 * a phone's screen is held to the room over the answers and scrolls inside itself, from the keys
 * too, with its focused first line and the answers both in view.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { EVERY, openGroups, refuse, REFUSED, WAITING, WORDS } from './questionGroupsPage.ts'
import { test } from './test.ts'

const CASES = [
  { width: 1280, locale: 'en' },
  { width: 620, locale: 'en' },
  { width: 390, locale: 'en' },
  { width: 390, locale: 'ru' },
] as const

/** Where an element stands on the screen; it must be there. */
async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('Not on screen')
  return found
}

for (const { width, locale } of CASES) {
  const words = WORDS[locale]

  test(`at ${width}px in ${locale} a group's findings stand ticked, and Do sends only those left ticked`, async ({
    page,
  }) => {
    const { group, requests } = await openGroups(page, locale, width, ['The group'])
    const { one, findings, answer } = group('The group')
    await one.scrollIntoViewIfNeeded()
    // The proposed goal with its conditions, and a box for each finding, every one ticked.
    await expect(one.locator('[data-kind-part="conditions"]')).toContainText(
      'Every switch says its state',
    )
    await expect(one.getByRole('group', { name: words.findings })).toBeVisible()
    await expect(findings).toHaveCount(3)
    for (const box of await findings.all()) await expect(box).toBeChecked()
    await expect(answer(words.do)).toBeVisible()

    await one.getByRole('checkbox', { name: 'MAIN-312 · The hint reads too pale' }).uncheck()
    await expect(answer(`${words.do}: 2`)).toBeVisible()
    await expect(answer(words.do)).toHaveCount(0)
    expect(requests.writes).toHaveLength(0)

    await answer(`${words.do}: 2`).click()
    await expect
      .poll(() => requests.writes.map((write) => write.body.answers))
      .toEqual([{ answer: 'do', items: ['main-311', 'main-313'] }])
    await expect(one.locator('.request-state')).toContainText(words.answered)
  })

  test(`at ${width}px in ${locale} with no finding ticked Do and «Later…» are unavailable, the reason under them`, async ({
    page,
  }) => {
    const { group, requests } = await openGroups(page, locale, width, ['The group'])
    const { one, findings, answer } = group('The group')
    await one.scrollIntoViewIfNeeded()
    await expect(findings).toHaveCount(3)
    for (const box of await findings.all()) await box.uncheck()

    const reason = one.getByText(words.tickFirst, { exact: true })
    await expect(reason).toBeVisible()
    const blocked = [answer(`${words.do}: 0`), answer(words.later)]
    for (const button of blocked) {
      await expect(button).toBeDisabled()
      await expect(button).toHaveAccessibleDescription(words.tickFirst)
    }
    await expect(answer(words.drop)).toBeEnabled()
    // The reason stands under the answers and inside the record.
    const [under, later, record] = await Promise.all(
      [reason, answer(words.later), one].map((found) => box(found)),
    )
    expect(under.y).toBeGreaterThanOrEqual(later.y + later.height)
    expect(under.x + under.width).toBeLessThanOrEqual(record.x + record.width + 0.5)
    expect(requests.writes).toHaveLength(0)

    // One ticked again gives both back, and the reason goes.
    await findings.first().check()
    await expect(answer(`${words.do}: 1`)).toBeEnabled()
    await expect(answer(words.later)).toBeEnabled()
    await expect(reason).toHaveCount(0)
  })

  test(`at ${width}px in ${locale} «Later…» puts the whole group off to a day or until a card closes`, async ({
    page,
  }) => {
    const { group, requests } = await openGroups(page, locale, width, ['By a day', 'By a card'])
    const byDay = group('By a day')
    await byDay.one.scrollIntoViewIfNeeded()
    await byDay.answer(words.later).click()
    await byDay.one.getByLabel(words.day).fill('2099-03-01')
    await byDay.answer(words.putOff).click()

    const byCard = group('By a card')
    await byCard.one.scrollIntoViewIfNeeded()
    await byCard.answer(words.later).click()
    const combo = byCard.one.getByRole('combobox', { name: words.card })
    await combo.click()
    await combo.pressSequentially('tray')
    await page.getByRole('option').first().click()
    await byCard.answer(words.putOff).click()

    await expect
      .poll(() => requests.writes.map((write) => write.body.answers))
      .toEqual([
        { answer: 'later', items: EVERY, until: '2099-03-01' },
        { answer: 'later', items: EVERY, until: 'MAIN-320' },
      ])
  })

  test(`at ${width}px in ${locale} «Don't do» over work the group did not ask about confirms the refusal's list`, async ({
    page,
  }) => {
    const { one, listed, refused, requests } = await refuse(page, { locale, width }, WAITING)

    // The refusal's list stands over the answers, what closes and what waits on it, focus on what
    // it says, and the asking again.
    await expect(listed.locator('[data-cancel-part="closes"]')).toContainText(
      'MAIN-314 Accepted work under the goal · codex · 71aa0000',
    )
    await expect(listed.locator('[data-cancel-part="waiting"]')).toContainText('MAIN-315')
    await expect(listed.getByRole('alert')).toBeFocused()
    await expect(one.getByRole('alert').filter({ hasText: words.asked })).toBeVisible()
    expect(refused).toEqual([
      expect.objectContaining({ answers: { answer: 'drop', items: EVERY } }),
    ])

    // The list pushed the answers down, and the record brought them back into view itself: the
    // press that confirms needs no scroll, which would end the asking.
    const confirm = one.getByRole('button', { name: words.drop, exact: true }).last()
    await expect(confirm).toBeInViewport({ ratio: 1 })
    await confirm.click()
    await expect
      .poll(() => requests.writes.map((write) => write.body.answers))
      .toEqual([{ answer: 'drop', items: EVERY, cancels: 'refused-token' }])
    await expect(one.locator('.request-state')).toContainText(words.answered)
    await expect(listed).toHaveCount(0)
  })

  test(`at ${width}px in ${locale} what waits on the work a refusal lists stands on one line, its reference whole`, async ({
    page,
  }) => {
    const { listed } = await refuse(page, { locale, width }, WAITING)
    const waits = listed.locator('[data-cancel-part="waiting"] [data-cancel-waits]')
    await expect(waits).toHaveText(words.waitsOn)
    const lines = await waits.evaluate((element) => {
      const rects = element.getClientRects()
      const box = element.closest('[data-cancel-list]')?.getBoundingClientRect()
      return { count: rects.length, past: (rects[0]?.right ?? 0) - (box?.right ?? 0) }
    })
    expect(lines.count).toBe(1)
    expect(lines.past).toBeLessThanOrEqual(0.5)
  })
}

for (const locale of ['en', 'ru'] as const) {
  const words = WORDS[locale]

  test(`on a phone in ${locale} a scroll the reader makes after the refusal's list came still ends the asking`, async ({
    page,
  }) => {
    // A phone's screen shorter than the question and its list, whatever the window's head takes.
    const { one, listed, requests } = await refuse(
      page,
      { locale, width: 390, height: 760 },
      WAITING,
    )
    await expect(listed.getByRole('alert')).toBeFocused()
    const asked = one.getByRole('alert').filter({ hasText: words.asked })
    await expect(asked).toBeVisible()
    // The record scrolled the list to bring its answers into view, so there is room back up.
    const scroller = page.getByRole('dialog').locator('.dialog-frame-body')
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    await page.mouse.wheel(0, -60)
    await expect(asked).toHaveCount(0)
    expect(requests.writes).toHaveLength(0)
  })
}

/** The refusal with more open work under the goal than a phone's screen holds. */
const LONG = {
  error: {
    ...REFUSED.error,
    cancels: Array.from({ length: 30 }, (_, index) => ({
      ...REFUSED.error.cancels[0],
      reference: `MAIN-${400 + index}`,
      title: `Accepted work under the goal, part ${index + 1}`,
    })),
  },
}

test('on a phone a refusal list taller than the screen keeps its first line and the answers in view, and scrolls inside itself', async ({
  page,
}, testInfo) => {
  const words = WORDS.en
  const { one, listed, requests } = await refuse(page, { locale: 'en', width: 390 }, LONG)
  const lead = listed.getByRole('alert')
  const asked = one.getByRole('alert').filter({ hasText: words.asked })
  const confirm = one.getByRole('button', { name: words.drop, exact: true }).last()
  await expect(listed.locator('[data-cancel-part="closes"]').getByRole('listitem')).toHaveCount(30)
  await expect(lead).toBeFocused()
  await expect(asked).toBeVisible()

  // The record brought the answers into view, and the focused first line stands in view too:
  // under the record's head that sticks over the panel's top, and the answers over its foot.
  const scroller = page.getByRole('dialog').locator('.dialog-frame-body')
  const [panel, head, first, answer] = await Promise.all(
    [scroller, one.locator('[data-stuck-edge="start"]').first(), lead, confirm].map((found) =>
      box(found),
    ),
  )
  expect(first.y).toBeGreaterThanOrEqual(head.y + head.height - 0.5)
  expect(answer.y + answer.height).toBeLessThanOrEqual(panel.y + panel.height + 0.5)
  expect(await listed.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('long-refusal-390.png') })

  // The keys scroll the list from its first line, and it moves no answer: the asking stands.
  await page.keyboard.press('PageDown')
  await expect.poll(() => listed.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await box(confirm)).toEqual(answer)
  // The list is a stop of its own on the way back from the answers, and Home takes it up again.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(listed).toBeFocused()
  await page.keyboard.press('Home')
  await expect.poll(() => listed.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(asked).toBeVisible()

  // A scroll the reader makes over the panel still moves the answers, and ends the asking.
  await page.mouse.move(answer.x + answer.width / 2, answer.y + answer.height / 2)
  await page.mouse.wheel(0, -60)
  await expect(asked).toHaveCount(0)
  expect(requests.writes).toHaveLength(0)
})
