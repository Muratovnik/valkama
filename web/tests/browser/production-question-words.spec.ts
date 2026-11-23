/**
 * The words of the questions Valkama asks, in «Needs my answer» and on the card, at a phone's,
 * a narrow and a desktop width, in both languages (DESIGN.md, the kinds of question): a cancel
 * and a return name their answers in the words of what answers them, the buttons in the list
 * and the form's options on the card, and say neither the number nor the title that the head
 * over them shows. However long the card's title and the agent's reason, the ask stands in sight
 * without «Show all».
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

import { workItemRef } from './planningFixtures.ts'
import { ofPurpose } from './questionKindsPage.ts'
import { openQuestion } from './questionPage.ts'
import { test } from './test.ts'

const WIDTHS = [390, 620, 1280] as const
const LOCALES = ['ru', 'en'] as const
type Locale = (typeof LOCALES)[number]

/** The longest title a card takes, and a reason of five sentences. */
const TITLE =
  `Экспорт карточек в таблицу пишет каждое поле, ${'и длинное название переносится '.repeat(6)}`
    .slice(0, 200)
    .trim()
const REASON =
  'The same export is done in another task, where every field is written. What is left here is a draft nobody will finish. The session that filed it ended a week ago and its branch is gone. Two of its steps were moved to that task with their comments, and the third one was about a format nobody uses any more. Nothing else points to it, and no session holds it.'
const REFERENCE = workItemRef.reference

const QUESTIONS = {
  cancel: () =>
    ofPurpose('cancel', {
      title: TITLE,
      prompt: `An agent cancels ${REFERENCE}, filed outside its own work: ${TITLE}. Its reason: ${REASON} Cancel it, or keep it.`,
      prompt_message: {
        key: 'cancel_asked',
        values: {
          reference: REFERENCE,
          point: 'cancel_outside',
          title: TITLE,
          reason: REASON,
          sessions_asked: false,
          objections: [],
          unanswered: [],
        },
      },
    }),
  return: () =>
    ofPurpose('return', {
      title: TITLE,
      prompt: `${REFERENCE} was put off until 3 new comments; that has come. Do it, put it off again, or drop it.`,
      prompt_message: {
        key: 'put_off_came',
        values: { reference: REFERENCE, until: null, item: null, comments: 3 },
      },
    }),
} satisfies Record<string, () => InputRequestEntry>

/** The answers of each question in the words of its buttons, and its ask that names them. */
const WORDS: Record<Locale, Record<keyof typeof QUESTIONS, { answers: string[]; ask: string }>> = {
  ru: {
    cancel: { answers: ['Отменить', 'Оставить'], ask: 'Отменить или оставить?' },
    return: { answers: ['Делать', 'Позже…', 'Не делать'], ask: 'Делать, позже или не делать?' },
  },
  en: {
    cancel: { answers: ['Cancel', 'Keep'], ask: 'Cancel it, or keep it?' },
    return: { answers: ['Do', 'Later…', 'Don’t do'], ask: 'Do it, later, or don’t do it?' },
  },
}
const SHOW_ALL = /^(?:Show all|Показать полностью)$/u

/**
 * The prompt that holds `ask`, whole, and where the ask ends against the bottom of what the
 * held text shows: the box `CollapsibleText` clips, or the prompt itself where nothing is held.
 */
async function promptOf(block: Locator, ask: string) {
  const words = block.getByText(ask, { exact: false })
  await expect(words).toHaveCount(1)
  return words.evaluate((paragraph, said) => {
    let held: Element | null = paragraph
    while (held && getComputedStyle(held).overflow !== 'hidden') held = held.parentElement
    const box = (held ?? paragraph).getBoundingClientRect()
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    let end = Number.NaN
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(said)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + said.length)
      end = Math.max(...[...range.getClientRects()].map((rect) => rect.bottom))
    }
    return { text: (held ?? paragraph).textContent ?? '', below: end - box.bottom }
  }, ask)
}

/** What a question's words are checked against: its answers and ask, and its agent's reason. */
type Expected = {
  /** The reason runs on under «Show all» at this width, the ask standing above it. */
  held: boolean
  /** The prompt carries the agent's reason. */
  reasoned: boolean
  words: { answers: string[]; ask: string }
}

async function checkWords(block: Locator, answers: Locator, expected: Expected) {
  const { words, reasoned, held } = expected
  await block.scrollIntoViewIfNeeded()
  await expect(answers).toHaveCount(words.answers.length)
  for (const [index, word] of words.answers.entries())
    await expect(answers.nth(index)).toHaveAccessibleName(word)
  const prompt = await promptOf(block, words.ask)
  expect(prompt.text).not.toContain(TITLE)
  expect(prompt.text).not.toContain(REFERENCE)
  // In sight as it stands, «Show all» unpressed: nothing of the ask lies under the held text's
  // bottom, while the agent's reason may run on under it.
  if (reasoned) expect(prompt.text).toContain(REASON.split('.')[0] ?? REASON)
  expect(prompt.below).toBeLessThanOrEqual(0.5)
  if (held) await expect(block.getByRole('button', { name: SHOW_ALL })).toHaveCount(1)
}

async function openList(page: Page) {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^(?:Needs my answer|Ждут моего ответа)/u }).click()
  return page.getByRole('dialog', { name: /^(?:Needs my answer|Ждут моего ответа)$/u })
}

for (const locale of LOCALES)
  for (const width of WIDTHS)
    for (const name of ['cancel', 'return'] as const) {
      // On a phone a cancel's reason runs on under «Show all».
      const expected = {
        words: WORDS[locale][name],
        reasoned: name === 'cancel',
        held: name === 'cancel' && width === 390,
      }

      test(`at ${width}px in ${locale} the ${name} question names its answers as they are pressed`, async ({
        page,
      }) => {
        await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
        await page.setViewportSize({ width, height: 900 })
        const { card, drawer } = await openQuestion(page, [QUESTIONS[name]()])
        // On the card its form answers it, its options named as the list's buttons are.
        await checkWords(card, card.getByRole('radio'), expected)
        const dialog = await openList(page)
        await expect(drawer).toHaveCount(0)
        const block = dialog.locator('.request-card')
        await expect(block).toHaveCount(1)
        await checkWords(block, block.locator('.request-pair').getByRole('button'), expected)
      })
    }
