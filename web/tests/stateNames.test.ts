/**
 * How a workflow state is named on screen. The server gives a new space seven states
 * (`DEFAULT_STATES` in `server/planning/model.py`); one of those, under the name it was given,
 * reads in the interface's language, and every other state reads as its workflow writes it.
 */
import { describe, expect, it } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'
import { stateName } from '@/shared/lib/stateNames.ts'

/** The interface's words, looked up the way vue-i18n does for a message path. */
function words(locale: 'en' | 'ru') {
  return (path: string) => {
    let node: unknown = messages[locale]
    for (const part of path.split('.')) node = (node as Record<string, unknown>)[part]
    if (typeof node !== 'string') throw new TypeError(`no message ${path}`)
    return node
  }
}

const ru = words('ru')

/** The workflow a new space is given, as the server writes it: key, name, category. */
const DEFAULT_WORKFLOW = [
  ['backlog', 'Backlog', 'backlog', 'Бэклог'],
  ['todo', 'Todo', 'queued', 'К работе'],
  ['dev', 'Dev', 'active', 'В работе'],
  ['review', 'Review', 'review', 'Проверка'],
  ['done', 'Done', 'completed', 'Выполнено'],
  ['blocked', 'Blocked', 'blocked', 'Заблокировано'],
  ['cancelled', 'Cancelled', 'cancelled', 'Отменено'],
] as const

describe('a state under the translated setting', () => {
  it.each(DEFAULT_WORKFLOW)(
    'standard and unrenamed, %s reads translated',
    (key, name, category, word) => {
      expect(stateName({ key, name, category }, 'translated', ru)).toBe(word)
    },
  )

  it('reads in English in the category’s own words', () => {
    const en = words('en')
    expect(stateName({ key: 'dev', name: 'Dev' }, 'translated', en)).toBe('In progress')
    expect(stateName({ key: 'todo', name: 'Todo' }, 'translated', en)).toBe('Queued')
  })

  it('renamed, reads as written, however close the new name is', () => {
    for (const name of ['Development', 'dev', 'DEV', 'Dev ', 'В разработке'])
      expect(stateName({ key: 'dev', name, category: 'active' }, 'translated', ru)).toBe(name)
  })

  it('of a key the default workflow does not have, reads as written, even under a standard name', () => {
    expect(stateName({ key: 'icebox', name: 'Icebox' }, 'translated', ru)).toBe('Icebox')
    expect(stateName({ key: 'qa', name: 'Review', category: 'review' }, 'translated', ru)).toBe(
      'Review',
    )
    expect(stateName({ key: 'constructor', name: 'Dev' }, 'translated', ru)).toBe('Dev')
  })

  it('carried with no key, is the standard one by its name, in its category where it has one', () => {
    expect(stateName({ name: 'Dev', category: 'active' }, 'translated', ru)).toBe('В работе')
    expect(stateName({ name: 'Done' }, 'translated', ru)).toBe('Выполнено')
    expect(stateName({ name: 'Dev', category: 'review' }, 'translated', ru)).toBe('Dev')
    expect(stateName({ name: 'Development', category: 'active' }, 'translated', ru)).toBe(
      'Development',
    )
  })
})

describe('a state under the setting «as in the workflow»', () => {
  it('reads as written, every one of them', () => {
    for (const [key, name, category] of DEFAULT_WORKFLOW) {
      expect(stateName({ key, name, category }, 'workflow', ru)).toBe(name)
      expect(stateName({ name, category }, 'workflow', ru)).toBe(name)
    }
    expect(stateName({ key: 'dev', name: 'Development' }, 'workflow', ru)).toBe('Development')
    expect(stateName({ key: 'icebox', name: 'Icebox' }, 'workflow', ru)).toBe('Icebox')
  })
})
