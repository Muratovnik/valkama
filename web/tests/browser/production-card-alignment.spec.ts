/**
 * The identity line over a card's title and the rows of facts under it, measured in the built
 * app. The texts of one line share a baseline, a row's name with its value's words, each icon or
 * dot stands on the middle of the capitals beside it, within half a pixel, and a word trimmed to
 * its capitals keeps all its letters. Every other surface that stands a sign beside words is
 * measured the same way in `production-sign-middle.spec.ts`.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openPlanFor } from './openSessionFixtures.ts'
import { blockedWorkItem, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { asked, installQuestions } from './questionBackend.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The room two texts of one line may stand apart from one baseline. */
const TOLERANCE = 1
/** The room a sign may stand off the middle of the capitals of its line, on every surface. */
const MIDDLE_ROOM = 0.5
/** Under half a pixel, so that two words of one line never round to two rows of pixels. */
const BASELINE_ROOM = 0.25

interface TextMeasure {
  /** The text's baseline, from the top of its own run plus the font's ascent. */
  baseline: number
  /** The middle of its capitals: the baseline less half the height of an `H`. */
  capCentre: number
  text: string
}

interface Measured {
  /** Each mark's vertical middle. */
  marks: Record<string, number>
  texts: Record<string, TextMeasure>
}

interface Spec {
  marks: Record<string, string>
  root: string
  texts: Record<string, string>
}

function measure(page: Page, spec: Spec): Promise<Measured> {
  return page.evaluate((input) => {
    const root = document.querySelector(input.root)
    if (!root) throw new Error(`no ${input.root}`)
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) throw new Error('no canvas')
    const texts: Record<string, TextMeasure> = {}
    for (const [name, selector] of Object.entries(input.texts)) {
      const element = root.querySelector(selector)
      if (!element) throw new Error(`no text ${selector}`)
      // A text the line has stepped aside is not drawn, so it has no line to measure.
      if (element.getClientRects().length === 0) continue
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node: Node | null = walker.nextNode()
      while (node && !node.textContent?.trim()) node = walker.nextNode()
      if (!node) throw new Error(`no words in ${selector}`)
      const range = document.createRange()
      range.selectNodeContents(node)
      const box = range.getBoundingClientRect()
      const style = getComputedStyle(element)
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const baseline = box.top + canvas.measureText('H').fontBoundingBoxAscent
      const capCentre = baseline - canvas.measureText('H').actualBoundingBoxAscent / 2
      texts[name] = { baseline, capCentre, text: node.textContent?.trim() ?? '' }
    }
    const marks: Record<string, number> = {}
    for (const [name, selector] of Object.entries(input.marks)) {
      const element = root.querySelector(selector)
      if (!element) throw new Error(`no mark ${selector}`)
      const box = element.getBoundingClientRect()
      marks[name] = (box.top + box.bottom) / 2
    }
    return { texts, marks }
  }, spec)
}

/** What a head holds beyond the state: each fact that prints a word beside its glyph. */
interface Head {
  asking?: boolean
  /** The reference of the item's parent, which is a link among the facts. */
  epic?: string
  kind?: string
  /** The parent's own kind, which its sign is drawn by; the fixture's is a plain task. */
  parentKind?: string
  priority?: string
  /** The name of the state the item stands in. */
  state?: string
}

const FULL_HEAD: Head = { asking: true, epic: 'MAIN-12', kind: 'epic', priority: 'high' }

/**
 * The item under its parent: the card's read says the id, the space's whose reference and kind
 * that is.
 */
function inEpic(model: Record<string, unknown>, reference: string, kind?: string) {
  const items = model.work_items as { reference: string; work_item_id: string }[]
  return {
    ...model,
    work_items: items.map((item) => {
      if (item.work_item_id === workItem.work_item_id)
        return { ...item, parent_id: blockedWorkItem.work_item_id }
      return item.work_item_id === blockedWorkItem.work_item_id
        ? { ...item, reference, ...(kind ? { kind } : {}) }
        : item
    }),
  }
}

/** The head of a card in the built app, on a state that moves, with the facts it is given. */
async function openCard(page: Page, locale: 'ru' | 'en', width: number, head: Head = {}) {
  const { asking, epic, kind, parentKind, priority, state = 'Review' } = head
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, {
    openPlan: openPlanFor,
    card: (read) => ({
      ...read,
      state: { ...(read.state as object), key: 'review', name: state, category: 'review' },
      ...(kind ? { kind } : {}),
      ...(priority ? { priority } : {}),
      ...(epic ? { parent_id: blockedWorkItem.work_item_id } : {}),
    }),
    ...(epic ? { space: (model) => inEpic(model, epic, parentKind) } : {}),
  })
  if (asking) await installQuestions(page, [asked()])
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer.locator('.card-identity')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  if (asking) await expect(drawer.locator('.card-question')).toBeVisible()
  if (epic) await expect(drawer.getByText(epic, { exact: true }).first()).toBeVisible()
  return drawer
}

