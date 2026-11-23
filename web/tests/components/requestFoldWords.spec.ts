/**
 * A closed question the service composed reads, under its answer, in the words its buttons were
 * pressed in: the field «Answer» and the option «Put it off» of a goal's question are the
 * reader's «Ответ» and «Позже…», the day it is put off until is named, and the findings of a
 * group keep the labels the agent listed them by. A question an agent composed keeps every
 * word it was written in.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RequestFold from '@/features/input-requests/components/RequestFold.vue'
import { answeredFields, spokenRequest } from '@/features/input-requests/utils/spokenFields.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import agentAsked from '../fixtures/server/request-answered.json'
import proposed from '../fixtures/server/request-proposed-goal.json'
import triage from '../fixtures/server/request-triage-group.json'

type Request = InputRequestEntry['request']

const read = (answer: unknown): Request =>
  validateInputRequestDetail(structuredClone(answer)).request

function i18n(locale: 'en' | 'ru') {
  return createI18n({ legacy: false, locale, messages, pluralRules })
}

function spoken(request: Request, locale: 'en' | 'ru') {
  const words = i18n(locale).global
  return spokenRequest(
    request,
    (key) => words.t(key),
    (key) => words.te(key),
  )
}

const labels = (request: Request) =>
  request.fields.map((field) => [field.label, field.options.map((option) => option.label)])

describe('spokenRequest', () => {
  it('names the fields and answers of a goal’s question in the reader’s words', () => {
    expect(labels(spoken(read(proposed), 'ru'))).toEqual([
      ['Ответ', ['Делать', 'Позже…', 'Не делать']],
      ['Отложить до', []],
      ['Ключ списка', []],
    ])
    expect(labels(spoken(read(proposed), 'en'))[0]).toEqual([
      'Answer',
      ['Do', 'Later…', 'Don’t do'],
    ])
  })

  it('keeps the findings a group lists by the agent’s labels', () => {
    const [answer, items] = labels(spoken(read(triage), 'ru'))
    expect(answer).toEqual(['Ответ', ['Делать', 'Позже…', 'Не делать']])
    expect(items).toEqual([
      'Находки группы',
      ['MAIN-28 · Finding in the export', 'MAIN-29 · Another finding in the export'],
    ])
  })

  it('names a session’s consent in the reader’s words', () => {
    const request = read(proposed)
    const [answer] = request.fields
    if (!answer) throw new Error('the question lost its answer field')
    const consent: Request = {
      ...request,
      purpose: 'consent',
      fields: [
        {
          ...answer,
          options: ['agree', 'object', 'moved_out', 'other'].map((id) => ({
            id,
            label: `Server ${id}`,
          })),
        },
      ],
    }
    expect(labels(spoken(consent, 'ru'))).toEqual([
      ['Ответ', ['согласна', 'возражает', 'вынесла свою работу', 'Server other']],
    ])
  })

  it('keeps every word of a question an agent composed', () => {
    const request = read(agentAsked)
    expect(spoken(request, 'ru')).toBe(request)
  })
})

function answered(request: Request, locale: 'en' | 'ru') {
  const words = i18n(locale).global
  return answeredFields(
    request,
    (key) => words.t(key),
    (key) => words.te(key),
  ).map((field) => [field.label, field.options.map((option) => option.label)])
}

describe('answeredFields', () => {
  it('offers a goal’s answers on its form as its buttons name them, and keeps what to type', () => {
    const request = read(proposed)
    const typed = request.fields.slice(1).map((field) => [field.label, []])
    expect(answered(request, 'ru')).toEqual([
      ['Ответ', ['Делать', 'Позже…', 'Не делать']],
      ...typed,
    ])
    expect(answered(request, 'en')[0]).toEqual(['Answer', ['Do', 'Later…', 'Don’t do']])
    expect(typed).toHaveLength(2)
  })

  it('keeps a session’s consent and a question an agent composed as the server wrote them', () => {
    const request = read(proposed)
    const consent: Request = { ...request, purpose: 'consent' }
    expect(answeredFields(consent, String, () => true)).toBe(consent.fields)
    const agents = read(agentAsked)
    expect(answeredFields(agents, String, () => true)).toBe(agents.fields)
  })
})

describe('the fold of an answered goal question', () => {
  it('says the field and the answer chosen in the reader’s words', () => {
    const request = read(proposed)
    const answered: Request = {
      ...request,
      status: 'answered',
      answers: { answer: 'later', until: '2026-12-01' },
      resolved_at: '2026-11-20T10:00:00Z',
      answered_by: 'owner',
      by_person: true,
    }
    const wrapper = mount(RequestFold, {
      props: { outcomeId: 'outcome', request: answered, unsent: '', unsentChosen: [] },
      global: { plugins: [i18n('ru')] },
    })
    // The prompt above it is the service's sentence as stored; the reply is the fold's own.
    const text = wrapper.get('.request-reply').text()
    expect(text).toContain('Ответ')
    expect(text).toContain('Позже…')
    expect(text).toContain('Отложить до')
    expect(text).not.toMatch(/Answer|Put it off|Take it on|Until:/u)
    wrapper.unmount()
  })
})
