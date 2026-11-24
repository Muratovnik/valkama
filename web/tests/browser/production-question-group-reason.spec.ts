/**
 * Why a group's Do and «Later…» wait for a finding, in «Needs my answer» (DESIGN.md, the group's
 * passage): the reason stands under the answers in a room held for it while the question waits,
 * so unticking every finding and ticking one again moves nothing under the answers; given its
 * room only while it stood, it moved the next question down and up. With the choice of a day
 * open, the reason is said once, under its «Put off», which it keeps unavailable too: said under
 * the answers as well, the same sentence stood twice on one screen. At every width the layout
 * changes at, in both languages.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { openGroups, WORDS } from './questionGroupsPage.ts'
import { test } from './test.ts'

const WIDTHS = [320, 390, 620, 1024, 1280] as const

/** How far below the top of `record` the top of `next` stands, as one frame draws both. */
async function below(record: Locator, next: Locator) {
  const [own, other] = await Promise.all([record.elementHandle(), next.elementHandle()])
  try {
    return await record
      .page()
      .evaluate(([one, two]) => two.getBoundingClientRect().top - one.getBoundingClientRect().top, [
        own,
        other,
      ] as const)
  } finally {
    await Promise.all([own?.dispose(), other?.dispose()])
  }
}

type Group = Awaited<ReturnType<typeof openGroups>>['group']

/** The two prompts, the one whose group stands above the other's first. */
async function upperFirst(group: Group, [first, second]: readonly [string, string]) {
  return (await below(group(first).one, group(second).one)) > 0
    ? ([first, second] as const)
    : ([second, first] as const)
}

for (const locale of ['ru', 'en'] as const)
  for (const width of WIDTHS)
    test(`at ${width}px in ${locale} a group's reason to tick a finding moves nothing and is said once`, async ({
      page,
    }) => {
      const words = WORDS[locale]
      const { group } = await openGroups(page, locale, width, ['The group', 'The next group'])
      const [upper, lower] = await upperFirst(group, ['The group', 'The next group'])
      const { one: record, findings, answer } = group(upper)
      const after = group(lower).one
      await record.scrollIntoViewIfNeeded()
      await expect(findings).toHaveCount(3)
      const reason = record.getByText(words.tickFirst, { exact: true }).filter({ visible: true })
      const untickAll = async () => {
        for (const box of await findings.all()) await box.uncheck()
      }

      // Every finding unticked: Do and «Later…» wait, the reason says why, and the next question
      // stays where it stood.
      const ticked = await below(record, after)
      await expect(reason).toHaveCount(0)
      await untickAll()
      await expect(reason).toHaveCount(1)
      await expect(answer(`${words.do}: 0`)).toHaveAccessibleDescription(words.tickFirst)
      expect(Math.abs((await below(record, after)) - ticked)).toBeLessThanOrEqual(0.5)

      // One ticked again: the reason goes, and still nothing moves.
      await findings.first().check()
      await expect(reason).toHaveCount(0)
      expect(Math.abs((await below(record, after)) - ticked)).toBeLessThanOrEqual(0.5)

      // With the choice of a day open, the reason is said once, under «Put off», which both Do
      // and «Put off» name; the next question stays as it stood with the choice open.
      await answer(words.later).click()
      const putOff = record.getByRole('button', { name: words.putOff, exact: true })
      await expect(putOff).toBeVisible()
      const opened = await below(record, after)
      await untickAll()
      await expect(reason).toHaveCount(1)
      await expect(putOff).toBeDisabled()
      await expect(putOff).toHaveAccessibleDescription(words.tickFirst)
      await expect(answer(`${words.do}: 0`)).toHaveAccessibleDescription(words.tickFirst)
      expect(Math.abs((await below(record, after)) - opened)).toBeLessThanOrEqual(0.5)
    })