/** The drawn words trimmed to their letters, and which box of theirs cuts those letters. */
function trimmedWords(page: Page) {
  return page.evaluate(() => {
    const words = [
      ...document.querySelectorAll<HTMLElement>('.drawer :is(.card-identity, .card-facts-block) *'),
    ].filter(
      (element) =>
        getComputedStyle(element).textBoxTrim !== 'none' &&
        getComputedStyle(element).clipPath === 'none' &&
        element.textContent?.trim(),
    )
    return words.map((word) => {
      const range = document.createRange()
      range.selectNodeContents(word)
      const letters = range.getBoundingClientRect()
      const cuts: string[] = []
      for (
        let box: HTMLElement | null = word;
        box && !box.matches('.drawer');
        box = box.parentElement
      ) {
        if (getComputedStyle(box).overflowY === 'visible') continue
        const edge = box.getBoundingClientRect()
        if (letters.top < edge.top - 0.5 || letters.bottom > edge.bottom + 0.5)
          cuts.push(
            `.${box.className} is ${edge.height}px tall over ${letters.height}px of letters`,
          )
      }
      return { cuts, text: word.textContent?.trim() ?? '' }
    })
  })
}

/**
 * Every text of the line shares the first one's baseline, and each mark stands on the middle of
 * the capitals of the text it is paired with.
 */
function alignmentGaps(measured: Measured, pairs: [string, string][]) {
  const [first, ...rest] = Object.values(measured.texts)
  const baselines = rest.map((other) => ({
    gap: Math.abs(other.baseline - first.baseline),
    label: `baseline of “${other.text}” against “${first.text}”`,
    room: TOLERANCE,
  }))
  const marks = pairs.map(([mark, text]) => {
    const target = measured.texts[text]
    return {
      gap: Math.abs(measured.marks[mark] - target.capCentre),
      label: `${mark} against the middle of “${target.text}”`,
      room: MIDDLE_ROOM,
    }
  })
  return [...baselines, ...marks]
}

const IDENTITY: Spec = {
  root: '.card-identity',
  texts: {
    kind: '.identity-kind',
    reference: '.head-reference',
    updated: '.identity-updated',
  },
  marks: {
    link: '.identity-link svg',
    source: '.identity-source svg',
  },
}

const STATE: Spec = {
  root: '.card-state',
  texts: { label: '.state-label' },
  marks: { dot: '.state-dot', chevron: '.choice-chevron' },
}

for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    test(`the identity line shares one baseline, and its marks centre on the capitals, ${locale} at ${width}px`, async ({
      page,
    }) => {
      await openCard(page, locale, width)
      const line = await measure(page, { ...IDENTITY, root: '.drawer .card-identity' })
      console.info(`identity ${locale} ${width}px`, JSON.stringify(line))
      // The date steps aside on a phone; the plan anchor then stands after the reference.
      const gaps = alignmentGaps(line, [
        ['link', 'reference'],
        ['source', line.texts.updated ? 'updated' : 'reference'],
      ])
      for (const { gap, label, room } of gaps) expect(gap, label).toBeLessThanOrEqual(room)
    })

    test(`the state button's dot and chevron centre on its label, ${locale} at ${width}px`, async ({
      page,
    }) => {
      await openCard(page, locale, width)
      const state = await measure(page, { ...STATE, root: '.drawer .card-state' })
      console.info(`state ${locale} ${width}px`, JSON.stringify(state))
      const gaps = alignmentGaps(state, [
        ['dot', 'label'],
        ['chevron', 'label'],
      ])
      for (const { gap, label, room } of gaps) expect(gap, label).toBeLessThanOrEqual(room)
    })
  }
}

test('the state word is cut short sideways only, so its trimmed box cuts no letter', async ({
  page,
}) => {
  await openCard(page, 'ru', 1280)
  const label = page.locator('.drawer .card-state .state-label')
  const box = await label.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      // Trimmed to the letters, so capitals and descenders stand outside the box.
      trimmed: element.getBoundingClientRect().height < Number.parseFloat(style.lineHeight),
      overflowY: style.overflowY,
      textOverflow: style.textOverflow,
    }
  })
  expect(box).toEqual({ trimmed: true, overflowY: 'visible', textOverflow: 'ellipsis' })
})

