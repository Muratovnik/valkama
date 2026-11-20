/**
 * A group of findings a triage review proposes as one goal, in «Needs my answer»: the group
 * opened in a language at a width, and its «Don't do» confirmed once over open work the
 * question did not ask about, which the server refuses with the list it names.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { ofPurpose, openKinds } from './questionKindsPage.ts'

export const EVERY = ['main-311', 'main-312', 'main-313']
/** What the server lists when a drop meets accepted work under the goal, and its own token. */
export const REFUSED = {
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
    dependents: [] as object[],
    list_token: 'refused-token',
  },
}
/** The same refusal, with work outside the goal that waits on the work it would cancel. */
export const WAITING = {
  error: {
    ...REFUSED.error,
    dependents: [
      {
        reference: 'MAIN-315',
        title: 'Release notes for the settings window',
        kind: 'task',
        waits_on: 'MAIN-314',
        how: 'blocks',
      },
    ],
  },
}

export const WORDS = {
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

export async function openGroups(
  page: Page,
  locale: 'en' | 'ru',
  width: number,
  prompts: string[],
) {
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

/**
 * The group's «Don't do» confirmed once, which the server refuses with this list; every later
 * write goes to the questions' server. `height` gives the screen a height of its own.
 */
export async function refuse(
  page: Page,
  { locale, width, height }: { locale: 'en' | 'ru'; width: number; height?: number },
  refusal: typeof REFUSED,
) {
  const words = WORDS[locale]
  const { group, requests } = await openGroups(page, locale, width, ['The group'])
  if (height !== undefined) await page.setViewportSize({ width, height })
  const refused: unknown[] = []
  await page.route('**/api/modules/planning/request/answer', async (route) => {
    if (refused.length) return route.fallback()
    refused.push(route.request().postDataJSON())
    return route.fulfill({ status: 409, json: refusal })
  })
  const { one, answer } = group('The group')
  await one.scrollIntoViewIfNeeded()
  await answer(words.drop).click()
  await expect(one.getByRole('alert').filter({ hasText: words.asked })).toBeVisible()
  await one.getByRole('button', { name: words.drop, exact: true }).last().click()
  return { one, listed: one.locator('[data-cancel-list]'), refused, requests }
}
