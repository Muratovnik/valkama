/**
 * A name as a chart draws it (`PairName`): a pair's end stays whole while its first part gives way,
 * and a name that holds a work item's title is drawn in its runs, the title's code as code
 * without its backticks, in either part. A name with no runs is the text it is.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { titleRuns } from '@/shared/lib/titleRuns.ts'
import PairName from '@/shared/ui/PairName.vue'
import type { TextRun } from '@/shared/ui/textRuns.ts'

const TASK = 'MAIN-7 Raise `STORE_SCHEMA_VERSION`'
const runsOf = (...parts: TextRun[][]) => parts.flat()
const text = (words: string): TextRun[] => [{ kind: 'text', text: words }]

const drawn = (props: { name: string; end?: string; runs?: readonly TextRun[] }) =>
  mount(PairName, { props, attachTo: document.body })

describe('a name drawn in runs', () => {
  it('draws a pair in its two parts, the code of the part that gives way as code', () => {
    const name = `${TASK} · model-a`
    const wrapper = drawn({
      name,
      end: ' · model-a',
      runs: runsOf(titleRuns(TASK), text(' · model-a')),
    })
    expect(wrapper.find('.pair-start').text()).toBe('MAIN-7 Raise STORE_SCHEMA_VERSION')
    expect(wrapper.find('.pair-start code').text()).toBe('STORE_SCHEMA_VERSION')
    expect(wrapper.find('.pair-end').element.textContent).toBe(' · model-a')
    expect(wrapper.text()).not.toContain('`')
    wrapper.unmount()
  })

  it('draws the task at either end of a pair in runs', () => {
    const name = `model-a · ${TASK}`
    const end = ` · ${TASK}`
    const wrapper = drawn({ name, end, runs: runsOf(text('model-a · '), titleRuns(TASK)) })
    expect(wrapper.find('.pair-start').text()).toBe('model-a')
    expect(wrapper.find('.pair-end code').text()).toBe('STORE_SCHEMA_VERSION')
    wrapper.unmount()
  })

  it('draws a name of one part in its runs, and one with none as the text it is', () => {
    const coded = drawn({ name: TASK, runs: titleRuns(TASK) })
    expect(coded.find('code').text()).toBe('STORE_SCHEMA_VERSION')
    expect(coded.text()).toBe('MAIN-7 Raise STORE_SCHEMA_VERSION')
    coded.unmount()
    const plain = drawn({ name: 'Run `npm test` · high', end: ' · high' })
    expect(plain.find('code').exists()).toBe(false)
    expect(plain.find('.pair-start').text()).toBe('Run `npm test`')
    plain.unmount()
  })
})