for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    for (const priority of ['high', 'medium']) {
      test(`a word trimmed to its letters keeps them all, ${priority}, ${locale} at ${width}px`, async ({
        page,
      }) => {
        await openCard(page, locale, width, { ...FULL_HEAD, priority })
        const words = await trimmedWords(page)
        // State, question, priority and epic at least: a head cannot pass by trimming fewer.
        expect(words.length).toBeGreaterThanOrEqual(4)
        expect(words.map(({ text }) => text)).toContain('MAIN-12')
        for (const { cuts, text } of words) expect(cuts, `the letters of “${text}”`).toEqual([])
      })
    }
  }
}

/**
 * The baseline of each row's name and of the words of its value on the value's first line: the
 * priority, the state and the question, the first labels, the holder and the parent.
 */
function factBaselines(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) throw new Error('no canvas')
    const WORDS =
      '.state-label, .card-question-word, .facet-word:not(.facet-word-hidden), .card-parent-link a, .open-action-name, .card-holder-name, .chip-face'
    const measure = (word: Element) => {
      const range = document.createRange()
      range.selectNodeContents(word)
      const style = getComputedStyle(word)
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const { top } = range.getBoundingClientRect()
      return { baseline: top + canvas.measureText('H').fontBoundingBoxAscent, top }
    }
    return [...document.querySelectorAll('.drawer .card-row')].map((row) => {
      const label = row.querySelector('.card-row-label')
      const words = [...row.querySelectorAll(`.card-row-value :is(${WORDS})`)]
      if (!label || words.length === 0) throw new Error(`no words in ${row.className}`)
      const firstLine = measure(words[0]).top
      const onFirstLine = words.filter((word) => Math.abs(measure(word).top - firstLine) < 12)
      return [label, ...onFirstLine].map((word) => ({
        baseline: measure(word).baseline,
        text: word.textContent?.trim() ?? '',
      }))
    })
  })
}

for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    test(`a row's name and its value's words share a baseline, ${locale} at ${width}px`, async ({
      page,
    }) => {
      await openCard(page, locale, width, FULL_HEAD)
      const lines = await factBaselines(page)
      console.info(`facts ${locale} ${width}px`, JSON.stringify(lines))
      // The priority, the state and «Answer», the labels, the holder and the parent, each with
      // its name, in the registry's order; «Answer» is short enough to stay on the state's line
      // on a phone.
      expect(lines).toHaveLength(5)
      expect(lines[1]).toHaveLength(3)
      for (const [first, ...rest] of lines)
        for (const other of rest)
          expect(
            Math.abs(other.baseline - first.baseline),
            `“${other.text}” against “${first.text}”`,
          ).toBeLessThanOrEqual(BASELINE_ROOM)
    })
  }
}

/**
 * The parent's row: any item may hold others, so the row is «Parent» and its sign is the
 * parent's own kind, in that kind's ink — the epic's for an epic, the generic parent's for a
 * plain task — at the size a facet's glyph is drawn at, as the priority's beside it, and on the
 * middle of the reference's capitals, as every sign of the facts stands. Every parent was called «Epic» under the epic's sign, a task holding others too.
 */
const PARENT_SIGNS = {
  epic: { icon: 'lucide-layers', ink: '--color-kind-epic' },
  task: { icon: 'lucide-corner-down-right', ink: '--color-kind-task' },
} as const
const PARENT_ROW = { ru: 'Родитель', en: 'Parent' } as const

