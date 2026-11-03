import { expect, test } from 'vitest'

import { checkAnswers, hasDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

const options = [
  { id: 'keep', label: 'Keep' },
  { id: 'merge', label: 'Merge' },
]
const fields: InputRequestField[] = [
  { id: 'proceed', label: 'Proceed', type: 'boolean', required: true, options: [] },
  { id: 'branch', label: 'Branch', type: 'choice', required: true, options },
  { id: 'extra', label: 'Extra', type: 'multi_choice', required: false, options },
  { id: 'note', label: 'Note', type: 'text', required: true, options: [] },
]

test('names every refused field, in the order the question lists them', () => {
  expect(checkAnswers(fields, {})).toEqual({
    refused: ['proceed', 'branch', 'note'],
    values: {},
  })
})

test('refuses a value that is present but not an answer', () => {
  const { refused } = checkAnswers(fields, {
    proceed: 'true',
    branch: 'unknown',
    note: '   ',
  })
  expect(refused).toEqual(['proceed', 'branch', 'note'])
})

test('asks for something at the first field when nothing is chosen or written, required or not', () => {
  const optional = [
    { id: 'extra', label: 'Extra', type: 'multi_choice', required: false, options: [] },
    { id: 'words', label: 'Words', type: 'text', required: false, options: [] },
  ] as InputRequestField[]
  expect(checkAnswers(optional, {}).refused).toEqual(['extra'])
  expect(checkAnswers(optional, { extra: [], words: '' }, '   ').refused).toEqual(['extra'])
  expect(checkAnswers(optional, {}, 'Words of my own')).toEqual({ refused: [], values: {} })
  expect(checkAnswers(optional, { words: 'A word' })).toEqual({
    refused: [],
    values: { words: 'A word' },
  })
})

test('sends false, leaves out an empty optional field and refuses nothing', () => {
  expect(checkAnswers(fields, { proceed: false, branch: 'merge', extra: [], note: 'why' })).toEqual(
    { refused: [], values: { proceed: false, branch: 'merge', note: 'why' } },
  )
})

test('with words of one’s own nothing is required, and what was given still goes', () => {
  expect(checkAnswers(fields, {}, 'My own words')).toEqual({ refused: [], values: {} })
  expect(checkAnswers(fields, { proceed: true }, 'My own words')).toEqual({
    refused: [],
    values: { proceed: true },
  })
  expect(checkAnswers(fields, {}, '   ').refused).toContain('proceed')
})

test('a draft holds a choice or a note, and neither an empty note nor no ticks count', () => {
  expect(hasDraft(undefined)).toBe(false)
  expect(hasDraft({ answers: { extra: [] }, note: '  ' })).toBe(false)
  expect(hasDraft({ answers: { proceed: false }, note: '' })).toBe(true)
  expect(hasDraft({ answers: {}, note: 'Words' })).toBe(true)
})
