/**
 * A question Valkama asks stands under a head that names its card by number and title, and is
 * answered by buttons, or on its card by its form's options, in the interface's words
 * (DESIGN.md, the kinds of question): its words say neither the number nor the title again,
 * name each answer as the buttons do, and ask before the agent's own words, which may run
 * long and fold away under «Show all».
 */
import { describe, expect, it } from 'vitest'

import type { PromptMessage } from '@/shared/api/composedTextModel.ts'

import { prompt, QUESTIONS, sayIn } from './support/composedQuestions.ts'
import type { Locale } from './support/composedQuestions.ts'

/**
 * The answers a question's buttons offer, by the key Valkama asks it with, in their order
 * (`questionKinds.ts`, `request_model.py`); a task an agent moves into a goal stays where it was
 * (`stay`). A group names its count, a confirmation answers in the first person («I confirm»)
 * and a session's consent is an agent's to answer: their prompts name no buttons.
 */
const ANSWERED: Partial<Record<PromptMessage['key'], string[]>> = {
  task_filed: ['do', 'later', 'out', 'drop'],
  task_moved_in: ['do', 'later', 'stay', 'drop'],
  task_moved_to: ['do', 'later', 'out', 'drop'],
  goal_proposed: ['do', 'later', 'drop'],
  goal_came_back: ['do', 'later', 'drop'],
  put_off_asked: ['do', 'later', 'drop'],
  put_off_came: ['do', 'later', 'drop'],
  cancel_asked: ['cancel', 'keep'],
  steps_asked: ['allow', 'keep'],
}
/** The agent's own words a prompt carries, which may run long and fold away. */
const agentWords = (message: PromptMessage) =>
  'reason' in message.values && typeof message.values.reason === 'string'
    ? message.values.reason
    : null
const LOCALES: Locale[] = ['en', 'ru']
const asked = QUESTIONS.flatMap(([message]) => LOCALES.map((locale) => [message, locale] as const))

describe('a question under the head of its block', () => {
  it.each(asked)(
    '%j in %s says neither the number nor the title of its own card',
    (message, locale) => {
      const said = prompt(message, locale)
      if ('title' in message.values) expect(said).not.toContain(message.values.title)
      if ('reference' in message.values) expect(said).not.toContain(message.values.reference)
    },
  )

  const answered = asked.filter(([message]) => ANSWERED[message.key])
  it('has an answered example of every key that names its buttons', () => {
    expect(new Set(answered.map(([message]) => message.key))).toEqual(
      new Set(Object.keys(ANSWERED)),
    )
  })

  it.each(answered)('%j in %s names each answer as its button does', (message, locale) => {
    const said = prompt(message, locale).toLowerCase()
    const say = sayIn(locale)
    for (const answer of ANSWERED[message.key] ?? []) {
      const button = say(`requests.kinds.answers.${answer}`)
      expect(button).not.toBe(`requests.kinds.answers.${answer}`)
      expect(said).toContain(button.replace(/…$/u, '').toLowerCase())
    }
  })

  it.each(answered.filter(([message]) => agentWords(message)))(
    '%j in %s asks before the agent’s own words',
    (message, locale) => {
      const said = prompt(message, locale).toLowerCase()
      const last = (ANSWERED[message.key] ?? []).at(-1) ?? ''
      const button = sayIn(locale)(`requests.kinds.answers.${last}`).toLowerCase()
      const reason = (agentWords(message) ?? '').toLowerCase()
      expect(said.indexOf(button)).toBeGreaterThan(-1)
      expect(said.indexOf(button)).toBeLessThan(said.indexOf(reason))
    },
  )
})
