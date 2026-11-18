/**
 * How a spec of the Analytics page reads the quota: its tiles on the rail, its panel's accounts
 * and windows, the controls the panel and a window's step line are switched by, and the headings
 * of a level. Each control is found by its role and its name, and a heading by its level, so a
 * styling class that moves or is renamed changes nothing a reader sees and nothing here.
 */
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { expect } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'

type Scope = DOMWrapper<Element> | VueWrapper

/** Words as a reader reads them: the app keeps a figure and its unit together with a no-break space. */
export const plain = (text: string) => text.replaceAll('\u{A0}', ' ')

export const tile = (page: VueWrapper, section: string) => page.get(`[data-section="${section}"]`)

/** What a tile says: its lead, its share and the state beside its name. */
export function says(page: VueWrapper, section: string) {
  const textIn = (part: string) =>
    tile(page, section)
      .findAll(part)
      .map((one) => one.text())
      .join('')
  return {
    lead: textIn('.rail-tile-lead'),
    aside: textIn('.rail-tile-aside'),
    count: textIn('.analytics-rail-count'),
  }
}

export const accounts = (page: VueWrapper) => page.findAll('.quota-account')

export function accountNamed(page: VueWrapper, name: string) {
  const found = accounts(page).find((one) => one.get('.quota-account-name').text() === name)
  if (!found) throw new Error(`no account ${name}`)
  return found
}

/** The one radio in `scope` a reader hears as `name`. */
export function radioNamed(scope: Scope, name: string) {
  const found = scope.findAll('[role="radio"]').filter((one) => one.text() === name)
  expect(found).toHaveLength(1)
  const [radio] = found
  if (!radio) throw new Error(`no radio ${name}`)
  return radio
}

/** Shows the panel as a table by its own switch, named «Table», not a step line's span. */
export async function showTable(page: VueWrapper) {
  await radioNamed(page, messages.en.analytics.shown.table).trigger('click')
  await flushPromises()
}

/** The words of every heading of `level` in `scope`, as an outline lists them. */
export const headings = (scope: Scope, level: number) =>
  scope
    .findAll(`h${level}, [role="heading"][aria-level="${level}"]`)
    .map((one) => plain(one.text()))

/**
 * What a window of the panel says: its state, its lead, its facts, and what its bar's hint adds —
 * where steady use would stand, then how old the latest reading is and who read it — with the
 * bar's words for a screen reader.
 */
export function windowOf(account: DOMWrapper<Element>, kind: string) {
  const window = account.get(`.quota-window[data-window="${kind}"]`)
  const fact = (key: string) => plain(window.get(`[data-fact="${key}"]`).text())
  const bar = window.get('.quota-window-bar')
  const [even, latest, ...more] = plain(bar.attributes('data-tooltip') ?? '').split('\n')
  return {
    state: window.attributes('data-state'),
    lead: plain(window.get('.quota-window-lead').text()),
    filled: window.find('.window-fill').exists(),
    /** The parts of the bar's hatched tail, and whether the forecast's line names its hatch. */
    tail: window.findAll('.window-ahead').length,
    keyed: window.find('[data-fact="forecast"] [data-mark="hatch"]').exists(),
    reset: fact('reset'),
    forecast: fact('forecast'),
    facts: window.findAll('[data-fact]').map((one) => one.attributes('data-fact')),
    even,
    latest,
    more,
    label: plain(bar.get('.window-track').attributes('aria-label') ?? ''),
  }
}
