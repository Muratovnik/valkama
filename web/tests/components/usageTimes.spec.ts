/**
 * The two times of an item's work, each by its own name. The oracle is the requirement: the
 * card's line names its first time as the time on the clock, «Work on the clock», and where
 * agents worked side by side, so that the sum of each one's time says another figure, that sum
 * stands beside it as «Agent time», the name Analytics gives the same sum; the Agents tab names
 * them alike. Where the two say one figure, the agents' time is not said again.
 */
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import InspectorUsageLine from '@/widgets/work-item-inspector/components/InspectorUsageLine.vue'

import { richUsage } from '../fixtures/usage.ts'
import { mountSummary } from './usageSummaryHost.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** Each fact of the card's line by its key: its label, if it has one, and its figure. */
const facts = (line: VueWrapper) =>
  Object.fromEntries(
    line.findAll('[data-fact]').map((fact) => {
      const label = fact.find('.usage-fact-label')
      const said = label.exists() ? words(label.text()) : ''
      return [fact.attributes('data-fact'), [said, words(fact.text()).slice(said.length).trim()]]
    }),
  )

describe('the two times on the card', () => {
  it('names the time on the clock and the agents’ time beside it, each its own', () => {
    // Two agents side by side: 7 h 38 min passed, and the two spent 11 h 14 min together.
    const line = mountSummary(richUsage({ quality: 'observed' }), { part: InspectorUsageLine })
    const said = facts(line)
    expect(said.time).toEqual(['Work on the clock', '7 h 38 min'])
    expect(said.agents).toEqual(['Agent time', '11 h 14 min'])
    expect(Object.keys(said)).toEqual(['time', 'agents', 'cost', 'tokens'])
  })

  it('names them in Russian', () => {
    const line = mountSummary(richUsage({ quality: 'observed' }), {
      part: InspectorUsageLine,
      locale: 'ru',
    })
    const said = facts(line)
    expect(said.time).toEqual(['Работа по часам', '7 ч 38 мин'])
    expect(said.agents).toEqual(['Время агентов', '11 ч 14 мин'])
  })

  it('does not say the agents’ time again where it is the time on the clock', () => {
    const line = mountSummary(
      richUsage({ quality: 'observed', elapsed_seconds: 3600, agent_seconds: 3600 }),
      { part: InspectorUsageLine },
    )
    expect(Object.keys(facts(line))).toEqual(['time', 'cost', 'tokens'])
    expect(facts(line).time).toEqual(['Work on the clock', '1 h'])
  })

  it('names them alike on the Agents tab', () => {
    const tab = mountSummary(richUsage({ quality: 'observed' }))
    const text = words(tab.text())
    expect(text).toContain('Work on the clock 7 h 38 min')
    expect(text).toContain('Agent time 11 h 14 min')
  })
})
