import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NavWorkActions from '@/widgets/app-nav/components/NavWorkActions.vue'

import { messages } from '@/shared/i18n/index.ts'

type Pending = { incomplete: boolean; value: number } | null

function mountActions(pendingCount: Pending) {
  return mount(NavWorkActions, {
    props: { pendingCount },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
    },
  })
}

describe('rail work actions', () => {
  // An aria-label replaces everything inside the button, so a pending count
  // printed beside the label would be seen and never heard (WCAG 2.5.3).
  it('names the questions button by its label and the count it shows', () => {
    const questions = mountActions({ value: 3, incomplete: false }).findAll('button')[1]
    expect(questions.attributes('aria-label')).toBeUndefined()
    // The badge is a box of its own, so a browser joins the two with a space.
    expect(questions.text().trim()).toMatch(/^Needs my answer\s*3$/)
  })

  // A source that could not be read may hold more questions, so the number is
  // a floor and the rail says so with the plus the dialog also prints.
  it('shows a count that is incomplete with a plus, and a complete one without', () => {
    const floor = mountActions({ value: 2, incomplete: true }).findAll('button')[1]
    expect(floor.text().trim()).toMatch(/^Needs my answer\s*2\+$/)
    const whole = mountActions({ value: 2, incomplete: false }).findAll('button')[1]
    expect(whole.text().trim()).toMatch(/^Needs my answer\s*2$/)
  })

  // The interface font has no ⌘, and drawing one made every first screen fetch
  // the 193 kB fallback face, which has none either.
  it('prints the finder shortcut in glyphs the interface font draws', () => {
    const finder = mountActions(null).findAll('button')[0]
    expect(finder.find('kbd').text()).toBe('Ctrl K')
    expect(finder.attributes('aria-keyshortcuts')).toBe('Control+k Meta+k')
  })

  // The shortcut is printed for the eye in the wide rail and hidden in the
  // narrow one; were it part of the name, the name would change with the
  // rail's width and repeat what aria-keyshortcuts already says.
  it('keeps the printed shortcut out of the finder button name', () => {
    const finder = mountActions(null).findAll('button')[0]
    expect(finder.find('kbd').attributes('aria-hidden')).toBe('true')
    expect(finder.attributes('aria-label')).toBeUndefined()
  })

  it('names it by its label alone while nothing waits', () => {
    const questions = mountActions({ value: 0, incomplete: false }).findAll('button')[1]
    expect(questions.attributes('aria-label')).toBeUndefined()
    expect(questions.text().trim()).toBe('Needs my answer')
  })
})
