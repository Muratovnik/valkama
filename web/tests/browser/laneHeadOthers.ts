/**
 * The layouts a lane heading could have drawn instead of the one it draws: its actions at the end
 * of its last line, beside the title, or at the end taking the last part down with them, each
 * with the state among the parts after the title and, where the state is shown, on the title's
 * line. Each is drawn on a copy of the heading laid after it, read as the heading itself is read
 * (`laneHeadRows.ts`), and taken away. What the heading draws is held against the best of these:
 * a line more than the base, or the actions on a line alone, is the cost of a rule only where
 * every layout with fewer lines covers text, leaves a part alone on a line or cuts the title.
 */
import type { Locator } from '@playwright/test'

import { overlaps } from './laneHeadGeometry.ts'
import { readHeading } from './laneHeadRows.ts'
import type { Reading } from './laneHeadRows.ts'

/** The text an action lies over, by member. Read at rest too: they come up where they stand. */
export function covered(reading: Reading): string[] {
  const actions = reading.parts.filter(({ member }) => member === 'action')
  return reading.parts
    .filter(
      ({ box, member }) => member !== 'action' && actions.some((one) => overlaps(one.box, box)),
    )
    .map(({ member }) => member)
}

/** The lines that hold the state alone or the actions alone. */
const loneLines = (reading: Reading) =>
  reading.rows.filter(
    (row) => row.every((member) => member === 'action') || (row.length === 1 && row[0] === 'state'),
  )

/** The layouts tried: where the actions stand, and whether the state stands on the title's line. */
const LAYOUTS = [false, true].flatMap((raised) =>
  (['end', 'beside', 'tied'] as const).map((place) => ({ place, raised })),
)

/** Lays a copy of `head` after its copies so far, laid out one way; runs in the page. */
const lay = (head: Element, { place, raised }: { place: string; raised: boolean }) => {
  const copy = head.cloneNode(true) as HTMLElement
  copy.classList.remove('crowded', 'tied')
  copy.querySelector('.lane-break')?.remove()
  const state = copy.querySelector('.lane-state:not(.visually-hidden)')
  if (state && raised) copy.querySelector('.lane-toggle')?.after(state)
  else if (state) copy.querySelector('.lane-tail')?.prepend(state)
  copy.classList.toggle('crowded', place === 'beside')
  copy.classList.toggle('tied', place === 'tied')
  if (place === 'tied') {
    const gap = document.createElement('span')
    gap.className = 'lane-break'
    // The scoped style reaches only elements that carry the component's attribute.
    const scope = [...head.attributes].find(({ name }) => name.startsWith('data-v-'))
    if (scope) gap.setAttribute(scope.name, '')
    copy.querySelector('.lane-actions')?.before(gap)
  }
  const name = `${place}${raised ? ', the state beside the title' : ''}`
  copy.dataset.layout = name
  const copies = head.parentElement?.querySelectorAll('[data-layout]') ?? []
  ;(copies.length > 0 ? [...copies].at(-1) : head)?.after(copy)
  return name
}

/** Every layout `head` could draw, as drawn on a copy of it; none where it has no actions. */
async function layouts(head: Locator): Promise<{ name: string; reading: Reading }[]> {
  const page = head.page()
  const actions = await head.locator('.lane-actions').count()
  const shown = await head.locator('.lane-state:not(.visually-hidden)').count()
  const found: { name: string; reading: Reading }[] = []
  for (const layout of LAYOUTS.filter(({ raised }) => actions > 0 && (shown > 0 || !raised))) {
    const name = await head.evaluate(lay, layout)
    found.push({ name, reading: await readHeading(page.locator(`[data-layout="${name}"]`)) })
  }
  await page.evaluate(() => {
    for (const copy of document.querySelectorAll('[data-layout]')) copy.remove()
  })
  return found
}

/**
 * The layouts that draw `head` in fewer lines than `rest`, or `slack` more, covering nothing,
 * leaving nothing alone on a line, running past nothing and keeping the title's letters.
 */
export async function better(head: Locator, rest: Reading, slack = 0): Promise<string[]> {
  const drawn = await layouts(head)
  return drawn.flatMap(({ name, reading }) =>
    reading.rows.length < rest.rows.length + slack &&
    covered(reading).length === 0 &&
    loneLines(reading).length === 0 &&
    reading.titleChars >= rest.titleChars &&
    reading.parts.every(({ box }) => box.left >= -0.5 && box.right <= reading.width + 0.5)
      ? [`${name} draws ${reading.rows.length}`]
      : [],
  )
}
