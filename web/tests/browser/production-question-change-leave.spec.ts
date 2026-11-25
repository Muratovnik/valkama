/**
 * Every way out of an answer's change form gives «Change answer» the focus back under reduced
 * motion, ringed after a key and in sight, in both languages at a desktop's widths.
 *
 * The way in stands hidden while the form is open and comes back in the render that closes it,
 * in the same task that gives it the focus. Under reduced motion nothing may pass through a
 * transition on the way (`shell.css`): a control still hidden for an instant refuses the focus,
 * and it falls to the page. A question of one field closes the quickest, so it is the one asked.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { frames } from './frames.ts'
import { inSightClear } from './heldWrite.ts'
import { asked, routeField } from './questionBackend.ts'
import { openQuestion } from './questionPage.ts'
import { test } from './test.ts'

const WAIT = { timeout: 10_000 }
const single: Parameters<typeof asked>[0] = {
  status: 'answered',
  fields: [routeField],
  answers: { route: 'move' },
  answered_by: 'user',
  by_person: true,
}
const WORDS = {
  en: { change: 'Change answer', cancel: 'Cancel', discard: 'Discard change' },
  ru: { change: 'Изменить ответ', cancel: 'Отмена', discard: 'Отменить изменение' },
} as const
type Words = (typeof WORDS)[keyof typeof WORDS]

const button = (card: Locator, name: string) => card.getByRole('button', { name, exact: true })

/** Focuses `control` and presses `key` on it, as the keyboard leaves the form. */
async function keyOn(page: Page, control: Locator, key: string) {
  await control.focus(WAIT)
  await page.keyboard.press(key)
}

/** Each way out of the form from its foot, and whether a key made it, which rings the landing. */
const WAYS: Record<
  string,
  { keyed: boolean; leave: (page: Page, card: Locator, words: Words) => Promise<void> }
> = {
  Escape: {
    keyed: true,
    leave: (page, card, words) => keyOn(page, button(card, words.cancel), 'Escape'),
  },
  Enter: {
    keyed: true,
    leave: (page, card, words) => keyOn(page, button(card, words.cancel), 'Enter'),
  },
  Cancel: { keyed: false, leave: (_page, card, words) => button(card, words.cancel).click(WAIT) },
  // A change asks before it is thrown away; Discard, by the keyboard, is the way out then.
  Discard: {
    keyed: true,
    async leave(page, card, words) {
      await card.getByRole('radio', { name: 'Keep the comments', exact: true }).check(WAIT)
      await keyOn(page, button(card, words.cancel), 'Enter')
      await keyOn(page, button(card, words.discard), 'Enter')
    },
  },
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1024] as const)
    for (const [way, { keyed, leave }] of Object.entries(WAYS))
      test(`under reduced motion, ${way} out of a one-field change gives the way in the focus, in ${locale} at ${String(width)}`, async ({
        page,
      }) => {
        const words = WORDS[locale]
        await page.addInitScript((code) => localStorage.setItem('valkama-locale', code), locale)
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const { card, drawer } = await openQuestion(page, [asked(single)])
        const change = button(card, words.change)
        await change.click(WAIT)
        await expect(card.getByRole('radio')).toHaveCount(routeField.options.length, WAIT)
        await leave(page, card, words)
        await expect(card.getByRole('radio')).toHaveCount(0, WAIT)
        await expect(change).toBeFocused(WAIT)
        await frames(drawer)
        // Ringed after a key; a press of the pointer rings nothing (DESIGN.md, Accessibility).
        expect(await change.evaluate((node) => node.matches(':focus-visible'))).toBe(keyed)
        expect(await inSightClear(change)).toBe(true)
      })
