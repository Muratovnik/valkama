import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NavWorkActions from '@/widgets/app-nav/components/NavWorkActions.vue'

import { messages } from '@/shared/i18n/index.ts'

function mountActions(pendingCount: number | null) {
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
    const questions = mountActions(3).findAll('button')[1]
    expect(questions.attributes('aria-label')).toBeUndefined()
    // The badge is a box of its own, so a browser joins the two with a space.
    expect(questions.text().trim()).toMatch(/^Needs my answer\s*3$/)
  })

  // The interface font has no ⌘, and drawing one made every first screen fetch
  // the 193 kB fallback face, which has none either.
  it('prints the finder shortcut in glyphs the interface font draws', () => {
    const finder = mountActions(null).findAll('button')[0]
    expect(finder.find('kbd').text()).toBe('Ctrl K')
    expect(finder.attributes('aria-keyshortcuts')).toBe('Control+k Meta+k')
  })

  it('names it by its label alone while nothing waits', () => {
    const questions = mountActions(0).findAll('button')[1]
    expect(questions.attributes('aria-label')).toBeUndefined()
    expect(questions.text().trim()).toBe('Needs my answer')
  })
})