for (const locale of ['ru', 'en'] as const) {
  for (const width of [1280, 390]) {
    for (const [parentKind, sign] of Object.entries(PARENT_SIGNS)) {
      test(`a ${parentKind} parent is named a parent and drawn by its own kind, ${locale} at ${width}px`, async ({
        page,
      }) => {
        const drawer = await openCard(page, locale, width, { epic: 'MAIN-12', parentKind })
        const names = await drawer.locator('.card-row-label').allTextContents()
        expect(names.map((name) => name.trim())).toContain(PARENT_ROW[locale])
        expect(names.map((name) => name.trim())).not.toContain(locale === 'ru' ? 'Эпик' : 'Epic')
        const mark = drawer.locator('.card-parent [data-facet="parent"]')
        await expect(mark).toHaveAttribute('data-kind', parentKind)
        const glyph = mark.locator('svg')
        await expect(glyph).toHaveClass(new RegExp(sign.icon, 'u'))
        const drawn = await glyph.evaluate((element, ink) => {
          const probe = document.createElement('span')
          probe.style.color = `var(${ink})`
          document.body.append(probe)
          const expected = getComputedStyle(probe).color
          probe.remove()
          const { width: across, height } = element.getBoundingClientRect()
          const declared = Number(element.getAttribute('width'))
          return { across, declared, height, ink: getComputedStyle(element).color, expected }
        }, sign.ink)
        // A facet's glyph is drawn at 14px on every surface (`drawMarks`).
        expect(drawn.declared).toBe(14)
        expect(drawn.across, 'the sign is as wide as it is drawn').toBeCloseTo(drawn.declared, 1)
        expect(drawn.height, 'the sign is as tall as it is drawn').toBeCloseTo(drawn.declared, 1)
        expect(drawn.ink, `the sign takes ${sign.ink}`).toBe(drawn.expected)
        const line = await measure(page, {
          root: '.drawer .card-parent',
          texts: { reference: '.card-parent-link a' },
          marks: { sign: '[data-facet="parent"] svg' },
        })
        console.info(`parent ${parentKind} ${locale} ${width}px`, JSON.stringify(line))
        for (const { gap, label, room } of alignmentGaps(line, [['sign', 'reference']]))
          expect(gap, label).toBeLessThanOrEqual(room)
      })
    }
  }
}

/** What a word short of room shows: its end replaced, its box inside the row. */
const shapeOf = (word: Locator) =>
  word.evaluate((element) => ({
    clipped: element.scrollWidth > element.clientWidth,
    ending: getComputedStyle(element).textOverflow,
    fits: element.getBoundingClientRect().right <= document.documentElement.clientWidth,
  }))

test('a long word on the first row is cut short sideways, with an ellipsis, and only there', async ({
  page,
}) => {
  // Only a state's name can outrun a phone's row: a reference holds twenty letters at most.
  const state = 'Согласование-'.repeat(8)
  const drawer = await openCard(page, 'ru', 390, { ...FULL_HEAD, state })
  const shortened = { clipped: true, ending: 'ellipsis', fits: true }
  expect(await shapeOf(drawer.locator('.card-facts .state-label', { hasText: state }))).toEqual(
    shortened,
  )
  const word = drawer.locator('.card-facts-block .card-fact .card-parent-link', {
    hasText: 'MAIN-12',
  })
  await word.evaluate((element) => {
    const fact = element.closest<HTMLElement>('.card-fact')
    if (fact) fact.style.maxWidth = '48px'
  })
  expect(await shapeOf(word)).toEqual(shortened)
  for (const { cuts, text } of await trimmedWords(page))
    expect(cuts, `the letters of “${text}”`).toEqual([])
})

/**
 * How many pixels of two pictures of one size stand apart by more than a word's edge can. A word
 * cut sideways at its box dims a fringe pixel where a glyph overhangs it, by 23 of 255 on «Ж», and
 * a letter cut across loses runs of them outright.
 */
function pixelsApart(page: Page, pictures: [Buffer, Buffer]) {
  return page.evaluate(
    async (encoded) => {
      // This body is serialized and evaluated in the page, so a module-scope helper would not be
      // in scope here.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const read = async (picture: string) => {
        const answer = await fetch(`data:image/png;base64,${picture}`)
        const bitmap = await createImageBitmap(await answer.blob())
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('no canvas')
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [first, second] = await Promise.all(encoded.map((picture) => read(picture)))
      let apart = 0
      for (let channel = 0; channel < first.length; channel += 1)
        if (Math.abs(first[channel] - second[channel]) > 48) apart += 1
      return apart
    },
    pictures.map((picture) => picture.toString('base64')),
  )
}

test.describe('at three device pixels', () => {
  test.use({ deviceScaleFactor: 3 })

  for (const width of [1280, 390]) {
    test(`the head draws the same with every trimmed word let out of its box, at ${width}px`, async ({
      page,
    }) => {
      const drawer = await openCard(page, 'ru', width, FULL_HEAD)
      const row = () => drawer.locator('.card-facts-block').screenshot({ animations: 'disabled' })
      const line = () => drawer.locator('.card-identity').screenshot({ animations: 'disabled' })
      const drawn = { line: await line(), row: await row() }
      await page.evaluate(() => {
        for (const element of document.querySelectorAll<HTMLElement>('.drawer *'))
          if (getComputedStyle(element).textBoxTrim !== 'none') element.style.overflow = 'visible'
      })
      expect(await pixelsApart(page, [drawn.row, await row()]), 'the first row').toBe(0)
      expect(await pixelsApart(page, [drawn.line, await line()]), 'the identity line').toBe(0)
    })
  }
})
