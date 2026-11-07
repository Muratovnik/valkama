/**
 * Where the interface moves focus in answer to an action, in the built app: focus moves there
 * whatever the reader used, and the ring is drawn only when a key was the last input. The owner
 * chose no ring after a press of a mouse, pen or finger, after one stood round a reply they had
 * just sent with the mouse; a keyboard user still sees where focus went (WCAG 2.4.7).
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { listEntry, openList } from './commentListBackend.ts'
import { LINK } from './documentBackend.ts'
import { openFromCard } from './documentFocusMoves.ts'
import { openCard } from './editorPage.ts'
import { frames } from './frames.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { asked, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

type Input = 'keyboard' | 'mouse'
const INPUTS: Input[] = ['mouse', 'keyboard']

/** The action as each hand does it: a click, or focus put on the control and Enter on it. */
async function act(control: Locator, input: Input) {
  if (input === 'mouse') {
    await control.click()
    return
  }
  await control.focus()
  await control.press('Enter')
}

/** What the browser draws round `target` now, read two frames after the move settled. */
const ringOf = async (page: Page, target: Locator) => {
  await frames(page.locator(':root'))
  return target.evaluate((node) => ({
    visible: node.matches(':focus-visible'),
    outline: getComputedStyle(node).outlineStyle,
  }))
}

const QUIET = { visible: false, outline: 'none' }
/** What a landing draws after each hand: the ring after a key only. */
const RING_AFTER = {
  mouse: QUIET,
  finger: QUIET,
  keyboard: { visible: true, outline: 'solid' },
}

/** Focus is on the landing whatever the hand; what is drawn round it there, to compare. */
async function landing(page: Page, target: Locator, input: keyof typeof RING_AFTER) {
  await expect(target).toBeFocused()
  // Off whatever it was over, so no hover is read; a finger leaves no pointer to take away.
  if (input !== 'finger') await page.mouse.move(0, 0)
  return ringOf(page, target)
}

const WORDS = {
  en: { field: 'Your reply', reply: 'Reply', send: 'Send' },
  ru: { field: 'Ваш ответ', reply: 'Ответить', send: 'Отправить' },
} as const

/** The card with its discussion, in `locale`, at `width`. */
async function openTalkedOn(page: Page, locale: keyof typeof WORDS = 'en', width = 1280) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  const opened = await openCard(page)
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  await expect(opened.drawer.locator('.thread-entry').first()).toBeVisible()
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  const threadOf = (text: string) =>
    opened.drawer.locator('.thread-entry').filter({ hasText: text })
  return { ...opened, threadOf }
}

const doNothing = () => {}

/** Every write of the card from here on waits to be let go: a round trip under the test's hand. */
async function heldWrites(page: Page) {
  let letGo = doNothing
  const released = new Promise<void>((resolve) => (letGo = resolve))
  await page.route('**/api/planning/work-item/**', async (route) => {
    if (route.request().method() !== 'GET') await released
    await route.fallback()
  })
  return letGo
}

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390])
    for (const input of INPUTS)
      test(`${locale} at ${width}: a reply just written by ${input} takes focus, ringed only after a key`, async ({
        page,
      }) => {
        const words = WORDS[locale]
        const { threadOf } = await openTalkedOn(page, locale, width)
        const thread = threadOf('Should the second report')
        await thread.getByRole('button', { name: words.reply, exact: true }).first().click()
        await thread.getByRole('textbox', { name: words.field }).fill('Beside it, then.')
        const letGo = await heldWrites(page)
        await act(thread.getByRole('button', { name: words.send, exact: true }), input)
        // The pointer passes over the page while the write is out: that is no input of its own,
        // so the reply still answers the hand that sent it.
        await page.mouse.move(width / 2, 300)
        await page.mouse.move(10, 10)
        letGo()
        const written = thread.locator('.reply').filter({ hasText: 'Beside it, then.' })
        expect(await landing(page, written, input)).toEqual(RING_AFTER[input])
        await shot(page, `reply-${input}-${locale}-${width}`)
      })

