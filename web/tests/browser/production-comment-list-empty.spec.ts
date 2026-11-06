/**
 * A list sent with nothing ticked, read off the built page. The owner's rule: the marks go with
 * one send, and a send with nothing ticked is allowed, which the agent reads as not decided. So
 * an empty send writes `{"items": []}` and refuses nothing, and so does a change that unticks
 * every mark, by the pointer and by the keyboard, in both languages, at a desktop width and a
 * phone's.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { boxes, openList, OPTIONS } from './commentListBackend.ts'
import { test } from './test.ts'

const WORDS = {
  en: {
    send: 'Send marks',
    change: 'Change',
    save: 'Save change',
    ticked: (n: number) => `You ticked ${n} of ${OPTIONS}`,
    refused: 'Tick at least one option.',
  },
  ru: {
    send: 'Отправить отметки',
    change: 'Изменить',
    save: 'Сохранить',
    ticked: (n: number) => `Вы отметили ${n} из ${OPTIONS}`,
    refused: 'Отметьте хотя бы один вариант.',
  },
}
type Words = (typeof WORDS)['en']

const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true })

/** A press and a tick as the pointer makes them, and as the keyboard does. */
const WAYS = {
  pointer: {
    press: (control: Locator) => control.click(),
    flip: (box: Locator) => box.click(),
  },
  keyboard: {
    press: async (control: Locator) => {
      await control.focus()
      await control.press('Enter')
    },
    flip: async (box: Locator) => {
      await box.focus()
      await box.press('Space')
    },
  },
}

async function expectNotRefused(list: Locator, words: Words) {
  await expect(list.getByText(words.refused, { exact: true })).toHaveCount(0)
  await expect(list.locator('[aria-invalid="true"]')).toHaveCount(0)
}

async function inLocale(page: Page, locale: 'en' | 'ru', width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390])
    for (const [by, way] of Object.entries(WAYS)) {
      test(`${locale} at ${width}, by ${by}: nothing ticked sends, and unticking all saves`, async ({
        page,
      }) => {
        await inLocale(page, locale, width)
        const words = WORDS[locale]
        const { list, requests } = await openList(page)
        await expect(boxes(list)).toHaveCount(OPTIONS)

        await way.press(button(list, words.send))
        await expect(list).toContainText(words.ticked(0))
        await expectNotRefused(list, words)
        expect(requests.writes.map((write) => [write.action, write.body.answers])).toEqual([
          ['answer', { items: [] }],
        ])

        await way.press(button(list, words.change))
        await way.flip(boxes(list).first())
        await expect(boxes(list).first()).toBeChecked()
        await way.press(button(list, words.save))
        await expect(list).toContainText(words.ticked(1))

        await way.press(button(list, words.change))
        await expect(boxes(list).first()).toBeChecked()
        await way.flip(boxes(list).first())
        await expect(boxes(list).first()).not.toBeChecked()
        await expect(button(list, words.save)).toBeEnabled()
        await way.press(button(list, words.save))
        await expect(list).toContainText(words.ticked(0))
        await expectNotRefused(list, words)
        expect(requests.writes.map((write) => [write.action, write.body.answers])).toEqual([
          ['answer', { items: [] }],
          ['change', { items: ['a'] }],
          ['change', { items: [] }],
        ])
      })
    }
