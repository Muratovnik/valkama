/**
 * A list of a given width in a test that lays nothing out. The list stands the widest fit
 * whose table its box holds (`useListFit.ts`), and jsdom draws every box 0px wide, so here
 * the list's box is `width` and its table, in each fit, as wide as `needs` says: a fit the
 * width holds draws its table as wide as the list, one it does not draws it wider.
 */
import type { Fit } from '@/widgets/work-item-views/utils/listColumns.ts'

/** What a list of short words needs in each fit: every column from 1270px, all but two from 920. */
const SHORT_WORDS: Readonly<Record<Fit, number>> = {
  full: 1270,
  wide: 920,
  medium: 560,
  narrow: 0,
}

function tableWidth(table: HTMLTableElement, width: number, needs: Readonly<Record<Fit, number>>) {
  const fit = table.closest<HTMLElement>('.work-item-list')?.dataset.fit as Fit | undefined
  const need = fit ? needs[fit] : 0
  return need > width ? need : width
}

/** Runs `run` with every list `width` pixels wide and its table as wide as `needs` says. */
export async function atListWidth(
  width: number,
  run: () => Promise<void> | void,
  needs: Readonly<Record<Fit, number>> = SHORT_WORDS,
) {
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const rect = Object.getOwnPropertyDescriptor(HTMLTableElement.prototype, 'getBoundingClientRect')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  })
  Object.defineProperty(HTMLTableElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLTableElement) {
      const drawn = tableWidth(this, width, needs)
      return { x: 0, y: 0, top: 0, left: 0, right: drawn, bottom: 0, width: drawn, height: 0 }
    },
  })
  try {
    await run()
  } finally {
    if (client) Object.defineProperty(HTMLElement.prototype, 'clientWidth', client)
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
    if (rect) Object.defineProperty(HTMLTableElement.prototype, 'getBoundingClientRect', rect)
    else Reflect.deleteProperty(HTMLTableElement.prototype, 'getBoundingClientRect')
  }
}