for (const input of INPUTS) {
  test(`the first reply a thread opens on takes focus, ringed only after a key: ${input}`, async ({
    page,
  }) => {
    const { threadOf } = await openTalkedOn(page)
    const thread = threadOf('Four replies below')
    await act(thread.getByRole('button', { name: 'Show 2 more replies', exact: true }), input)
    await expect(thread.locator('.reply')).toHaveCount(4)
    expect(await landing(page, thread.locator('.reply').first(), input)).toEqual(RING_AFTER[input])
  })

  // Where typing goes, focus is seen after a press as after a key: the field's edge turns the
  // focus colour. A click on Resolve left the field it opened focused under a grey edge.
  test(`a field the interface takes focus to shows its edge after ${input}`, async ({ page }) => {
    const { threadOf } = await openTalkedOn(page)
    const thread = threadOf('Should the second report')
    await act(thread.getByRole('button', { name: 'Resolve', exact: true }), input)
    const field = thread.getByRole('textbox', { name: 'Decision (optional)' })
    await expect(field).toBeFocused()
    await page.mouse.move(0, 0)
    const edge = async () => {
      await ringOf(page, field)
      return field.evaluate((node) => {
        const probe = document.body.appendChild(document.createElement('i'))
        probe.style.color = 'var(--color-focus-ring)'
        const focusColour = getComputedStyle(probe).color
        probe.remove()
        return {
          visible: node.matches(':focus-visible'),
          focusColour,
          edge: getComputedStyle(node).borderTopColor,
        }
      })
    }
    const shown = await edge()
    expect(shown).toEqual({
      visible: true,
      focusColour: shown.focusColour,
      edge: shown.focusColour,
    })
    await page.keyboard.type('A decision')
    expect(await edge()).toEqual(shown)
  })

  test(`the checklist's head takes focus from All steps, ringed only after a key: ${input}`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1280, height: 700 })
    const checklist = Array.from({ length: 9 }, (_, index) => ({
      id: `123e4567-e89b-42d3-a456-4266141742${String(index).padStart(2, '0')}`,
      text: `The step number ${index + 1}`,
      done: index < 2,
      claimed_by: '',
      done_by: '',
    }))
    await installBackend(page, { longRead: true, card: (read) => ({ ...read, checklist }) })
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        entity: planningWorkItemEntity(workItemRef),
      }),
    )
    const drawer = page.locator('.drawer')
    await expect(drawer).toHaveCSS('transform', 'none')
    await act(drawer.getByRole('button', { name: 'All steps', exact: true }), input)
    expect(await landing(page, drawer.locator('.checklist-head'), input)).toEqual(RING_AFTER[input])
  })

  test(`why a send failed takes focus, ringed only after a key: ${input}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { card, requests } = await openQuestion(page, [asked()])
    await card.getByRole('radio', { name: 'Move them', exact: true }).check()
    requests.failNext(503)
    await act(send(card), input)
    expect(await landing(page, card.locator('.request-foot .request-error'), input)).toEqual(
      RING_AFTER[input],
    )
  })

  test(`a question's comment list takes focus once its marks are sent, ringed only after a key: ${input}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { list } = await openList(page, [listEntry()])
    await list.getByRole('checkbox', { name: 'Widen the check' }).check()
    await act(list.getByRole('button', { name: 'Send marks', exact: true }), input)
    await expect(list).toContainText('You ticked 1 of')
    expect(await landing(page, list, input)).toEqual(RING_AFTER[input])
  })

  test(`the place a link names in a document takes focus, ringed only after a key: ${input}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { link } = await openFromCard(page, LINK)
    await act(link, input)
    const target = page.locator('.overlay-pane .document-block.is-target')
    await expect(target).toContainText('The target')
    expect(await landing(page, target, input)).toEqual(RING_AFTER[input])
  })
}

test.describe('under a finger', () => {
  test.use({ hasTouch: true })

  test('a reply sent with a tap takes focus and no ring', async ({ page }) => {
    const { threadOf } = await openTalkedOn(page, 'en', 390)
    // What the page heard, so the press below is known to be a finger's and not a mouse's.
    await page.evaluate(() =>
      document.addEventListener(
        'pointerdown',
        (event) => (document.documentElement.dataset.pressedBy = event.pointerType),
        { capture: true },
      ),
    )
    const thread = threadOf('Should the second report')
    await thread.getByRole('button', { name: 'Reply', exact: true }).first().tap()
    await thread.getByRole('textbox', { name: 'Your reply' }).fill('Beside it, then.')
    await thread.getByRole('button', { name: 'Send', exact: true }).tap()
    await expect(page.locator('html')).toHaveAttribute('data-pressed-by', 'touch')
    const written = thread.locator('.reply').filter({ hasText: 'Beside it, then.' })
    expect(await landing(page, written, 'finger')).toEqual(RING_AFTER.finger)
  })
})
