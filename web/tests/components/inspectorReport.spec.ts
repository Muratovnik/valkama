/**
 * A report's friction: what hindered the work itself, on a line of its own after the result.
 *
 * The owner's rule: friction stands apart under its own label, its item numbers open as the
 * rest of the report's do, and nothing of it shows where there was none — absent, or `none`
 * as an agent writes it, in any case.
 */
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'

import { messages } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

type Report = { done: string; next: string; friction?: string; why?: string }
/** Opening is not what these cases look at. */
const stay = () => {}

/** The report inside a layer that opens every item number, as the card's does. */
function shown(report: Report, locale = 'en') {
  const Host = defineComponent({
    setup() {
      provideReferenceLinks((reference) => ({
        title: `Open ${reference.value}`,
        href: `/open/${reference.value}?in=browser`,
        open: stay,
      }))
    },
    render() {
      return h(InspectorReport, { report })
    },
  })
  return mount(Host, {
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
}
const terms = (wrapper: ReturnType<typeof shown>) =>
  wrapper.findAll('dt').map((term) => term.text())

describe('a report’s friction', () => {
  it('stands last under its own label, its item numbers links as the result’s are', () => {
    const wrapper = shown({
      done: 'Shipped; see MAIN-12.',
      next: 'Nothing',
      friction: 'MAIN-14 needed two claims.',
    })
    expect(terms(wrapper)).toEqual(['What was done', 'What comes next', 'Flow friction'])
    const friction = wrapper.get('.report-friction')
    expect(friction.text()).toBe('MAIN-14 needed two claims.')
    expect(friction.get('a').attributes('href')).toBe('/open/MAIN-14?in=browser')
    expect(wrapper.findAll('dd')[0]?.get('a').attributes('href')).toBe('/open/MAIN-12?in=browser')
  })

  it('is labelled in Russian as the owner reads it', () => {
    const wrapper = shown({ done: 'Готово', next: 'Ничего', friction: 'Два захода' }, 'ru')
    expect(terms(wrapper)).toContain('Трение процесса')
  })

  it('is not shown where there was none', () => {
    for (const friction of [undefined, '', 'none', 'None', ' NONE \n']) {
      const wrapper = shown({
        done: 'Shipped',
        next: 'Nothing',
        ...(friction !== undefined && { friction }),
      })
      expect(terms(wrapper)).toEqual(['What was done', 'What comes next'])
      expect(wrapper.find('.report-friction').exists()).toBe(false)
    }
  })

  it('leaves an old summary that wrote its friction into done as it was', () => {
    const done = 'Shipped.\n\nFlow friction: none'
    const wrapper = shown({ done, next: 'Nothing' })
    expect(wrapper.findAll('dd')[0]?.text()).toContain('Flow friction: none')
    expect(wrapper.find('.report-friction').exists()).toBe(false)
  })
})
