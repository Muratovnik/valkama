/**
 * A group of findings a triage review proposes as one goal, in «Needs my answer», at the widths
 * its layout changes at and at a phone's width in both languages: its findings stand ticked, an
 * unticked one leaves Do naming how many go and leaves the answer, with none ticked Do and
 * «Later…» are unavailable with the reason under them, «Later…» puts the group off to a day or a
 * card's close with its findings, and «Don't do» over open work the question did not ask about
 * shows the list the server's refusal names, what waits on that work on one line, and confirms
 * that list's token, not the one the question was asked with.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { ofPurpose, openKinds } from './questionKindsPage.ts'
import { test } from './test.ts'

const EVERY = ['main-311', 'main-312', 'main-313']
/** What the server lists when a drop meets accepted work under the goal, and its own token. */
const REFUSED = {
  error: {
    code: 'cancel_list',
    message:
      '[cancel_list] MAIN-264 has 1 open item(s) under it, and cancelling it cancels them all: read the list, then send the same transition with cancels set to list_token refused-token',
    cancels: [
      {
        reference: 'MAIN-314',
        title: 'Accepted work under the goal',
        kind: 'task',
        state: { key: 'dev', name: 'Dev', category: 'active' },
        container_state: null,
        holder: ['codex (session 71aa0000)'],
      },
    ],
    dependents: [
      {
        reference: 'MAIN-315',
        title: 'Release notes for the settings window',
        kind: 'task',
        waits_on: 'MAIN-314',
        how: 'blocks',
      },
    ],
    list_token: 'refused-token',
  },
}

const WORDS = {
  en: {
    do: 'Do',
    later: 'Later…',
    drop: 'Don’t do',
    putOff: 'Put off',
    day: 'Until a day',
    card: 'Until a card closes',
    findings: 'Findings',
    asked: '«Don’t do» — are you sure?',
    answered: 'You answered',
    tickFirst: 'Tick a finding first, or answer «Don’t do».',
    waitsOn: 'waits on MAIN-314',
  },
  ru: {
    do: 'Делать',
    later: 'Позже…',
    drop: 'Не делать',
    putOff: 'Отложить',
    day: 'До даты',
    card: 'До закрытия карточки',
    findings: 'Находки',
    asked: '«Не делать» — точно?',
    answered: 'Вы ответили',
    tickFirst: 'Сначала отметьте находку или ответьте «Не делать».',
    waitsOn: 'ждёт MAIN-314',
  },
} as const

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

async function openGroups(page: Page, locale: 'en' | 'ru', width: number, prompts: string[]) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  const entries = prompts.map((prompt) => ofPurpose('triage', { prompt }))
  const opened = await openKinds(page, entries, width)
  const group = (prompt: string) => {
    const one = opened.record(prompt)
    const findings = one.locator('[data-findings]').getByRole('checkbox')
    const answer = (name: string) => one.getByRole('button', { name, exact: true })
    return { one, findings, answer }
  }
  return { ...opened, group }
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
    const { group, requests } = await openGroups(page, locale, width, ['The group'])
    // The first drop is refused with the list; every later write goes to the questions' server.
    const refused: unknown[] = []
    await page.route('**/api/modules/planning/request/answer', async (route) => {
      if (refused.length) return route.fallback()
      refused.push(route.request().postDataJSON())
      return route.fulfill({ status: 409, json: REFUSED })
    })
    const { one, answer } = group('The group')
    await one.scrollIntoViewIfNeeded()
    await answer(words.drop).click()
    await expect(one.getByRole('alert').filter({ hasText: words.asked })).toBeVisible()
    await one.getByRole('button', { name: words.drop, exact: true }).last().click()

    // The refusal's list stands over the answers, focus on what it says, and the asking again.
    const listed = one.locator('[data-cancel-list]')
    await expect(listed.locator('[data-cancel-part="closes"]')).toContainText(
      'MAIN-314 Accepted work under the goal · codex · 71aa0000',
    )
    // What waits on that work says so on one line, its reference whole, within the list.
    const waits = listed.locator('[data-cancel-waits]')
    await expect(waits).toHaveText(words.waitsOn)
    const lines = await waits.evaluate((element) => {
      const rects = element.getClientRects()
      const box = element.closest('[data-cancel-list]')?.getBoundingClientRect()
      return { count: rects.length, past: (rects[0]?.right ?? 0) - (box?.right ?? 0) }
    })
    expect(lines.count).toBe(1)
    expect(lines.past).toBeLessThanOrEqual(0.5)
    await expect(listed.getByRole('alert')).toBeFocused()
    await expect(one.getByRole('alert').filter({ hasText: words.asked })).toBeVisible()
    expect(refused).toEqual([
      expect.objectContaining({ answers: { answer: 'drop', items: EVERY } }),
    ])

    await one.getByRole('button', { name: words.drop, exact: true }).last().click()
    await expect
      .poll(() => requests.writes.map((write) => write.body.answers))
      .toEqual([{ answer: 'drop', items: EVERY, cancels: 'refused-token' }])
    await expect(one.locator('.request-state')).toContainText(words.answered)
    await expect(listed).toHaveCount(0)
  })
}
