/**
 * A card open on the questions the double answers, for the specs that read them.
 */
import type { Page } from '@playwright/test'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

import { openCard } from './editorPage.ts'
import { installQuestions } from './questionBackend.ts'
export { asked, QUESTION_ID } from './questionBackend.ts'
import { installStreamDouble } from './streamDouble.ts'

/**
 * A card open on these questions, with the stream under the test's hand. `prepare` adds
 * routes of the test's own, over the backend's, before the page first asks.
 */
export async function openQuestion(
  page: Page,
  entries: InputRequestEntry[],
  prepare?: () => Promise<unknown>,
) {
  let requests: Awaited<ReturnType<typeof installQuestions>> | undefined
  let stream: Awaited<ReturnType<typeof installStreamDouble>> | undefined
  const opened = await openCard(page, async () => {
    requests = await installQuestions(page, entries)
    stream = await installStreamDouble(page)
    await prepare?.()
  })
  if (!requests || !stream) throw new Error('Not installed')
  return { ...opened, requests, stream, card: opened.drawer.locator('.request-card') }
}
