/**
 * The start of an agent's session where a card prints it, read off the built page in both
 * languages: in its system events.
 *
 * The system events printed an author's session whole, 36 characters in the interface font,
 * where every other surface prints its start in the metadata font, the whole id in its tooltip
 * and a link where the server knows the session.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { launchedSessionId } from './executionFixtures.ts'
import { openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

type Locale = 'en' | 'ru'

/** A session the server does not know, as an agent writes it. */
const SESSION = '019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b'
/** A session the server knows, which a start links to. */
const KNOWN = launchedSessionId

async function setUp(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

const EVENTS = { en: 'System events', ru: 'Системные события' } as const

/** A claim an agent's call made, signed with its session. */
const event = (author: string, at: string, session: string) => ({
  action: 'claimed' as const,
  detail: '',
  author,
  at,
  identity: { state: 'confirmed' as const, source: null, session_id: session, agent_id: null },
})

for (const locale of ['en', 'ru'] as const)
  test(`${locale}: a system event prints its author's session as its start, the whole id behind it`, async ({
    page,
  }) => {
    await setUp(page, locale, 1280)
    const opened = await openQuestion(page, [])
    opened.backend.item.events.push(
      event(`kolo (session ${KNOWN})`, '2026-10-24T10:00:00Z', KNOWN),
      event(`elko (session ${SESSION})`, '2026-10-24T09:00:00Z', SESSION),
    )
    await page.reload()
    await opened.drawer.getByRole('tab', { name: EVENTS[locale] }).click()
    const author = (name: string) =>
      opened.drawer.locator('.entry-author').filter({ hasText: name }).locator('.session-start')
    const mono = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('i'))
      probe.style.fontFamily = 'var(--font-family-mono)'
      const family = getComputedStyle(probe).fontFamily
      probe.remove()
      return family
    })
    for (const [name, whole] of [
      ['kolo', KNOWN],
      ['elko', SESSION],
    ] as const) {
      const start = author(name)
      await expect(start).toHaveText(whole.slice(0, 13))
      await expect(start).toHaveAttribute('title', whole)
      await expect(start).toHaveCSS('font-family', mono)
    }
    // A link only to a session the server knows, which says the whole id as well.
    await expect(author('kolo').getByRole('button')).toHaveAttribute(
      'title',
      new RegExp(KNOWN, 'u'),
    )
    await expect(author('elko').locator('a')).toHaveCount(0)
  })
